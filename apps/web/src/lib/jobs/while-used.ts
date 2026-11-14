import "server-only";

import { CLOCK_BEAT_KEY, clockAlive } from "@/lib/jobs/clock-beat";
import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";

/** How often, on each server, a round runs while ONE is used. */
const EVERY_MS = 5 * 60_000;

/** How long such a round starts sweeps for, after the answer of the request that asked it. */
const USE_BUDGET_MS = 150_000;

/** When this server last ran a round while ONE was used. */
let last = 0;

/**
 * Somebody is using ONE (a screen of the firm, the agency's area, the client's link): when the clock has been silent
 * (its last beat older than `CLOCK_SILENT_MS`, `lib/jobs/clock-beat.ts`), the sweeps that serve what people wait on
 * run, once in five minutes on each server, after the answer (`whileUsedOrder` of `lib/jobs/schedule.ts`). So what
 * is due is still done while ONE is used if ONE's server stops (the clock runs there since 2026-11-14, `clock/`),
 * and the app's host spends nothing on rounds the clock already makes. The database claims each work, so this round
 * and the clock's never do anything twice. Never throws, never makes anybody wait.
 */
export function sweepWhileUsed(): void {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const now = Date.now();
  if (now - last < EVERY_MS) return;
  last = now;
  const scheduled = soon("sweeps-while-used", async () => {
    const service = createServiceClient();
    const { data } = await service.from("platform_settings").select("value").eq("key", CLOCK_BEAT_KEY).maybeSingle();
    if (clockAlive(data?.value, Date.now())) return;
    // Loaded when needed: a screen that asks for a round never carries every worker on its way in.
    const [{ SWEEPS }, { runSweeps }] = await Promise.all([import("@/lib/jobs/registry"), import("@/lib/jobs/sweeps")]);
    await runSweeps(service, SWEEPS, { at: now, budgetMs: USE_BUDGET_MS, whileUsed: true });
  });
  if (!scheduled) last = 0;
}
