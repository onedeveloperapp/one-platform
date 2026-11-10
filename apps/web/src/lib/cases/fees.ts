/**
 * The fees and the costs of a case (phase 7 of the plan of the controladoria and the finance, migration 0131), as the
 * screens read them: the firm's terms (how it charges a module and a kind of problem), a case's fees, and its costs.
 * Pure.
 */
import { formatCents } from "@flyee/rules/finance";

export type FeeTerms = {
  id: string;
  module: string | null;
  incident: string | null;
  entryCents: number;
  installments: number;
  installmentCents: number;
  successPercent: number;
  successMinCents: number;
  settlementPercent: number | null;
  /** The monthly fee and for how many months (0159). */
  monthlyCents: number;
  monthlyMonths: number;
  /** A fee per hearing held and per appeal the firm files for the client (0159). */
  hearingCents: number;
  appealCents: number;
  /** The fine and the monthly interest of the contract on a fee paid late (0159). */
  lateFinePercent: number;
  lateInterestPercent: number;
  confirmedAt: string;
};

export type CaseFees = Omit<FeeTerms, "id" | "module" | "incident" | "confirmedAt"> & {
  source: "terms" | "person";
  billed: boolean;
};

export type CaseCost = {
  id: string;
  description: string;
  cents: number;
  spentOn: string;
  paidBy: "firm" | "client";
  owedBy: "client" | "re" | null;
  absorbed: boolean;
  billId: string | null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const whole = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const valuesOf = (row: Record<string, unknown>) => ({
  entryCents: Math.trunc(whole(row.entry_cents)),
  installments: Math.trunc(whole(row.installments)),
  installmentCents: Math.trunc(whole(row.installment_cents)),
  successPercent: whole(row.success_percent),
  successMinCents: Math.trunc(whole(row.success_min_cents)),
  settlementPercent:
    row.settlement_percent === null || row.settlement_percent === undefined ? null : whole(row.settlement_percent),
  monthlyCents: Math.trunc(whole(row.monthly_cents)),
  monthlyMonths: Math.trunc(whole(row.monthly_months)),
  hearingCents: Math.trunc(whole(row.hearing_cents)),
  appealCents: Math.trunc(whole(row.appeal_cents)),
  lateFinePercent: whole(row.late_fine_percent),
  lateInterestPercent: whole(row.late_interest_percent),
});

export function feeTermsOf(raw: unknown): FeeTerms[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): FeeTerms[] => {
    const row = record(item);
    const id = text(row.id);
    return id
      ? [
          {
            id,
            module: text(row.module),
            incident: text(row.incident),
            ...valuesOf(row),
            confirmedAt: String(row.confirmed_at ?? ""),
          },
        ]
      : [];
  });
}

export function caseFeesOf(raw: unknown): CaseFees | null {
  const row = Array.isArray(raw) ? record(raw[0]) : record(raw);
  if (!row.case_id) return null;
  return {
    ...valuesOf(row),
    source: row.source === "person" ? "person" : "terms",
    billed: row.bills_at !== null && row.bills_at !== undefined,
  };
}

export function caseCostsOf(raw: unknown): CaseCost[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): CaseCost[] => {
    const row = record(item);
    const id = text(row.id);
    const description = text(row.description);
    if (!id || !description) return [];
    return [
      {
        id,
        description,
        cents: Math.trunc(whole(row.cents)),
        spentOn: String(row.spent_on ?? ""),
        paidBy: row.paid_by === "client" ? "client" : "firm",
        owedBy: row.owed_by === "client" || row.owed_by === "re" ? row.owed_by : null,
        absorbed: row.absorbed_at !== null && row.absorbed_at !== undefined,
        billId: text(row.bill_id),
      },
    ];
  });
}

/** A percentage as a person reads it: "30%", "12,5%". */
export const percentText = (value: number): string => `${String(value).replace(".", ",")}%`;

