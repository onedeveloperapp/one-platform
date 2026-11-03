/**
 * The flight itself, step by step, as the agency follows it once the passenger agreed (the owner, 2026-11-03): each
 * leg leaving its origin and arriving at its destination, the whole way, as the firm follows a case along its steps.
 * These are the steps of a flight with no problem; a problem is the trip's own way (`journey.ts`: told to the
 * passenger, with the firm). What a step says happened is what the flight's source said (FlightAware, or the test
 * chat's tools, migration 0084), never a guess from the clock: a leg no source said left is still to leave, however
 * late it is. Pure: read from `pax_flight_progress`.
 */

import { TRIP_STATES, type TripState } from "./passengers";

export type FlightLegStatus = "scheduled" | "delayed" | "cancelled" | "changed" | "landed";
const LEG_STATUSES: readonly FlightLegStatus[] = ["scheduled", "delayed", "cancelled", "changed", "landed"];

export type FlightLeg = {
  position: number;
  flightNumber: string;
  origin: string;
  destination: string;
  /** Scheduled local times of its airports, "YYYY-MM-DDTHH:MM". */
  departure: string;
  arrival: string;
  status: FlightLegStatus;
  /** When it is now expected at its destination, local time; null when nothing is expected. */
  estimatedArrival: string | null;
  /** When it left and arrived, local times, as its source said. */
  departed: string | null;
  arrived: string | null;
  /** When its source last said anything of it (an instant). */
  statusAt: string | null;
};

export type FlightTrip = {
  tripId: string;
  travelerId: string;
  holder: string;
  locator: string | null;
  state: TripState;
  /** Where its flights are read: FlightAware, or the test chat's tools. */
  source: "flightaware" | "simulated";
  legs: FlightLeg[];
};

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const local = (value: unknown): string | null => {
  const read = text(value);
  return read && LOCAL.test(read) ? read : null;
};

/** The answer of `pax_flight_progress`, read; null for one that is not. A trip or leg it cannot read is left out. */
export function flightTripsOf(raw: unknown): { days: number; trips: FlightTrip[] } | null {
  const answer = record(raw);
  if (!Array.isArray(answer.trips)) return null;
  const days = Number(answer.days);
  return {
    days: Number.isInteger(days) && days > 0 ? days : 7,
    trips: answer.trips.flatMap((item): FlightTrip[] => {
      const trip = record(item);
      const tripId = text(trip.trip_id);
      const travelerId = text(trip.traveler_id);
      const state = TRIP_STATES.find((value) => value === trip.state);
      if (!tripId || !travelerId || !state) return [];
      const legs = (Array.isArray(trip.legs) ? trip.legs : []).flatMap((entry): FlightLeg[] => {
        const leg = record(entry);
        const departure = local(leg.departure);
        const arrival = local(leg.arrival);
        const status = LEG_STATUSES.find((value) => value === leg.status);
        const flightNumber = text(leg.flight_number);
        const origin = text(leg.origin);
        const destination = text(leg.destination);
        if (typeof leg.position !== "number" || !departure || !arrival || !status) return [];
        if (!flightNumber || !origin || !destination) return [];
        return [
          {
            position: leg.position,
            flightNumber,
            origin,
            destination,
            departure,
            arrival,
            status,
            estimatedArrival: local(leg.estimated_arrival),
            departed: local(leg.departed),
            arrived: local(leg.arrived),
            statusAt: text(leg.status_at),
          },
        ];
      });
      return [
        {
          tripId,
          travelerId,
          holder: text(trip.holder) ?? "",
          locator: text(trip.locator),
          state,
          source: trip.source === "simulated" ? "simulated" : "flightaware",
          legs,
        },
      ];
    }),
  };
}

/** A step is late when it happened, or is now expected, this many minutes after its scheduled time or more. */
export const LATE_MINUTES = 15;

const minutesOf = (value: string): number => {
  const [day, time] = value.split("T");
  const [year, month, date] = (day ?? "").split("-").map(Number);
  const [hour, minute] = (time ?? "").split(":").map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, date ?? 1, hour ?? 0, minute ?? 0) / 60_000;
};
const lateBy = (scheduled: string, actual: string | null): number =>
  actual === null ? 0 : minutesOf(actual) - minutesOf(scheduled);

export type FlightStepState = "done" | "current" | "next" | "stopped";

export type FlightStep = {
  key: string;
  kind: "departure" | "arrival";
  airport: string;
  flightNumber: string;
  state: FlightStepState;
  /** When it happened (done), or when it is expected (the source's estimate, else the schedule), local time. */
  at: string;
  /** Whether it happened, or is expected, late. */
  late: boolean;
};

/** What happens now, in a sentence: waiting to leave, in the air, between two flights, arrived, or stopped. */
export type FlightNow =
  | { kind: "before"; flightNumber: string; airport: string; at: string }
  | { kind: "in_air"; flightNumber: string; from: string; to: string; at: string; late: boolean }
  | { kind: "connection"; flightNumber: string; airport: string; at: string }
  | { kind: "arrived"; airport: string; at: string }
  | { kind: "cancelled" | "changed"; flightNumber: string };

