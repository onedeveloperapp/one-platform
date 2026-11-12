import type { FlightStatus } from "@flyee/flights/types";
import {
  type UnscheduledLeg,
  VRA_TIME_ZONE,
  type VraRecord,
  type VraUnscheduledLine,
  zonedInstant,
} from "@flyee/flights/vra";

/**
 * How a leg of a case is checked against what a source says of its flight:
 * which flight of ANAC's official record (or of a provider) is the leg's,
 * and whether the times the case holds agree with it. Pure, and versioned:
 * a check keeps the version that made it.
 *
 * It decides nothing about a claim. A delay that gives a claim is a rule of
 * `packages/rules`; this says what a source recorded, next to what the case
 * says, for a person to read.
 */
export const FLIGHT_CHECK_VERSION = "conferencia-voo-v1";

/** A leg of a case, as the check reads it. */
export type LegToCheck = {
  /**
   * The ICAO designators the official record may name the airline's flights by: one for most airlines,
   * two for LATAM's "LA" (LATAM Brasil, "TAM", and LATAM Chile, "LAN"). Empty when the airline is unknown.
   */
  designators: readonly string[];
  /** The flight number: digits, no zeros before them. */
  number: string;
  /** The airports' ICAO codes, when the case has them. */
  originIcao: string | null;
  destinationIcao: string | null;
  /** The scheduled departure as a ticket prints it: the origin airport's local time, "YYYY-MM-DDTHH:MM[:SS]". */
  scheduledDepartureLocal: string;
  /** The origin airport's offset from UTC in minutes, when known (the airports of Brazil). */
  originOffsetMinutes: number | null;
};

/** How a flight of the record was found to be the leg's. */
export type MatchedBy = "operator" | "codeshare" | "route";
/**
 * The flight of the record that is the leg's: its first leg from the leg's origin, with the legs after it
 * that take the same flight on to the leg's destination (`continuation`), or marked as never reaching it
 * (`arrivalElsewhere`).
 */
export type RecordMatch = { record: VraRecord; matchedBy: MatchedBy };

/** The most legs one number is followed through, from the leg's origin to its destination. */
const MOST_LEGS = 4;

/** The farthest a scheduled departure of the record may be from the ticket's, with the origin's offset known. */
const MOST_APART_MINUTES = 12 * 60;
/** The same without it: both read as wall times of zones a few hours apart. */
const MOST_APART_WALL_MINUTES = 18 * 60;

const wallMinutes = (wall: string): number => Date.parse(`${wall.slice(0, 16)}:00Z`) / 60_000;
const instantMinutes = (iso: string): number => Date.parse(iso) / 60_000;

/** Two lines of the record are legs of one flight of a day: the same airline, number and day of the flight. */
const sameFlight = (a: VraRecord, b: VraRecord): boolean =>
  a.airline === b.airline &&
  a.number === b.number &&
  (a.reference && b.reference
    ? a.reference === b.reference
    : Math.abs(wallMinutes(b.scheduledDeparture) - wallMinutes(a.scheduledDeparture)) <= 24 * 60);

/** How a candidate flight ranks: one that reaches the leg's destination, then the operator's own, then the closest. */
const orderOf = (
  candidate: { continuation: VraRecord[] | null; matchedBy: MatchedBy; gap: number },
  rank: Record<MatchedBy, number>,
): number[] => [candidate.continuation === null ? 1 : 0, rank[candidate.matchedBy], candidate.gap];

/** Whether one order comes before another, value by value. */
const comesBefore = (mine: number[], theirs: number[]): boolean => {
  for (let index = 0; index < mine.length; index += 1) {
    if (mine[index] !== theirs[index]) return mine[index] < theirs[index];
  }
  return false;
};

/**
 * The legs after a flight of the record that take the same flight on to an airport, in order: none when it
 * lands there, null when no leg of it does.
 */
function continuationTo(first: VraRecord, destination: string, records: readonly VraRecord[]): VraRecord[] | null {
  const after: VraRecord[] = [];
  let at = first;
  while (at.destination !== destination) {
    if (after.length + 1 >= MOST_LEGS) return null;
    const from = at;
    const next = records
      .filter(
        (record) =>
          record !== from &&
          !after.includes(record) &&
          sameFlight(first, record) &&
          record.origin === from.destination &&
          wallMinutes(record.scheduledDeparture) >= wallMinutes(from.scheduledArrival),
      )
      .sort((a, b) => wallMinutes(a.scheduledDeparture) - wallMinutes(b.scheduledDeparture))[0];
    if (!next) return null;
    after.push(next);
    at = next;
  }
  return after;
}

