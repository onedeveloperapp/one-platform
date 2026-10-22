import "server-only";

import { after } from "next/server";
import { createHash, randomBytes } from "node:crypto";

import { runFirmTask } from "@/lib/ai/executor";
import {
  byPersonMessage,
  calledMessage,
  caseOpenedNoLinkMessage,
  caseStepsMessage,
  cleanReply,
  CONVERSATION_TASK,
  declinedMessage,
  lastClientWords,
  minorsOf,
  modelAnswerOf,
  modelInput,
  quickAnswer,
  type TurnContext,
  turnContextOf,
} from "@/lib/conversations/agent";
import { deliverOutbox } from "@/lib/whatsapp/send";
import { createServiceClient } from "@flyee/auth/service";
import { BRAND } from "@flyee/content";
import { sendEvent } from "@flyee/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of ONE in a conversation (migration 0048): a turn is
 * claimed under a number, read, and answered. The passenger's plain answer
 * to ONE's first word is the database's to keep (a yes opens the case with
 * the trip and sends the link with the next steps; a no ends it; a stop
 * stops everything); anything else is read by a run of the task
 * `atendimento.conversa`, whose answer goes as ONE's when the firm lets it,
 * or waits in the queue for a person's "Enviar". When ONE cannot go on, it
 * calls a person. Every message goes through the outbox of 0019, once.
 * Nothing of a passenger is kept in a job's state: the steps carry ids and
 * counts.
 */

export type TurnReport = { claimed: number; answered: number; opened: number; called: number; failed: number };

/** How many answers ONE gives a conversation in an hour before it calls a person (the database's setting is read with the turn). */
const ANSWERS_PER_HOUR = 20;

/** Today on the platform's calendar (Brasília): the day a child is a child on. */
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

async function send(service: SupabaseClient, messageId: unknown): Promise<void> {
  if (typeof messageId !== "string") return;
  try {
    await deliverOutbox(service, { messageId });
  } catch {
    // Queued: the outbox's sweep sends it.
  }
}

type Held = { conversationId: string; claim: number };

async function rpc(
  service: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await service.rpc(name, args);
  if (error) throw new Error(`${name} failed`);
  return (data ?? {}) as Record<string, unknown>;
}

/** ONE says something of its own in the conversation, and it is sent. */
async function say(service: SupabaseClient, held: Held, body: string): Promise<void> {
  const answer = await rpc(service, "one_say", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_body: body,
  });
  if (answer.ok) await send(service, answer.message_id);
}

async function callPerson(service: SupabaseClient, held: Held, reason: string): Promise<void> {
  await rpc(service, "call_person", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_reason: reason,
  });
}

/** A yes: the case opened with the trip, and the link with the next steps; or the yes kept for a person. */
async function openCase(service: SupabaseClient, held: Held, context: TurnContext, report: TurnReport): Promise<void> {
  const alert = context.alert;
  if (!alert) return;
  const token = randomBytes(32).toString("base64url");
  const answer = await rpc(service, "one_open_case_from_alert", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_alert: alert.alertId,
    target_token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
    target_body: caseStepsMessage({
      passengerName: alert.passengerName,
      url: `${BRAND.siteUrl}/c/${token}`,
      minors: minorsOf(context, today()),
    }),
  });
  if (answer.code === "opened") {
    report.opened += 1;
    await send(service, answer.message_id);
    return;
  }
  if (answer.code === "opened_without_link") {
    report.opened += 1;
    await say(service, held, caseOpenedNoLinkMessage(alert.passengerName).replace("{caso}", String(answer.seq ?? "")));
    return;
  }
  if (answer.code === "by_person") {
    await say(service, held, byPersonMessage(alert.passengerName));
    await callPerson(
      service,
      held,
      "O passageiro quer seguir, e abrir o caso pela conversa espera uma pessoa do escritório.",
    );
    report.called += 1;
    return;
  }
  if (answer.code === "already_opened") return;
  throw new Error(`the case could not be opened: ${String(answer.code)}`);
}

/** The passenger's answer to the alert, kept; a no is ended kindly, a stop in silence. */
async function answerAlert(
  service: SupabaseClient,
  held: Held,
  context: TurnContext,
  answer: "yes" | "no" | "stop",
  report: TurnReport,
): Promise<void> {
  if (answer === "yes") {
    await openCase(service, held, context, report);
    return;
  }
  const kept = await rpc(service, "answer_flight_alert", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_answer: answer,
  });
  if (kept.ok && answer === "no") await say(service, held, declinedMessage(context.alert?.passengerName ?? ""));
}

