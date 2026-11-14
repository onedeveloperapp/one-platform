import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";
import { catalogOf, thesisOf } from "@/lib/jurimetrics/theses";
import { MarketDjenSource } from "@flyee/jurimetrics/providers/djen";
import { MARKET_RULE } from "@flyee/jurimetrics/read";
import type { MarketSource } from "@flyee/jurimetrics/types";
import { MarketUnavailableError } from "@flyee/jurimetrics/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The reading of the market's decisions (migration 0190, phase 5 of the case journey plan): a few days a run, each a
 * court and an airline as the database plans them (`market_days_due`; the courts of the firms' lawsuits planned first,
 * `market_plan_captures`, 0250), read at the DJEN's public API by `@flyee/jurimetrics`, each decision's thesis read by
 * rule against the catalog at that moment (its text is never kept), and recorded (`record_market_day`) by the reading's
 * rule (`MARKET_RULE`; the database refuses an older one) with the unit, the judge and the airline only.
 *
 * Whether an environment reads it is a switch, as the DJEN's reading by registration is (`lib/courts/djen.ts`):
 * production reads it unless `JURIMETRICS_CAPTURE=0`; anywhere else only with `JURIMETRICS_CAPTURE=1`. The API counts
 * calls per address, shared with the reading of the publications, so this reads slowly, from the clock alone.
 */
export function isMarketCaptureOn(): boolean {
  const flag = (process.env.JURIMETRICS_CAPTURE ?? "").trim();
  if (flag === "0") return false;
  if (flag === "1") return true;
  return process.env.VERCEL_ENV === "production";
}

export async function readMarketDays(
  service: SupabaseClient,
  source: MarketSource = new MarketDjenSource(),
): Promise<Record<string, number>> {
  // The courts the firms' lawsuits are in, each airline by its short name (0250): planned once, read from then on.
  await service.rpc("market_plan_captures");
  const [{ data: due, error }, { data: catalogRows }] = await Promise.all([
    service.rpc("market_days_due", { target_limit: 4 }),
    service.from("jurimetry_theses").select("slug, position, patterns"),
  ]);
  if (error) throw new Error("market_days_due failed");
  const catalog = catalogOf(catalogRows);
  const counts: Record<string, number> = { days: 0, decisions: 0, failed: 0 };
  for (const day of (Array.isArray(due) ? due : []) as Record<string, unknown>[]) {
    if (typeof day.capture_id !== "string" || typeof day.court !== "string" || typeof day.party !== "string") continue;
    const date = String(day.day ?? "");
    try {
      const listing = await source.decisionsOn({ court: day.court, party: day.party, day: date });
      const rows = listing.decisions.map((decision) => ({
        key: decision.key,
        source: source.name === "fake" ? "fake" : "djen",
        unit: decision.unit,
        judge: decision.judge,
        instance: decision.instance,
        result: decision.result,
        moral_cents: decision.moralCents,
        per_claimant: decision.perClaimant,
        problem: decision.problem,
        prior_complaint: decision.priorComplaint,
        extinction_reason: decision.extinctionReason,
        content_key: decision.contentKey,
        // The grounds are read here and never leave: only the thesis they rest on goes.
        thesis: thesisOf(decision.grounds, catalog),
      }));
      const { error: recordError } = await service.rpc("record_market_day", {
        target_capture: day.capture_id,
        target_day: date,
        target_decisions: rows,
        target_complete: listing.complete,
        target_rule: MARKET_RULE,
      });
      if (recordError) throw new Error("record_market_day failed");
      counts.days += 1;
      counts.decisions += rows.length;
    } catch (failure) {
      counts.failed += 1;
      const code = failure instanceof MarketUnavailableError ? failure.message : "read_failed";
      await service.rpc("record_market_error", { target_capture: day.capture_id, target_error: code });
      // The source out of reach is out for the rest of the run.
      if (failure instanceof MarketUnavailableError) break;
    }
  }
  return counts;
}

export const marketSweeps: Sweep[] = [
  {
    // The market's decisions, a few days a run (0190): the clock's alone, where the switch is on. Every five minutes
    // since the twelve months of each court and airline were read again by `mercado-v2` (0250).
    key: "market-reading",
    when: { every: 5 },
    run: async (service) => (isMarketCaptureOn() ? readMarketDays(service) : { off: 1 }),
  },
  {
    // Each open lawsuit's forecast, once a day, and at once a lawsuit just filed, whose forecast is then kept to
    // compare with its judgment (0250): what the firm's numbers sum.
    key: "case-forecasts",
    when: { every: 30 },
    run: async (service) => {
      const { data, error } = await service.rpc("refresh_case_forecasts", { target_limit: 40 });
      if (error) throw new Error("refresh_case_forecasts failed");
      return { read: Number(data) || 0 };
    },
  },
];
