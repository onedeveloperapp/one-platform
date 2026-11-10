"use server";

import { revalidatePath } from "next/cache";

import { runFirmTask } from "@/lib/ai/executor";
import { contractBriefing, FEE_TERMS_TASK, type FeeTermsRead, readFeeTermsOutput } from "@/lib/cases/fee-terms-reading";
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
  /** The forms of 0159, absent from an older form (taken as none). */
  monthlyCents?: number;
  monthlyMonths?: number;
  hearingCents?: number;
  appealCents?: number;
  lateFinePercent?: string;
  lateInterestPercent?: string;
};

const cents = (value: number | undefined) => String(Math.max(Math.trunc(value ?? 0) || 0, 0));
const percent = (value: string | undefined) => String(value ?? "0").replace(",", ".") || "0";

const valuesOf = (values: FeeValues) => ({
  entry_cents: String(Math.max(Math.trunc(values.entryCents) || 0, 0)),
  installments: String(Math.max(Math.trunc(values.installments) || 0, 0)),
  installment_cents: String(Math.max(Math.trunc(values.installmentCents) || 0, 0)),
  success_percent: String(values.successPercent ?? "0").replace(",", ".") || "0",
  success_min_cents: String(Math.max(Math.trunc(values.successMinCents) || 0, 0)),
  settlement_percent: String(values.settlementPercent ?? "").replace(",", "."),
  monthly_cents: cents(values.monthlyCents),
  monthly_months: cents(values.monthlyMonths),
  hearing_cents: cents(values.hearingCents),
  appeal_cents: cents(values.appealCents),
  late_fine_percent: percent(values.lateFinePercent),
  late_interest_percent: percent(values.lateInterestPercent),
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
    /** The receipt ONE read the cost from, kept with it (0162). */
    fileId?: string | null;
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
        file_id: isId(fields.fileId) ? fields.fileId : "",
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

// ---------- The split of a case's fees with another lawyer (migration 0159) ----------

/** The splits of a case, for who reads the books; null for anybody else. */
export async function readFeeSplits(caseId: string): Promise<Record<string, unknown>[] | null> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId)) return null;
  const { data, error } = await context.supabase
    .from("case_fee_splits")
    .select("id, name, document, bar_registration, percent, ended_at, ended_reason")
    .eq("case_id", caseId)
    .order("created_at", { ascending: true });
  return error ? null : ((data ?? []) as Record<string, unknown>[]);
}

/** A partner, a lawyer or the controladoria splits a case's fees with a lawyer or law firm of the bar (second factor). */
export async function saveFeeSplit(
  caseId: string,
  fields: { name: string; document: string; barRegistration: string; percent: string },
): Promise<FeesResult> {
  if (!isId(caseId)) return { ok: false, code: "not_found" };
  return call(
    "save_fee_split",
    {
      target_case: caseId,
      fields: {
        name: String(fields.name ?? "").slice(0, 120),
        document: String(fields.document ?? "").slice(0, 20),
        bar_registration: String(fields.barRegistration ?? "").slice(0, 20),
        percent: String(fields.percent ?? "").replace(",", "."),
      },
    },
    `/casos/${caseId}`,
  );
}

/** A split ends with its reason (second factor); what was written of it stays. */
export async function endFeeSplit(caseId: string, splitId: string, reason: string): Promise<FeesResult> {
  if (!isId(caseId) || !isId(splitId)) return { ok: false, code: "not_found" };
  return call(
    "end_fee_split",
    { target_split: splitId, target_reason: String(reason ?? "").slice(0, 300) },
    `/casos/${caseId}`,
  );
}

// ---------- The fee terms read from the firm's own contract (migration 0160) ----------

export type FeeTermsReadAnswer = { ok: true; contract: string; read: FeeTermsRead } | { ok: false; code: string };

/**
 * ONE reads the firm's fee contract (the model of its library that writes the contract, the default first) and
 * answers how it charges, each value checked against the contract's words. Only who decides for the firm, never in a
 * support visit, within the day's readings. Nothing is written: the panel fills, and the person confirms the terms.
 */
export async function readFeeTermsFromContract(): Promise<FeeTermsReadAnswer> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_allowed" };
  const { data: model, error: modelError } = await context.supabase
    .from("draft_templates")
    .select("id, name, body, updated_at")
    .eq("org_id", context.firm.id)
    .eq("document_kind", "contrato")
    .order("is_default", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (modelError) return { ok: false, code: "failed" };
  if (!model) return { ok: false, code: "no_contract" };
  const { data: allowed, error } = await context.supabase.rpc("fee_terms_reading_allowed", {
    target_org: context.firm.id,
  });
  if (error) return { ok: false, code: error.code === "42501" ? "not_allowed" : "failed" };
  const answer = (allowed ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: String(answer.code ?? "failed") };

  const body = String(model.body ?? "");
  const result = await runFirmTask({
    orgId: context.firm.id,
    task: FEE_TERMS_TASK,
    // What is hashed for the record: the model and when it was last written, never its text.
    input: { template: model.id, updated_at: model.updated_at },
    messages: [{ role: "user", content: contractBriefing(String(model.name ?? ""), body) }],
    requestedBy: context.userId,
    subject: { type: "draft_template", id: String(model.id) },
  });
  if (result.kind === "finished") {
    return { ok: true, contract: String(model.name ?? ""), read: readFeeTermsOutput(result.output, body) };
  }
  if (result.kind === "replayed") return { ok: false, code: "read_running" };
  return { ok: false, code: result.code };
}
