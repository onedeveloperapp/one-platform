import "server-only";

import { fetchPendingMedia } from "@/lib/whatsapp/media";
import { deliverOutbox } from "@/lib/whatsapp/send";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/**
 * The scheduled work of WhatsApp, recomputed from the data on every pass
 * (migration 0019), so running any of it twice changes nothing twice:
 *
 * - the outbox sweep sends what was reserved and never claimed (the request
 *   that reserved it ended before sending), and closes as `unconfirmed` what
 *   was claimed long ago and never answered;
 * - the media sweep brings into the firm's files what people sent, and tries
 *   again what a pass left half-way. A delivery that brings a media also asks
 *   for a pass at once, so the file is there when somebody opens the thread.
 */

export const whatsappOutboxFunction = inngest.createFunction(
  { id: "one-whatsapp-outbox", retries: 0, concurrency: { limit: 1 } },
  { cron: "*/2 * * * *" },
  async ({ step }) =>
    step.run("deliver-outbox", async () => {
      const report = await deliverOutbox(createServiceClient(), { limit: 20 });
      // A step's answer is stored as JSON: counts only, never who was written to.
      return { claimed: report.claimed, sent: report.sent, failed: report.failed };
    }),
);

const mediaPass = () => fetchPendingMedia(createServiceClient(), 10);

export const whatsappMediaSweepFunction = inngest.createFunction(
  { id: "one-whatsapp-media-sweep", retries: 0, concurrency: { limit: 1 } },
  { cron: "*/5 * * * *" },
  async ({ step }) => step.run("fetch-media", mediaPass),
);

export const whatsappMediaPendingFunction = inngest.createFunction(
  { id: "one-whatsapp-media-pending", retries: 0, concurrency: { limit: 1 } },
  { event: "one/whatsapp.media.pending" },
  async ({ step }) => step.run("fetch-media", mediaPass),
);

export const whatsappFunctions = [whatsappOutboxFunction, whatsappMediaSweepFunction, whatsappMediaPendingFunction];
