"use server";

import { revalidatePath } from "next/cache";

import { queueCaseAdvance } from "@/lib/cases/advance-work";
import { relationInputOf } from "@/lib/cases/residence";
import { getMemberContext } from "@/lib/member/context";

/** What came of a write about a declaration of residence: done, or the code of what went wrong (`residenceErrorKey`). */
export type ResidenceResult = { ok: true } | { ok: false; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const KNOWN_ERRORS = ["not_allowed_in_support_session", "case_not_found", "not_authorized"] as const;

function resultOf(data: unknown, error: { message: string } | null): ResidenceResult {
  if (error) return { ok: false, code: KNOWN_ERRORS.find((code) => error.message.includes(code)) ?? "failed" };
  const answer = (data ?? {}) as { ok?: unknown; code?: unknown };
  return answer.ok === true
    ? { ok: true }
    : { ok: false, code: typeof answer.code === "string" ? answer.code : "failed" };
}

/**
 * Somebody of the firm says who the holder of a client's bill is to them, as the client told it, and the holder's name
 * where ONE read it wrong (migration 0123). The declaration is then ONE's to issue; one issued already is not changed.
 */
export async function recordResidenceRelation(
  caseId: string,
  declarationId: string,
  input: unknown,
): Promise<ResidenceResult> {
  if (!isId(caseId) || !isId(declarationId)) return { ok: false, code: "not_found" };
  const read = relationInputOf(input);
  if (!read.ok) return read;
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("record_residence_relation", {
    target_declaration: declarationId,
    target_relation: read.relation,
    target_note: read.note,
    target_holder: read.holder,
  });
  const result = resultOf(data, error);
  if (result.ok) {
    revalidatePath(`/casos/${caseId}`);
    // The declaration may be what ONE waited for to issue: the case is looked at now.
    await queueCaseAdvance(caseId);
  }
  return result;
}

/**
 * A partner or a lawyer goes on without a client's declaration, with the second factor and the reason the record keeps
 * (migration 0123): the filing no longer waits for it, and its envelope still open ends.
 */
export async function waiveResidenceDeclaration(
  caseId: string,
  declarationId: string,
  reason: string,
): Promise<ResidenceResult> {
  if (!isId(caseId) || !isId(declarationId)) return { ok: false, code: "not_found" };
  const said = typeof reason === "string" ? reason.trim().replace(/\s+/g, " ") : "";
  if (said.length < 8 || said.length > 500) return { ok: false, code: "reason" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("waive_residence_declaration", {
    target_declaration: declarationId,
    target_reason: said,
  });
  const result = resultOf(data, error);
  if (result.ok) {
    revalidatePath(`/casos/${caseId}`);
    await queueCaseAdvance(caseId);
  }
  return result;
}
