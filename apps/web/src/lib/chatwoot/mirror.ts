import "server-only";

import { type ReadyAccount, readyAccount, serviceAccount, userToken } from "@/lib/chatwoot/accounts";
import { calledNote, contentOf, failureOf, FILE_IN_ONE } from "@/lib/chatwoot/notes";
import { chatwootProvider } from "@/lib/chatwoot/provider";
import { supabaseFileStore } from "@/lib/files/store";
import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";
import {
  type ChatwootAccount,
  type ChatwootProvider,
  ChatwootRequestError,
  isChatwootNotFound,
} from "@flyee/chatwoot/types";
import { oneSourceId } from "@flyee/chatwoot/webhook";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The firm's panel brought up to its conversations (migration 0223). A conversation marked by the database (a
 * message came, went or changed; who answers changed; ONE called a person) is claimed under a number and brought
 * up to date in order: its contact and its conversation made in the panel when missing, each message written once
 * (ONE's mark in its `source_id`, so the panel's webhook knows it is ONE's) with its file, the status of what the
 * firm sent, who answers (pending while ONE does, open while a person does) and a note when ONE called a person.
 * A message still on its way (a file being fetched, a message being sent) waits: its change marks the conversation
 * again. Counts only in the report.
 */

export type MirrorReport = { claimed: number; done: number; failed: number; written: number };

/** A file bigger than this stays in ONE, and the panel says so. */
const FILE_MAX_BYTES = 15 * 1024 * 1024;

type ConversationRow = {
  id: string;
  org_id: string;
  contact_wa_id: string;
  contact_name: string | null;
  saved_name: string | null;
  agent: "one" | "person";
  called_at: string | null;
  called_reason: string | null;
  chatwoot_conversation_id: number | null;
  chatwoot_contact_id: number | null;
  chatwoot_agent: string | null;
  chatwoot_called_at: string | null;
};

type MessageRow = {
  id: string;
  direction: "in" | "out";
  origin: string;
  kind: string;
  body: string | null;
  status: string;
  error_code: string | null;
  media_status: string;
  media_file_id: string | null;
  media_filename: string | null;
  sent_by: string | null;
  chatwoot_message_id: number | null;
  chatwoot_status: string | null;
};

const PUSHED = new Set(["sent", "delivered", "read", "failed"]);

export async function mirrorConversations(
  service: SupabaseClient,
  input: { conversationId?: string | null; limit?: number; until?: number } = {},
): Promise<MirrorReport> {
  const report: MirrorReport = { claimed: 0, done: 0, failed: 0, written: 0 };
  const provider = chatwootProvider();
  if (!provider) return report;

  const { data, error } = await service.rpc("chatwoot_claim_conversations", {
    target_limit: input.limit ?? 5,
    target_conversation: input.conversationId ?? null,
  });
  if (error) throw new Error(`chatwoot_claim_conversations failed: ${error.message}`);
  const claimed = (Array.isArray(data) ? data : []) as { conversation_id: string; org_id: string; dirty_at: string }[];
  report.claimed = claimed.length;

  const accounts = new Map<string, ReadyAccount | null>();
  for (const item of claimed) {
    let done = false;
    try {
      if (input.until && Date.now() > input.until) throw new Error("out of time");
      if (!accounts.has(item.org_id)) accounts.set(item.org_id, await readyAccount(service, item.org_id));
      const account = accounts.get(item.org_id);
      if (account) {
        try {
          report.written += await mirrorOne(service, provider, account, item.conversation_id);
        } catch (error) {
          if (!isChatwootNotFound(error)) throw error;
          // The panel no longer has the conversation or its contact (0229): forgotten, and written there again now.
          await kept(service.rpc("chatwoot_forget_conversation", { target_conversation: item.conversation_id }));
          report.written += await mirrorOne(service, provider, account, item.conversation_id);
        }
      }
      done = true;
    } catch {
      done = false;
    }
    await service.rpc("chatwoot_finish_conversation", {
      target_conversation: item.conversation_id,
      target_dirty_at: item.dirty_at,
      target_done: done,
    });
    if (done) report.done += 1;
    else report.failed += 1;
  }
  return report;
}

async function mirrorOne(
  service: SupabaseClient,
  provider: ChatwootProvider,
  account: ReadyAccount,
  conversationId: string,
): Promise<number> {
  const { data: found } = await service
    .from("wa_conversations")
    .select(
      "id, org_id, contact_wa_id, contact_name, saved_name, agent, called_at, called_reason, chatwoot_conversation_id, chatwoot_contact_id, chatwoot_agent, chatwoot_called_at",
    )
    .eq("id", conversationId)
    .maybeSingle();
  const conversation = found as ConversationRow | null;
  if (!conversation) return 0;
  const panel = await serviceAccount(provider, account);
  let written = 0;

  // The conversation in the panel, made once.
  let panelId = conversation.chatwoot_conversation_id;
  if (!panelId) {
    const contactId = conversation.chatwoot_contact_id ?? (await contactOf(panel, account, conversation));
    panelId = (
      await panel.createConversation({
        inboxId: account.inboxId,
        contactId,
        status: conversation.agent === "one" ? "pending" : "open",
      })
    ).id;
    await kept(
      service.rpc("chatwoot_keep_conversation", {
        target_conversation: conversation.id,
        target_panel_conversation: panelId,
        target_contact: contactId,
        target_agent: conversation.agent,
      }),
    );
    conversation.chatwoot_agent = conversation.agent;
  }

  // Its messages, in order: what is not in the panel yet, and what changed status since.
  const { data: rows } = await service
    .from("wa_messages")
    .select(
      "id, direction, origin, kind, body, status, error_code, media_status, media_file_id, media_filename, sent_by, chatwoot_message_id, chatwoot_status",
    )
    .eq("conversation_id", conversation.id)
    .gte("created_at", account.mirrorFrom)
    .order("created_at", { ascending: true })
    .limit(200);
  const staff = new Map<string, number>();
  for (const message of (rows ?? []) as MessageRow[]) {
    if (message.chatwoot_message_id === null) {
      if (message.direction === "in" && (message.media_status === "pending" || message.media_status === "fetching"))
        break;
      if (message.direction === "out" && (message.status === "queued" || message.status === "sending")) break;
      const author = await authorOf(service, provider, account, message, staff);
      const attachment = await fileOf(service, message);
      const posted = await author.createMessage(panelId, {
        content: attachment === "too_big" ? `${contentOf(message)}\n${FILE_IN_ONE}` : contentOf(message),
        type: message.direction === "in" ? "incoming" : "outgoing",
        sourceId: oneSourceId(message.id),
        attachment: attachment === "too_big" ? null : attachment,
      });
      written += 1;
      const pushed = message.direction === "out" && message.status !== "sent" && PUSHED.has(message.status);
      if (pushed) await panel.setMessageStatus(panelId, posted.id, message.status as "read", statusError(message));
      await kept(
        service.rpc("chatwoot_keep_message", {
          target_message: message.id,
          target_panel_message: posted.id,
          target_status: message.direction === "out" && PUSHED.has(message.status) ? message.status : null,
        }),
      );
    } else if (
      message.direction === "out" &&
      PUSHED.has(message.status) &&
      message.status !== message.chatwoot_status
    ) {
      // A 404 here is a conversation the panel lost: the round forgets it and writes it again (0229).
      await panel.setMessageStatus(
        panelId,
        // A bigint: a number from PostgREST, and text from a driver that keeps its digits.
        Number(message.chatwoot_message_id),
        message.status as "read",
        statusError(message),
      );
      await kept(service.rpc("chatwoot_keep_message", { target_message: message.id, target_status: message.status }));
    }
  }

  // Who answers.
  if (conversation.agent !== conversation.chatwoot_agent) {
    await panel.setConversationStatus(panelId, conversation.agent === "one" ? "pending" : "open");
    await kept(
      service.rpc("chatwoot_keep_conversation", {
        target_conversation: conversation.id,
        target_agent: conversation.agent,
      }),
    );
  }

  // ONE called a person: a note for the team, once per call.
  if (
    conversation.called_at &&
    (!conversation.chatwoot_called_at || conversation.chatwoot_called_at < conversation.called_at)
  ) {
    await panel.createMessage(panelId, {
      content: calledNote(conversation.called_reason),
      type: "outgoing",
      private: true,
    });
    await kept(
      service.rpc("chatwoot_keep_conversation", {
        target_conversation: conversation.id,
        target_called_at: conversation.called_at,
      }),
    );
  }
  return written;
}

/** The client's contact in the panel: the one of their number, or a new one. */
async function contactOf(
  panel: ChatwootAccount,
  account: ReadyAccount,
  conversation: ConversationRow,
): Promise<number> {
  const identifier = conversation.contact_wa_id;
  const known = await panel.findContact(identifier);
  if (known) return known.id;
  const name = (conversation.saved_name || conversation.contact_name || "").trim() || `+${identifier}`;
  try {
    return (
      await panel.createContact({
        inboxId: account.inboxId,
        name: name.slice(0, 120),
        phone: `+${identifier}`,
        identifier,
      })
    ).id;
  } catch (error) {
    // Made at the same moment by another server: it is there now.
    if (error instanceof ChatwootRequestError && error.status === 422) {
      const again = await panel.findContact(identifier);
      if (again) return again.id;
    }
    throw error;
  }
}

/**
 * Who a message goes as in the panel: the client's own come as the client's; what the firm typed on its phone goes
 * as "Celular do WhatsApp"; what a person of the firm wrote in ONE goes as them when they are in the panel; the rest
 * (ONE's own, a person not in the panel) goes as ONE.
 */
async function authorOf(
  service: SupabaseClient,
  provider: ChatwootProvider,
  account: ReadyAccount,
  message: MessageRow,
  staff: Map<string, number>,
): Promise<ChatwootAccount> {
  let userId = account.serviceUserId;
  if (message.direction === "out" && message.origin === "app") userId = account.phoneUserId;
  else if (message.direction === "out" && message.sent_by) {
    if (!staff.has(message.sent_by)) {
      const { data } = await service
        .from("chatwoot_staff")
        .select("chatwoot_user_id")
        .eq("org_id", account.orgId)
        .eq("user_id", message.sent_by)
        .maybeSingle();
      staff.set(message.sent_by, (data as { chatwoot_user_id?: number } | null)?.chatwoot_user_id ?? 0);
    }
    userId = staff.get(message.sent_by) || account.serviceUserId;
  }
  return provider.account(account.accountId, await userToken(provider, userId));
}

/** The bytes of a message's file, when it has one the panel can take. */
async function fileOf(
  service: SupabaseClient,
  message: MessageRow,
): Promise<{ name: string; mime: string; bytes: Uint8Array } | "too_big" | null> {
  if (!message.media_file_id || message.media_status !== "stored") return null;
  const { data } = await service
    .from("files")
    .select("name, storage_path, bytes, detected_mime, status")
    .eq("id", message.media_file_id)
    .maybeSingle();
  const file = data as {
    name: string;
    storage_path: string;
    bytes: number | null;
    detected_mime: string | null;
    status: string;
  } | null;
  if (!file || file.status !== "stored" || !file.detected_mime) return null;
  if ((file.bytes ?? 0) > FILE_MAX_BYTES) return "too_big";
  const bytes = await supabaseFileStore(service).get(file.storage_path);
  if (!bytes) return null;
  return { name: file.name || message.media_filename || "arquivo", mime: file.detected_mime, bytes };
}

const statusError = (message: MessageRow): string | null =>
  message.status === "failed" ? failureOf(message.error_code) : null;

/** What the panel now has is kept in ONE, or the round fails and the conversation is brought up again later. */
async function kept(call: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await call;
  if (error) throw new Error(`not kept: ${error.message}`);
}

/**
 * Brings the panel up right after what changed a conversation (a message in or out, a status), on this server: the
 * firm's people see it at once, and the clock's sweep takes what this did not finish.
 */
export function queueChatwootMirror(conversationId?: string | null): void {
  if (!chatwootProvider()) return;
  soon("chatwoot-mirror", async () => {
    await mirrorConversations(createServiceClient(), {
      conversationId: conversationId ?? null,
      limit: conversationId ? 1 : 10,
    });
  });
}
