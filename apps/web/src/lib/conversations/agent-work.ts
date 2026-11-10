import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { runFirmTask } from "@/lib/ai/executor";
import { accountThanksMessage } from "@/lib/cases/account";
import { base64, MODEL_IMAGE, processCaseDocuments, queueDocumentProcessing } from "@/lib/cases/documents-work";
import {
  advanceInterview,
  answerInterview,
  answerWithPaper,
  readInterview,
  startInterview,
} from "@/lib/cases/interview-work";
import { alertQualification } from "@/lib/cases/qualification";
import { queueStatementWork } from "@/lib/cases/statements-work";
import {
  byPersonMessage,
  calledMessage,
  caseOpenedNoLinkMessage,
  caseStepsMessage,
  cleanReply,
  CONVERSATION_TASK,
  declinedMessage,
  FILE_KIND_TASK,
  type FileOutcome,
  fileRole,
  filesMessage,
  lastClientWords,
  minorsOf,
  modelAnswerOf,
  modelInput,
  notQualifiedMessage,
  type PaperKind,
  paperOf,
  quickAnswer,
  type TurnContext,
  turnContextOf,
  type TurnFile,
  turnFilesOf,
} from "@/lib/conversations/agent";
import { supabaseFileStore } from "@/lib/files/store";
import { soon } from "@/lib/jobs/soon";
import { deliverOutbox } from "@/lib/whatsapp/send";
import { createServiceClient } from "@flyee/auth/service";
import { BRAND } from "@flyee/content";
import { normalizeImage } from "@flyee/documents/normalize";
import type { FileStore } from "@flyee/documents/types";
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
 * A file the passenger sent (0050) joins their case first: a photo or a PDF
 * is read by the task `atendimento.arquivo.tipo` (what paper it is, the name
 * on it), joins as that paper and is checked at once as a paper sent through
 * the link is; an audio joins as their account of what happened; and ONE
 * says what became of each. Nothing of a passenger is kept in a job's state:
 * the steps carry ids and counts.
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

/** The largest PDF the task that says what paper a file is reads; a larger one joins as a paper of no kind. */
const PAPER_MAX_BYTES = 20 * 1024 * 1024;

/** What paper a file is, as the task reads it; a paper of no kind when it cannot say (or waits for a person). */
async function paperOfFile(
  store: FileStore,
  context: TurnContext,
  file: TurnFile,
): Promise<{ kind: PaperKind; name: string }> {
  const unknown = { kind: "other" as const, name: "" };
  if (!file.storagePath || !file.mime) return unknown;
  const bytes = await store.get(file.storagePath);
  if (!bytes) return unknown;
  let attachment: { kind: "image" | "document"; mime: string; dataBase64: string };
  if (file.mime === "application/pdf") {
    if (bytes.byteLength > PAPER_MAX_BYTES) return unknown;
    attachment = { kind: "document", mime: "application/pdf", dataBase64: base64(bytes) };
  } else {
    try {
      attachment = {
        kind: "image",
        mime: "image/jpeg",
        dataBase64: base64((await normalizeImage(bytes, MODEL_IMAGE)).jpeg),
      };
    } catch {
      // An image the backend cannot read (a HEIC its build of sharp has no decoder for): a person sees it.
      return unknown;
    }
  }
  const run = await runFirmTask({
    orgId: context.orgId,
    task: FILE_KIND_TASK,
    // What is hashed for the record: the file's own hash, never its bytes.
    input: { sha256: file.sha256 ?? file.fileId },
    messages: [{ role: "user", content: "Que papel é este arquivo?", attachments: [attachment] }],
    subject: { type: "wa_message", id: file.messageId },
    idempotencyKey: `file-kind:${file.messageId}`,
  });
  return run.kind === "finished" && !run.approvalId ? paperOf(run.output) : unknown;
}

/**
 * The files the passenger sent since ONE last answered: each joins their
 * case being gathered (or is set aside for a person), a paper is checked at
 * once, and ONE says what became of each in one message. The statements
 * joined are worked on once that message went. Answers whether there was any.
 */
