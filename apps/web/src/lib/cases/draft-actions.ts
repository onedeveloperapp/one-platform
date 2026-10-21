"use server";

import { revalidatePath } from "next/cache";

import { hasPersonMark } from "@/lib/cases/drafts";
import { settleDraftReading, settleDraftWork } from "@/lib/cases/drafts-work";
import { getMemberContext } from "@/lib/member/context";

/**
 * What a person of the firm does with the piece of a lawsuit (migration
 * 0029): ask for it from a model of the firm, edit its text, see how it
 * will read with the facts of the lawsuit written in, approve it, send it
 * back to the AI with what to change, turn the AI's text down, give it up,
 * or put a work that failed back. Every write is
 * a function of the database, which holds the gate (a draft is approved only
 * when every source it cites is in the firm's verified library); these
 * actions carry the request and turn the answer into a code the screen has
 * words for.
 */

export type DraftResult<T extends object = object> =
  | ({ ok: true; code: string } & T)
  | { ok: false; code: string; field?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** What the database raises instead of answering, by the code the screen has words for. */
const RAISED = [
  "not_allowed_in_support_session",
  "second_factor_required",
  "case_not_found",
  "not_authorized",
  "draft_text_mismatch",
  "approve_on_case",
  // Raised by a request that met, under its lock, a first text that had just arrived (the answer it
  // withdrew goes back to waiting with the rollback).
  "draft_in_course",
  "not_proposed",
  // What the firm's queue answers when it would not take the decision of the AI's answer.
  "not_an_approver",
  "already_decided",
  "invalid_output",
  "not_revisable",
  "note_required",
  // A text is sent back where it is read; and a rewriting that became a version while it was being given up.
  "return_on_case",
  "draft_changed",
] as const;
const raised = (message: string | null | undefined): string =>
  RAISED.find((code) => (message ?? "").includes(code)) ?? "failed";

type RpcAnswer = { ok?: boolean; code?: string; field?: string | null } & Record<string, unknown>;

function fold<T extends object>(
  data: unknown,
  error: { message: string } | null,
  pick: (answer: RpcAnswer) => T,
): DraftResult<T> {
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as RpcAnswer;
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed"), field: answer.field ?? null };
  return { ok: true, code: String(answer.code ?? "saved"), ...pick(answer) };
}

const refresh = (caseId: string) => {
  revalidatePath(`/casos/${caseId}`);
  revalidatePath("/aprovacoes");
  revalidatePath("/inicio");
};

/** A text as the database takes it: with no character it refuses. */
const NUL = String.fromCharCode(0);
const clean = (text: unknown): string =>
  String(text ?? "")
    .split(NUL)
    .join("")
    .replace(/\p{Cs}/gu, "");

/** A person asks for the piece of a lawsuit: written by the AI from a model of the firm, or started as the model. */
export async function requestCaseDraft(input: {
  caseId: string;
  proceedingId: string;
  templateId: string;
  mode: "ai" | "blank";
}): Promise<DraftResult<{ draftId: string }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.proceedingId))
    return { ok: false, code: "case_not_found" };
  if (!isId(input.templateId)) return { ok: false, code: "template_not_found", field: "template" };
  const { data, error } = await context.supabase.rpc("request_case_draft", {
    target_proceeding: input.proceedingId,
    target_template: input.templateId,
    target_mode: input.mode === "ai" ? "ai" : "blank",
  });
  const result = fold(data, error, (answer) => ({ draftId: String(answer.draft_id ?? "") }));
  if (result.ok) {
    refresh(input.caseId);
    if (isId(result.draftId)) await settleDraftWork(result.draftId);
  }
  return result;
}

/**
 * A lawyer saves the text of a draft: a new version, whose citations are read at once. `baseVersion` is the
 * version the text was written on: one that is no longer the latest is refused, so that no colleague's
 * version is written over unseen.
 */
