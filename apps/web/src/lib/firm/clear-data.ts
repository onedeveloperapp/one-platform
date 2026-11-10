/**
 * Clearing the firm's cases and clients (migration 0161): what a clearing would take, read for the confirmation the
 * person reads before typing the word, and what came of it. Pure: the screen and the server action read it.
 */

/** What the confirmation counts, in the order the screen lists it. */
export const CLEAR_COUNT_KEYS = [
  "cases",
  "people",
  "conversations",
  "publications",
  "deadlines",
  "hearings",
  "imports",
  "agency_passengers",
] as const;

export type ClearCountKey = (typeof CLEAR_COUNT_KEYS)[number];
export type ClearCounts = Record<ClearCountKey, number>;

/** Why the database refused, or that the call itself failed. The second factor is asked in place instead. */
export type ClearRefusal = "not_allowed" | "support_visit" | "second_factor" | "confirm_missing" | "failed";

export type ClearPreview = { ok: true; counts: ClearCounts; secondFactor: boolean } | { ok: false; code: ClearRefusal };

export type ClearResult = { ok: true; counts: ClearCounts; files: number } | { ok: false; code: ClearRefusal };

/** The word the person types to confirm, as the database compares it. */
export const CLEAR_WORD = "apagar";

/** Whether what was typed is the word: case and the spaces around it do not count. */
export function isClearWord(typed: string): boolean {
  return typed.trim().toLowerCase() === CLEAR_WORD;
}

const REFUSALS: readonly ClearRefusal[] = ["not_allowed", "support_visit", "second_factor", "confirm_missing"];

function refusalOf(code: unknown): ClearRefusal {
  return REFUSALS.includes(code as ClearRefusal) ? (code as ClearRefusal) : "failed";
}

function countsOf(raw: unknown): ClearCounts | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const counts = {} as ClearCounts;
  for (const key of CLEAR_COUNT_KEYS) {
    const value = Number(source[key]);
    if (!Number.isInteger(value) || value < 0) return null;
    counts[key] = value;
  }
  return counts;
}

/** The database's answer to `firm_clear_preview`. */
export function clearPreviewOf(raw: unknown): ClearPreview {
  const answer = (raw ?? {}) as { ok?: unknown; code?: unknown; counts?: unknown; second_factor?: unknown };
  if (answer.ok !== true) return { ok: false, code: refusalOf(answer.code) };
  const counts = countsOf(answer.counts);
  if (!counts) return { ok: false, code: "failed" };
  return { ok: true, counts, secondFactor: answer.second_factor === true };
}

/** The database's answer to `clear_firm_data`, with the storage paths it named apart for the bytes to go. */
export function clearResultOf(raw: unknown): { result: ClearResult; paths: string[] } {
  const answer = (raw ?? {}) as { ok?: unknown; code?: unknown; counts?: unknown; paths?: unknown };
  if (answer.ok !== true) return { result: { ok: false, code: refusalOf(answer.code) }, paths: [] };
  const counts = countsOf(answer.counts);
  if (!counts) return { result: { ok: false, code: "failed" }, paths: [] };
  const paths = Array.isArray(answer.paths)
    ? answer.paths.filter((path): path is string => typeof path === "string" && path.startsWith("org/"))
    : [];
  const files = Number((answer.counts as Record<string, unknown>).files);
  return { result: { ok: true, counts, files: Number.isInteger(files) && files >= 0 ? files : paths.length }, paths };
}

/** Whether anything would go at all: with nothing, the screen says so and offers no button. */
export function clearsAnything(counts: ClearCounts): boolean {
  return CLEAR_COUNT_KEYS.some((key) => counts[key] > 0);
}
