"use server";

import { revalidatePath } from "next/cache";

import { queueSessionLimits } from "@/lib/courts/session-work";
import { getMemberContext } from "@/lib/member/context";

/**
 * The firm's writes on the sessions of judgment (migration 0219): a person records a session ONE did not read, or
 * takes one off with why; a partner or a lawyer says whether the firm registered to argue. The database decides who
 * may, keeps each on the record, and the limit of a session recorded is counted right after.
 */

export type SessionResult = { ok: true } | { ok: false; code: string };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;

function fold(data: unknown, error: { message: string; code?: string } | null): SessionResult {
  if (error) return { ok: false, code: error.code === "P0002" ? "not_found" : "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: unknown };
  return answer.ok ? { ok: true } : { ok: false, code: String(answer.code ?? "failed") };
}

export async function recordJudgmentSession(
  caseId: string,
  proceedingId: string,
  kind: string,
  startsOn: string,
  startsAt: string,
): Promise<SessionResult> {
  const context = await getMemberContext();
  if (!context?.firm || !ID.test(caseId) || !ID.test(proceedingId)) return { ok: false, code: "not_found" };
  if ((kind !== "virtual" && kind !== "presencial") || !DAY.test(startsOn)) return { ok: false, code: "invalid_data" };
  if (startsAt !== "" && !HOUR.test(startsAt)) return { ok: false, code: "invalid_data" };
  const { data, error } = await context.supabase.rpc("record_judgment_session", {
    target_proceeding: proceedingId,
    target_kind: kind,
    target_starts_on: startsOn,
    target_starts_at: startsAt === "" ? null : startsAt,
  });
  const result = fold(data, error);
  if (result.ok) {
    revalidatePath(`/casos/${caseId}`);
    await queueSessionLimits();
  }
  return result;
}

export async function withdrawJudgmentSession(
  caseId: string,
  sessionId: string,
  reason: string,
): Promise<SessionResult> {
  const context = await getMemberContext();
  if (!context?.firm || !ID.test(caseId) || !ID.test(sessionId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("withdraw_judgment_session", {
    target_session: sessionId,
    target_reason: String(reason ?? "").slice(0, 500),
  });
  const result = fold(data, error);
  if (result.ok) revalidatePath(`/casos/${caseId}`);
  return result;
}

export async function decideOralArgument(
  caseId: string,
  sessionId: string,
  choice: "registered" | "declined" | null,
): Promise<SessionResult> {
  const context = await getMemberContext();
  if (!context?.firm || !ID.test(caseId) || !ID.test(sessionId)) return { ok: false, code: "not_found" };
  if (choice !== null && choice !== "registered" && choice !== "declined") return { ok: false, code: "invalid_data" };
  const { data, error } = await context.supabase.rpc("decide_oral_argument", {
    target_session: sessionId,
    target_choice: choice,
  });
  const result = fold(data, error);
  if (result.ok) revalidatePath(`/casos/${caseId}`);
  return result;
}
