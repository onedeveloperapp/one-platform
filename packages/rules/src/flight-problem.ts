/**
 * Whether a trip ONE follows has a problem to tell its passenger
 * (`flight-problem-v2`), and what the airline owes them for it.
 *
 * A trip is its legs, each in the local times of its airports, as a source
 * says them now (the test chat's tools, FlightAware), in the order they fly
 * whatever their positions say. Its legs make one journey while each departs
 * from where the one before landed within a day of it (a connection); a stay
 * longer than that, or a leg from another airport, starts another journey (the
 * way back of a round trip). The rule reads:
 *
 * - a leg cancelled: the trip is `cancelled`;
 * - a leg the airline changed (another flight, another time): `changed`;
 * - the last leg of a journey landing late at its destination by the
 *   setting's minutes or more (four hours, where Resolução 400 of ANAC, art.
 *   21, gives the passenger another flight, the refund or another way to
 *   travel): `delayed`, with by how much, the first journey that is so. A
 *   connection lost shows here: the leg after it lands later.
 *
 * Nothing else is a problem it tells: a delay shorter than the setting, a leg
 * still scheduled. A cancellation is said before a change, and a change before
 * a delay. The times of a leg are compared at its own airport (both local),
 * never across zones.
 *
 * What the airline owes is ANAC's, by the time the passenger waits
 * (Resolução 400, art. 27): from one hour, the means to communicate; from
 * two, food; from four, lodging when a night must be spent, with the way to
 * it. A cancellation, a delay of four hours or more and a change the
 * passenger does not accept give the choice of another flight, the refund
 * or another way to travel (art. 21 and art. 12). The rule names what is
 * owed; the words are the app's.
 */

export const FLIGHT_PROBLEM_RULE = "flight-problem-v2";

/** A leg of a trip as a source says it now. Times are local (`2026-10-22T08:10:00`), at the leg's own airports. */
export type WatchedLeg = {
  position: number;
  scheduledDeparture: string;
  scheduledArrival: string;
  status: "scheduled" | "delayed" | "cancelled" | "changed" | "landed";
  /** When the leg is now expected at its destination, local; null when nothing is said. */
  estimatedArrival: string | null;
  /** Its airports, when known: a leg from another airport than the one the leg before landed at starts a journey. */
  origin?: string | null;
  destination?: string | null;
};

/** More than this between a leg's scheduled arrival and the next one's departure is a stay, never a connection. */
export const CONNECTION_MAX_MINUTES = 24 * 60;

export type FlightProblemKind = "cancelled" | "changed" | "delayed";

export type FlightProblem = {
  kind: FlightProblemKind;
  /** The leg it is about. */
  leg: number;
  /** How late at the destination, for a delay; null otherwise. */
  delayMinutes: number | null;
};

/** What ANAC has the airline give, each said once. */
export type Assistance = "rebooking_or_refund" | "communication" | "food" | "lodging";

/** Minutes between two local times of the same airport; null when either is not a time. */
export function minutesBetween(earlier: string, later: string): number | null {
  const parse = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim());
    if (!match) return null;
    const [, y, m, d, h, min, sec] = match;
    return Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(sec ?? 0));
  };
  const from = parse(earlier);
  const to = parse(later);
  if (from === null || to === null) return null;
  return Math.round((to - from) / 60_000);
}

/** The legs in the order they fly: by their scheduled departure, then by position; a leg with no time goes last. */
export function inFlightOrder(legs: readonly WatchedLeg[]): WatchedLeg[] {
  const start = legs[0]?.scheduledDeparture ?? "";
  const offset = (leg: WatchedLeg) => minutesBetween(start, leg.scheduledDeparture);
  return [...legs].sort((a, b) => {
    const left = offset(a);
    const right = offset(b);
    if (left !== null && right !== null && left !== right) return left - right;
    if ((left === null) !== (right === null)) return left === null ? 1 : -1;
    return a.position - b.position;
  });
}

/** The journeys of a trip: its legs in the order they fly, cut where a stay or another airport starts the next. */
export function journeysOf(legs: readonly WatchedLeg[]): WatchedLeg[][] {
  const journeys: WatchedLeg[][] = [];
  for (const leg of inFlightOrder(legs)) {
    const current = journeys[journeys.length - 1];
    const before = current?.[current.length - 1];
    const gap = before ? minutesBetween(before.scheduledArrival, leg.scheduledDeparture) : null;
    const elsewhere = Boolean(before?.destination && leg.origin && before.destination !== leg.origin);
    if (!current || !before || elsewhere || (gap !== null && gap > CONNECTION_MAX_MINUTES)) journeys.push([leg]);
    else current.push(leg);
  }
  return journeys;
}

/**
 * The problem of a trip, or null when there is nothing to tell. The legs may
 * come in any order; each journey is read at its own last leg.
 */
export function flightProblem(legs: readonly WatchedLeg[], options: { delayMinutes: number }): FlightProblem | null {
  if (legs.length === 0) return null;
  const ordered = inFlightOrder(legs);
  const cancelled = ordered.find((leg) => leg.status === "cancelled");
  if (cancelled) return { kind: "cancelled", leg: cancelled.position, delayMinutes: null };
  const changed = ordered.find((leg) => leg.status === "changed");
  if (changed) return { kind: "changed", leg: changed.position, delayMinutes: null };

  const threshold = Math.max(1, Math.round(options.delayMinutes));
  for (const journey of journeysOf(ordered)) {
    const last = journey[journey.length - 1];
    if (!last.estimatedArrival) continue;
    const late = minutesBetween(last.scheduledArrival, last.estimatedArrival);
    if (late !== null && late >= threshold) return { kind: "delayed", leg: last.position, delayMinutes: late };
  }
  return null;
}

/**
 * What the airline owes for a problem, in the order a message says it: the
 * choice first, then what a wait brings. A cancellation is told before the
 * wait is known, so it names everything a wait may bring.
 */
export function assistanceDue(problem: FlightProblem): Assistance[] {
  if (problem.kind === "changed") return ["rebooking_or_refund"];
  if (problem.kind === "cancelled") return ["rebooking_or_refund", "communication", "food", "lodging"];
  const wait = problem.delayMinutes ?? 0;
  const owed: Assistance[] = [];
  if (wait >= 240) owed.push("rebooking_or_refund");
  if (wait >= 60) owed.push("communication");
  if (wait >= 120) owed.push("food");
  if (wait >= 240) owed.push("lodging");
  return owed;
}
