"use server";

import { revalidatePath } from "next/cache";

import { queueMoneySplit } from "@/lib/finance/money-work";
import { getMemberContext } from "@/lib/member/context";

/**
 * The writes of what a lawsuit came to (migration 0130), each through its database function, which checks who may (a
 * partner, a lawyer or the controladoria; never a support visit) and keeps it on the record.
 */

export type OutcomeResult = { ok: true } | { ok: false; code: string; field?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

async function call(name: string, args: Record<string, unknown>, caseId: string): Promise<OutcomeResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc(name, args);
  if (error) return { ok: false, code: error.code === "42501" ? "not_allowed" : "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; field?: string };
  if (answer.ok !== true) {
    return { ok: false, code: typeof answer.code === "string" ? answer.code : "failed", field: answer.field };
  }
  if (isId(caseId)) revalidatePath(`/casos/${caseId}`);
  return { ok: true };
}

/** A person records a fact of a lawsuit the court has, by hand. */
export async function saveLawsuitFact(
  caseId: string,
  proceedingId: string,
  fields: {
    kind: string;
    result: string | null;
    appealBy: string | null;
    happenedOn: string;
    cents: number | null;
    perClaimant: boolean;
  },
): Promise<OutcomeResult> {
  if (!isId(proceedingId)) return { ok: false, code: "not_found" };
  return call(
    "save_lawsuit_fact",
    {
      target_proceeding: proceedingId,
      fields: {
        kind: fields.kind,
        result: fields.result ?? "",
        appeal_by: fields.appealBy ?? "",
        happened_on: fields.happenedOn,
        cents: fields.cents && fields.cents > 0 ? String(fields.cents) : "",
        per_claimant: fields.perClaimant,
      },
    },
    caseId,
  );
}

/** A person corrects a fact, confirms one ONE read, says they are aware of it, or registers what a release paid. */
export async function actOnLawsuitFact(
  caseId: string,
  factId: string,
  action: "correct" | "confirm" | "ack" | "received",
  fields: { reason?: string; cents?: number; receivedOn?: string } = {},
): Promise<OutcomeResult> {
  if (!isId(factId)) return { ok: false, code: "not_found" };
  const result = await call(
    "act_on_lawsuit_fact",
    {
      target_fact: factId,
      target_action: action,
      fields: {
        reason: fields.reason ?? "",
        cents: fields.cents !== undefined ? String(fields.cents) : "",
        received_on: fields.receivedOn ?? "",
      },
    },
    caseId,
  );
  // A release received owes its split by claimant (0135), done right after the answer.
  if (result.ok && action === "received") queueMoneySplit();
  return result;
}

/** A lawyer says they are aware ONE closed the case. */
export async function acknowledgeCaseClosure(caseId: string): Promise<OutcomeResult> {
  if (!isId(caseId)) return { ok: false, code: "not_found" };
  return call("acknowledge_case_closure", { target_case: caseId }, caseId);
}
