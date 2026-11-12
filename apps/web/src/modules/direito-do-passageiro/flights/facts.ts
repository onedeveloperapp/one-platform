import "server-only";

import { momentLabel } from "@/lib/ai/approvals";
import { flightStatusProvider } from "@/modules/direito-do-passageiro/flights/status";
import {
  compareLeg,
  factsOfRecord,
  factsOfStatus,
  type FlightFacts,
  type LegComparison,
  type MatchedBy,
  wallAt,
} from "@flyee/flights/check";
import type { FlightStatus } from "@flyee/flights/types";
import {
  type UnscheduledKind,
  type UnscheduledLeg,
  VRA_TIME_ZONE,
  type VraRecord,
  zonedInstant,
} from "@flyee/flights/vra";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the case screen and the dossier read of the check of each leg
 * (migration 0030), under the person's own session: what ANAC's record and
 * FlightAware said of the leg's flight, its times as people at each airport
 * read them, and how the case's own times stand against them (the pure rule
 * of `@flyee/flights/check`, applied on every read: a time corrected in the
 * case is compared at once, with no new check). A read that fails throws.
 */

export type CheckStatus = "waiting" | "incomplete" | "not_published" | "found" | "not_found" | "failed";

/** A time as read at an airport: its wall time, and whether it is the airport's own or Brasília's. */
export type WallTime = { wall: string; basis: "airport" | "brasilia" } | null;

/** A leg of the same flight no schedule foresaw, as people read it: the airports by the codes a ticket prints. */
export type UnscheduledView = {
  origin: string;
  destination: string;
  departure: WallTime;
  arrival: WallTime;
  kind: UnscheduledKind;
};

export type SourceView = {
  status: CheckStatus;
  checkedLabel: string | null;
  /** The month of the record the flight was looked for in (the record only). */
  month: string | null;
  matchedBy: MatchedBy | null;
  /** The flight as the source names it ("TAM 3418"), when it is not the leg's own number. */
  operatedAs: string | null;
  times: {
    scheduledDeparture: WallTime;
    actualDeparture: WallTime;
    scheduledArrival: WallTime;
    actualArrival: WallTime;
  } | null;
  comparison: LegComparison | null;
  /** The source gives the flight as cancelled, or as having landed elsewhere (ONE's rule of the problem's leg). */
  cancelled: boolean;
  diverted: boolean;
  /** The record: the legs of the same flight no schedule foresaw (a stop nobody planned, a return). */
  unscheduled: UnscheduledView[];
  /** The record, for a cancelled flight: when its aircraft still reached the destination by those legs. */
  reachedDestination: WallTime;
  /** The airports the flight stopped at under the same number on the way to the leg's destination. */
  stops: string[];
  /** The legs of such a flight the record gives as cancelled, by their airports. */
  cancelledLegs: { origin: string; destination: string }[];
  /** Where the source's flight ends when it never reaches the leg's destination: then no arrival is compared. */
  endsAt: string | null;
  /** The reason the airline gave in the record, when it gave one (older months). */
  justification: string | null;
  /** FlightAware: whether its times are at the gate or on the runway. */
  basis: "gate" | "runway" | null;
  /** Why the last try failed, when it did. */
  error: string | null;
};

export type LegChecks = { vra: SourceView | null; flightaware: SourceView | null };

export type FlightChecks = {
  bySegment: Record<string, LegChecks>;
  toleranceMinutes: number;
  /** FlightAware may be asked in this environment (the platform has its key). */
  lookupAvailable: boolean;
};

type Segment = {
  id: string;
  flight_number: string | null;
  origin_iata: string | null;
  destination_iata: string | null;
  scheduled_departure_local: string | null;
  actual_arrival_local: string | null;
};

type CheckRow = {
  segment_id: string;
  source: "vra" | "flightaware";
  status: string;
  record: unknown;
  matched_by: string | null;
  month: string | null;
  checked_at: string | null;
  requested_at: string | null;
  work_error: string | null;
};

const STATUSES: readonly CheckStatus[] = ["waiting", "incomplete", "not_published", "found", "not_found", "failed"];
const isStatus = (value: unknown): value is CheckStatus => (STATUSES as readonly unknown[]).includes(value);
const isMatchedBy = (value: unknown): value is MatchedBy =>
  value === "operator" || value === "codeshare" || value === "route";

const isRecord = (value: unknown): value is VraRecord =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as VraRecord).airline === "string" &&
  typeof (value as VraRecord).scheduledDeparture === "string" &&
  typeof (value as VraRecord).scheduledArrival === "string";

const KINDS: readonly UnscheduledKind[] = ["extra", "return", "included", "duplicated", "other"];

