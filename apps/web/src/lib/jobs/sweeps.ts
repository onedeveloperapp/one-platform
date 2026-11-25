import "server-only";

import { aiPausedFor } from "@/lib/ai/health";
import { clockOrder, slotOf, type Sweep, type SweepReport, whileUsedOrder } from "@/lib/jobs/schedule";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What one round of the sweeps did: each sweep's counts, how long each one that started took (in milliseconds,
 * failed or paused ones too), and which failed or were left for the next round.
 */
export type SweepsReport = {
  slot: number;
  ran: Record<string, SweepReport>;
  ms: Record<string, number>;
  failed: string[];
  skipped: string[];
};

/**
 * Runs the sweeps of a round, one after the other, each on its own: one that fails leaves the others to run, and
 * once the time given is over nothing more is started (a work under way may still finish; its claim fences it).
 * The clock's round runs what is due at its beat; a round while ONE is used runs the sweeps that serve what people
 * wait on. The answer holds counts only: the clock logs it.
 */
export async function runSweeps(
  service: SupabaseClient,
  sweeps: readonly Sweep[],
  options: { at: number; budgetMs: number; whileUsed?: boolean },
): Promise<SweepsReport> {
  const slot = slotOf(options.at);
  const order = options.whileUsed ? whileUsedOrder(sweeps, slot) : clockOrder(sweeps, slot);
  const until = Date.now() + options.budgetMs;
  const report: SweepsReport = { slot, ran: {}, ms: {}, failed: [], skipped: [] };
  for (const sweep of order) {
    if (Date.now() >= until) {
      report.skipped.push(sweep.key);
      continue;
    }
    // Each sweep's own time, from its start to its end, whatever came of it: the clock's log names the slow ones.
    const started = Date.now();
    // The work of a model waits while the provider of its tasks refuses the platform's AI account (0255).
    if (sweep.ai && (await aiPausedFor(service, sweep.ai).catch(() => false))) {
      report.ran[sweep.key] = { paused: "ai" };
      report.ms[sweep.key] = Date.now() - started;
      continue;
    }
    try {
      report.ran[sweep.key] = await sweep.run(service, until);
    } catch (error) {
      report.failed.push(sweep.key);
      // The sweep and the kind of failure only: a work's own data never goes to a log.
      console.error("sweep_failed", {
        sweep: sweep.key,
        message: error instanceof Error ? error.message.slice(0, 160) : "unknown",
      });
    }
    report.ms[sweep.key] = Date.now() - started;
  }
  return report;
}
