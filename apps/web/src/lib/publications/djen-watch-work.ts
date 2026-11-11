import "server-only";

import { djenClient } from "@/lib/courts/djen";
import type { Sweep, SweepReport } from "@/lib/jobs/schedule";
import { DjenRateLimitedError } from "@flyee/courts/providers/djen";
import type { DjenClient } from "@flyee/courts/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The watch over the DJEN (migration 0201), the backend's half: once in the setting's minutes, one look at what a
 * state court made available on the last weekday, the courts taken in turn, recorded with counts only. Where the
 * reading of the DJEN is off (a development machine, a preview) nothing is asked, and the watch says nothing.
 */
export async function djenWatchRound(
  service: SupabaseClient,
  client: DjenClient | null = djenClient(),
): Promise<SweepReport> {
  if (!client) return { due: false, off: true };
  const { data: due, error } = await service.rpc("djen_probe_due");
  if (error) throw new Error("djen_probe_due failed");
  const target = (due ?? null) as { court?: unknown; day?: unknown } | null;
  if (!target || typeof target.court !== "string" || typeof target.day !== "string") return { due: false };

  const started = Date.now();
  let outcome: "ok" | "error" | "rate_limited" = "ok";
  let items = 0;
  let withoutText = 0;
  let systems: Record<string, Record<string, number>> = {};
  let failure: string | null = null;
  try {
    const probe = await client.probe({ court: target.court, day: target.day });
    items = probe.items;
    withoutText = probe.withoutText;
    systems = probe.systems as Record<string, Record<string, number>>;
  } catch (thrown) {
    outcome = thrown instanceof DjenRateLimitedError ? "rate_limited" : "error";
    // The client's own words (djen_http_500, djen_no_answer): never a party's data.
    failure = thrown instanceof Error ? thrown.message.slice(0, 200) : "djen_failed";
  }
  const { error: recordError } = await service.rpc("record_djen_probe", {
    target_court: target.court,
    target_day: target.day,
    target_outcome: outcome,
    target_latency: Date.now() - started,
    target_items: items,
    target_without_text: withoutText,
    target_systems: systems,
    target_error: failure,
  });
  if (recordError) throw new Error("record_djen_probe failed");
  return { due: true, court: target.court, outcome, items, withoutText };
}

export const djenWatchSweeps: Sweep[] = [
  {
    // The clock's alone: one look an hour, from the one place the platform reads the DJEN.
    key: "djen-watch",
    when: { every: 15 },
    run: (service) => djenWatchRound(service),
  },
];
