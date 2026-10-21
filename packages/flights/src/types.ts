/**
 * Flight facts of ONE (docs/ONE-PLANO-DESENVOLVIMENTO.md, 4.6 and 6): what
 * happened to a flight and the weather observed at an airport. They are
 * evidence for a case and input for its triage; whether a delay gives a claim
 * is a rule (`packages/rules`), never decided here.
 */

import type { VraMonthRead, VraWanted } from "@flyee/flights/vra";

/**
 * A flight on a day: the airline's code with the number ("LA3418"), and the local date of the scheduled
 * departure. `icaoFlight` is the same flight under the airline's ICAO designator ("TAM3418"), which a
 * provider may prefer to the IATA one; `origin` (an IATA code) tells apart the legs a flight number has on
 * one day ("G3 1000" from Guarulhos to Brasília, then from Brasília to Manaus), and `destination` says
 * where the passenger got off, so a flight is followed through a stop to it.
 */
export type FlightQuery = {
  flight: string;
  date: string;
  icaoFlight?: string | null;
  origin?: string | null;
  destination?: string | null;
};

/**
 * Where a flight stands:
 * - `scheduled`: has not left;
 * - `departed`: left and has not arrived;
 * - `landed`: arrived at its destination;
 * - `cancelled`: did not operate;
 * - `diverted`: landed somewhere else.
 */
export type FlightState = "scheduled" | "departed" | "landed" | "cancelled" | "diverted";

export type FlightStatus = {
  /** The flight code, upper case and without spaces. */
  flight: string;
  /** The local date of the scheduled departure, as YYYY-MM-DD. */
  date: string;
  /** IATA codes of the airports ("GYN", "CGH"). */
  origin: string;
  destination: string;
  /** ISO instants. */
  scheduledDeparture: string;
  scheduledArrival: string;
  /** Null while it has not happened, and for a cancelled flight. */
  actualDeparture: string | null;
  actualArrival: string | null;
  state: FlightState;
  /**
   * Minutes between the scheduled and the actual arrival at the destination:
   * negative when early, null while the flight has not landed there.
   */
  arrivalDelayMinutes: number | null;
  /**
   * What the times are: at the gate (the airplane leaving and reaching its stand, what a ticket prints)
   * or on the runway (taking off and landing), when the source had no gate times. Absent when a source
   * does not say.
   */
  basis?: "gate" | "runway";
  /** The time zones of the airports (IANA, "America/Sao_Paulo"), when the source names them. */
  originTimeZone?: string | null;
  destinationTimeZone?: string | null;
  /** The airports the flight stopped at under the same number on the way to the destination asked (IATA). */
  stops?: string[];
};

/** What a month of ANAC's official record came to: read, not out yet, or no answer (with why). */
export type VraMonth = VraMonthRead | { kind: "missing" } | { kind: "unavailable"; code: string };

/**
 * ANAC's official monthly record of the flights operated in Brazil (`@flyee/flights/vra`): a month, "YYYY-MM",
 * read for the flights with a number or a codeshare asked, and every leg no schedule foresaw.
 */
export interface FlightRecordSource {
  readMonth(month: string, wanted: VraWanted): Promise<VraMonth>;
}

export interface FlightStatusProvider {
  /** What is known about the flight on that day; null when the provider does not know the flight. */
  getFlightStatus(query: FlightQuery): Promise<FlightStatus | null>;
}

/** One weather observation of an airport (a METAR), as published. */
export type Metar = {
  /** The airport's ICAO code ("SBGO"). */
  icao: string;
  /** When it was observed, as an ISO instant. */
  observedAt: string;
  /** The report, as published. */
  raw: string;
};

export interface WeatherProvider {
  /** The observations of an airport from `from` to `to` (ISO instants, both included), oldest first. */
  getMetar(input: { icao: string; from: string; to: string }): Promise<Metar[]>;
}

/** Minutes from the scheduled to the actual arrival, rounded to the minute: the one way the delay is counted. */
export function arrivalDelayMinutes(scheduledArrival: string, actualArrival: string): number {
  return Math.round((Date.parse(actualArrival) - Date.parse(scheduledArrival)) / 60_000);
}
