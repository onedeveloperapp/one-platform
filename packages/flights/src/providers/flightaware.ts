import {
  arrivalDelayMinutes,
  type FlightQuery,
  type FlightStatus,
  type FlightStatusProvider,
} from "@flyee/flights/types";

/**
 * What happened to a flight, from FlightAware's AeroAPI. Written from its
 * OpenAPI reference (version 4.17.1, read on 2026-10-10 at
 * flightaware.com/commercial/aeroapi/resources/aeroapi-openapi.yml):
 *
 *   GET https://aeroapi.flightaware.com/aeroapi/flights/{ident}?ident_type=designator&start=...&end=...
 *       a flight's recent and scheduled legs: `start` no more than 10 days back, `end` no more than 2 ahead;
 *   GET https://aeroapi.flightaware.com/aeroapi/history/flights/{ident}?ident_type=designator&start=...&end=...
 *       its history, from 2011-01-01, a window of 7 days at most, never in the future;
 *
 * both with the key in the header `x-apikey`, answering
 * `{ flights: [...], links: { next } | null, num_pages }`. A flight carries
 * the times at the gate (`scheduled_out`, `actual_out`, `scheduled_in`,
 * `actual_in`, and the estimates `estimated_out`, `estimated_in`) and on the
 * runway (`*_off`, `*_on`), its airports with their
 * IATA codes and time zones, and two flags: `diverted`, and `cancelled`,
 * which the reference says means the flight is no longer tracked, "a number
 * of reasons" of which an airline's cancellation is one: a flight with a
 * real departure is never read as cancelled. An ident is best given as the
 * ICAO one ("GLO1000"); an IATA one is taken too. An error answers
 * `{ title, reason, detail, status }`.
 *
 * Each leg is a flight of its own there: a ticket from Galeão to Macapá on
 * a number that stops at Belém is the leg from Galeão and the leg on to
 * Macapá, joined here. Times are taken in pairs of one kind, the gate's or
 * the runway's, so a delay never mixes them.
 *
 * The key is the platform's (`FLIGHTAWARE_API_KEY`), never a firm's. Each
 * answer is billed by FlightAware per result set. None of it has run
 * against AeroAPI yet: the contract test answers in the shapes of that
 * reference.
 */

export const FLIGHTAWARE_BASE_URL = "https://aeroapi.flightaware.com/aeroapi";

/** The key was refused. */
export class FlightAwareAuthError extends Error {
  constructor() {
    super("flightaware_key_refused");
    this.name = "FlightAwareAuthError";
  }
}

/** AeroAPI did not answer, asked to slow down, or answered what cannot be read. */
export class FlightAwareUnavailableError extends Error {
  readonly status: number | null;
  constructor(status: number | null) {
    super(status === null ? "flightaware_no_answer" : `flightaware_http_${status}`);
    this.name = "FlightAwareUnavailableError";
    this.status = status;
  }
}

/** AeroAPI refused the query as it was asked (its parameters): a fault of the asking, never of the flight. */
export class FlightAwareQueryError extends Error {
  constructor(detail: string) {
    super(`flightaware_query_refused: ${detail}`);
    this.name = "FlightAwareQueryError";
  }
}

export type FlightAwareConfig = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** The most pages one query follows. */
  maxPages?: number;
  /** The clock, for a test. */
  now?: () => number;
};

type AirportRef = { code?: string | null; code_iata?: string | null; timezone?: string | null } | null;
type AeroFlight = {
  ident?: string;
  ident_iata?: string | null;
  cancelled?: boolean;
  diverted?: boolean;
  origin?: AirportRef;
  destination?: AirportRef;
  scheduled_out?: string | null;
  actual_out?: string | null;
  scheduled_off?: string | null;
  actual_off?: string | null;
  scheduled_on?: string | null;
  actual_on?: string | null;
  scheduled_in?: string | null;
  actual_in?: string | null;
  estimated_on?: string | null;
  estimated_in?: string | null;
};
type AeroPage = { flights?: AeroFlight[]; links?: { next?: string } | null };

const DAY = 24 * 60 * 60 * 1000;
const codeOf = (flight: string) => flight.replace(/\s+/g, "").toUpperCase();
const dateAt = (day: string, plus: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + plus * DAY).toISOString().slice(0, 10);