export async function saveDraftVersion(input: {
  caseId: string;
  draftId: string;
  body: string;
  baseVersion: number;
}): Promise<DraftResult<{ version: number }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.draftId)) return { ok: false, code: "draft_not_found" };
  const { data, error } = await context.supabase.rpc("save_draft_version", {
    target_draft: input.draftId,
    target_body: clean(input.body).slice(0, 250_000),
    target_base: Number.isInteger(input.baseVersion) ? input.baseVersion : -1,
  });
  const result = fold(data, error, (answer) => ({ version: Number(answer.version ?? 0) }));
  if (result.ok) {
    if (result.code === "saved") await settleDraftWork(input.draftId);
    refresh(input.caseId);
  }
  return result;
}

/**
 * The text of a draft as its document would say it today, with the facts of
 * the lawsuit written in by the database, and why it cannot be approved yet
 * when it cannot.
 */
export async function previewCaseDraft(draftId: string): Promise<
  DraftResult<{
    text: string;
    version: number;
    /** The mark of this very text: what an approval hands back, so that what is approved is what was read. */
    hash: string;
    blocker: string | null;
    /** The characters its document could not write. */
    unwritable: string[];
    /** The marks of a person left in it, as they are written: what a lawyer looks for when one holds the piece. */
    marks: string[];
  }>
> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(draftId)) return { ok: false, code: "draft_not_found" };
  const { data, error } = await context.supabase.rpc("preview_case_draft", { target_draft: draftId });
  return fold(data, error, (answer) => ({
    text: String(answer.text ?? ""),
    version: Number(answer.version ?? 0),
    hash: typeof answer.hash === "string" ? answer.hash : "",
    blocker: typeof answer.blocker === "string" ? answer.blocker : null,
    unwritable: Array.isArray(answer.unwritable)
      ? answer.unwritable.filter((item): item is string => typeof item === "string")
      : [],
    marks: Array.isArray(answer.marks) ? answer.marks.filter((item): item is string => typeof item === "string") : [],
  }));
}

/**
 * The text of a draft nobody edits anymore, read when a person opens it: what a piece says as it was
 * approved, or the last text of a draft that was given up or turned down (kept, so that what was written
 * on it is never lost with it).
 */
export async function readCaseDraftText(draftId: string): Promise<DraftResult<{ text: string; version: number }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(draftId)) return { ok: false, code: "draft_not_found" };
  const { data: draft, error } = await context.supabase
    .from("case_drafts")
    .select("id, version, approved_version, approved_body")
    .eq("id", draftId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  if (error) return { ok: false, code: "failed" };
  if (!draft) return { ok: false, code: "draft_not_found" };
  if (typeof draft.approved_body === "string") {
    return {
      ok: true,
      code: "approved",
      text: draft.approved_body,
      version: Number(draft.approved_version ?? draft.version),
    };
  }
  const { data: latest, error: readError } = await context.supabase
    .from("case_draft_versions")
    .select("body")
    .eq("org_id", context.firm.id)
    .eq("draft_id", draftId)
    .eq("version", draft.version)
    .maybeSingle();
  if (readError) return { ok: false, code: "failed" };
  if (!latest) return { ok: false, code: "no_text" };
  return { ok: true, code: "text", text: String(latest.body ?? ""), version: Number(draft.version) };
}

/**
 * A partner or a lawyer approves a draft, with the second factor: the version and the text the preview showed
 * them (`version` and `hash`, as `previewCaseDraft` answered), so that what is approved is what was read. Its
 * PDF is made at once.
 */
export async function approveCaseDraft(input: {
  caseId: string;
  draftId: string;
  version: number;
  hash: string;
}): Promise<DraftResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.draftId)) return { ok: false, code: "draft_not_found" };
  const { data, error } = await context.supabase.rpc("approve_case_draft", {
    target_draft: input.draftId,
    target_version: Number.isInteger(input.version) ? input.version : -1,
    target_hash: /^[0-9a-f]{32}$/.test(String(input.hash ?? "")) ? input.hash : null,
  });
  const result = fold(data, error, () => ({}));
  if (result.ok) {
    await settleDraftWork(input.draftId);
    refresh(input.caseId);
  }
  return result;
}