export type FlightProgress = {
  steps: FlightStep[];
  /** The step the way is at (the first not done, or the last once it arrived), from 0. */
  reached: number;
  /**
   * Whether the way began: a leg left. Before that nothing is under way, however soon the flight is: the first step
   * is still to come, and the way in small is drawn with none under way.
   */
  started: boolean;
  state: "progress" | "done" | "stopped";
  now: FlightNow | null;
};

/** The legs in the order they fly: by when each leaves, its position deciding a tie. */
const inOrder = (legs: readonly FlightLeg[]) =>
  [...legs].sort((a, b) => a.departure.localeCompare(b.departure) || a.position - b.position);

export function flightProgress(legs: readonly FlightLeg[]): FlightProgress {
  const ordered = inOrder(legs);
  const steps: FlightStep[] = [];
  let open = -1;
  for (const leg of ordered) {
    const stopped = leg.status === "cancelled" || leg.status === "changed";
    const arrived = !stopped && (leg.arrived !== null || leg.status === "landed");
    const departed = !stopped && (arrived || leg.departed !== null);
    const expectedArrival = leg.arrived ?? leg.estimatedArrival ?? leg.arrival;
    const pairs: [FlightStep["kind"], boolean, string, boolean][] = [
      ["departure", departed, leg.departed ?? leg.departure, lateBy(leg.departure, leg.departed) >= LATE_MINUTES],
      [
        "arrival",
        arrived,
        expectedArrival,
        leg.status === "delayed" || lateBy(leg.arrival, leg.arrived ?? leg.estimatedArrival) >= LATE_MINUTES,
      ],
    ];
    for (const [kind, done, at, late] of pairs) {
      const index = steps.length;
      let state: FlightStepState = "next";
      if (open === -1) {
        if (done) state = "done";
        else {
          open = index;
          // Waiting for the first departure is no step under way: the way has not begun.
          state = stopped ? "stopped" : index === 0 ? "next" : "current";
        }
      }
      steps.push({
        key: `${leg.position}:${kind}`,
        kind,
        airport: kind === "departure" ? leg.origin : leg.destination,
        flightNumber: leg.flightNumber,
        state,
        at,
        late,
      });
    }
  }
  if (steps.length === 0) return { steps, reached: 0, started: false, state: "progress", now: null };
  if (open === -1) {
    const last = steps[steps.length - 1]!;
    return {
      steps,
      reached: steps.length - 1,
      started: true,
      state: "done",
      now: { kind: "arrived", airport: last.airport, at: last.at },
    };
  }
  const step = steps[open]!;
  const leg = ordered[Math.floor(open / 2)]!;
  if (step.state === "stopped") {
    return {
      steps,
      reached: open,
      started: open > 0,
      state: "stopped",
      now: { kind: leg.status === "changed" ? "changed" : "cancelled", flightNumber: leg.flightNumber },
    };
  }
  const now: FlightNow =
    step.kind === "arrival"
      ? {
          kind: "in_air",
          flightNumber: leg.flightNumber,
          from: leg.origin,
          to: leg.destination,
          at: step.at,
          late: step.late,
        }
      : open > 0
        ? { kind: "connection", flightNumber: leg.flightNumber, airport: leg.origin, at: step.at }
        : { kind: "before", flightNumber: leg.flightNumber, airport: leg.origin, at: step.at };
  return { steps, reached: open, started: open > 0, state: "progress", now };
}

/** A local time as a step says it: the hour on the day asked about ("08:10"), else the day too ("20/11 08:10"). */
export function stepTimeLabel(value: string, today: string): string {
  const [day, time] = value.split("T");
  if (!day || !time) return "";
  if (day === today) return time.slice(0, 5);
  const [, month, date] = day.split("-");
  return `${date}/${month} ${time.slice(0, 5)}`;
}

/** The latest moment a source said anything of a trip's legs: when the progress was last read. */
export function lastRead(legs: readonly FlightLeg[]): string | null {
  return legs.reduce<string | null>(
    (latest, leg) => (leg.statusAt && (!latest || leg.statusAt > latest) ? leg.statusAt : latest),
    null,
  );
}

// The `product` message keys, spelled out so the catalog check sees each one.

export const FLIGHT_STEP_KEY: Record<FlightStep["kind"], string> = {
  departure: "pax-flight-step-departure",
  arrival: "pax-flight-step-arrival",
};

export const FLIGHT_NOW_LEAD_KEY: Record<FlightNow["kind"], string> = {
  before: "pax-flight-now-before-lead",
  in_air: "pax-flight-now-in-air-lead",
  connection: "pax-flight-now-connection-lead",
  arrived: "pax-flight-now-arrived-lead",
  cancelled: "pax-flight-now-cancelled-lead",
  changed: "pax-flight-now-changed-lead",
};