/**
 * The flight of the record that is the leg's, or null. A flight is the leg's
 * when it is operated under one of the airline's designators with the leg's
 * number, or sold as it (a codeshare), or, for an airline the platform does
 * not know, flies the same number on the same route; from the leg's origin
 * when the case has it (one number may fly several legs on a day), on the
 * day the ticket says. When the case has the leg's destination, the flight
 * is followed through its stops to it (one number flies Galeão to Belém and
 * on to Macapá: a ticket from Galeão to Macapá arrives with the second
 * leg); one that reaches it comes before one that does not, and one that
 * does not is marked so, for its arrival is somewhere else. Then the
 * operator's own first, then the one closest to the ticket's time.
 */
export function matchLeg(leg: LegToCheck, records: readonly VraRecord[]): RecordMatch | null {
  const legWall = leg.scheduledDepartureLocal.slice(0, 16);
  const legInstant = leg.originOffsetMinutes === null ? null : wallMinutes(legWall) - leg.originOffsetMinutes;
  const rank: Record<MatchedBy, number> = { operator: 0, codeshare: 1, route: 2 };
  let best: (RecordMatch & { gap: number; continuation: VraRecord[] | null }) | null = null;
  for (const record of records) {
    let matchedBy: MatchedBy | null = null;
    if (leg.designators.includes(record.airline) && record.number === leg.number) matchedBy = "operator";
    else if (leg.designators.some((designator) => record.codeshares.includes(`${designator}${leg.number}`))) {
      matchedBy = "codeshare";
    } else if (
      leg.designators.length === 0 &&
      record.number === leg.number &&
      leg.originIcao !== null &&
      leg.destinationIcao !== null &&
      record.origin === leg.originIcao &&
      record.destination === leg.destinationIcao
    ) {
      matchedBy = "route";
    }
    if (!matchedBy) continue;
    if (leg.originIcao !== null && record.origin !== leg.originIcao) continue;
    if (leg.originIcao === null && leg.destinationIcao !== null && record.destination !== leg.destinationIcao) continue;
    const gap =
      legInstant === null
        ? Math.abs(wallMinutes(record.scheduledDeparture) - wallMinutes(legWall))
        : Math.abs(instantMinutes(zonedInstant(record.scheduledDeparture, VRA_TIME_ZONE)) - legInstant);
    if (gap > (legInstant === null ? MOST_APART_WALL_MINUTES : MOST_APART_MINUTES)) continue;
    const continuation = leg.destinationIcao === null ? [] : continuationTo(record, leg.destinationIcao, records);
    const candidate = { record, matchedBy, gap, continuation };
    if (!best || comesBefore(orderOf(candidate, rank), orderOf(best, rank))) best = candidate;
  }
  if (!best) return null;
  const { record, matchedBy, continuation } = best;
  if (continuation === null) return { record: { ...record, arrivalElsewhere: true }, matchedBy };
  return { record: continuation.length > 0 ? { ...record, continuation } : record, matchedBy };
}

/** The most legs with no schedule kept beside a flight: a diversion or a return leaves a few. */
const MOST_UNSCHEDULED = 6;

/**
 * A flight of the record with the legs of the same flight no schedule foresaw (the same airline, the same
 * number, the same day of the flight), in the order they were flown. A cancelled flight whose aircraft went
 * on by other legs (a stop nobody planned, a return to the origin) is told with them. A file with no day of
 * the flight ("Referência") ties none.
 */
export function withUnscheduled(record: VraRecord, lines: readonly VraUnscheduledLine[]): VraRecord {
  if (!record.reference) return record;
  const when = (leg: UnscheduledLeg) => leg.actualDeparture ?? leg.actualArrival ?? "";
  const legs = lines
    .filter(
      (line) => line.airline === record.airline && line.number === record.number && line.reference === record.reference,
    )
    .sort((a, b) => when(a).localeCompare(when(b)))
    .slice(0, MOST_UNSCHEDULED)
    .map(({ origin, destination, actualDeparture, actualArrival, kind }) => ({
      origin,
      destination,
      actualDeparture,
      actualArrival,
      kind,
    }));
  return legs.length > 0 ? { ...record, unscheduled: legs } : record;
}

