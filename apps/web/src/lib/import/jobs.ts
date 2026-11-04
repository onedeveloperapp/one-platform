import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";

/** How many passes one round makes: each closes or drops fifty batches. */
const MOST_PASSES = 20;

/**
 * The upkeep of the imports (migration 0032), once a day, recomputed from the
 * data on every pass: a batch nobody finished does not keep what a
 * spreadsheet said of people for ever. One none of whose lines was decided
 * goes; one that stopped half way is closed as far as it went, and the cases
 * it opened stay for a person to undo. Counts only.
 */
export const importSweeps: Sweep[] = [
  {
    key: "import-sweep",
    when: { daily: { hour: 5, minute: 10 } },
    run: async (service, until) => {
      let dropped = 0;
      let closed = 0;
      for (let pass = 0; pass < MOST_PASSES && Date.now() < until; pass += 1) {
        const { data, error } = await service.rpc("expire_import_batches");
        if (error) throw new Error(`expire_import_batches failed: ${error.code ?? "unknown"}`);
        const answer = (data ?? {}) as { dropped?: number; closed?: number };
        const round = { dropped: Number(answer.dropped ?? 0), closed: Number(answer.closed ?? 0) };
        dropped += round.dropped;
        closed += round.closed;
        if (round.dropped + round.closed === 0) break;
      }
      return { dropped, closed };
    },
  },
];
