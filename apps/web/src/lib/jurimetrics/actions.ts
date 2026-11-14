"use server";

import { type CaseForecast, caseForecastOf } from "@/lib/jurimetrics/forecast";
import { type MarketNumbers, marketNumbersOf } from "@/lib/jurimetrics/profile";
import { getMemberContext } from "@/lib/member/context";

/**
 * What the screens read of the market (migrations 0190 and 0250): a lawsuit's forecast, the firm's, and the projection
 * by unit. Read under the person's session; only to prepare and to project, never to choose a judge.
 */

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A lawsuit's forecast (0250): the case's card and its hearing read it, under the person's session. */
export async function readCaseForecast(proceedingId: string): Promise<CaseForecast | null> {
  const context = await getMemberContext();
  if (!context?.firm || !ID.test(String(proceedingId ?? ""))) return null;
  const { data, error } = await context.supabase.rpc("case_forecast", { target_proceeding: proceedingId });
  if (error) throw new Error("case_forecast failed");
  return caseForecastOf(data);
}

export type FirmForecast = {
  refreshedAt: string | null;
  withForecast: number;
  withoutForecast: number;
  expectedCents: number;
  bands: { high: number; mid: number; low: number };
  airlines: { airline: string | null; name: string | null; lawsuits: number; expectedCents: number }[];
  accuracy: {
    judged: number;
    asForecast: number;
    forecastPercent: number | null;
    wonPercent: number | null;
    minSample: number;
  };
};

/** The firm's forecast (0250): its open lawsuits summed, and how the forecast came out. */
export async function readFirmForecast(withTests: boolean): Promise<FirmForecast | null> {
  const context = await getMemberContext();
  if (!context?.firm) return null;
  const { data, error } = await context.supabase.rpc("firm_forecast", {
    target_org: context.firm.id,
    with_tests: withTests === true,
  });
  if (error) throw new Error("firm_forecast failed");
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const n = (value: unknown) => Number(value) || 0;
  const maybe = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  const bands = (row.bands ?? {}) as Record<string, unknown>;
  const accuracy = (row.accuracy ?? {}) as Record<string, unknown>;
  return {
    refreshedAt: typeof row.refreshed_at === "string" ? row.refreshed_at : null,
    withForecast: n(row.with_forecast),
    withoutForecast: n(row.without_forecast),
    expectedCents: n(row.expected_cents),
    bands: { high: n(bands.high), mid: n(bands.mid), low: n(bands.low) },
    airlines: (Array.isArray(row.airlines) ? (row.airlines as Record<string, unknown>[]) : []).map((item) => ({
      airline: typeof item.airline === "string" ? item.airline : null,
      name: typeof item.name === "string" ? item.name : null,
      lawsuits: n(item.lawsuits),
      expectedCents: n(item.expected_cents),
    })),
    accuracy: {
      judged: n(accuracy.judged),
      asForecast: n(accuracy.as_forecast),
      forecastPercent: maybe(accuracy.forecast_percent),
      wonPercent: maybe(accuracy.won_percent),
      minSample: n(accuracy.min_sample) || 5,
    },
  };
}

export type MarketProjection =
  | { ok: true; rows: { unit: string; numbers: MarketNumbers }[] }
  | { ok: false; code: string };

/** The projection by unit of a court, for an airline and a kind of problem (each optional). */
export async function readMarketProjection(input: {
  court: string;
  airline: string | null;
  problem: string | null;
}): Promise<MarketProjection> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_found" };
  const court = String(input?.court ?? "").toUpperCase();
  if (!/^[A-Z]{2,6}$/.test(court)) return { ok: false, code: "invalid_data" };
  const { data, error } = await context.supabase.rpc("market_projection", {
    target_court: court,
    target_airline: input.airline && /^[A-Z0-9]{2}$/.test(input.airline) ? input.airline : null,
    target_problem: input.problem && /^[a-z]{3,20}$/.test(input.problem) ? input.problem : null,
  });
  if (error) return { ok: false, code: "failed" };
  return {
    ok: true,
    rows: ((Array.isArray(data) ? data : []) as { unit?: unknown; numbers?: unknown }[]).flatMap((row) => {
      const numbers = marketNumbersOf(row.numbers);
      return typeof row.unit === "string" && numbers ? [{ unit: row.unit, numbers }] : [];
    }),
  };
}
