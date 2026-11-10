import "server-only";

import { categorizeRound } from "@/lib/finance/categorize-work";
import type { Sweep } from "@/lib/jobs/schedule";

/** How many passes one round makes: each takes out the words of up to two thousand movements. */
const MOST_PASSES = 10;

/**
 * The upkeep of the books (migration 0127), once a day: a movement older than the setting's years loses the words
 * that say who it was of (the person or company, what was written, the case, the bank's memo), and keeps its value,
 * day, account and category, as the fiscal record needs. Counts only.
 */
export const financeSweeps: Sweep[] = [
  {
    // The lines of a statement no rule decided, read by the AI (0128): also while ONE is used, since the database
    // claims each statement under a number.
    key: "finance-categorize",
    when: { every: 5 },
    whileUsed: true,
    run: (service, until) => categorizeRound(service, until),
  },
  {
    key: "finance-retention",
    when: { daily: { hour: 5, minute: 20 } },
    run: async (service, until) => {
      let done = 0;
      for (let pass = 0; pass < MOST_PASSES && Date.now() < until; pass += 1) {
        const { data, error } = await service.rpc("finance_retention_sweep", { target_limit: 2000 });
        if (error) throw new Error(`finance_retention_sweep failed: ${error.code ?? "unknown"}`);
        const round = Number(data ?? 0);
        done += round;
        if (round === 0) break;
      }
      return { deidentified: done };
    },
  },
];
