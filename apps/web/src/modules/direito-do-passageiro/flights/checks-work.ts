import "server-only";

import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";
import { FLIGHT_CHECK_VERSION, type LegToCheck, matchLeg, monthsToSearch, withUnscheduled } from "@flyee/flights/check";
import { AnacVraSource, VRA_URL_PATTERN } from "@flyee/flights/providers/anac-vra";
import type { FlightRecordSource, VraMonth } from "@flyee/flights/types";
import type { VraRecord } from "@flyee/flights/vra";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of the check of a case's legs against ANAC's official
 * record (migration 0030): claim the legs owed, read each month of the record
 * they need once (through `@flyee/flights/providers/anac-vra`, which keeps
 * the flights with a number one of them has and the legs no schedule
 * foresaw), find each leg's flight (`matchLeg`, which follows it through its
 * stops) with the legs of it no schedule foresaw (`withUnscheduled`) and
 * record what came of it under the claim. A month ANAC answers 404 for is
 * never taken as one without the flight: it is a month not out yet, and when
 * it is too old for that, a check given up that says so. Nothing of a person
 * ever leaves: what is asked of ANAC is a public file.
 */

/** A leg as the claim hands it. */
type ClaimedCheck = {
  check_id: string;
  claim: number;
  leg_case: string;
  leg_flight: string;
  designators: string[] | null;
  leg_number: string;
  origin_icao: string | null;
  origin_offset: number | null;
  destination_icao: string | null;
  departure_local: string | null;
};

/** The most months one run downloads: each is a large file. */
const MONTHS_PER_RUN = 2;

type Settings = { url: string; missingAfterMonths: number };

async function settingsOf(service: SupabaseClient): Promise<Settings> {
  const { data } = await service.from("platform_settings").select("value").eq("key", "flights").maybeSingle();
  const value = (data?.value ?? {}) as Record<string, unknown>;
  const url =
    typeof value.vra_url === "string" && /^https:\/\/\S+\{ano\}\S*\{mes\}/.test(value.vra_url)
      ? value.vra_url
      : VRA_URL_PATTERN;
  const after = Number(value.vra_missing_after_months);
  return { url, missingAfterMonths: Number.isInteger(after) && after > 0 ? after : 3 };
}

/** A flight of the record by what tells it apart in a month. */
const flightKey = (record: VraRecord): string =>
  `${record.airline}${record.number}@${record.origin}@${record.scheduledDeparture}`;

/** Months from one to the other, "YYYY-MM": how long ago a month was. */
const monthsBetween = (from: string, to: string): number => {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
};

export type FlightCheckOutcome = "found" | "not_found" | "not_published" | "retry" | "later" | "failed" | "not_held";

/**
 * Claims what is owed (or the one check named) and works on it: the months its legs need, downloaded
 * once each, and each leg's flight looked for in them. What a run could not reach (months beyond the
 * ones it downloads) is given back for the next run.
 */
export async function checkFlights(
  service: SupabaseClient,
  options: {
    limit?: number;
    checkId?: string | null;
    fetch?: typeof fetch;
    source?: FlightRecordSource;
    now?: () => number;
  } = {},
): Promise<Record<FlightCheckOutcome, number>> {
  const counts: Record<FlightCheckOutcome, number> = {
    found: 0,
    not_found: 0,
    not_published: 0,
    retry: 0,
    later: 0,
    failed: 0,
    not_held: 0,
  };
  const { data, error } = await service.rpc("claim_flight_checks", {
    target_limit: options.limit ?? 20,
    target_check: options.checkId ?? null,
  });
  if (error) throw new Error("flight checks could not be claimed");
  const claimed = (data ?? []) as ClaimedCheck[];
  if (claimed.length === 0) return counts;
  const settings = await settingsOf(service);
  const current = new Date((options.now ?? Date.now)()).toISOString().slice(0, 7);

  // The months to read, the oldest leg's first, a few a run.
  const monthsOf = new Map(claimed.map((check) => [check.check_id, monthsToSearch(check.departure_local ?? "")]));
  const months = [...new Set(claimed.flatMap((check) => monthsOf.get(check.check_id) ?? []))].slice(0, MONTHS_PER_RUN);
  const numbers = new Set(claimed.map((check) => check.leg_number).filter(Boolean));
  const codeshares = new Set(
    claimed.flatMap((check) => (check.designators ?? []).map((designator) => `${designator}${check.leg_number}`)),
  );
  const source = options.source ?? new AnacVraSource({ urlPattern: settings.url, fetch: options.fetch });
  const read = new Map<string, VraMonth>();
  for (const month of months) read.set(month, await source.readMonth(month, { numbers, codeshares }));

  for (const check of claimed) {
    const outcome = await settle(service, check, monthsOf.get(check.check_id) ?? [], read, settings, current);
    counts[outcome] += 1;
  }
  return counts;
}

