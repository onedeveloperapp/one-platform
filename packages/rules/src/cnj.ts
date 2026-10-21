/**
 * The unique case number of the Brazilian courts (Resolução CNJ 65/2008,
 * NNNNNNN-DD.AAAA.J.TR.OOOO), read from the compiled text of the resolution on
 * 2026-10-09:
 *
 *   NNNNNNN  the sequence of the case in its unit of origin, restarted each year;
 *   DD       two check digits (Annex VIII, Módulo 97 Base 10, ISO 7064:2003);
 *   AAAA     the year it was filed;
 *   J        the segment of the judiciary (8: the state courts and the DF);
 *   TR       the court within the segment (for J = 8, 01 to 27: TJGO is 09);
 *   OOOO     the unit of origin (the forum).
 *
 * Which court a TR names is data (the `courts` table), never a constant here.
 */

/** The segment of the state courts and of the Federal District. */
export const STATE_COURTS_SEGMENT = "8";

export type CnjNumber = {
  /** The 20 digits, with no mask: what is stored. */
  digits: string;
  sequence: string;
  check: string;
  year: string;
  segment: string;
  court: string;
  origin: string;
};

/** The 18 digits the check is computed over, in the order Annex VIII puts them: NNNNNNN AAAA J TR OOOO. */
const body = (sequence: string, year: string, segment: string, court: string, origin: string): string =>
  `${sequence}${year}${segment}${court}${origin}`;

/**
 * The two check digits of a number, from its other 18 (Annex VIII, III):
 * DD = 98 - (NNNNNNN AAAA J TR OOOO 00 mod 97), written with two digits.
 */
export function cnjCheckDigits(withoutCheck: string): string {
  if (!/^\d{18}$/.test(withoutCheck)) throw new Error("a CNJ number without its check has 18 digits");
  const remainder = BigInt(`${withoutCheck}00`) % 97n;
  return String(98n - remainder).padStart(2, "0");
}

/**
 * The number, read from what a person typed or a court printed: with or
 * without the mask, with spaces. Null when it is not 20 digits or when its
 * check digits do not match (Annex VIII, VI: the whole number with DD at the
 * end, modulo 97, is 1).
 */
export function parseCnj(input: string | null | undefined): CnjNumber | null {
  const digits = String(input ?? "").replace(/\D/g, "");
  if (digits.length !== 20) return null;
  const sequence = digits.slice(0, 7);
  const check = digits.slice(7, 9);
  const year = digits.slice(9, 13);
  const segment = digits.slice(13, 14);
  const court = digits.slice(14, 16);
  const origin = digits.slice(16, 20);
  if (BigInt(`${body(sequence, year, segment, court, origin)}${check}`) % 97n !== 1n) return null;
  return { digits, sequence, check, year, segment, court, origin };
}

export const isValidCnj = (input: string | null | undefined): boolean => parseCnj(input) !== null;

/** The number as courts print it: `NNNNNNN-DD.AAAA.J.TR.OOOO`. Null for one that is not valid. */
export function formatCnj(input: string | null | undefined): string | null {
  const number = parseCnj(input);
  if (!number) return null;
  return `${number.sequence}-${number.check}.${number.year}.${number.segment}.${number.court}.${number.origin}`;
}

/**
 * A whole number from its parts, with its check digits: for tests and for the
 * fixtures of the platform, which must never carry a real case's number.
 */
export function composeCnj(parts: {
  sequence: number | string;
  year: number | string;
  segment?: string;
  court: string;
  origin: number | string;
}): string {
  const sequence = String(parts.sequence).padStart(7, "0");
  const year = String(parts.year).padStart(4, "0");
  const segment = parts.segment ?? STATE_COURTS_SEGMENT;
  const court = parts.court.padStart(2, "0");
  const origin = String(parts.origin).padStart(4, "0");
  const withoutCheck = body(sequence, year, segment, court, origin);
  if (!/^\d{18}$/.test(withoutCheck)) throw new Error("the parts of a CNJ number make 18 digits");
  const check = cnjCheckDigits(withoutCheck);
  return `${sequence}${check}${year}${segment}${court}${origin}`;
}
