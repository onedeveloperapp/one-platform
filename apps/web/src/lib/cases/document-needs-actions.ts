"use server";

import { revalidatePath } from "next/cache";

import { getMemberContext } from "@/lib/member/context";
import { isSupportVisit } from "@/lib/whatsapp/session";

/**
 * A dispensable document the client does not have, said for them by a person of the firm (migration 0177): the case
 * goes on without it. The database decides who may and keeps it on the case's timeline.
 */
export async function recordDocumentNotHave(caseId: string, kind: string): Promise<{ ok: boolean; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  if (kind !== "receipt" && kind !== "evidence") return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("record_document_not_have", {
    target_case: caseId,
    target_kind: kind,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  revalidatePath(`/casos/${caseId}`);
  return { ok: answer.ok === true, code: String(answer.code ?? "failed") };
}
