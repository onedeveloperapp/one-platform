import "server-only";

import { createHash } from "node:crypto";

import { accountByChatwootId, inboxSecret, type ReadyAccount, serviceAccount } from "@/lib/chatwoot/accounts";
import { queueChatwootMirror } from "@/lib/chatwoot/mirror";
import { flaggedNote, flaggedRefusal, refusalOf } from "@/lib/chatwoot/notes";
import { chatwootProvider } from "@/lib/chatwoot/provider";
import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";
import type { ChatwootProvider } from "@flyee/chatwoot/types";
import {
  accountOfDelivery,
  parseChatwootDelivery,
  type PersonMessageEvent,
  verifyChatwootSignature,
} from "@flyee/chatwoot/webhook";
import { checkMessage } from "@flyee/whatsapp/rules";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the firm's panel says to ONE (migration 0223), through its inbox's webhook, signed with the inbox's secret:
 * what a person of the firm wrote to the client, and a change of who answers. A message goes through ONE's outbox
 * as the person's, under ONE's rules; one ONE does not send fails in the panel with the reason, and a text the
 * bar's rules flag fails until the same text is written again within ten minutes, which sends it all the same.
 * The answer comes within Chatwoot's five seconds: the sending is done right after it. Nothing of a message goes
 * to a log, only codes.
 */

export type ChatwootDeliveryOutcome = { status: number; code: string };

export async function handleChatwootDelivery(
  rawBody: string,
  headers: { timestamp: string | null; signature: string | null },
): Promise<ChatwootDeliveryOutcome> {
  const provider = chatwootProvider();
  if (!provider) return { status: 503, code: "chatwoot_not_configured" };

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, code: "invalid_json" };
  }
  const accountId = accountOfDelivery(payload);
  if (!accountId) return { status: 400, code: "no_account" };

  const service = createServiceClient();
  const account = await accountByChatwootId(service, accountId);
  // The same answer for an account of no firm and a signature that does not hold.
  if (!account) return { status: 401, code: "invalid_signature" };
  const now = Math.floor(Date.now() / 1000);
  const signed = async (fresh: boolean) => {
    const secret = await inboxSecret(provider, account, fresh).catch(() => null);
    return secret ? verifyChatwootSignature({ rawBody, ...headers, secret, now }) : false;
  };
  // A secret remembered from before the inbox's was reset is read again once.
  if (!(await signed(false)) && !(await signed(true))) return { status: 401, code: "invalid_signature" };

  const event = parseChatwootDelivery(payload);
  if (event.type === "ignored") return { status: 200, code: event.reason };
  if (event.inboxId && event.inboxId !== account.inboxId) return { status: 200, code: "another_inbox" };

  if (event.type === "status") {
    const { data, error } = await service.rpc("chatwoot_panel_status", {
      target_org: account.orgId,
      target_conversation: event.conversationId,
      target_status: event.status,
    });
    if (error) return { status: 500, code: "status_not_kept" };
    const answer = (data ?? {}) as { ok?: boolean; code?: string; agent?: string };
    if (answer.ok) {
      const conversation = await conversationOf(service, account, event.conversationId);
      if (conversation) {
        queueChatwootMirror(conversation);
        // Given back to ONE: what the client wrote last and nobody answered is ONE's to answer now.
        if (answer.code === "changed" && answer.agent === "one") {
          soon("chatwoot-given-back", async () => {
            const { queueConversationTurn } = await import("@/lib/conversations/agent-work");
            await queueConversationTurn(conversation);
          });
        }
      }
    }
    return { status: 200, code: answer.code ?? "status" };
  }

  if (event.senderId === account.serviceUserId || event.senderId === account.phoneUserId) {
    return { status: 200, code: "written_by_one" };
  }
  return personWrote(service, provider, account, event);
}

async function conversationOf(service: SupabaseClient, account: ReadyAccount, panelId: number): Promise<string | null> {
  const { data } = await service
    .from("wa_conversations")
    .select("id")
    .eq("org_id", account.orgId)
    .eq("chatwoot_conversation_id", panelId)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/** A text as the bar's rules compare it twice: the same words, whatever the spaces and the case. */
const hashOf = (text: string): string =>
  createHash("sha256").update(text.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase()).digest("hex");

async function personWrote(
  service: SupabaseClient,
  provider: ChatwootProvider,
  account: ReadyAccount,
  event: PersonMessageEvent,
): Promise<ChatwootDeliveryOutcome> {
  const fail = async (reason: string, note?: string) => {
    const panel = await serviceAccount(provider, account);
    await panel.setMessageStatus(event.conversationId, event.messageId, "failed", reason).catch(() => undefined);
    if (note) {
      await panel
        .createMessage(event.conversationId, { content: note, type: "outgoing", private: true })
        .catch(() => undefined);
    }
  };

  if (event.attachments > 0) {
    await fail(refusalOf("attachment"));
    return { status: 200, code: "attachment" };
  }

  const text = event.content.trim();
  const findings = text ? checkMessage(text) : [];
  if (findings.length > 0) {
    // The same text written again within ten minutes is sent all the same: the database keeps the time (0223).
    const { data, error } = await service.rpc("chatwoot_flagged_again", {
      target_org: account.orgId,
      target_conversation: event.conversationId,
      target_hash: hashOf(text),
    });
    if (error) return { status: 500, code: "flag_not_kept" };
    const flagged = (data ?? {}) as { ok?: boolean; code?: string; again?: boolean };
    if (!flagged.ok) {
      await fail(refusalOf(flagged.code ?? "failed"));
      return { status: 200, code: flagged.code ?? "failed" };
    }
    if (!flagged.again) {
      await fail(flaggedRefusal(findings), flaggedNote(findings));
      return { status: 200, code: "flagged" };
    }
  }

  const { data, error } = await service.rpc("chatwoot_person_writes", {
    target_org: account.orgId,
    target_conversation: event.conversationId,
    target_person: event.senderId,
    target_message: event.messageId,
    target_body: event.content,
    // What the bar's rules weighed, when the same text was written again to send it all the same: on the record.
    target_flagged: findings.length > 0 ? findings : null,
  });
  if (error) return { status: 500, code: "not_reserved" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; message_id?: string; person_id?: string };
  if (!answer.ok || !answer.message_id) {
    await fail(refusalOf(answer.code ?? "failed"));
    return { status: 200, code: answer.code ?? "failed" };
  }
  if (answer.code === "duplicate") return { status: 200, code: "duplicate" };

  const messageId = answer.message_id;
  // Sent right after the answer to Chatwoot; what does not go here, the outbox's sweep sends.
  soon("chatwoot-person-wrote", async () => {
    const { deliverOutbox } = await import("@/lib/whatsapp/send");
    await deliverOutbox(createServiceClient(), { messageId });
  });
  return { status: 200, code: "queued" };
}