/** What a source says happened to a flight, in instants (ISO, UTC). */
export type FlightFacts = {
  scheduledDeparture: string | null;
  actualDeparture: string | null;
  scheduledArrival: string | null;
  actualArrival: string | null;
  cancelled: boolean;
  diverted: boolean;
  /**
   * For a cancelled flight of the record: when the last leg of the same flight no schedule foresaw reached
   * the flight's destination. What the aircraft did, not where any passenger was.
   */
  reachedDestination?: string | null;
};

const brasilia = (wall: string | null): string | null => (wall ? zonedInstant(wall, VRA_TIME_ZONE) : null);

/**
 * A flight of the official record as facts: its Brasília times as the instants they were; the departure of
 * its first leg and the arrival of its last, cancelled when any of its legs was. A flight that never reaches
 * the leg's destination has no arrival of the leg's.
 */
export function factsOfRecord(record: VraRecord): FlightFacts {
  const legs = [record, ...(record.continuation ?? [])];
  const final = legs[legs.length - 1];
  const elsewhere = record.arrivalElsewhere === true;
  const cancelled = legs.some((leg) => leg.state === "cancelado");
  const arrivals =
    cancelled && !elsewhere
      ? (record.unscheduled ?? []).filter((leg) => leg.destination === final.destination && leg.actualArrival)
      : [];
  const reached =
    arrivals
      .map((leg) => leg.actualArrival as string)
      .sort()
      .at(-1) ?? null;
  return {
    scheduledDeparture: brasilia(record.scheduledDeparture),
    actualDeparture: brasilia(record.actualDeparture),
    scheduledArrival: elsewhere ? null : brasilia(final.scheduledArrival),
    actualArrival: elsewhere || cancelled ? null : brasilia(final.actualArrival),
    cancelled,
    diverted: false,
    reachedDestination: brasilia(reached),
  };
}

/** What a flight status provider answered, as facts. */
export function factsOfStatus(status: FlightStatus): FlightFacts {
  return {
    scheduledDeparture: status.scheduledDeparture || null,
    actualDeparture: status.actualDeparture,
    scheduledArrival: status.scheduledArrival || null,
    actualArrival: status.actualArrival,
    cancelled: status.state === "cancelled",
    diverted: status.state === "diverted",
  };
}

/** The times a case holds of a leg, as a ticket and the passenger tell them: local times of each airport. */
export type InformedLeg = {
  scheduledDepartureLocal: string | null;
  actualArrivalLocal: string | null;
  originOffsetMinutes: number | null;
  destinationOffsetMinutes: number | null;
};

/**
 * How what a case says of a leg stands against a source:
 *
 *   agrees              every time both have is within the tolerance;
 *   differs             one of them is not (a schedule changed, an arrival told wrong, another flight);
 *   cancelled           the source says the flight did not operate (the passenger may have flown on
 *                       another one: that is a fact of the case, not a contradiction);
 *   diverted            the source says it landed somewhere else;
 *   nothing_to_compare  the case holds no time the source has, or an airport's offset is unknown.
 */
export type Agreement = "agrees" | "differs" | "cancelled" | "diverted" | "nothing_to_compare";

export type LegComparison = {
  /** The source's own delays, in minutes: actual minus scheduled. Null when the source lacks a time. */
  departureDelayMinutes: number | null;
  arrivalDelayMinutes: number | null;
  /** The case minus the source, in minutes: positive when the case says later. */
  scheduledDepartureDifference: number | null;
  actualArrivalDifference: number | null;
  agreement: Agreement;
  /**
   * A cancelled flight whose aircraft still reached the destination by legs no schedule foresaw: how long
   * after the scheduled arrival it did. Null otherwise.
   */
  reachedDestinationDelayMinutes: number | null;
};

const between = (from: string | null, to: string | null): number | null =>
  from && to ? Math.round(instantMinutes(to) - instantMinutes(from)) : null;

const localInstant = (wall: string | null, offset: number | null): number | null =>
  wall && offset !== null ? wallMinutes(wall) - offset : null;

