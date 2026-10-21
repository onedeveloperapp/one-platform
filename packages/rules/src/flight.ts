/**
 * Flights as tickets and boarding passes print them.
 *
 * An airline is named by its two-character IATA designator (letters and
 * digits, never two digits: `G3`, `AD`, `2Z`) and a flight by the designator
 * and up to four digits, with an optional letter (`G3 1234`, `AD4512`). An
 * airport is named by its three-letter IATA code (`GYN`, `GRU`). Whether a
 * code exists is data (the `airports` and `airlines` tables), never a list in
 * code: this only reads the shape.
 */

/** A two-character airline designator: letters and digits, never two digits. */
export const isAirlineDesignator = (value: string | null | undefined): boolean =>
  /^[A-Z0-9]{2}$/.test(String(value ?? "")) && !/^\d{2}$/.test(String(value));

export const isAirportCode = (value: string | null | undefined): boolean => /^[A-Z]{3}$/.test(String(value ?? ""));

/** An airport code as a person types it: trimmed and in capitals, or null when it is not three letters. */
export function normalizeAirportCode(input: string | null | undefined): string | null {
  const code = String(input ?? "")
    .trim()
    .toUpperCase();
  return isAirportCode(code) ? code : null;
}

export type FlightNumber = {
  airline: string;
  /** The digits, without the zeros a ticket may put before them. */
  number: string;
  suffix: string | null;
  /** What is stored and shown: `G31234`, `AD4512A`. */
  normalized: string;
};

/**
 * A flight number from what a person typed: `g3 1234`, `G3-01234`, `AD 4512a`.
 * Null when it is not a designator followed by one to four digits.
 */
export function parseFlightNumber(input: string | null | undefined): FlightNumber | null {
  const compact = String(input ?? "")
    .toUpperCase()
    .replace(/[\s-]/g, "");
  const match = /^([A-Z0-9]{2})(\d{1,5})([A-Z]?)$/.exec(compact);
  if (!match || !isAirlineDesignator(match[1])) return null;
  const number = String(Number(match[2]));
  if (number === "0" || number.length > 4) return null;
  const suffix = match[3] || null;
  return { airline: match[1], number, suffix, normalized: `${match[1]}${number}${suffix ?? ""}` };
}

/** A flight number as it is shown: `G3 1234`. */
export function formatFlightNumber(input: string | null | undefined): string | null {
  const flight = parseFlightNumber(input);
  return flight ? `${flight.airline} ${flight.number}${flight.suffix ?? ""}` : null;
}

/** A booking reference (the "localizador"): five to eight letters and digits, as printed. */
export function normalizeBookingReference(input: string | null | undefined): string | null {
  const code = String(input ?? "")
    .toUpperCase()
    .replace(/\s/g, "");
  return /^[A-Z0-9]{5,8}$/.test(code) ? code : null;
}

/**
 * How late a flight arrived, in minutes, from the times printed for the same
 * airport: the scheduled and the actual arrival, both in local time as the
 * ticket and the airport show them (so no time zone is needed). Null when
 * either is missing; negative when it arrived early.
 */
export function arrivalDelayMinutes(
  scheduledLocal: string | null | undefined,
  actualLocal: string | null | undefined,
): number | null {
  // A local moment written as `YYYY-MM-DDTHH:MM` (seconds and a space instead of the T are accepted).
  const read = (value: string | null | undefined): number => {
    const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(value ?? ""));
    return match ? Date.parse(`${match[1]}T${match[2]}:00Z`) : Number.NaN;
  };
  const scheduled = read(scheduledLocal);
  const actual = read(actualLocal);
  if (!Number.isFinite(scheduled) || !Number.isFinite(actual)) return null;
  return Math.round((actual - scheduled) / 60_000);
}
