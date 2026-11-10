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
  >,
  say: (key: string, values?: Record<string, string | number>) => string,
): string {
  const parts: string[] = [];
  if (fees.entryCents > 0) parts.push(say("fees-line-entry", { value: formatCents(fees.entryCents) }));
  if (fees.installments > 0) {
    parts.push(say("fees-line-installments", { count: fees.installments, value: formatCents(fees.installmentCents) }));
  }
  if (fees.successPercent > 0) {
    parts.push(say("fees-line-success", { percent: percentText(fees.successPercent) }));
    if (fees.successMinCents > 0) parts.push(say("fees-line-minimum", { value: formatCents(fees.successMinCents) }));
    if (fees.settlementPercent !== null) {
      parts.push(say("fees-line-settlement", { percent: percentText(fees.settlementPercent) }));
    }
  }
  return parts.length > 0 ? parts.join(" · ") : say("fees-line-none");
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
