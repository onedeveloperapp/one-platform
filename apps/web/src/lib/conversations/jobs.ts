import "server-only";

import { takeConversationTurns } from "@/lib/conversations/agent-work";
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
];
