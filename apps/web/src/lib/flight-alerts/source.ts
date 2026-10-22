import type { FlightStatus } from "@flyee/flights/types";

/**
 * What a flight source said of a leg ONE follows, as the leg keeps it
 * (migration 0051): its state and when it is now expected at its
 * destination, in that airport's local time. Pure.
 *
 * The local time is reached without any zone table: the source's own
 * scheduled arrival and its estimate are instants of the same flight, so
 * their difference, added to the leg's scheduled local arrival, is the
 * expected local arrival. A source that does not know the flight says
 * nothing of the leg, which stays as it was.
 */

/** A leg as the database hands it to the reading (`claim_trip_watch`). */
export type FollowedLeg = {
  position: number;
  flightNumber: string;
  origin: string;
  destination: string;
  /** Local times of its airports, "YYYY-MM-DDTHH:MM". */
  departure: string;
  arrival: string;
};

/** What the leg keeps of the source's word (`record_trip_watch`). */
export type LegReading = {
  position: number;
  status: "scheduled" | "delayed" | "cancelled" | "changed" | "landed";
  /** Local time at the destination, "YYYY-MM-DDTHH:MM"; null when nothing is expected. */
  estimated_arrival: string | null;
};

/** A late arrival under this many minutes is still on time, as an airline says it. */
export const ON_TIME_MINUTES = 15;

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/** A local time moved by some minutes, "YYYY-MM-DDTHH:MM"; null when it is not one. */
export function shiftLocal(local: string, minutes: number): string | null {
  const match = LOCAL.exec(local.trim());
  if (!match || !Number.isFinite(minutes)) return null;
  const [, y, m, d, h, min] = match;
  const at = new Date(
    Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min)) + Math.round(minutes) * 60_000,
  );
  return at.toISOString().slice(0, 16);
}

/** The day of a local time, "YYYY-MM-DD". */
export const localDay = (local: string): string => local.trim().slice(0, 10);

/** The leg as the source says it now; null when the source does not know the flight. */
export function legReadingOf(leg: FollowedLeg, status: FlightStatus | null): LegReading | null {
  if (!status) return null;
  if (status.state === "cancelled") return { position: leg.position, status: "cancelled", estimated_arrival: null };
  if (status.state === "diverted") return { position: leg.position, status: "changed", estimated_arrival: null };
  const scheduled = Date.parse(status.scheduledArrival);
  const expected = Date.parse(status.estimatedArrival ?? status.actualArrival ?? "");
  const late =
    Number.isFinite(scheduled) && Number.isFinite(expected) ? Math.round((expected - scheduled) / 60_000) : null;
  const estimated = late === null ? null : shiftLocal(leg.arrival, late);
  if (status.state === "landed") return { position: leg.position, status: "landed", estimated_arrival: estimated };
  if (late !== null && late >= ON_TIME_MINUTES && estimated) {
    return { position: leg.position, status: "delayed", estimated_arrival: estimated };
  }
  return {
    position: leg.position,
    status: "scheduled",
    estimated_arrival: late !== null && late > 0 ? estimated : null,
  };
}

/** The legs as the database answered them; what is not a leg is left out. */
export function followedLegsOf(raw: unknown): FollowedLeg[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): FollowedLeg[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === "string" ? value : null);
    const position = typeof row.position === "number" ? row.position : null;
    const flightNumber = text(row.flight_number);
    const origin = text(row.origin);
    const destination = text(row.destination);
    const departure = text(row.departure);
    const arrival = text(row.arrival);
    return position !== null && flightNumber && origin && destination && departure && arrival
      ? [{ position, flightNumber, origin, destination, departure, arrival }]
      : [];
  });
}

/** A local time of an instant in an airport's zone, "YYYY-MM-DDTHH:MM"; null when either is not one. */
export function localOf(instant: string | null | undefined, timeZone: string | null | undefined): string | null {
  if (!instant || Number.isNaN(Date.parse(instant))) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  } catch {
    return null;
  }
}
