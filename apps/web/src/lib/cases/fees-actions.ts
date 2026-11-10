"use server";

import { revalidatePath } from "next/cache";

import { getMemberContext } from "@/lib/member/context";

/**
 * The writes of the fees and the costs of a case (migration 0131), each through its database function, which checks
 * who may and keeps it on the record.
 */

export type FeesResult = { ok: true; bills?: number } | { ok: false; code: string; field?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

async function call(name: string, args: Record<string, unknown>, path: string | null): Promise<FeesResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc(name, args);
  if (error) return { ok: false, code: error.code === "42501" ? "not_allowed" : "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; field?: string; bills?: number };
  if (answer.ok !== true) {
    return { ok: false, code: typeof answer.code === "string" ? answer.code : "failed", field: answer.field };
  }
  if (path) revalidatePath(path);
  return { ok: true, bills: typeof answer.bills === "number" ? answer.bills : undefined };
}

type FeeValues = {
  entryCents: number;
  installments: number;
  installmentCents: number;
  successPercent: string;
  successMinCents: number;
  settlementPercent: string;
};

const valuesOf = (values: FeeValues) => ({
  entry_cents: String(Math.max(Math.trunc(values.entryCents) || 0, 0)),
  installments: String(Math.max(Math.trunc(values.installments) || 0, 0)),
  installment_cents: String(Math.max(Math.trunc(values.installmentCents) || 0, 0)),
  success_percent: String(values.successPercent ?? "0").replace(",", ".") || "0",
  success_min_cents: String(Math.max(Math.trunc(values.successMinCents) || 0, 0)),
  settlement_percent: String(values.settlementPercent ?? "").replace(",", "."),
});

/** Who decides for the firm confirms how it charges a module and a kind of problem, with the second factor. */
export async function saveFeeTerms(
  scope: { module: string | null; incident: string | null },
  values: FeeValues,
): Promise<FeesResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  return call(
    "save_fee_terms",
    {
      target_org: context.firm.id,
      fields: { module: scope.module ?? "", incident: scope.incident ?? "", ...valuesOf(values) },
    },
    "/financeiro/configuracao",
  );
}

/** A partner, a lawyer or the controladoria sets the fees of a case, by hand or from the firm's terms. */
export async function saveCaseFees(caseId: string, values: FeeValues | "terms"): Promise<FeesResult> {
  if (!isId(caseId)) return { ok: false, code: "not_found" };
  return call(
    "save_case_fees",
    { target_case: caseId, fields: values === "terms" ? { from_terms: "true" } : valuesOf(values) },
    `/casos/${caseId}`,
  );
}

/** Anybody of the firm who works on the case writes a cost of it. */
export async function saveCaseCost(
  caseId: string,
  fields: {
    description: string;
    cents: number;
    spentOn: string;
    paidBy: "firm" | "client";
    owedBy: "client" | "re" | null;
  },
): Promise<FeesResult> {
  if (!isId(caseId)) return { ok: false, code: "not_found" };
  return call(
    "save_case_cost",
    {
      target_case: caseId,
      fields: {
        description: String(fields.description ?? "").slice(0, 200),
        cents: String(Math.trunc(fields.cents) || 0),
        spent_on: fields.spentOn,
        paid_by: fields.paidBy,
        owed_by: fields.owedBy ?? "",
      },
    },
    `/casos/${caseId}`,
  );
}

/** Who operates the books absorbs a cost the client owed, with the reason. */
export async function absorbCaseCost(caseId: string, costId: string, reason: string): Promise<FeesResult> {
  if (!isId(costId)) return { ok: false, code: "not_found" };
  return call(
    "absorb_case_cost",
    { target_cost: costId, target_reason: String(reason ?? "").slice(0, 300) },
    `/casos/${caseId}`,
  );
}
