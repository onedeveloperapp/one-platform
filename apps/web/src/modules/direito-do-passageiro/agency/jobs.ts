import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";
import {
  claimPaxReadings,
  PAX_READING_TASK,
  readClaimedPaxDocument,
} from "@/modules/direito-do-passageiro/agency/reading-work";
import { removeForgottenBytes, sweepRetention } from "@/modules/direito-do-passageiro/agency/retention-work";
import { tellUnagreedDepartures } from "@/modules/direito-do-passageiro/agency/unagreed-notices";

/** How many documents one round reads: one just sent is read right after it arrived. */
const READINGS_PER_ROUND = 3;

export const agencySweeps: Sweep[] = [
  /**
   * The reading of the documents an agency or its passenger sent (migration
   * 0070): one just sent is read right after it arrived (`queuePaxReading`);
   * this takes what waits, one claimed and read at a time. A claim that never
   * came back expires and the document is taken again. Counts only.
   */
  {
    key: "pax-readings",
    // Its work is a model's: it waits while the provider of these tasks refuses the platform's AI account (0255).
    ai: [PAX_READING_TASK],
    when: { every: 5 },
    whileUsed: true,
    run: async (service, until) => {
      const outcomes: Record<string, number> = {};
      for (let turn = 0; turn < READINGS_PER_ROUND && Date.now() < until; turn += 1) {
        const [claim] = await claimPaxReadings(service, 1, null);
        if (!claim) break;
        const outcome = await readClaimedPaxDocument(service, claim).catch(() => "error");
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      }
      return outcomes;
    },
  },
  /**
   * How long an agency's passengers are kept (migration 0072): once a day, who
   * the setting keeps no longer is forgotten, and so is a passenger started
   * from documents and never confirmed (0083); then the bytes of every file
   * forgotten since (by the sweep, the agency or the passenger) are removed.
   * Counts only.
   */
  /**
   * The agency's bell of a passenger who flies in the next days with no agreement (migration 0094): once an hour,
   * each trip told once by its key, while there is time to send the link. Counts only.
   */
  {
    key: "pax-unagreed-departures",
    when: { hourly: 40 },
    run: (service, until) => tellUnagreedDepartures(service, until),
  },
  {
    key: "pax-retention",
    when: { daily: { hour: 7, minute: 20 } },
    run: async (service) => {
      const swept = await sweepRetention(service);
      const removed = await removeForgottenBytes(service);
      return { ...swept, removed };
    },
  },
];