/** One turn of a claimed conversation. Throws when it could not be done now: the turn is given back. */
async function takeTurn(service: SupabaseClient, held: Held, report: TurnReport): Promise<void> {
  const context = turnContextOf(
    await rpc(service, "conversation_turn_context", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
    }),
  );
  if (!context) return;

  if (context.answersLastHour >= ANSWERS_PER_HOUR) {
    await callPerson(service, held, "Muitas mensagens em pouco tempo: uma pessoa do escritório continua a conversa.");
    report.called += 1;
  } else {
    const words = lastClientWords(context.messages);
    const quick = context.alert && words.length > 0 ? quickAnswer(words[words.length - 1]) : null;
    if (context.alert && quick) {
      await answerAlert(service, held, context, quick, report);
    } else if (words.length > 0) {
      const run = await runFirmTask({
        orgId: context.orgId,
        task: CONVERSATION_TASK,
        input: modelInput(context),
        subject: { type: "wa_conversation", id: held.conversationId },
        idempotencyKey: `${held.conversationId}:${held.claim}`,
      });
      if (run.kind !== "finished") {
        // A model that did not answer now: a person carries the conversation on rather than the passenger waiting.
        await say(service, held, calledMessage).catch(() => undefined);
        await callPerson(service, held, "O ONE não conseguiu responder agora.");
        report.called += 1;
      } else {
        const answer = modelAnswerOf(run.output);
        if (
          answer &&
          context.alert &&
          (answer.intent === "sim" || answer.intent === "nao" || answer.intent === "parar")
        ) {
          await answerAlert(
            service,
            held,
            context,
            answer.intent === "sim" ? "yes" : answer.intent === "nao" ? "no" : "stop",
            report,
          );
        } else if (run.approvalId) {
          // The firm keeps ONE's answers to a person: this one waits in the queue for "Enviar".
        } else {
          const reply = cleanReply(answer?.reply);
          if (reply) {
            const sent = await rpc(service, "one_reply", {
              target_conversation: held.conversationId,
              target_claim: held.claim,
              target_run: run.runId,
              target_body: reply,
            });
            if (sent.ok) {
              report.answered += 1;
              await send(service, sent.message_id);
            }
          }
          if (!answer || answer.callPerson || answer.intent === "parar") {
            if (!reply) await say(service, held, calledMessage).catch(() => undefined);
            await callPerson(
              service,
              held,
              answer?.callPerson ??
                (answer?.intent === "parar"
                  ? "O passageiro pediu para não receber mais mensagens."
                  : "O ONE não entendeu o que responder."),
            );
            report.called += 1;
          }
        }
      }
    }
  }

  await rpc(service, "record_conversation_turn", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
    target_through: context.through,
  });
}

/** Takes the turns due: one conversation named, or the oldest. Throws only when nothing could be claimed at all. */
export async function takeConversationTurns(
  service: SupabaseClient,
  options: { conversationId?: string | null; limit?: number } = {},
): Promise<TurnReport> {
  const report: TurnReport = { claimed: 0, answered: 0, opened: 0, called: 0, failed: 0 };
  const { data, error } = await service.rpc("claim_conversation_turns", {
    target_limit: options.limit ?? 10,
    target_conversation: options.conversationId ?? null,
  });
  if (error) throw new Error("conversation turns could not be claimed");
  const claimed = (Array.isArray(data) ? data : []) as { conversation_id: string; claim: number }[];
  report.claimed = claimed.length;
  for (const row of claimed) {
    const held = { conversationId: row.conversation_id, claim: Number(row.claim) };
    try {
      await takeTurn(service, held, report);
    } catch {
      report.failed += 1;
      await service
        .rpc("release_conversation_turn", { target_conversation: held.conversationId, target_claim: held.claim })
        .then(
          () => undefined,
          () => undefined,
        );
    }
  }
  return report;
}

/** How long a passenger's messages one after the other are gathered before ONE answers. */
const GATHER_MS = 5_500;

/**
 * A passenger just wrote: the jobs answer once they stop writing (the event
 * is debounced per conversation), or, with none, the answer is taken after
 * the response, a few seconds later. Never waited for: the sweep takes it
 * anyway.
 */
export async function queueConversationTurn(conversationId: string): Promise<void> {
  const sent = await sendEvent("one/conversation.turn", { conversationId });
  if (sent.sent) return;
  try {
    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, GATHER_MS));
      try {
        await takeConversationTurns(createServiceClient(), { conversationId });
      } catch {
        // Still due: the sweep takes it.
      }
    });
  } catch {
    // Outside a request: the sweep takes it.
  }
}

/**
 * An answer of ONE a person approved: sent now. Never throws: answers what
 * became of it (`queued`, `already_sent`, or why it did not go, as the
 * database says it: `window_closed`, `opted_out`, `number_disconnected`).
 */
export async function sendApprovedReply(approvalId: string): Promise<string> {
  try {
    const service = createServiceClient();
    const answer = await rpc(service, "one_send_approved_reply", { target_approval: approvalId });
    if (!answer.ok) return typeof answer.code === "string" ? answer.code : "failed";
    await send(service, answer.message_id);
    return typeof answer.code === "string" ? answer.code : "queued";
  } catch {
    return "failed";
  }
}
