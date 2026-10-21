import "server-only";

import { after } from "next/server";

import { deliverNewsletter, deliverNewsletterBatch } from "@/lib/newsletter";
import { createServiceClient } from "@flyee/auth/service";
import { inngest, sendEvent } from "@flyee/jobs";

/**
 * The queue side of a send to the list (lib/newsletter.ts): one step per batch
 * of 100 readers, so each batch is its own unit of work and a long list never
 * runs into the time limit of a single request.
 */

/** 500 batches are 50,000 readers: far past any list this platform will hold in one send. */
const MAX_BATCHES = 500;

export const newsletterSendFunction = inngest.createFunction(
  { id: "one-newsletter-send", retries: 2, concurrency: { limit: 1 } },
  { event: "one/newsletter.send" },
  async ({ event, step }) => {
    const { sendId } = event.data;
    let delivered = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const result = await step.run(`batch-${batch}`, async () =>
        deliverNewsletterBatch(createServiceClient(), sendId),
      );
      delivered += result.delivered;
      if (result.error) return { delivered, error: result.error };
      if (result.claimed === 0) return { delivered, done: true };
    }
    return { delivered, done: false, reason: "batch-limit" };
  },
);

export const newsletterFunctions = [newsletterSendFunction];

/**
 * How long a delivery without a queue may run after the operator's request was
 * answered. It has to fit inside the `maxDuration` of the page that starts it
 * (/admin/leads); whatever is left stays in "sending" and is resumed from the
 * console.
 */
const INLINE_BUDGET_MS = 45_000;

/**
 * Starts (or resumes) the delivery of a send, from a server action: through
 * the queue when there is one, otherwise in this process AFTER the answer went
 * out, so the operator's dialog never hangs on a mail provider. What happened
 * is in the send's own row, which is what the console shows.
 */
export async function startNewsletterDelivery(sendId: string): Promise<{ queued: boolean }> {
  const queued = await sendEvent("one/newsletter.send", { sendId });
  if (queued.sent) return { queued: true };
  after(async () => {
    try {
      await deliverNewsletter(createServiceClient(), sendId, INLINE_BUDGET_MS);
    } catch (error) {
      console.error("newsletter_delivery_failed", {
        sendId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return { queued: false };
}
