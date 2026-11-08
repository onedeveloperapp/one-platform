/**
 * How old a case of the stock is at its step, and whether it stagnated (`estoque-v1`, phase 1 of the plan of the
 * controladoria). Pure: the days and the limits come in.
 *
 * - The days at a step are counted in the days of Brasília, from the day the case reached the step to today: a case
 *   that reached it today has 0 days, one that reached it yesterday 1.
 * - A case stagnated when it is at a step for more days than the limit of that step (the setting `stagnant_days` of
 *   `controladoria`). A step with no limit never stagnates; a case whose step has no day it was reached is no age.
 *
 * The database writes the same rule in `firm_cases` (migration 0111); a test of the app compares the two on the same
 * cases, and fails when one side changes alone.
 */

export const STOCK_RULE_VERSION = "estoque-v1";

/** The steps of a case's way that a case in progress may be at (lib/cases/journey.ts, `OPEN_STEPS`). */
export const STOCK_STEPS = [
  "intake",
  "documents",
  "signature",
  "drafting",
  "filing",
  "hearing",
  "judgment",
  "payment",
] as const;
export type StockStep = (typeof STOCK_STEPS)[number];

/** The limits the platform proposes: the setting's, while nobody has changed it. Data, and a first proposal. */
export const STAGNANT_DAYS: Record<StockStep, number> = {
  intake: 7,
  documents: 15,
  signature: 15,
  drafting: 15,
  filing: 15,
  hearing: 120,
  judgment: 120,
  payment: 90,
};

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A day of the calendar as a count of days, or null when it is not one. */
function dayNumber(day: string): number | null {
  const match = DAY.exec(day);
  if (!match) return null;
  const at = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const back = new Date(at);
  if (back.getUTCMonth() !== Number(match[2]) - 1 || back.getUTCDate() !== Number(match[3])) return null;
  return at / 86_400_000;
}

const BRASILIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The day of Brasília a moment falls on ("YYYY-MM-DD"), or null when it is not a moment. */
export function brasiliaDay(moment: string | null | undefined): string | null {
  if (!moment) return null;
  const at = Date.parse(moment);
  return Number.isFinite(at) ? BRASILIA.format(at) : null;
}

/** The days a case is at its step on `today` (a day of Brasília); null when it has no day it reached the step. */
export function stepDays(since: string | null | undefined, today: string): number | null {
  const reached = brasiliaDay(since);
  const from = reached ? dayNumber(reached) : null;
  const to = dayNumber(today);
  if (from === null || to === null) return null;
  return Math.max(to - from, 0);
}

/** Whether a case at `step` for `days` stagnated under `limits` (the setting's, else the platform's proposal). */
export function isStagnant(
  step: string | null | undefined,
  days: number | null | undefined,
  limits: Partial<Record<string, number>> = STAGNANT_DAYS,
): boolean {
  if (!step || days === null || days === undefined) return false;
  const limit = limits[step];
  return typeof limit === "number" && Number.isFinite(limit) && days > limit;
}