async function joinFiles(service: SupabaseClient, held: Held, context: TurnContext): Promise<boolean> {
  const listed = await rpc(service, "conversation_media_to_join", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
  });
  const files = turnFilesOf(listed.items);
  if (files.length === 0) return false;
  const store = supabaseFileStore(service);
  const join = (file: TurnFile, kind: string, name: string | null = null) =>
    rpc(service, "one_join_conversation_media", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
      target_message: file.messageId,
      target_kind: kind,
      target_name: name,
    });

  const outcomes: FileOutcome[] = [];
  const statements: string[] = [];
  for (const file of files) {
    const role = fileRole(file);
    if (role === "failed" || role === "not_taken") {
      await join(file, "left");
      outcomes.push({ kind: role });
      continue;
    }
    if (role === "statement") {
      const joined = await join(file, "statement");
      if (joined.code === "statement" && typeof joined.statement_id === "string") {
        statements.push(joined.statement_id);
        outcomes.push({ kind: "statement" });
      } else if (joined.code === "no_case") outcomes.push({ kind: "no_case" });
      continue;
    }
    const paper = await paperOfFile(store, context, file);
    const joined = await join(file, paper.kind, paper.name || null);
    if (joined.code === "no_case") {
      outcomes.push({ kind: "no_case" });
      continue;
    }
    if (joined.code !== "document" || typeof joined.document_id !== "string") continue;
    // The same check as a paper sent through the link, now: the passenger hears what came of it here.
    await processCaseDocuments(service, 1, joined.document_id).catch(() => undefined);
    const { data: decided } = await service
      .from("case_documents")
      .select("status, rejected_reason")
      .eq("id", joined.document_id)
      .maybeSingle();
    const status =
      decided?.status === "accepted" ? "accepted" : decided?.status === "rejected" ? "rejected" : "waiting";
    outcomes.push({
      kind: "paper",
      paper: paper.kind,
      status,
      reason: typeof decided?.rejected_reason === "string" ? decided.rejected_reason : null,
    });
  }

  const message = filesMessage(outcomes);
  if (message) await say(service, held, message);
  for (const statementId of statements) await workStatement(statementId);
  return true;
}

/**
 * A statement joined from the conversation is transcribed and put in order right after, on its own, so the turn
 * never waits for a model hearing an audio.
 */
async function workStatement(statementId: string): Promise<void> {
  await queueStatementWork(statementId);
}

/**
 * The partner agency a trip of an alert came from (0070), by its name: the case it opens comes with the agency's
 * record (0071), and the next steps say so. Null for a trip of the firm's own, or when it could not be read (the
 * steps of a passenger of the firm's own then go, which still lead to the link).
 */
async function agencyOfAlert(service: SupabaseClient, alertId: string): Promise<string | null> {
  const { data, error } = await service
    .from("flight_alerts")
    .select("tracked_trips(pax_trips(partner_links(partners(name))))")
    .eq("id", alertId)
    .maybeSingle();
  if (error || !data) return null;
  const one = (value: unknown): Record<string, unknown> | null => {
    const row = Array.isArray(value) ? value[0] : value;
    return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
  };
  const name = one(
    one(one(one((data as Record<string, unknown>).tracked_trips)?.pax_trips)?.partner_links)?.partners,
  )?.name;
  return typeof name === "string" && name.trim() !== "" ? name : null;
}

/**
 * The rule of qualification on ONE's word about a flight (0147), from the alert and its trip's legs; null when they
 * could not be read, and the case then opens as before (the rule runs on the case too).
 */