/** The legs a stored record carries, each as it should be; a record of before they were read carries none. */
const legsOf = (record: VraRecord): UnscheduledLeg[] =>
  (Array.isArray(record.unscheduled) ? record.unscheduled : []).filter(
    (leg): leg is UnscheduledLeg =>
      typeof leg === "object" &&
      leg !== null &&
      typeof leg.origin === "string" &&
      typeof leg.destination === "string" &&
      (KINDS as readonly unknown[]).includes(leg.kind),
  );

/** The legs after the first that take a stored flight on to the leg's destination, each as it should be. */
const continuationOf = (record: VraRecord): VraRecord[] =>
  (Array.isArray(record.continuation) ? record.continuation : []).filter((leg): leg is VraRecord => isRecord(leg));

const isStatusAnswer = (value: unknown): value is FlightStatus =>
  typeof value === "object" && value !== null && typeof (value as FlightStatus).state === "string";

export async function loadFlightChecks(
  supabase: SupabaseClient,
  firmId: string,
  caseId: string,
  segments: readonly Segment[],
  timeZone: string | null | undefined,
): Promise<FlightChecks> {
  const codes = [
    ...new Set(
      segments
        .flatMap((segment) => [segment.origin_iata, segment.destination_iata])
        .filter((code): code is string => Boolean(code)),
    ),
  ];
  const [checks, airports, settings] = await Promise.all([
    supabase
      .from("flight_checks")
      .select("segment_id, source, status, record, matched_by, month, checked_at, requested_at, work_error")
      .eq("org_id", firmId)
      .eq("case_id", caseId),
    codes.length > 0
      ? supabase.from("airports").select("iata, utc_offset_minutes").in("iata", codes)
      : { data: [], error: null },
    supabase.from("platform_settings").select("value").eq("key", "flights").maybeSingle(),
  ]);
  if (checks.error || airports.error) throw new Error("flight checks could not be read");

  // The airports the record names by their ICAO codes: of its flight, its stops and its legs no schedule foresaw.
  const rows = (checks.data ?? []) as CheckRow[];
  const icaos = [
    ...new Set(
      rows.flatMap((row) =>
        row.source === "vra" && isRecord(row.record)
          ? [
              row.record.origin,
              row.record.destination,
              ...continuationOf(row.record).flatMap((leg) => [leg.origin, leg.destination]),
              ...legsOf(row.record).flatMap((leg) => [leg.origin, leg.destination]),
            ]
          : [],
      ),
    ),
  ];
  const byIcao = new Map<string, { iata: string; utc_offset_minutes: number | null }>();
  if (icaos.length > 0) {
    const known = await supabase.from("airports").select("iata, icao, utc_offset_minutes").in("icao", icaos);
    if (known.error) throw new Error("flight checks could not be read");
    for (const airport of (known.data ?? []) as { iata: string; icao: string; utc_offset_minutes: number | null }[]) {
      if (!byIcao.has(airport.icao)) byIcao.set(airport.icao, airport);
    }
  }

  const offsetOf = new Map(
    ((airports.data ?? []) as { iata: string; utc_offset_minutes: number | null }[]).map((airport) => [
      airport.iata,
      airport.utc_offset_minutes,
    ]),
  );
  const setting = (settings.data?.value ?? {}) as Record<string, unknown>;
  const configured = Number(setting.agreement_minutes);
  const toleranceMinutes = Number.isInteger(configured) && configured > 0 ? configured : 15;
  const working = Number(setting.lookup_working_minutes);
  // A lookup of FlightAware whose answer never came back is lost after these minutes: it may be asked again.
  const lostAfter = (Number.isInteger(working) && working > 0 ? working : 5) * 60_000;
  const iataOf = (icao: string) => byIcao.get(icao)?.iata ?? icao;

  const bySegment: Record<string, LegChecks> = {};
  for (const segment of segments) {
    const originOffset = segment.origin_iata ? (offsetOf.get(segment.origin_iata) ?? null) : null;
    const destinationOffset = segment.destination_iata ? (offsetOf.get(segment.destination_iata) ?? null) : null;
    const informed = {
      scheduledDepartureLocal: segment.scheduled_departure_local,
      actualArrivalLocal: segment.actual_arrival_local,
      originOffsetMinutes: originOffset,
      destinationOffsetMinutes: destinationOffset,
    };
    const view = (row: CheckRow | undefined): SourceView | null => {
      if (!row || !isStatus(row.status)) return null;
      // A lookup whose answer never came back is one that failed, which a person asks again.
      const lost =
        row.source === "flightaware" &&
        row.status === "waiting" &&
        (!row.requested_at || Date.now() - Date.parse(row.requested_at) > lostAfter);
      let facts: FlightFacts | null = null;
      let stops: string[] = [];
      let cancelledLegs: SourceView["cancelledLegs"] = [];
      let endsAt: string | null = null;
      let justification: string | null = null;
      let operatedAs: string | null = null;
      let basis: SourceView["basis"] = null;
      let zones: { origin: string | null; destination: string | null } = { origin: null, destination: null };
      let unscheduled: UnscheduledView[] = [];
      if (row.source === "vra" && isRecord(row.record)) {
        const legs = legsOf(row.record);
        const continuation = continuationOf(row.record);
        facts = factsOfRecord({ ...row.record, unscheduled: legs, continuation });
        stops = continuation.map((leg) => iataOf(leg.origin));
        cancelledLegs =
          continuation.length > 0
            ? [row.record, ...continuation]
                .filter((leg) => leg.state === "cancelado")
                .map((leg) => ({ origin: iataOf(leg.origin), destination: iataOf(leg.destination) }))
            : [];
        endsAt = row.record.arrivalElsewhere === true ? iataOf(row.record.destination) : null;
        // A leg whose destination the platform does not know by its ICAO code was never followed to it: when the
        // record's flight ends at an airport known as another, its arrival is not the leg's either.
        const final = byIcao.get((continuation.at(-1) ?? row.record).destination)?.iata;
        if (!endsAt && final && segment.destination_iata && final !== segment.destination_iata) {
          endsAt = final;
          facts = { ...facts, scheduledArrival: null, actualArrival: null, reachedDestination: null };
        }
        justification =
          [row.record, ...continuation]
            .map((leg) => leg.justification)
            .find((said) => typeof said === "string" && said) ?? null;
        // Brasília times, read at each airport with the offset it has when it is one of Brazil's.
        const brasiliaAt = (wall: string | null, icao: string): WallTime =>
          wall
            ? wallAt(zonedInstant(wall, VRA_TIME_ZONE), { offsetMinutes: byIcao.get(icao)?.utc_offset_minutes ?? null })
            : null;
        unscheduled = legs.map((leg) => ({
          origin: byIcao.get(leg.origin)?.iata ?? leg.origin,
          destination: byIcao.get(leg.destination)?.iata ?? leg.destination,
          departure: brasiliaAt(leg.actualDeparture, leg.origin),
          arrival: brasiliaAt(leg.actualArrival, leg.destination),
          kind: leg.kind,
        }));
        const own = segment.flight_number ? segment.flight_number.slice(2).replace(/^0+/, "") : null;
        if (row.matched_by !== "operator" || own !== row.record.number)
          operatedAs = `${row.record.airline} ${row.record.number}`;
      } else if (row.source === "flightaware" && isStatusAnswer(row.record)) {
        facts = factsOfStatus(row.record);
        basis = row.record.basis ?? null;
        zones = { origin: row.record.originTimeZone ?? null, destination: row.record.destinationTimeZone ?? null };
        stops = Array.isArray(row.record.stops) ? row.record.stops.filter((stop) => typeof stop === "string") : [];
        // A flight that lands somewhere else than the leg's destination has no arrival of the leg's.
        if (row.record.destination && segment.destination_iata && row.record.destination !== segment.destination_iata) {
          endsAt = row.record.destination;
          facts = { ...facts, scheduledArrival: null, actualArrival: null };
        }
      }
      const at = (instant: string | null, offset: number | null, zone: string | null) =>
        wallAt(instant, { offsetMinutes: offset, timeZone: zone });
      return {
        status: lost ? (facts ? "found" : "failed") : row.status,
        checkedLabel: row.checked_at ? momentLabel(row.checked_at, timeZone) : null,
        month: row.month,
        matchedBy: isMatchedBy(row.matched_by) ? row.matched_by : null,
        operatedAs,
        times: facts
          ? {
              scheduledDeparture: at(facts.scheduledDeparture, originOffset, zones.origin),
              actualDeparture: at(facts.actualDeparture, originOffset, zones.origin),
              scheduledArrival: at(facts.scheduledArrival, destinationOffset, zones.destination),
              actualArrival: at(facts.actualArrival, destinationOffset, zones.destination),
            }
          : null,
        comparison: facts ? compareLeg(informed, facts, toleranceMinutes) : null,
        cancelled: facts?.cancelled ?? false,
        diverted: facts?.diverted ?? false,
        unscheduled,
        reachedDestination: facts ? at(facts.reachedDestination ?? null, destinationOffset, null) : null,
        stops,
        cancelledLegs,
        endsAt,
        justification,
        basis,
        error: lost ? "lookup_lost" : row.work_error,
      };
    };
    const own = rows.filter((row) => row.segment_id === segment.id);
    bySegment[segment.id] = {
      vra: view(own.find((row) => row.source === "vra")),
      flightaware: view(own.find((row) => row.source === "flightaware")),
    };
  }
  return { bySegment, toleranceMinutes, lookupAvailable: flightStatusProvider() !== null };
}
