import "server-only";

import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";

/** How often, on each server, a round runs while ONE is used. */
const EVERY_MS = 5 * 60_000;

/** How long such a round starts sweeps for, after the answer of the request that asked it. */
const USE_BUDGET_MS = 150_000;

/** When this server last ran a round while ONE was used. */
let last = 0;

/**
 * Somebody is using ONE (a screen of the firm, the agency's area, the client's link, the test chat): the sweeps
 * that serve what people wait on run, once in five minutes on each server, after the answer
 * (`whileUsedOrder` of `lib/jobs/schedule.ts`). So what is due is done while ONE is used even when the clock is
 * held (the job runner's quota spent), and a work that failed right after an action is tried again. The database
 * claims each work, so this round and the clock's never do anything twice. Never throws, never makes anybody wait.
 */
export function sweepWhileUsed(): void {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const now = Date.now();
  if (now - last < EVERY_MS) return;
  last = now;
  const scheduled = soon("sweeps-while-used", async () => {
    // Loaded when needed: a screen that asks for a round never carries every worker on its way in.
    const [{ SWEEPS }, { runSweeps }] = await Promise.all([import("@/lib/jobs/registry"), import("@/lib/jobs/sweeps")]);
    await runSweeps(createServiceClient(), SWEEPS, { at: now, budgetMs: USE_BUDGET_MS, whileUsed: true });
  });
  if (!scheduled) last = 0;
}
