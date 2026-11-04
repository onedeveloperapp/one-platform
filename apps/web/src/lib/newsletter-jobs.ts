import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";
import { soon } from "@/lib/jobs/soon";
import { deliverNewsletter } from "@/lib/newsletter";
import { createServiceClient } from "@flyee/auth/service";

/**
 * How long a delivery may run after the operator's request was answered. It has
 * to fit inside the `maxDuration` of the page that starts it (/admin/leads);
 * whatever is left stays in "sending", and the sweep below goes on with it (or
 * the operator resumes it from the console).
 */
const INLINE_BUDGET_MS = 45_000;

/** How long a round of the sweep spends on one send at most. */
const SWEEP_BUDGET_MS = 60_000;

/**
 * Starts (or resumes) the delivery of a send, from a server action: in this
 * process AFTER the answer went out, so the operator's dialog never hangs on a
 * mail provider. What happened is in the send's own row, which is what the
 * console shows.
 */
export async function startNewsletterDelivery(sendId: string): Promise<{ queued: boolean }> {
  soon("newsletter", () => deliverNewsletter(createServiceClient(), sendId, INLINE_BUDGET_MS));
  return { queued: false };
}

/**
 * The sends that stopped half way (lib/newsletter.ts): the oldest one still
 * "sending" goes on, batch after batch, for a minute at most a round. Each
 * batch claims its readers before the message leaves, so going on never
 * writes to anybody twice. Counts only.
 */
export const newsletterSweeps: Sweep[] = [
  {
    key: "newsletter",
    when: { every: 5 },
    run: async (service, until) => {
      const { data, error } = await service
        .from("newsletter_sends")
        .select("id")
        .eq("status", "sending")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(`newsletter_sends could not be read: ${error.message}`);
      if (!data) return { sending: 0 };
      const budget = Math.min(SWEEP_BUDGET_MS, Math.max(0, until - Date.now()));
      const outcome = await deliverNewsletter(service, String(data.id), budget);
      return { batches: outcome.batches, delivered: outcome.delivered, done: outcome.done };
    },
  },
];
