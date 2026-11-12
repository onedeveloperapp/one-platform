import "server-only";

import { chatQuestionOf, chatQuestionText } from "@/lib/conversations/questions";
import type { Sweep } from "@/lib/jobs/schedule";
import { deliverOutbox } from "@/lib/whatsapp/send";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the client is asked before the action goes to court, asked in the chat (migration 0233): their word on free
 * justice and on the civil court, one at a time, in the conversation ONE carries with who gives it, inside the 24
 * hours. The database says what is owed and keeps the question as the conversation's step in the same transaction as
 * the message; this writes the words and sends. Counts only.
 */
export async function askChatQuestions(service: SupabaseClient, limit = 20): Promise<{ asked: number }> {
  const { data, error } = await service.rpc("chat_questions_owed", { target_limit: limit });
  if (error) throw new Error("chat_questions_owed failed");
  let asked = 0;
  for (const raw of (data ?? []) as unknown[]) {
    const question = chatQuestionOf(raw);
    if (!question) continue;
    const written = await service.rpc("one_ask_chat_question", {
      target_conversation: question.conversationId,
      target_kind: question.kind,
      target_party: question.partyId,
      target_body: chatQuestionText(question),
    });
    const answer = (written.data ?? {}) as { ok?: boolean; message_id?: unknown };
    if (written.error || !answer.ok) continue;
    asked += 1;
    if (typeof answer.message_id === "string") {
      try {
        await deliverOutbox(service, { messageId: answer.message_id });
      } catch {
        // Queued: the outbox's sweep sends it.
      }
    }
  }
  return { asked };
}

export const chatQuestionSweeps: Sweep[] = [
  {
    // A person waits on the conversation: swept while ONE is used too.
    key: "chat-questions",
    when: { every: 5 },
    whileUsed: true,
    run: async (service) => ({ ...(await askChatQuestions(service)) }),
  },
];
