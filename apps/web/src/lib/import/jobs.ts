import "server-only";

import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/** How many passes one run makes: each closes or drops fifty batches. */
const MOST_PASSES = 20;

/**
 * The upkeep of the imports (migration 0032), once a day, recomputed from the
 * data on every pass: a batch nobody finished does not keep what a
 * spreadsheet said of people for ever. One none of whose lines was decided
 * goes; one that stopped half way is closed as far as it went, and the cases
 * it opened stay for a person to undo. The steps carry counts only.
 */
export const importSweepFunction = inngest.createFunction(
  { id: "one-import-sweep", retries: 1, concurrency: { limit: 1 } },
  { cron: "10 5 * * *" },
  async ({ step }) => {
    let dropped = 0;
    let closed = 0;
    for (let pass = 0; pass < MOST_PASSES; pass += 1) {
      const report = await step.run(`expire-${pass}`, async () => {
        const { data, error } = await createServiceClient().rpc("expire_import_batches");
        if (error) throw new Error(`expire_import_batches failed: ${error.code ?? "unknown"}`);
        const answer = (data ?? {}) as { dropped?: number; closed?: number };
        return { dropped: Number(answer.dropped ?? 0), closed: Number(answer.closed ?? 0) };
      });
      dropped += report.dropped;
      closed += report.closed;
      if (report.dropped + report.closed === 0) break;
    }
    return { dropped, closed };
  },
);

export const importFunctions = [importSweepFunction];
