import "server-only";

import { takeConversationTurns } from "@/lib/conversations/agent-work";
import { chatQuestionSweeps } from "@/lib/conversations/chat-questions-work";
import { dataCheckSweeps } from "@/lib/conversations/data-check-work";
import { signatureLinkSweeps } from "@/lib/conversations/signature-links-work";
import type { Sweep } from "@/lib/jobs/schedule";

/**
 * ONE's turns in the firms' conversations (migration 0048): a passenger who
 * wrote is answered right after the delivery (`queueConversationTurn`); this
 * takes what was left, a few turns a round. The database claims each turn
 * under a number, so a turn is never taken twice. Counts only.
 */
export const conversationSweeps: Sweep[] = [
  {
    key: "conversation-turns",
    when: { every: 5 },
    whileUsed: true,
    run: async (service) => ({ ...(await takeConversationTurns(service, { limit: 5 })) }),
  },
  // The links to sign, in the chat (0231).
  ...signatureLinkSweeps,
  // The check of data a firm's acceptance left owed (0232).
  ...dataCheckSweeps,
  // What the client is asked before the action goes to court (0233).
  ...chatQuestionSweeps,
];
