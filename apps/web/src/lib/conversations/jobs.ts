import "server-only";

import { takeConversationTurns } from "@/lib/conversations/agent-work";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/**
 * ONE's turns in the firms' conversations (migration 0048): at once when a
 * passenger wrote (`one/conversation.turn`, gathered per conversation until
 * they stop writing for a few seconds), and every two minutes for what was
 * left. The database claims each turn under a number, so a turn is never
 * taken twice. The steps carry counts only.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const conversationTurnFunction = inngest.createFunction(
  {
    id: "one-conversation-turn",
    retries: 1,
    concurrency: { limit: 5 },
    debounce: { key: "event.data.conversationId", period: "5s", timeout: "30s" },
  },
  { event: "one/conversation.turn" },
  async ({ event, step }) => {
    const named = event.data?.conversationId;
    const conversationId = typeof named === "string" && UUID.test(named) ? named : null;
    if (!conversationId) return { claimed: 0 };
    return step.run("turn", () => takeConversationTurns(createServiceClient(), { conversationId }));
  },
);

export const conversationTurnsSweepFunction = inngest.createFunction(
  { id: "one-conversation-turns", retries: 1, concurrency: { limit: 1 } },
  { cron: "*/2 * * * *" },
  async ({ step }) => step.run("turns", () => takeConversationTurns(createServiceClient())),
);

export const conversationFunctions = [conversationTurnFunction, conversationTurnsSweepFunction];