async function qualifyAlert(service: SupabaseClient, alertId: string) {
  const { data, error } = await service
    .from("flight_alerts")
    .select(
      "kind, delay_minutes, tracked_trips(tracked_legs(scheduled_departure_local, origin_iata, destination_iata))",
    )
    .eq("id", alertId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const trip = (Array.isArray(row.tracked_trips) ? row.tracked_trips[0] : row.tracked_trips) as {
    tracked_legs?: { scheduled_departure_local: string; origin_iata: string; destination_iata: string }[];
  } | null;
  const legs = trip?.tracked_legs ?? [];
  const codes = [...new Set(legs.flatMap((leg) => [leg.origin_iata, leg.destination_iata]))];
  let international: boolean | null = null;
  if (codes.length > 0) {
    const airports = await service.from("airports").select("iata, country").in("iata", codes);
    if (!airports.error) {
      const known = (airports.data ?? []) as { iata: string; country: string }[];
      international = known.some((airport) => airport.country !== "BR")
        ? true
        : known.length === codes.length
          ? false
          : null;
    }
  }
  const days = legs.map((leg) => String(leg.scheduled_departure_local).slice(0, 10)).sort();
  return alertQualification({
    kind: String(row.kind),
    delayMinutes: typeof row.delay_minutes === "number" ? row.delay_minutes : null,
    flightDay: days[0] ?? null,
    international,
    today: today(),
  });
}

/** A yes: the case opened with the trip, and the link with the next steps; or the yes kept for a person. */
async function openCase(service: SupabaseClient, held: Held, context: TurnContext, report: TurnReport): Promise<void> {
  const alert = context.alert;
  if (!alert) return;
  // A problem the rule does not qualify opens no case: the firm's word, and the passenger kept with the reason.
  const verdict = await qualifyAlert(service, alert.alertId);
  if (verdict?.outcome === "not_qualified") {
    const answer = await rpc(service, "one_alert_not_qualified", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
      target_alert: alert.alertId,
      target_result: verdict,
      target_body: notQualifiedMessage(alert.passengerName),
    });
    if (answer.code === "not_qualified") {
      await send(service, answer.message_id);
      return;
    }
    if (answer.code === "not_qualified_by_person") {
      await callPerson(
        service,
        held,
        "O passageiro quer seguir, mas pela regra o problema não se qualifica: uma pessoa do escritório responde.",
      );
      report.called += 1;
      return;
    }
    if (answer.code === "answered_before" || answer.code === "already_opened") return;
    throw new Error(`the answer could not be kept: ${String(answer.code)}`);
  }
  const agency = await agencyOfAlert(service, alert.alertId);
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
      agency,
    }),
  });
  // The documents an agency handed over to the case (0071) are checked right after, as a client's are; the sweep
  // takes what that did not finish.
  const handed = Array.isArray(answer.documents) ? answer.documents : [];
  for (const documentId of handed) {
    if (typeof documentId === "string") await queueDocumentProcessing(documentId);
  }
  if (answer.code === "opened" || answer.code === "opened_without_link") {
    report.opened += 1;
    if (answer.code === "opened") await send(service, answer.message_id);
    else
      await say(
        service,
        held,
        caseOpenedNoLinkMessage(alert.passengerName).replace("{caso}", String(answer.seq ?? "")),
      );
    // The interview starts right after the next steps, here, one question at a time (0095).
    if (typeof answer.case_id === "string") {
      const interviewId = await startInterview(service, answer.case_id).catch(() => null);
      if (interviewId) await advanceInterview(service, interviewId).catch(() => undefined);
    }
    return;
  }
  if (answer.code === "by_person" || answer.code === "agency_closed") {
    await say(service, held, byPersonMessage(alert.passengerName));
    await callPerson(
      service,
      held,
      answer.code === "agency_closed"
        ? "O passageiro quer seguir, mas o acordo dele com a agência não está mais em vigor: uma pessoa do escritório abre o caso sem os dados da agência."
        : "O passageiro quer seguir, e abrir o caso pela conversa espera uma pessoa do escritório.",
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

  // What the passenger sent as files joins the case before anything is answered.
  const joinedFiles = await joinFiles(service, held, context);

  // ONE asked here what the client's account is missing (0092): what they write now is their answer, unless it is
  // their plain answer to an alert.
  const replied = lastClientWords(context.messages);

  // The interview of their case (0095): what they write now answers the question that waits, one at a time. A
  // question of theirs is ONE's to answer first, and the question that waits is asked again after it. A read that
  // fails here never stops the turn: ONE answers as it would without it.
  const lastWord = replied.length > 0 ? quickAnswer(replied[replied.length - 1]) : null;
  let interviewTook = false;
  let interviewBack: string | null = null;
  if (!(context.alert && lastWord) && lastWord !== "stop") {
    const found = await rpc(service, "conversation_interview", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
    }).catch((): Record<string, unknown> => ({}));
    const view =
      typeof found.interview_id === "string"
        ? await readInterview(service, { interviewId: found.interview_id }).catch(() => null)
        : null;
    if (view && view.status === "open") {
      if (replied.length > 0) {
        const outcome = await answerInterview(service, {
          orgId: context.orgId,
          view,
          words: replied,
          key: `${held.conversationId}:${held.claim}`,
        }).catch(() => "none" as const);
        if (outcome === "question") interviewBack = view.id;
        else if (outcome !== "none") {
          interviewTook = true;
          report.answered += 1;
        }
      } else if (joinedFiles) {
        interviewTook = await answerWithPaper(service, view).catch(() => false);
      }
    }
  }
  // A read that fails here never stops the turn: ONE answers the conversation as it would without it.
  const open = await rpc(service, "conversation_account_open", {
    target_conversation: held.conversationId,
    target_claim: held.claim,
  }).catch((): Record<string, unknown> => ({}));
  const alertAnswer = context.alert && replied.length > 0 ? quickAnswer(replied[replied.length - 1]) : null;
  const statementId = open.code === "open" && typeof open.statement_id === "string" ? open.statement_id : null;
  let answeredAccount = false;
  if (
    !interviewTook &&
    !interviewBack &&
    statementId &&
    replied.length > 0 &&
    !alertAnswer &&
    quickAnswer(replied[replied.length - 1]) !== "stop"
  ) {
    const completed = await rpc(service, "one_complete_statement", {
      target_conversation: held.conversationId,
      target_claim: held.claim,
      target_statement: statementId,
      target_text: replied.join("\n"),
    });
    if (completed.ok) {
      answeredAccount = true;
      await say(service, held, accountThanksMessage(typeof open.first_name === "string" ? open.first_name : "")).catch(
        () => undefined,
      );
      report.answered += 1;
      await workStatement(statementId);
    }
  }

  if (answeredAccount || interviewTook) {
    // The reply was the account's, or the interview's: nothing else of it waits for an answer.
  } else if (context.answersLastHour >= ANSWERS_PER_HOUR) {
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

  // ONE answered what the passenger asked in the middle of the interview: the question that waits is asked again.
  if (interviewBack) await advanceInterview(service, interviewBack, "back").catch(() => undefined);

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
export const GATHER_MS = 5_500;

/**
 * A passenger just wrote: the answer is taken right after the response, a
 * few seconds later, so messages written one after the other are answered
 * together (the database claims the conversation's turn, so the requests of
 * each of them answer once). Never waited for: the sweep takes it anyway.
 */
export async function queueConversationTurn(conversationId: string): Promise<void> {
  soon("conversation-turn", async () => {
    await new Promise((resolve) => setTimeout(resolve, GATHER_MS));
    await takeConversationTurns(createServiceClient(), { conversationId });
  });
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
