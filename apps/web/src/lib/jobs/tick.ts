import "server-only";

import { SWEEPS } from "@/lib/jobs/registry";
import { runSweeps } from "@/lib/jobs/sweeps";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/**
 * How long a beat starts sweeps for. The jobs route has five minutes; a work
 * started near the end still has the rest to finish, and one that does not is
 * the next beat's (its claim expires).
 */
const CLOCK_BUDGET_MS = 200_000;

/**
 * The platform's one function at the job runner (the owner's decision of
 * 2026-11-04): a beat every five minutes that runs, in one step, every sweep
 * due at that beat (`lib/jobs/schedule.ts`). Two executions a beat, about 18
 * thousand a month, within the 50 thousand of the runner's free plan; the work
 * a person waits on never passes through it (`lib/jobs/soon.ts`). A beat that
 * fails is not run again: the next one recomputes what is due. Its answer
 * holds counts only.
 */
export const tickFunction = inngest.createFunction(
  { id: "one-tick", retries: 0, concurrency: { limit: 1 } },
  { cron: "*/5 * * * *" },
  async ({ event, step }) => {
    // The beat it was scheduled for, not when it started: a beat that started late still runs its own sweeps.
    const at = typeof event.ts === "number" ? event.ts : null;
    return step.run("sweeps", () =>
      runSweeps(createServiceClient(), SWEEPS, { at: at ?? Date.now(), budgetMs: CLOCK_BUDGET_MS }),
    );
  },
);