/** The terms or a case's fees in one line: "Entrada de R$ 500,00 · 3 parcelas de R$ 200,00 · 30% de êxito". */
export function feesLine(
  fees: Pick<
    FeeTerms,
    "entryCents" | "installments" | "installmentCents" | "successPercent" | "successMinCents" | "settlementPercent"
  > &
    Partial<
      Pick<
        FeeTerms,
        "monthlyCents" | "monthlyMonths" | "hearingCents" | "appealCents" | "lateFinePercent" | "lateInterestPercent"
      >
    >,
  say: (key: string, values?: Record<string, string | number>) => string,
): string {
  const parts: string[] = [];
  if (fees.entryCents > 0) parts.push(say("fees-line-entry", { value: formatCents(fees.entryCents) }));
  if (fees.installments > 0) {
    parts.push(say("fees-line-installments", { count: fees.installments, value: formatCents(fees.installmentCents) }));
  }
  if ((fees.monthlyMonths ?? 0) > 0) {
    parts.push(
      say("fees-line-monthly", { count: fees.monthlyMonths ?? 0, value: formatCents(fees.monthlyCents ?? 0) }),
    );
  }
  if ((fees.hearingCents ?? 0) > 0)
    parts.push(say("fees-line-hearing", { value: formatCents(fees.hearingCents ?? 0) }));
  if ((fees.appealCents ?? 0) > 0) parts.push(say("fees-line-appeal", { value: formatCents(fees.appealCents ?? 0) }));
  if (fees.successPercent > 0) {
    parts.push(say("fees-line-success", { percent: percentText(fees.successPercent) }));
    if (fees.successMinCents > 0) parts.push(say("fees-line-minimum", { value: formatCents(fees.successMinCents) }));
    if (fees.settlementPercent !== null) {
      parts.push(say("fees-line-settlement", { percent: percentText(fees.settlementPercent) }));
    }
  }
  if ((fees.lateFinePercent ?? 0) > 0 || (fees.lateInterestPercent ?? 0) > 0) {
    parts.push(
      say("fees-line-late", {
        fine: percentText(fees.lateFinePercent ?? 0),
        interest: percentText(fees.lateInterestPercent ?? 0),
      }),
    );
  }
  return parts.length > 0 ? parts.join(" · ") : say("fees-line-none");
}

/** A split of a case's fees with another lawyer or law firm (0159). */
export type FeeSplit = {
  id: string;
  name: string;
  document: string;
  barRegistration: string;
  percent: number;
  ended: boolean;
  endedReason: string | null;
};

export function feeSplitsOf(raw: unknown): FeeSplit[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): FeeSplit[] => {
    const row = record(item);
    const id = text(row.id);
    const name = text(row.name);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        document: String(row.document ?? ""),
        barRegistration: String(row.bar_registration ?? ""),
        percent: whole(row.percent),
        ended: row.ended_at !== null && row.ended_at !== undefined,
        endedReason: text(row.ended_reason),
      },
    ];
  });
}

/**
 * What a fee paid late asks with the contract's fine and monthly interest, on a day: the fine once, the interest pro
 * rata by the days late (30 days a month), on what is still owed. The books say it; ONE charges nobody.
 */
export function lateCharge(
  restCents: number,
  dueOn: string,
  today: string,
  finePercent: number,
  interestPercent: number,
): { days: number; fineCents: number; interestCents: number; totalCents: number } {
  const days = Math.max(
    0,
    Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueOn}T00:00:00Z`)) / 86_400_000),
  );
  if (days === 0 || restCents <= 0) return { days, fineCents: 0, interestCents: 0, totalCents: Math.max(restCents, 0) };
  const fineCents = Math.round((restCents * finePercent) / 100);
  const interestCents = Math.round((restCents * interestPercent * days) / 100 / 30);
  return { days, fineCents, interestCents, totalCents: restCents + fineCents + interestCents };
}

/** The total of the costs the firm paid and nobody absorbed, and of those the client owes back. */
export function costTotals(costs: readonly CaseCost[]): { paid: number; owed: number } {
  return costs.reduce(
    (sum, cost) => ({
      paid: sum.paid + (cost.paidBy === "firm" ? cost.cents : 0),
      owed: sum.owed + (cost.owedBy === "client" && !cost.absorbed ? cost.cents : 0),
    }),
    { paid: 0, owed: 0 },
  );
}
