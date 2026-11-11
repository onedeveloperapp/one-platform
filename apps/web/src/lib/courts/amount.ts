import { depositShortfall, enforcementFine, LAW_14905_FROM, UPDATE_RULE, updateAmount } from "@flyee/rules/update";

/**
 * What a condemnation is worth and what to ask for it (migration 0184, item 4.6 of the case journey plan). Pure: the
 * facts of the lawsuit, the monthly rates and the day are given; the next step follows from what was deposited and
 * from the 15 days the airline has to pay after the judgment became final (CPC, art. 523).
 */

export type AmountFacts = {
  principalCents: number;
  judgmentOn: string;
  interestFrom: string;
  finalOn: string;
  depositedCents: number;
  lastDepositOn: string | null;
};

export type AmountStep = "aguardar" | "levantamento" | "complementacao" | "cumprimento";

/** The days the airline has to pay once the judgment became final, counted as calendar days here (CPC, art. 523). */
export const PAYMENT_DAYS = 15;

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function amountDue(
  facts: AmountFacts,
  rates: { ipca: Record<string, number>; selic: Record<string, number> },
  today: string,
) {
  const result = updateAmount({
    principalCents: facts.principalCents,
    correctionFrom: facts.judgmentOn,
    interestFrom: facts.interestFrom,
    until: today,
    // The judgment's own terms before 30/08/2024 are not read: their months count at zero, and it is said.
    before: { index: {}, interestMonthly: 0 },
    ipca: rates.ipca,
    selic: rates.selic,
  });
  const needsTerms = facts.judgmentOn < LAW_14905_FROM || facts.interestFrom < LAW_14905_FROM;
  const shortfall = depositShortfall(result.totalCents, facts.depositedCents);
  const termOver = today > addDays(facts.finalOn, PAYMENT_DAYS);
  const step: AmountStep =
    facts.depositedCents > 0
      ? shortfall.kind === "inteiro"
        ? "levantamento"
        : "complementacao"
      : termOver
        ? "cumprimento"
        : "aguardar";
  return {
    rule: UPDATE_RULE,
    correctedCents: result.correctedCents,
    interestCents: result.interestCents,
    totalCents: result.totalCents,
    missing: needsTerms ? result.missing.filter((month) => month >= LAW_14905_FROM.slice(0, 7)) : result.missing,
    needsTerms,
    step,
    shortCents: step === "complementacao" ? shortfall.shortCents : 0,
    fineCents: step === "cumprimento" ? enforcementFine(result.totalCents) : 0,
  };
}

/** The months a computation needs rates of: from the earlier start to the day, as YYYY-MM. */
export function monthsNeeded(facts: AmountFacts, today: string): { from: string; to: string } {
  const start = [facts.judgmentOn, facts.interestFrom, LAW_14905_FROM].sort()[0] ?? facts.judgmentOn;
  const from = start < LAW_14905_FROM ? LAW_14905_FROM : start;
  return { from: from.slice(0, 7), to: today.slice(0, 7) };
}

/** The words of each next step on the case. */
export const AMOUNT_STEP_KEY: Record<AmountStep, string> = {
  aguardar: "amount-step-wait",
  levantamento: "amount-step-release",
  complementacao: "amount-step-complement",
  cumprimento: "amount-step-enforce",
};

/** What the case screen reads of a lawsuit's amount. */
export type LawsuitAmount = {
  proceedingId: string;
  asOf: string;
  correctedCents: number;
  interestCents: number;
  totalCents: number;
  missing: string[];
  needsTerms: boolean;
  depositedCents: number;
  step: AmountStep;
  shortCents: number;
  fineCents: number;
};

const STEPS: readonly AmountStep[] = ["aguardar", "levantamento", "complementacao", "cumprimento"];

export function lawsuitAmountsOf(raw: unknown): LawsuitAmount[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): LawsuitAmount[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    const step = STEPS.find((value) => value === row.next_step);
    if (typeof row.proceeding_id !== "string" || !step) return [];
    const cents = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
    return [
      {
        proceedingId: row.proceeding_id,
        asOf: String(row.as_of ?? "").slice(0, 10),
        correctedCents: cents(row.corrected_cents),
        interestCents: cents(row.interest_cents),
        totalCents: cents(row.total_cents),
        missing: Array.isArray(row.missing)
          ? row.missing.filter((month): month is string => typeof month === "string")
          : [],
        needsTerms: row.needs_terms === true,
        depositedCents: cents(row.deposited_cents),
        step,
        shortCents: cents(row.short_cents),
        fineCents: cents(row.fine_cents),
      },
    ];
  });
}
