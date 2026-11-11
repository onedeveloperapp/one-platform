"use server";

import { revalidatePath } from "next/cache";

import { getMemberContext } from "@/lib/member/context";

/**
 * The firm's writes on what follows a judgment (migration 0185): a partner or a lawyer decides, with the second
 * factor; a person of the firm records the client's word on what an appeal costs, saying how. The database decides
 * who may and what follows.
 */

export type JudgmentPathResult = { ok: true } | { ok: false; code: string };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DECISIONS = ["aceitar", "embargos_declaracao", "recurso_inominado", "apelacao"] as const;
const HOWS = ["telefone", "whatsapp", "presencial", "email"] as const;

function fold(data: unknown, error: { message: string } | null): JudgmentPathResult {
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: unknown };
  return answer.ok ? { ok: true } : { ok: false, code: String(answer.code ?? "failed") };
}

export async function decideJudgmentPath(
  caseId: string,
  pathId: string,
  decision: string,
  reason: string,
): Promise<JudgmentPathResult> {
  const context = await getMemberContext();
  if (!context?.firm || !ID.test(caseId) || !ID.test(pathId)) return { ok: false, code: "not_found" };
  if (!(DECISIONS as readonly string[]).includes(decision)) return { ok: false, code: "invalid_decision" };
  const { data, error } = await context.supabase.rpc("decide_judgment_path", {
    target_path: pathId,
    target_decision: decision,
    target_reason: reason.trim() ? reason.slice(0, 500) : null,
  });
  const result = fold(data, error);
  if (result.ok) revalidatePath(`/casos/${caseId}`);
  return result;
}

export async function recordJudgmentAnswer(
  caseId: string,
  pathId: string,
  agrees: boolean,
  how: string,
): Promise<JudgmentPathResult> {
  const context = await getMemberContext();
  if (!context?.firm || !ID.test(caseId) || !ID.test(pathId)) return { ok: false, code: "not_found" };
  if (!(HOWS as readonly string[]).includes(how)) return { ok: false, code: "invalid_how" };
  const { data, error } = await context.supabase.rpc("record_judgment_path_answer", {
    target_path: pathId,
    target_agrees: agrees,
    target_how: how,
  });
  const result = fold(data, error);
  if (result.ok) revalidatePath(`/casos/${caseId}`);
  return result;
}
