/**
 * The monthly rates a condemnation is updated by (item 4.6 of the case journey plan, `atualizacao-v1` of
 * `@flyee/rules/update`): the IPCA, by which it is corrected since Lei 14.905/2024, and the Selic, of which the IPCA is
 * taken out for the interest. ONE reads them from the Banco Central's public series; a month a series did not answer
 * is said so, never guessed.
 */

export type IndexSeries = "ipca" | "selic";

/** A month as YYYY-MM. */
export type Month = string;

/**
 * What came of a reading:
 * - `read`: the rate of each month the series answered, in percent per month (a month it did not answer is left out);
 * - `unavailable`: the series could not be asked now. `detail` is a code, never the source's text.
 */
export type IndexAnswer = { kind: "read"; rates: Record<Month, number> } | { kind: "unavailable"; detail: string };

export interface IndexSource {
  /** The monthly rates of a series from a month to another, both included. */
  monthly(series: IndexSeries, from: Month, to: Month): Promise<IndexAnswer>;
}

/** A month that is no month. */
export class InvalidMonthError extends Error {
  constructor() {
    super("invalid_month");
  }
}

/** Reads a month as YYYY-MM, or refuses it. */
export function normalizeMonth(value: string): Month {
  const month = String(value ?? "").trim().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new InvalidMonthError();
  return month;
}