const iataOf = (airport: AirportRef | undefined): string => (airport?.code_iata ?? airport?.code ?? "").toUpperCase();
const departureOf = (flight: AeroFlight) => flight.scheduled_out ?? flight.scheduled_off ?? null;
const scheduledArrivalOf = (flight: AeroFlight) => flight.scheduled_in ?? flight.scheduled_on ?? null;
/** A leg AeroAPI no longer tracks and that never left: a cancellation. One that left is not. */
const legCancelled = (flight: AeroFlight) => flight.cancelled === true && !(flight.actual_out || flight.actual_off);

/** The local date of an instant in a zone, "YYYY-MM-DD"; null when either is not one. */
function localDate(instant: string | null | undefined, timeZone: string | null | undefined): string | null {
  if (!instant || Number.isNaN(Date.parse(instant))) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(instant));
  } catch {
    return null;
  }
}

export class FlightAwareProvider implements FlightStatusProvider {
  private readonly config: FlightAwareConfig;

  constructor(config: FlightAwareConfig) {
    this.config = config;
  }

  async getFlightStatus(query: FlightQuery): Promise<FlightStatus | null> {
    const flight = codeOf(query.flight);
    const date = query.date;
    if (!/^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(flight) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const ident = query.icaoFlight ? codeOf(query.icaoFlight) : flight;
    const now = (this.config.now ?? Date.now)();
    // A day either side of the local date: a flight's UTC day may be the one before or after it.
    const from = Date.parse(`${dateAt(date, -1)}T00:00:00Z`);
    const to = Date.parse(`${dateAt(date, 2)}T00:00:00Z`);
    if (from > now + 2 * DAY) return null;
    // A window the flights cover whole (10 days back, a margin kept) is asked of them; an older one, of the
    // history, which never looks ahead.
    const recent = from >= now - 9.5 * DAY;
    const path = recent ? "flights" : "history/flights";
    const start = from;
    const end = recent ? Math.min(to, now + 2 * DAY) : Math.min(to, now);
    if (end <= start) return null;

    const flights = await this.list(path, ident, new Date(start).toISOString(), new Date(end).toISOString());
    const origin = query.origin ? query.origin.trim().toUpperCase() : null;
    const destination = query.destination ? query.destination.trim().toUpperCase() : null;
    const leaving = flights
      .filter((candidate) => {
        if (localDate(departureOf(candidate), candidate.origin?.timezone) !== date) return false;
        return origin === null || iataOf(candidate.origin) === origin;
      })
      .sort((a, b) => Date.parse(departureOf(a) ?? "") - Date.parse(departureOf(b) ?? ""));
    if (destination !== null) {
      const direct = leaving.find((candidate) => iataOf(candidate.destination) === destination);
      if (direct) return this.statusOf(direct, direct, flight, date);
      // The same number on to the destination, from where the first leg lands, scheduled after it and within a
      // day: by the schedule, for a first leg that landed late is still the one the onward leg waited for.
      for (const first of leaving) {
        const landed = Date.parse(scheduledArrivalOf(first) ?? "");
        const onward = flights
          .filter((candidate) => {
            const leaves = Date.parse(departureOf(candidate) ?? "");
            return (
              candidate !== first &&
              iataOf(candidate.origin) === iataOf(first.destination) &&
              iataOf(candidate.destination) === destination &&
              leaves >= landed &&
              leaves - landed <= DAY
            );
          })
          .sort((a, b) => Date.parse(departureOf(a) ?? "") - Date.parse(departureOf(b) ?? ""))[0];
        if (onward) return this.statusOf(first, onward, flight, date);
      }
    }
    // None reaches the destination asked: the first leg from the origin, which says where it landed.
    return leaving[0] ? this.statusOf(leaving[0], leaving[0], flight, date) : null;
  }

  /** A flight from its leg's departure to its (same or onward) leg's arrival, each pair of times of one kind. */
  private statusOf(first: AeroFlight, last: AeroFlight, flight: string, date: string): FlightStatus {
    // The gate's times when the arrival has them (or nothing happened yet), else the runway's.
    const gate =
      Boolean(last.scheduled_in && (last.actual_in || !last.actual_on)) || !(last.scheduled_on || last.actual_on);
    const left = (leg: AeroFlight) => (gate ? (leg.actual_out ?? null) : (leg.actual_off ?? null));
    // Cancelled when either leg was, each by itself: a first leg flown and an onward leg cancelled never arrived.
    const cancelled = legCancelled(first) || (last !== first && legCancelled(last));
    // Each time of the kind chosen, or none: a scheduled time of the other kind would mix them.
    const scheduledDeparture = (gate ? first.scheduled_out : first.scheduled_off) ?? "";
    const scheduledArrival = (gate ? last.scheduled_in : last.scheduled_on) ?? "";
    const actualDeparture = legCancelled(first) ? null : left(first);
    const actualArrival = cancelled ? null : gate ? (last.actual_in ?? null) : (last.actual_on ?? null);
    // When it is now expected: its arrival once it landed, else AeroAPI's estimate of the same kind.
    const estimatedArrival = cancelled
      ? null
      : (actualArrival ?? (gate ? (last.estimated_in ?? null) : (last.estimated_on ?? null)));
    const diverted = first.diverted === true || last.diverted === true;
    const state: FlightStatus["state"] = cancelled
      ? "cancelled"
      : diverted
        ? "diverted"
        : actualArrival
          ? "landed"
          : actualDeparture
            ? "departed"
            : "scheduled";
    return {
      flight,
      date,
      origin: iataOf(first.origin),
      destination: iataOf(last.destination),
      scheduledDeparture,
      scheduledArrival,
      actualDeparture,
      actualArrival,
      estimatedArrival,
      state,
      arrivalDelayMinutes:
        state === "landed" && scheduledArrival && actualArrival
          ? arrivalDelayMinutes(scheduledArrival, actualArrival)
          : null,
      basis: gate ? "gate" : "runway",
      originTimeZone: first.origin?.timezone ?? null,
      destinationTimeZone: last.destination?.timezone ?? null,
      ...(last !== first ? { stops: [iataOf(first.destination)] } : {}),
    };
  }

  /** Every flight of the window, following the pages up to the limit. */
  private async list(path: string, ident: string, start: string, end: string): Promise<AeroFlight[]> {
    const base = (this.config.baseUrl ?? FLIGHTAWARE_BASE_URL).replace(/\/$/, "");
    const first = new URL(`${base}/${path}/${encodeURIComponent(ident)}`);
    first.searchParams.set("ident_type", "designator");
    first.searchParams.set("start", start);
    first.searchParams.set("end", end);
    const flights: AeroFlight[] = [];
    let next: URL | null = first;
    for (let page = 0; next && page < (this.config.maxPages ?? 3); page += 1) {
      const answer: AeroPage = await this.ask(next);
      flights.push(...(answer.flights ?? []));
      const link = answer.links?.next;
      next = link ? new URL(link.startsWith("http") ? link : `${base}${link.startsWith("/") ? "" : "/"}${link}`) : null;
    }
    return flights;
  }

  private async ask(url: URL): Promise<AeroPage> {
    const run = this.config.fetch ?? fetch;
    let response: Response;
    try {
      response = await run(url, {
        headers: { "x-apikey": this.config.apiKey, accept: "application/json" },
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
      });
    } catch {
      throw new FlightAwareUnavailableError(null);
    }
    if (response.status === 401 || response.status === 403) throw new FlightAwareAuthError();
    // A flight AeroAPI does not know: nothing known of it, never an outage.
    if (response.status === 404) return { flights: [] };
    if (response.status === 400) {
      const said = (await response.json().catch(() => null)) as { detail?: unknown } | null;
      throw new FlightAwareQueryError(typeof said?.detail === "string" ? said.detail.slice(0, 200) : "400");
    }
    if (!response.ok) throw new FlightAwareUnavailableError(response.status);
    try {
      const body = (await response.json()) as AeroPage;
      if (!body || typeof body !== "object" || (body.flights !== undefined && !Array.isArray(body.flights))) {
        throw new Error("unreadable");
      }
      return body;
    } catch {
      throw new FlightAwareUnavailableError(response.status);
    }
  }
}
