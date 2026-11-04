import "server-only";

import { countDeadlines } from "@/lib/deadlines/count-work";
import type { Sweep } from "@/lib/jobs/schedule";

/** How many rounds one sweep makes, and how many deadlines each counts. */
const MOST_ROUNDS = 5;
const PER_ROUND = 100;

/**
 * The count of the deadlines (migration 0034): every five minutes, and right
 * after a person wrote a deadline (`settleDeadlineCount`), what is owed
 * recomputed from the data on each round. A change of a court's calendar has
 * the open deadlines of that court whose count went through the days that
 * changed counted again, a round at a time, a claim worked on where it was
 * taken. Counts only.
 */
export const deadlineSweeps: Sweep[] = [
  {
    key: "deadline-counts",
    when: { every: 5 },
    whileUsed: true,
    run: async (service, until) => {
      let counted = 0;
      let failed = 0;
      for (let round = 0; round < MOST_ROUNDS && Date.now() < until; round += 1) {
        const report = await countDeadlines(service, { limit: PER_ROUND });
        counted += report.counted;
        failed += report.failed;
        if (report.claimed === 0) break;
      }
      return { counted, failed };
    },
  },
];
