import "server-only";

import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/**
 * Gives up the AI runs nobody finished (`expire_stale_ai_runs`, migration
 * 0016): the process that asked the model stopped before it could record what
 * came of it. Until the sweep closes such a run it reads as still running and
 * holds its idempotency key.
 *
 * What is stale is recomputed from the data on every pass, and how long a run
 * may take is configuration (`platform_settings`, key `ai_runs`), so the job
 * holds no state and running it twice gives up nothing twice.
 */
export const expireStaleAiRunsFunction = inngest.createFunction(
  { id: "one-expire-stale-ai-runs", retries: 1, concurrency: { limit: 1 } },
  { cron: "*/15 * * * *" },
  async () => {
    const { data, error } = await createServiceClient().rpc("expire_stale_ai_runs");
    if (error) throw new Error(`expire_stale_ai_runs failed: ${error.message}`);
    return { givenUp: Number(data ?? 0) };
  },
);

export const aiFunctions = [expireStaleAiRunsFunction];
