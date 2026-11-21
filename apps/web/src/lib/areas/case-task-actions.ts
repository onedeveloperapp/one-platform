"use server";

import { revalidatePath } from "next/cache";

import { getMemberContext } from "@/lib/member/context";

/**
 * A person of the firm says a work outside the lawsuit of a case of an area is done, or not after all (migration
 * 0274). The firm and the record are the database's.
 */
export async function markCaseTask(input: {
  caseId: string;
  taskId: string;
  done: boolean;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!/^[0-9a-f-]{36}$/i.test(input.taskId) || !/^[0-9a-f-]{36}$/i.test(input.caseId)) {
    return { ok: false, code: "not_found" };
  }
  const { data, error } = await context.supabase.rpc("mark_case_task", {
    target_org: context.firm.id,
    target_task: input.taskId,
    target_done: input.done === true,
  });
  if (error) {
    return { ok: false, code: error.message.includes("support_session") ? "not_allowed_in_support_session" : "failed" };
  }
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: answer.code ?? "failed" };
  revalidatePath(`/casos/${input.caseId}`);
  return { ok: true };
}
