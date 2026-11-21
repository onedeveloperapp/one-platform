import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";
import { fetchPendingMedia } from "@/lib/whatsapp/media";
import { syncWhatsAppProfiles } from "@/lib/whatsapp/profile-work";
import { deliverOutbox } from "@/lib/whatsapp/send";

/**
 * The sweeps of WhatsApp, recomputed from the data on every pass (migration
 * 0019), so running any of them twice changes nothing twice:
 *
 * - the outbox sweep sends what was reserved and never claimed (the request
 *   that reserved it ended before sending), and closes as `unconfirmed` what
 *   was claimed long ago and never answered;
 * - the media sweep brings into the firm's files what people sent, and tries
 *   again what a pass left half-way. A delivery that brings a media fetches it
 *   right after its answer (`queueMediaFetch`), so the file is there when
 *   somebody opens the thread, and each conversation a file was settled in is
 *   owed ONE's turn (0050), which waited for the file.
 *
 * Their answers carry counts only, never who was written to.
 */
export const whatsappSweeps: Sweep[] = [
  {
    key: "whatsapp-outbox",
    when: { every: 5 },
    whileUsed: true,
    run: async (service) => {
      const report = await deliverOutbox(service, { limit: 20 });
      return { claimed: report.claimed, sent: report.sent, failed: report.failed };
    },
  },
  {
    key: "whatsapp-media",
    when: { every: 5 },
    whileUsed: true,
    run: async (service) => {
      const report = await fetchPendingMedia(service, 10);
      if (report.conversations.length > 0) {
        // Loaded when needed: the turn answers through this outbox's sender.
        const { queueConversationTurn } = await import("@/lib/conversations/agent-work");
        for (const conversationId of report.conversations) await queueConversationTurn(conversationId);
      }
      return { claimed: report.claimed, stored: report.stored, failed: report.failed, waiting: report.waiting };
    },
  },
  // The firm's business profile in its brand and data (0262), written again only when it changes.
  {
    key: "whatsapp-profile",
    when: { every: 30 },
    run: async (service) => syncWhatsAppProfiles(service),
  },
];
