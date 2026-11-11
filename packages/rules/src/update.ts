/**
 * The amount a condemnation is worth on a day (`atualizacao-v1`, item 4.6 of the case journey plan), from the value the
 * judgment set. Until 29/08/2024 by the judgment's own terms (an index and a monthly interest the judgment names); from
 * 30/08/2024 on, by Lei 14.905/2024: the monetary correction by the IPCA (Código Civil, art. 389, sole paragraph) and
 * the interest by the Selic less the IPCA (art. 406, §§ 1º and 3º), never below zero in a month. Pure: the monthly
 * rates are given (the Banco Central's series, read by an adapter), and what it cannot know is said, never guessed:
 * a month with no rate is counted at zero and named.
 *
 * Months are counted whole from the month after the start to the month of the end, a usual way of court calculations;
 * a start on the first day of a month counts that month too. Rates are in percent per month.
 */

export const UPDATE_RULE = "atualizacao-v1";

/** The day Lei 14.905/2024 took effect for the correction and the interest. */
export const LAW_14905_FROM = "2024-08-30";

export type MonthlyRates = Record<string, number>;

export type UpdateInput = {
  principalCents: number;
  /** From when the correction runs (the day of the judgment, or of the event the judgment names). */
  correctionFrom: string;
  /** From when the interest runs (the citation, or the event). */
  interestFrom: string;
  /** The day the amount is wanted for. */
  until: string;
  /** Before 30/08/2024: the judgment's index, monthly, and its monthly interest in percent (1 for 1% a.m.). */
  before: { index: MonthlyRates; interestMonthly: number };
  /** From 30/08/2024: the IPCA and the Selic of each month, in percent. */
  ipca: MonthlyRates;
  selic: MonthlyRates;
};

export type UpdateResult = {
  rule: string;
  /** The value corrected, without interest. */
  correctedCents: number;
  interestCents: number;
  totalCents: number;
  /** The months whose rate no series answered: counted at zero. */
  missing: string[];
  /** Each month counted, with what was applied. */
  months: { month: string; correction: number; interest: number; regime: "sentenca" | "lei_14905" }[];
};

const monthOf = (day: string): string => day.slice(0, 7);

function nextMonth(month: string): string {
  const [year, value] = month.split("-").map(Number);
  return value === 12 ? `${year + 1}-01` : `${year}-${String(value + 1).padStart(2, "0")}`;
}

/** The months counted from a start to an end: from the start's month when it starts on its first day, else the next. */
export function monthsBetween(from: string, until: string): string[] {
  const months: string[] = [];
  if (until < from) return months;
  let month = from.slice(8, 10) === "01" ? monthOf(from) : nextMonth(monthOf(from));
  const last = monthOf(until);
  while (month <= last) {
    months.push(month);
    month = nextMonth(month);
  }
  return months;
}

/** Whether a month falls under Lei 14.905/2024: every month from September 2024 on, and August 2024 itself. */
const underLaw = (month: string): boolean => month >= monthOf(LAW_14905_FROM);

/** The amount a condemnation is worth on a day, month by month, with what it could not know named. */
export function updateAmount(input: UpdateInput): UpdateResult {
  const missing: string[] = [];
  const rate = (rates: MonthlyRates, month: string): number => {
    const value = rates[month];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      if (!missing.includes(month)) missing.push(month);
      return 0;
    }
    return value;
  };
  const months: UpdateResult["months"] = [];
  let factor = 1;
  for (const month of monthsBetween(input.correctionFrom, input.until)) {
    const law = underLaw(month);
    const correction = law ? rate(input.ipca, month) : rate(input.before.index, month);
    factor *= 1 + correction / 100;
    months.push({ month, correction, interest: 0, regime: law ? "lei_14905" : "sentenca" });
  }
  const correctedCents = Math.round(input.principalCents * factor);
  // Simple interest, month by month, over the corrected value.
  let interestPercent = 0;
  for (const month of monthsBetween(input.interestFrom, input.until)) {
    const law = underLaw(month);
    const interest = law
      ? Math.max(0, rate(input.selic, month) - rate(input.ipca, month))
      : input.before.interestMonthly;
    interestPercent += interest;
    const line = months.find((item) => item.month === month);
    if (line) line.interest = interest;
    else months.push({ month, correction: 0, interest, regime: law ? "lei_14905" : "sentenca" });
  }
  months.sort((a, b) => a.month.localeCompare(b.month));
  const interestCents = Math.round((correctedCents * interestPercent) / 100);
  return {
    rule: UPDATE_RULE,
    correctedCents,
    interestCents,
    totalCents: correctedCents + interestCents,
    missing: missing.sort(),
    months,
  };
}

/** What a deposit leaves owed of an amount: nothing, or the difference (the complementação to ask). */
export function depositShortfall(dueCents: number, depositedCents: number): { kind: "inteiro" | "a_menor"; shortCents: number } {
  const short = Math.max(0, Math.round(dueCents) - Math.round(depositedCents));
  return { kind: short === 0 ? "inteiro" : "a_menor", shortCents: short };
}

/** The fine of 10 percent of an amount not paid in the term (CPC, art. 523, § 1º; FONAJE, Enunciado 97). */
export function enforcementFine(owedCents: number): number {
  return Math.round(Math.max(0, owedCents) * 0.1);
}
