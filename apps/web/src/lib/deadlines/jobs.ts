import "server-only";

import { countDeadlines } from "@/lib/deadlines/count-work";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/** How many rounds one run makes, and how many deadlines each counts: three thousand in a run. */
const MOST_ROUNDS = 30;
const PER_ROUND = 100;

/**
 * The count of the deadlines (migration 0034): every five minutes, and at
 * once when a deadline is owed one (`one/deadline.count`), what is owed
 * recomputed from the data on each round. A change of a court's calendar has
 * the open deadlines of that court whose count went through the days that
 * changed counted again, a round at a time, a claim worked on in the step
 * that took it. The steps carry counts only.
 */
export const deadlineCountsFunction = inngest.createFunction(
  { id: "one-deadline-counts", retries: 1, concurrency: { limit: 1 } },
  [{ cron: "*/5 * * * *" }, { event: "one/deadline.count" }],
  async ({ step }) => {
    let counted = 0;
    let failed = 0;
    for (let round = 0; round < MOST_ROUNDS; round += 1) {
      const report = await step.run(`count-${round}`, () =>
        countDeadlines(createServiceClient(), { limit: PER_ROUND }),
      );
      counted += report.counted;
      failed += report.failed;
      if (report.claimed === 0) break;
    }
    return { counted, failed };
  },
);

export const deadlineFunctions = [deadlineCountsFunction];
