import "server-only";

import { claimPaxReadings, readClaimedPaxDocument } from "@/modules/direito-do-passageiro/agency/reading-work";
import { removeForgottenBytes, sweepRetention } from "@/modules/direito-do-passageiro/agency/retention-work";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The reading of the documents an agency or its passenger sent (migration 0070): every five minutes what waits is
 * claimed and read, and at once when a document just arrived (`one/pax.document.uploaded`). Each document is
 * claimed in one step and read in another; a claim that never came back expires and the document is taken again.
 * The steps carry ids, claims and outcomes only.
 */
export const paxReadingsFunction = inngest.createFunction(
  { id: "one-pax-document-readings", retries: 1, concurrency: { limit: 2 } },
  [{ cron: "*/5 * * * *" }, { event: "one/pax.document.uploaded" }],
  async ({ event, step }) => {
    const named = event.name === "one/pax.document.uploaded" ? event.data?.documentId : null;
    const target = typeof named === "string" && UUID.test(named) ? named : null;
    const claimed = await step.run("claim", () => claimPaxReadings(createServiceClient(), target ? 1 : 5, target));
    const outcomes: Record<string, number> = {};
    for (const claim of claimed) {
      const outcome = await step.run(`read-${claim.documentId}-${claim.claim}`, () =>
        readClaimedPaxDocument(createServiceClient(), claim),
      );
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }
    return { claimed: claimed.length, ...outcomes };
  },
);

/**
 * How long an agency's passengers are kept (migration 0072): once a day, who the setting keeps no longer is
 * forgotten, and then the bytes of every file forgotten since (by the sweep, the agency or the passenger) are
 * removed. The steps carry counts only.
 */
export const paxRetentionFunction = inngest.createFunction(
  { id: "one-pax-retention", retries: 2, concurrency: { limit: 1 } },
  { cron: "20 7 * * *" },
  async ({ step }) => {
    const swept = await step.run("sweep", () => sweepRetention(createServiceClient()));
    const removed = await step.run("remove-bytes", () => removeForgottenBytes(createServiceClient()));
    return { ...swept, removed };
  },
);

export const agencyFunctions = [paxReadingsFunction, paxRetentionFunction];