/** A partner or a lawyer takes back an approval whose document was not made: the draft is a text to correct again. */
export async function reopenCaseDraft(input: { caseId: string; draftId: string }): Promise<DraftResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.draftId)) return { ok: false, code: "draft_not_found" };
  const { data, error } = await context.supabase.rpc("reopen_case_draft", { target_draft: input.draftId });
  const result = fold(data, error, () => ({}));
  if (result.ok) refresh(input.caseId);
  return result;
}

/**
 * A partner or a lawyer turns the AI's text down, with the reason. A first text turned down is a draft
 * rejected; a rewriting turned down puts the text before it back as the latest version, whose citations
 * are read at once.
 */
export async function rejectCaseDraft(input: {
  caseId: string;
  draftId: string;
  note: string;
  /** The version that was read: a text that changed since is not turned down unseen. */
  version: number;
}): Promise<DraftResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.draftId)) return { ok: false, code: "draft_not_found" };
  const { data, error } = await context.supabase.rpc("reject_case_draft", {
    target_draft: input.draftId,
    target_note: clean(input.note).trim().slice(0, 2000) || null,
    target_version: Number.isInteger(input.version) ? input.version : -1,
  });
  const result = fold(data, error, () => ({}));
  if (result.ok) {
    await settleDraftReading(input.draftId);
    refresh(input.caseId);
  }
  return result;
}

/**
 * A partner or a lawyer sends the text of a draft back to the AI with what to change in it, with the second
 * factor: `version` is the version they read, and one that is no longer the latest is refused. The AI
 * rewrites it in the jobs, and what it writes is the next version, to be read and approved like the first.
 */
export async function returnCaseDraft(input: {
  caseId: string;
  draftId: string;
  version: number;
  note: string;
}): Promise<DraftResult<{ version: number }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.draftId)) return { ok: false, code: "draft_not_found" };
  const note = clean(input.note).trim().slice(0, 4000);
  // A mark of a person written in the request: the database refuses it too, and here it is said as the request's.
  if (hasPersonMark(note)) return { ok: false, code: "request_has_mark" };
  const { data, error } = await context.supabase.rpc("return_case_draft", {
    target_draft: input.draftId,
    target_version: Number.isInteger(input.version) ? input.version : -1,
    target_note: note || null,
  });
  const result = fold(data, error, (answer) => ({ version: Number(answer.version ?? 0) }));
  if (result.ok) {
    await settleDraftWork(input.draftId);
    refresh(input.caseId);
    return result;
  }
  // The same answer the queue gives a refusal with no reason: here what is missing is what to change.
  if (result.code === "note_required") return { ok: false, code: "request_required" };
  if (result.code === "placeholder_left" && result.field === "note") return { ok: false, code: "request_has_mark" };
  // The text is no longer the version the request was written about: said as such, with the request kept.
  if (result.code === "draft_changed") return { ok: false, code: "request_changed" };
  return result;
}

/** A partner or a lawyer gives up the rewriting they asked the AI for: the text is theirs to edit or approve again. */
export async function withdrawDraftRevision(input: { caseId: string; draftId: string }): Promise<DraftResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.draftId)) return { ok: false, code: "draft_not_found" };
  const { data, error } = await context.supabase.rpc("withdraw_draft_revision", { target_draft: input.draftId });
  const result = fold(data, error, () => ({}));
  if (result.ok) {
    await settleDraftReading(input.draftId);
    refresh(input.caseId);
  }
  return result;
}

/** A person gives up a draft that was not approved. */
export async function cancelCaseDraft(input: { caseId: string; draftId: string }): Promise<DraftResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.draftId)) return { ok: false, code: "draft_not_found" };
  const { data, error } = await context.supabase.rpc("cancel_case_draft", { target_draft: input.draftId });
  const result = fold(data, error, () => ({}));
  if (result.ok) refresh(input.caseId);
  return result;
}

/** A person puts back to work a draft whose work was given up. */
export async function resumeCaseDraft(input: { caseId: string; draftId: string }): Promise<DraftResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.draftId)) return { ok: false, code: "draft_not_found" };
  const { data, error } = await context.supabase.rpc("resume_case_draft_work", { target_draft: input.draftId });
  const result = fold(data, error, () => ({}));
  if (result.ok) {
    await settleDraftWork(input.draftId);
    refresh(input.caseId);
  }
  return result;
}