export function compareLeg(informed: InformedLeg, facts: FlightFacts, toleranceMinutes: number): LegComparison {
  const departureDelayMinutes = between(facts.scheduledDeparture, facts.actualDeparture);
  const arrivalDelayMinutes =
    facts.cancelled || facts.diverted ? null : between(facts.scheduledArrival, facts.actualArrival);
  const informedDeparture = localInstant(informed.scheduledDepartureLocal, informed.originOffsetMinutes);
  const informedArrival = localInstant(informed.actualArrivalLocal, informed.destinationOffsetMinutes);
  const scheduledDepartureDifference =
    informedDeparture !== null && facts.scheduledDeparture
      ? Math.round(informedDeparture - instantMinutes(facts.scheduledDeparture))
      : null;
  const actualArrivalDifference =
    informedArrival !== null && facts.actualArrival && !facts.cancelled && !facts.diverted
      ? Math.round(informedArrival - instantMinutes(facts.actualArrival))
      : null;
  const differences = [scheduledDepartureDifference, actualArrivalDifference].filter(
    (difference): difference is number => difference !== null,
  );
  const agreement: Agreement = facts.cancelled
    ? "cancelled"
    : facts.diverted
      ? "diverted"
      : differences.length === 0
        ? "nothing_to_compare"
        : differences.some((difference) => Math.abs(difference) > toleranceMinutes)
          ? "differs"
          : "agrees";
  const reachedDestinationDelayMinutes = facts.cancelled
    ? between(facts.scheduledArrival, facts.reachedDestination ?? null)
    : null;
  return {
    departureDelayMinutes,
    arrivalDelayMinutes,
    scheduledDepartureDifference,
    actualArrivalDifference,
    agreement,
    reachedDestinationDelayMinutes,
  };
}

/**
 * An instant as people at an airport read it: with the airport's offset when it is known, or in the zone
 * a source names, or else in Brasília time, and said which.
 */
export function wallAt(
  instant: string | null,
  where: { offsetMinutes: number | null; timeZone?: string | null },
): { wall: string; basis: "airport" | "brasilia" } | null {
  if (!instant) return null;
  const at = Date.parse(instant);
  if (Number.isNaN(at)) return null;
  if (where.offsetMinutes !== null) {
    return { wall: new Date(at + where.offsetMinutes * 60_000).toISOString().slice(0, 16), basis: "airport" };
  }
  const zone = where.timeZone || VRA_TIME_ZONE;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    wall: `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`,
    basis: where.timeZone ? "airport" : "brasilia",
  };
}

/**
 * The months of the record a leg's flight may be in. A month's file holds the flights by their day
 * ("Referência"): the day the flight's first leg was scheduled, in Brasília time. Read in the files of June
 * to August 2026, that day is the leg's own or up to two days before it (a later leg of a long flight), so
 * the first two days of a month look in the month before too; and on the last day of a month, a leg late
 * at night at an airport west of Brasília is already the next day there, so the month after is read too.
 */
export function monthsToSearch(scheduledDepartureLocal: string): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(scheduledDepartureLocal);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const label = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
  const months = [label(year, month)];
  if (day <= 2) months.push(month === 1 ? label(year - 1, 12) : label(year, month - 1));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day === last) months.push(month === 12 ? label(year + 1, 1) : label(year, month + 1));
  return months;
}

/** A leg of a trip as the rule of the problem's leg reads it: what the official record said of its flight. */
export type LegTrouble = {
  id: string;
  /** The record answered for the leg's flight (found it, or said it is not there); false while it is still asked. */
  checked: boolean;
  cancelled: boolean;
  diverted: boolean;
  /** Actual minus scheduled arrival, in minutes, by the record; null when it has no arrival to compare. */
  arrivalDelayMinutes: number | null;
};

/**
 * The leg of a trip where the problem happened, which ONE marks by itself before the lawsuit (the owner,
 * 2026-11-12: ONE does what needs no person): a trip of one leg is that leg; a trip of several is the one leg the
 * record gives as cancelled, diverted or arriving `delayMinutes` or more late, once every leg was checked. None or
 * more than one such leg (a missed connection behind a late first leg, a trip the record does not explain), or a
 * leg still waiting for its check, is a person's to say: null.
 */
export function problemLeg(legs: readonly LegTrouble[], delayMinutes: number): string | null {
  if (legs.length === 1) return legs[0].id;
  if (legs.length === 0 || legs.some((leg) => !leg.checked)) return null;
  const troubled = legs.filter(
    (leg) =>
      leg.cancelled || leg.diverted || (leg.arrivalDelayMinutes !== null && leg.arrivalDelayMinutes >= delayMinutes),
  );
  return troubled.length === 1 ? troubled[0].id : null;
}
