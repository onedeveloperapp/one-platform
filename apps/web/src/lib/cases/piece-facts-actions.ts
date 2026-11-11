"use server";

import { revalidatePath } from "next/cache";

import { queueDraftWork } from "@/lib/cases/drafts-work";
import { queuePieceFacts } from "@/lib/cases/piece-facts-work";
import { getMemberContext } from "@/lib/member/context";

/**
 * The firm's writes on the client's check of the facts of a piece (migration 0182): a person of the firm records the
 * client's word as the client told them, saying how; a partner or a lawyer goes on without it, saying why, with the
 * second factor. The database decides who may and what follows.
 */

export type PieceFactsResult = { ok: true; code: string } | { ok: false; code: string };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HOWS = ["telefone", "whatsapp", "presencial", "email"] as const;

function fold(
  data: unknown,
  error: { message: string } | null,
): PieceFactsResult & { draftId?: string; sentBack?: boolean } {
  if (error)
    return { ok: false, code: error.message.includes("support_session") ? "not_allowed_in_support_session" : "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: unknown; draft_id?: unknown; sent_back?: unknown };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  return {
    ok: true,
    code: String(answer.code ?? "saved"),
    draftId: typeof answer.draft_id === "string" ? answer.draft_id : undefined,
    sentBack: answer.sent_back === true,
  };
}

export async function recordPieceFacts(input: {
  caseId: string;
  checkId: string;
  confirmed: boolean;
  note: string;
  how: string;
}): Promise<PieceFactsResult> {
  const context = await getMemberContext();
  if (!context?.firm || !ID.test(input?.caseId ?? "") || !ID.test(input?.checkId ?? "")) {
    return { ok: false, code: "not_found" };
  }
  if (!(HOWS as readonly string[]).includes(input.how)) return { ok: false, code: "invalid_how" };
  const { data, error } = await context.supabase.rpc("record_piece_facts_answer", {
    target_check: input.checkId,
    target_confirmed: input.confirmed === true,
    target_note: String(input.note ?? "").slice(0, 2000),
    target_how: input.how,
  });
  const result = fold(data, error);
  if (result.ok && result.draftId) {
    if (result.code === "confirmed") queuePieceFacts(result.draftId);
    else if (result.sentBack) await queueDraftWork(result.draftId);
  }
  if (result.ok) revalidatePath(`/casos/${input.caseId}`);
  return result.ok ? { ok: true, code: result.code } : result;
}

export async function waivePieceFacts(caseId: string, draftId: string, reason: string): Promise<PieceFactsResult> {
  const context = await getMemberContext();
  if (!context?.firm || !ID.test(caseId) || !ID.test(draftId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("waive_piece_facts", {
    target_draft: draftId,
    target_reason: String(reason ?? "").slice(0, 500),
  });
  const result = fold(data, error);
  if (result.ok) {
    queuePieceFacts(draftId);
    revalidatePath(`/casos/${caseId}`);
  }
  return result.ok ? { ok: true, code: result.code } : result;
}
