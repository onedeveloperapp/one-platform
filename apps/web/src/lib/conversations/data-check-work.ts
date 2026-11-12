import "server-only";

import { dataSummary, personDataOf } from "@/lib/conversations/data-check";
import type { Sweep } from "@/lib/jobs/schedule";
import { deliverOutbox } from "@/lib/whatsapp/send";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The check of data a firm's acceptance left owed (migration 0232): a document the firm accepted by hand after the
 * client's last file leaves the client's data unchecked, with nothing in the chat to start it. ONE starts it inside
 * the 24 hours, with the summary of what it read; the database checks it is still owed and keeps the step it waits
 * on in the same transaction as the message. Counts only.
 */
export async function startOwedDataChecks(service: SupabaseClient, limit = 20): Promise<{ started: number }> {
  const { data, error } = await service.rpc("chat_data_checks_owed", { target_limit: limit });
  if (error) throw new Error("chat_data_checks_owed failed");
  let started = 0;
  for (const row of (data ?? []) as { conversation_id: string; person: unknown }[]) {
    const person = personDataOf(row.person);
    if (!person) continue;
    const written = await service.rpc("one_start_data_check", {
      target_conversation: row.conversation_id,
      target_body: dataSummary(person),
    });
    const answer = (written.data ?? {}) as { ok?: boolean; message_id?: unknown };
    if (written.error || !answer.ok) continue;
    started += 1;
    if (typeof answer.message_id === "string") {
      try {
        await deliverOutbox(service, { messageId: answer.message_id });
      } catch {
        // Queued: the outbox's sweep sends it.
      }
    }
  }
  return { started };
}

export const dataCheckSweeps: Sweep[] = [
  {
    // A person waits on the conversation: swept while ONE is used too.
    key: "chat-data-checks",
    when: { every: 5 },
    whileUsed: true,
    run: async (service) => ({ ...(await startOwedDataChecks(service)) }),
  },
];