async function settle(
  service: SupabaseClient,
  check: ClaimedCheck,
  months: string[],
  read: ReadonlyMap<string, VraMonth>,
  settings: Settings,
  current: string,
): Promise<FlightCheckOutcome> {
  const record = async (outcome: string, extra: Record<string, unknown> = {}): Promise<FlightCheckOutcome> => {
    const { data, error } = await service.rpc("record_flight_check", {
      target_check: check.check_id,
      target_claim: check.claim,
      target_outcome: outcome,
      ...extra,
    });
    if (error) throw new Error("a flight check could not be recorded");
    const answer = (data ?? {}) as { ok?: boolean; code?: string };
    if (!answer.ok) return "not_held";
    return (answer.code as FlightCheckOutcome) ?? "failed";
  };

  const primary = months[0] ?? null;
  if (!check.departure_local || !check.leg_number || !primary) {
    return record("failed", { target_code: "leg_unreadable" });
  }
  const states = months.map((month) => read.get(month));
  // A month this run did not reach: the leg waits for the next run, with no attempt counted against it.
  if (states.some((state) => state === undefined)) return record("later");
  const unavailable = states.find(
    (state): state is Extract<VraMonth, { kind: "unavailable" }> => state?.kind === "unavailable",
  );
  // Each flight with the month of the file it was found in, which is what the screen names.
  const records: VraRecord[] = [];
  const monthOf = new Map<string, string>();
  for (const month of months) {
    const state = read.get(month);
    if (state?.kind !== "read") continue;
    records.push(...state.records);
    for (const found of state.records) monthOf.set(flightKey(found), month);
  }
  const unscheduled = states.flatMap((state) => (state?.kind === "read" ? state.unscheduled : []));
  const leg: LegToCheck = {
    designators: check.designators ?? [],
    number: check.leg_number,
    originIcao: check.origin_icao,
    destinationIcao: check.destination_icao,
    scheduledDepartureLocal: check.departure_local,
    originOffsetMinutes: check.origin_offset,
  };
  const match = matchLeg(leg, records);
  if (match) {
    return record("found", {
      target_record: withUnscheduled(match.record, unscheduled),
      target_matched_by: match.matchedBy,
      target_month: monthOf.get(flightKey(match.record)) ?? primary,
      target_version: FLIGHT_CHECK_VERSION,
    });
  }
  if (unavailable) return record("retry", { target_code: unavailable.code });
  // Any month the flight may be in that is not there (the ticket's, or the one beside it) is one not out
  // yet; long past its time, a check given up that says so, which a person asks again: never "not found",
  // for that file was never read.
  const missing = months.find((month) => read.get(month)?.kind === "missing");
  if (missing) {
    return monthsBetween(missing, current) > settings.missingAfterMonths
      ? record("failed", { target_code: "vra_month_missing" })
      : record("not_published", { target_month: missing });
  }
  return record("not_found", { target_month: primary, target_version: FLIGHT_CHECK_VERSION });
}

/**
 * A leg was written: the legs owed a check are checked right after the response is sent instead of at the next
 * sweep.
 */
export async function queueFlightCheck(): Promise<void> {
  soon("flight-check", () => checkFlights(createServiceClient(), { limit: 10 }));
}
