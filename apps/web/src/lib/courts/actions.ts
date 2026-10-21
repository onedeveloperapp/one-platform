"use server";

import { revalidatePath } from "next/cache";

import { queueProceedingRead } from "@/lib/courts/tracking-work";
import { getMemberContext } from "@/lib/member/context";

/**
 * What a person of a firm does to the course of a lawsuit (migration 0031):
 * ask for it to be read now, and say they saw what the court did. The
 * database says whether a person may (their firm, not a support visit, once
 * in a while); every id is read again under the caller's session.
 */

export type CourseResult = { ok: true; code: string } | { ok: false; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const RAISED = ["not_allowed_in_support_session", "case_not_found"] as const;
const raised = (message: string | null | undefined): string =>
  RAISED.find((code) => (message ?? "").includes(code)) ?? "failed";

/** A person asks for a lawsuit to be read now from its source. */
export async function requestProceedingRead(caseId: string, proceedingId: string): Promise<CourseResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId) || !isId(proceedingId)) return { ok: false, code: "proceeding_not_found" };
  const { data, error } = await context.supabase.rpc("request_proceeding_read", { target_proceeding: proceedingId });
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; tracking_id?: string };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  if (answer.tracking_id) await queueProceedingRead(answer.tracking_id);
  revalidatePath(`/casos/${caseId}`);
  return { ok: true, code: "waiting" };
}

/** A person says they saw what the court did in a lawsuit. */
export async function acknowledgeMovements(caseId: string, proceedingId: string): Promise<CourseResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId) || !isId(proceedingId)) return { ok: false, code: "proceeding_not_found" };
  const { data, error } = await context.supabase.rpc("acknowledge_proceeding_movements", {
    target_proceeding: proceedingId,
  });
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  revalidatePath(`/casos/${caseId}`);
  revalidatePath("/inicio");
  return { ok: true, code: "seen" };
}
