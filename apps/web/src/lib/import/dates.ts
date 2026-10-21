/**
 * A day as a spreadsheet writes it, as "YYYY-MM-DD". Brazilian exports write
 * the day first ("03/08/2026"); a column where a second number is above
 * twelve and no first one is was written month first, and is read so. An
 * hour after the day is left out. Pure.
 */

export type DateOrder = "day-first" | "month-first";

const NUMERIC = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})(?:[ T].*)?$/;

/**
 * The order a column of days was written in: day first, unless its values say otherwise (one with the
 * second number above twelve, none with the first above twelve).
 */
export function resolveDateOrder(values: readonly string[]): DateOrder {
  let firstAbove = false;
  let secondAbove = false;
  for (const value of values) {
    const match = NUMERIC.exec(value.trim());
    if (!match || match[1].length === 4) continue;
    if (Number(match[1]) > 12) firstAbove = true;
    if (Number(match[2]) > 12) secondAbove = true;
  }
  return secondAbove && !firstAbove ? "month-first" : "day-first";
}

/** A day that exists, as "YYYY-MM-DD", or null. */
function dayOf(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** A cell as a day: "03/08/2026", "3-8-26", "2026-08-03" (with or without an hour after it). Null when it is none. */
export function parseDateValue(value: string, order: DateOrder = "day-first"): string | null {
  const match = NUMERIC.exec(value.trim());
  if (!match) return null;
  const [, a, b, c] = match;
  if (a.length === 4) return dayOf(Number(a), Number(b), Number(c));
  // A year of two digits is of this century up to a few years ahead, of the last one otherwise.
  const year =
    c.length === 4 ? Number(c) : c.length === 2 ? (Number(c) <= 40 ? 2000 + Number(c) : 1900 + Number(c)) : NaN;
  if (Number.isNaN(year)) return null;
  return order === "day-first" ? dayOf(year, Number(b), Number(a)) : dayOf(year, Number(a), Number(b));
}
