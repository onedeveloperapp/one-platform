import { computeDeadline, type CourtCalendar, type DeadlinePlace } from "@flyee/rules/deadlines";
import { depositShortfall, enforcementFine, LAW_14905_FROM, UPDATE_RULE, updateAmount } from "@flyee/rules/update";

/**
 * What a condemnation is worth and what to ask for it (migrations 0184 and 0214, item 4.6 of the case journey plan).
 * Pure: the facts of the lawsuit, the monthly rates and the day are given; the next step follows from what was
 * deposited and from the term to pay, which the kind of lawsuit sets:
 *
 * - in the small-claims court the loser is told, when intimated of the judgment, to pay once it becomes final, and the
 *   execution follows on request (Lei 9.099/1995, art. 52, III and IV): ONE waits the 15 business days from the final
 *   judgment (art. 12-A), counted over the court's calendar, and past them the cumprimento comes with the fine of 10
 *   percent and no fees of 10 percent (CPC, art. 523, § 1º; FONAJE, Enunciado 97);
 * - in the civil court the cumprimento starts at the creditor's request, and the debtor is intimated to pay in 15
 *   business days (CPC, arts. 513, § 2º, I, and 523): with nothing deposited the next step is the request, and the fine
 *   and the fees of 10 percent each come only if the airline does not pay in the term of that intimation.
 */

export type LawsuitKind = "juizado" | "comum";

export type AmountFacts = {
  principalCents: number;
  judgmentOn: string;
  interestFrom: string;
  finalOn: string;
  depositedCents: number;
  lastDepositOn: string | null;
  kind: LawsuitKind;
  /** In the small-claims court, the last day of the airline's term to pay (`paymentTermEnds`); null otherwise. */
  payUntil: string | null;
};

export type AmountStep = "aguardar" | "levantamento" | "complementacao" | "cumprimento";

/** The business days the airline has to pay (Lei 9.099/1995, arts. 12-A and 52, III; CPC, art. 523). */
export const PAYMENT_DAYS = 15;

/** Three weeks: what 15 business days come to, read only when the court's calendar could not count them. */
const PAYMENT_FALLBACK_DAYS = 21;

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The last day of the airline's term to pay in the small-claims court: 15 business days from the day the judgment
 * became final, over the court's calendar, by the rule of the deadlines. Null when the day cannot be counted.
 */
export function paymentTermEnds(finalOn: string, place: DeadlinePlace, calendar: CourtCalendar): string | null {
  const outcome = computeDeadline({
    trigger: "day",
    on: finalOn,
    days: PAYMENT_DAYS,
    counting: "business",
    place,
    calendar,
  });
  return outcome.ok ? outcome.result.dueOn : null;
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
  const juizado = facts.kind === "juizado";
  // The small-claims court waits the airline's term; in the civil court the request comes first.
  const payUntil = juizado ? (facts.payUntil ?? addDays(facts.finalOn, PAYMENT_FALLBACK_DAYS)) : null;
  const termOver = payUntil === null || today > payUntil;
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
    // The fine is already due in the small-claims court; in the civil court only after the intimation's term.
    fineCents: step === "cumprimento" && juizado ? enforcementFine(result.totalCents) : 0,
    payUntil,
  };
}

/** The months a computation needs rates of: from the earlier start to the day, as YYYY-MM. */
export function monthsNeeded(facts: AmountFacts, today: string): { from: string; to: string } {
  const start = [facts.judgmentOn, facts.interestFrom, LAW_14905_FROM].sort()[0] ?? facts.judgmentOn;
  const from = start < LAW_14905_FROM ? LAW_14905_FROM : start;
  return { from: from.slice(0, 7), to: today.slice(0, 7) };
}

/**
 * The words of the next step on the case: the cumprimento of the small-claims court comes with its fine, the civil
 * court's is the request that opens the airline's term.
 */
export function amountStepKey(step: AmountStep, kind: LawsuitKind | null): string {
  switch (step) {
    case "aguardar":
      return "amount-step-wait";
    case "levantamento":
      return "amount-step-release";
    case "complementacao":
      return "amount-step-complement";
    case "cumprimento":
      return kind === "comum" ? "amount-step-request" : "amount-step-enforce";
  }
}

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
  kind: LawsuitKind | null;
  payUntil: string | null;
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
        kind: row.lawsuit_kind === "juizado" || row.lawsuit_kind === "comum" ? row.lawsuit_kind : null,
        payUntil: typeof row.pay_until === "string" ? row.pay_until.slice(0, 10) : null,
      },
    ];
  });
}
