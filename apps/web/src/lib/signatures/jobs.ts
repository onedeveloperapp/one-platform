import "server-only";

import { openReservedEnvelopes, pollPendingEnvelopes, sendProviderCancels } from "@/lib/signatures/work";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/**
 * The signatures' sweep (migration 0023), recomputed from the data on every
 * pass: the envelopes a person reserved are opened at ZapSign, the ones
 * pending that nobody heard of for a while are asked for again, and the
 * cancels made in ONE are sent to ZapSign. A request
 * starts it at once (`one/signature.requested`); the cron is what catches
 * anything that request did not finish.
 */
export const signaturesSweepFunction = inngest.createFunction(
  { id: "one-signatures-sweep", retries: 1, concurrency: { limit: 1 } },
  [{ cron: "*/10 * * * *" }, { event: "one/signature.requested" }],
  async ({ step }) => {
    const opened = await step.run("open-reserved", () => openReservedEnvelopes(createServiceClient(), 10));
    const asked = await step.run("poll-pending", () => pollPendingEnvelopes(createServiceClient(), 50));
    const cancelled = await step.run("send-cancels", () => sendProviderCancels(createServiceClient(), 20));
    return { ...opened, asked, cancelled };
  },
);

export const signatureFunctions = [signaturesSweepFunction];
