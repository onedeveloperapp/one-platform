import { CLOCK_BEAT_KEY, type ClockBeat } from "@/lib/jobs/clock-beat";
import { SWEEPS } from "@/lib/jobs/registry";
import { slowestSweeps } from "@/lib/jobs/schedule";
import { runSweeps } from "@/lib/jobs/sweeps";
import { createServiceClient } from "@flyee/auth/service";

/**
 * The platform's one clock, on ONE's own server (the owner, 2026-11-14): a beat every five minutes runs every sweep
 * due at it (`lib/jobs/schedule.ts`), with the very code the app runs, bundled from the same commit
 * (`clock/build.mjs`) and shipped by the production deploy. It took the place of the job runner's beat, whose
 * minutes on the app's host were most of what the free plan allows. One process, one beat at a time: a beat that
 * runs past the next mark leaves that mark to the following one, as the runner's concurrency of one did. Each beat
 * leaves its mark in the database (`clock_beat`), so the app runs its own round while ONE is used only when the
 * clock has been silent (`lib/jobs/while-used.ts`). Its log holds counts and times only: the line of a beat names
 * each sweep that took a second or more, with its milliseconds (`slow`).
 */

const BEAT_MS = 5 * 60_000;
/** How long a beat starts sweeps for: a work started near the end still has the rest of the beat to finish. */
const BUDGET_MS = 200_000;

const commit = process.env.ONE_COMMIT ?? "unknown";
let stopping = false;

function log(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...data }));
}

async function beat(at: number): Promise<void> {
  const service = createServiceClient();
  const started = Date.now();
  const report = await runSweeps(service, SWEEPS, { at, budgetMs: BUDGET_MS });
  const beatMark: ClockBeat = { at: new Date(at).toISOString(), host: "vps", commit };
  const { error } = await service
    .from("platform_settings")
    .upsert({ key: CLOCK_BEAT_KEY, value: beatMark, is_public: false, updated_at: new Date().toISOString() });
  log("beat", {
    slot: report.slot,
    ms: Date.now() - started,
    ran: Object.keys(report.ran).length,
    failed: report.failed,
    skipped: report.skipped.length,
    marked: !error,
    // Each sweep that took a second or more, the slowest first, in milliseconds: where the beat's time went.
    slow: slowestSweeps(report.ms),
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[name]) throw new Error(`${name} must be set`);
  }
  log("start", { commit, sweeps: SWEEPS.length });
  // Loaded, with its keys, and out: how a new version is tried before it takes the clock's place (receber.sh).
  if (process.env.ONE_CLOCK_CHECK === "1") return;
  // One beat now and out, for a machine trying the bundle (never beside a running clock).
  if (process.env.ONE_CLOCK_ONCE === "1") {
    await beat(Date.now());
    return;
  }
  while (!stopping) {
    const next = Math.ceil((Date.now() + 1) / BEAT_MS) * BEAT_MS;
    while (!stopping && Date.now() < next) await sleep(Math.min(5_000, next - Date.now()));
    if (stopping) break;
    try {
      await beat(next);
    } catch (error) {
      // The kind of failure only: a work's own data never goes to a log.
      log("beat_failed", { message: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
    }
  }
  log("stop");
}

// A new version takes the place of this one between beats: a beat under way finishes first.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

main().then(
  () => process.exit(0),
  (error) => {
    log("fatal", { message: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
    process.exit(1);
  },
);
