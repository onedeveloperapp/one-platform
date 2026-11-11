import { firstNameOf } from "@/lib/cases/cases";
import { type AlertLeg, flightWords } from "@/modules/direito-do-passageiro/flight-alerts/words";
import { journeysOf, type WatchedLeg } from "@flyee/rules/flight-problem";

/**
 * The day of a trip ONE follows (migration 0173, item 2.6 of the case journey plan): which journey owes its word now.
 * About two hours before a journey leaves, a good trip; half an hour after it lands, whether all went well. Each once
 * per journey, never of a journey a case took, whose problem the passenger was told of, or that was cancelled. Pure:
 * the moments are instants the database gave from each airport's own offset; what may go is the database's.
 */

export type DayKind = "departure" | "arrival";

export type DayLeg = {
  position: number;
  flightNumber: string;
  origin: string;
  destination: string;
  originCity: string | null;
  destinationCity: string | null;
  /** Local, at the airports. */
  departure: string;
  arrival: string;
  status: WatchedLeg["status"];
  estimatedArrival: string | null;
  /** Instants (ISO): the scheduled departure, and the arrival as known now (landed, expected or scheduled). */
  departureAt: string;
  arrivalAt: string;
  caseId: string | null;
};

export type DayTrip = {
  tripId: string;
  test: boolean;
  passengerName: string;
  firm: string;
  legs: DayLeg[];
  /** What was written of the trip already, and the journeys whose problem the passenger was told of. */
  written: { journey: number; kind: DayKind }[];
  alerted: number[];
};

/** How long before a journey leaves its good trip goes, and the window after it lands for the question. */
export const DEPARTURE_BEFORE_MINUTES = 120;
export const ARRIVAL_AFTER_MINUTES = 30;
export const ARRIVAL_UNTIL_MINUTES = 180;

export type DayWord = { journey: number; kind: DayKind; legs: DayLeg[] };

const minutes = (from: string, to: Date): number | null => {
  const at = Date.parse(from);
  return Number.isNaN(at) ? null : (at - to.getTime()) / 60_000;
};

/** The journeys of a trip, as the rule cuts them, each with its legs as the database gave them. */
export function dayJourneys(legs: readonly DayLeg[]): DayLeg[][] {
  const byPosition = new Map(legs.map((leg) => [leg.position, leg]));
  const watched: WatchedLeg[] = legs.map((leg) => ({
    position: leg.position,
    scheduledDeparture: leg.departure,
    scheduledArrival: leg.arrival,
    status: leg.status,
    estimatedArrival: leg.estimatedArrival,
    origin: leg.origin,
    destination: leg.destination,
  }));
  return journeysOf(watched).map((journey) => journey.flatMap((leg) => byPosition.get(leg.position) ?? []));
}

/**
 * What a trip owes now: by the clock, or, in the test chat, by what the tester just made happen (a leg leaving owes
 * its journey's good trip, the journey's last leg landing its question), so the test needs no wait.
 */
export function dayWordsDue(
  trip: DayTrip,
  now: Date,
  event: { kind: "depart" | "land"; position: number } | null = null,
): DayWord[] {
  const done = new Set(trip.written.map((item) => `${item.journey}:${item.kind}`));
  return dayJourneys(trip.legs).flatMap((legs, index): DayWord[] => {
    const journey = index + 1;
    const first = legs[0];
    const last = legs[legs.length - 1];
    if (!first || !last) return [];
    if (trip.alerted.includes(journey) || legs.some((leg) => leg.caseId !== null)) return [];
    if (legs.some((leg) => leg.status === "cancelled")) return [];
    const words: DayWord[] = [];
    const departs = event
      ? event.kind === "depart" && event.position === first.position
      : (() => {
          const left = minutes(first.departureAt, now);
          return left !== null && left > 0 && left <= DEPARTURE_BEFORE_MINUTES;
        })();
    if (departs && !done.has(`${journey}:departure`)) words.push({ journey, kind: "departure", legs });
    const lands = event
      ? event.kind === "land" && event.position === last.position
      : (() => {
          const since = minutes(last.arrivalAt, now);
          return since !== null && -since >= ARRIVAL_AFTER_MINUTES && -since <= ARRIVAL_UNTIL_MINUTES;
        })();
    if (lands && !done.has(`${journey}:arrival`)) words.push({ journey, kind: "arrival", legs });
    return words;
  });
}

/** The three values of the template: the passenger's first name, the firm and the journey's flights. */
export function dayParams(trip: DayTrip, word: DayWord): string[] {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const legs: AlertLeg[] = word.legs.map((leg) => ({
    position: leg.position,
    flightNumber: leg.flightNumber,
    origin: leg.origin,
    originCity: leg.originCity,
    destination: leg.destination,
    destinationCity: leg.destinationCity,
    departure: leg.departure,
  }));
  return [clean(firstNameOf(trip.passengerName) || trip.passengerName), clean(trip.firm), clean(flightWords(legs))];
}

const STATUSES: readonly WatchedLeg["status"][] = ["scheduled", "delayed", "cancelled", "changed", "landed"];
const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The trips as `trip_day_trips` answers them; what is not one is left out. */
export function dayTripsOf(raw: unknown): DayTrip[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): DayTrip[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    const tripId = text(row.trip_id);
    if (!tripId) return [];
    const legs = (Array.isArray(row.legs) ? row.legs : []).flatMap((rawLeg): DayLeg[] => {
      const leg = (rawLeg ?? {}) as Record<string, unknown>;
      const status = leg.status as WatchedLeg["status"];
      if (typeof leg.position !== "number" || !STATUSES.includes(status)) return [];
      return [
        {
          position: leg.position,
          flightNumber: text(leg.flight_number),
          origin: text(leg.origin),
          destination: text(leg.destination),
          originCity: text(leg.origin_city) || null,
          destinationCity: text(leg.destination_city) || null,
          departure: text(leg.departure),
          arrival: text(leg.arrival),
          status,
          estimatedArrival: text(leg.estimated_arrival) || null,
          departureAt: text(leg.departure_at),
          arrivalAt: text(leg.arrival_at),
          caseId: text(leg.case_id) || null,
        },
      ];
    });
    const written = (Array.isArray(row.written) ? row.written : []).flatMap((rawItem) => {
      const entry = (rawItem ?? {}) as Record<string, unknown>;
      return typeof entry.journey === "number" && (entry.kind === "departure" || entry.kind === "arrival")
        ? [{ journey: entry.journey, kind: entry.kind as DayKind }]
        : [];
    });
    const alerted = (Array.isArray(row.alerted) ? row.alerted : []).filter(
      (value): value is number => typeof value === "number",
    );
    return [
      {
        tripId,
        test: row.test === true,
        passengerName: text(row.passenger_name),
        firm: text(row.firm),
        legs,
        written,
        alerted,
      },
    ];
  });
}
