"use server";

import { revalidatePath } from "next/cache";

import { queueDraftWork } from "@/lib/cases/drafts-work";
import { queuePieceFilings } from "@/lib/cases/pieces-work";
import { discardUpload, finishUpload } from "@/lib/files/uploads";
import { getMemberContext } from "@/lib/member/context";
import { isSupportVisit } from "@/lib/whatsapp/session";

/**
 * The firm's writes on the intermediate pieces of a lawsuit the court has (migration 0189): a person asks for one, a
 * partner or a lawyer decides it with ONE's recommendation (the second factor), says they filed it in the court's
 * system, and sends the airline's defence for a réplica. The database decides who may and what follows; the work a
 * write leaves owed (the AI's text, the filing) is done right after the answer.
 */

export type PieceResult = { ok: true; code?: string } | { ok: false; code: string };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KIND = /^[a-z][a-z_]{2,40}$/;

function fold(data: unknown, error: { message: string } | null): PieceResult & { draftId?: string; waits?: boolean } {
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: unknown; draft_id?: unknown; waits_for?: unknown };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  return {
    ok: true,
    code: String(answer.code ?? "ok"),
    ...(typeof answer.draft_id === "string" ? { draftId: answer.draft_id } : {}),
    waits: Boolean(answer.waits_for),
  };
}

const refresh = (caseId: string) => revalidatePath(`/casos/${caseId}`);

/** A person asks for a piece of a lawsuit the court has. */
export async function requestPiece(caseId: string, proceedingId: string, kind: string): Promise<PieceResult> {
  const context = await getMemberContext();
  if (!context?.firm || !ID.test(caseId) || !ID.test(proceedingId)) return { ok: false, code: "not_found" };
  if (!KIND.test(kind)) return { ok: false, code: "invalid_data" };
  const { data, error } = await context.supabase.rpc("request_intermediate_piece", {
    target_proceeding: proceedingId,
    target_kind: kind,
    target_publication: null,
    target_source: null,
  });
  const result = fold(data, error);
  if (result.ok) {
    if (result.draftId && !result.waits) await queueDraftWork(result.draftId);
    refresh(caseId);
  }
  return result.ok ? { ok: true, code: result.code } : result;
}

/** A partner or a lawyer decides a piece: file it, or hold it with the next steps. */
export async function decidePiece(
  caseId: string,
  draftId: string,
  decision: "file" | "hold",
  reason: string,
): Promise<PieceResult> {
  const context = await getMemberContext();
  if (!context?.firm || !ID.test(caseId) || !ID.test(draftId)) return { ok: false, code: "not_found" };
  if (decision !== "file" && decision !== "hold") return { ok: false, code: "invalid_data" };
  const { data, error } = await context.supabase.rpc("decide_intermediate_piece", {
    target_draft: draftId,
    target_decision: decision,
    target_reason: reason.trim() ? reason.trim().slice(0, 1000) : null,
  });
  const result = fold(data, error);
  if (result.ok) {
    if (decision === "file") queuePieceFilings();
    refresh(caseId);
  }
  return result.ok ? { ok: true } : result;
}

/** A lawyer says they filed the piece in the court's system, with the protocol and the day. */
export async function recordPieceFiled(
  caseId: string,
  draftId: string,
  protocol: string,
  filedOn: string,
): Promise<PieceResult> {
  const context = await getMemberContext();
  if (!context?.firm || !ID.test(caseId) || !ID.test(draftId)) return { ok: false, code: "not_found" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filedOn)) return { ok: false, code: "invalid_data" };
  const { data, error } = await context.supabase.rpc("record_piece_filed", {
    target_draft: draftId,
    target_protocol: protocol.trim().slice(0, 120) || null,
    target_filed_on: filedOn,
  });
  const result = fold(data, error);
  if (result.ok) refresh(caseId);
  return result.ok ? { ok: true } : result;
}

/** The airline's defence, uploaded by the firm, joins the case; the réplica that waited for it is written. */
export async function attachDefense(caseId: string, fileId: string): Promise<PieceResult> {
  const context = await getMemberContext();
  if (!context?.firm || !ID.test(caseId) || !ID.test(fileId)) return { ok: false, code: "not_found" };
  const finished = await finishUpload(context, fileId);
  if (!finished.ok) return { ok: false, code: finished.code };
  const { data, error } = await context.supabase.rpc("attach_case_defense", {
    target_case: caseId,
    target_file: fileId,
  });
  const result = fold(data, error);
  if (!result.ok) {
    if (finished.measured && !(await isSupportVisit())) await discardUpload(context, fileId);
    return result;
  }
  const { data: waiting } = await context.supabase
    .from("case_drafts")
    .select("id")
    .eq("case_id", caseId)
    .eq("piece_kind", "replica")
    .eq("status", "generating")
    .eq("work", "generate");
  for (const row of (waiting ?? []) as { id: string }[]) await queueDraftWork(row.id);
  refresh(caseId);
  return { ok: true };
}
