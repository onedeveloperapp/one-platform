import "server-only";

import { supabaseFileStore } from "@/lib/files/store";
import { CATEGORIZE_TASK } from "@/lib/finance/categorize";
import { categorizeRound } from "@/lib/finance/categorize-work";
import { receiptRound } from "@/lib/finance/receipt-work";
import type { Sweep } from "@/lib/jobs/schedule";
import { takeBackFile } from "@flyee/documents/files";

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
    // Its work is a model's: it waits while the provider of these tasks refuses the platform's AI account (0255).
    ai: [CATEGORIZE_TASK],
    when: { every: 5 },
    whileUsed: true,
    run: (service, until) => categorizeRound(service, until),
  },
  {
    // The receipts ONE issues to clients (0152): also while ONE is used, since the client reads them on their link and
    // the database claims each under a number.
    key: "finance-receipts",
    when: { every: 5 },
    whileUsed: true,
    run: (service, until) => receiptRound(service, until),
  },
  {
    // A document of the books sent for a form nobody saved, kept a day, then taken back, record first (0140).
    key: "finance-documents",
    when: { daily: { hour: 5, minute: 40 } },
    run: async (service, until) => {
      const { data, error } = await service.rpc("finance_unused_documents", { target_limit: 200 });
      if (error) throw new Error(`finance_unused_documents failed: ${error.code ?? "unknown"}`);
      const store = supabaseFileStore(service);
      let taken = 0;
      for (const row of (data ?? []) as { file_id: string; storage_path: string }[]) {
        if (Date.now() >= until) break;
        if (await takeBackFile(store, row.file_id, row.storage_path)) taken += 1;
      }
      return { taken };
    },
  },
  {
    // The bills that repeat (0151): ONE makes a series of what it saw three months in a row and writes the next bill.
    key: "finance-series",
    when: { daily: { hour: 6, minute: 10 } },
    run: async (service) => {
      const { data, error } = await service.rpc("finance_series_sweep", { target_limit: 2000 });
      if (error) throw new Error(`finance_series_sweep failed: ${error.code ?? "unknown"}`);
      return (data ?? {}) as Record<string, number>;
    },
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
