import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";

/**
 * Gives up the AI runs nobody finished (`expire_stale_ai_runs`, migration
 * 0016): the process that asked the model stopped before it could record what
 * came of it. Until the sweep closes such a run it reads as still running and
 * holds its idempotency key.
 *
 * What is stale is recomputed from the data on every pass, and how long a run
 * may take is configuration (`platform_settings`, key `ai_runs`), so the sweep
 * holds no state and running it twice gives up nothing twice. It also runs
 * while ONE is used: a work done right after a person's answer may stop half
 * way, and its run would otherwise hold its key until the clock's next beat.
 */
export const aiSweeps: Sweep[] = [
  {
    key: "ai-stale-runs",
    when: { every: 15 },
    whileUsed: true,
    run: async (service) => {
      const { data, error } = await service.rpc("expire_stale_ai_runs");
      if (error) throw new Error(`expire_stale_ai_runs failed: ${error.message}`);
      return { givenUp: Number(data ?? 0) };
    },
  },
];
