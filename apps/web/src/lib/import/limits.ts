/**
 * What the import of a portfolio reads and asks at once, on the app's side.
 * How many lines a batch holds and a call takes, and the oldest day of
 * distribution a line may carry, are the database's (the setting `import`,
 * read through `import_limits`), never a number here.
 */

/** The largest file read in the browser: a portfolio of thousands of lawsuits is a few megabytes. */
export const MOST_FILE_BYTES = 30 * 1024 * 1024;

/** How many lawsuit numbers one call asks about (which of them the firm already has): `known_lawsuits` takes a thousand. */
export const NUMBERS_PER_CALL = 1000;

/** How many lines a result lists of the ones that did not go as they were; the rest are counted. */
export const NOTED_SHOWN = 200;

export type ImportLimits = { maxRows: number; rowsPerCall: number; oldestFiledOn: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The limits as `import_limits` answers them; what cannot be read is the setting's own default. */
export function importLimitsOf(raw: unknown): ImportLimits {
  const value = (raw ?? {}) as Record<string, unknown>;
  const whole = (key: string, fallback: number) => {
    const number = value[key];
    return typeof number === "number" && Number.isInteger(number) && number > 0 ? number : fallback;
  };
  const oldest = value.oldest_filed_on;
  return {
    maxRows: whole("max_rows", 20_000),
    rowsPerCall: whole("rows_per_call", 200),
    oldestFiledOn: typeof oldest === "string" && DAY.test(oldest) ? oldest : "1990-01-01",
  };
}

/** A list in pieces of at most `size`. */
export function inPieces<T>(items: readonly T[], size: number): T[][] {
  const pieces: T[][] = [];
  const step = Math.max(1, Math.floor(size));
  for (let start = 0; start < items.length; start += step) pieces.push(items.slice(start, start + step));
  return pieces;
}
