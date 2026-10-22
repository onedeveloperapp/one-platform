"use server";

import { revalidatePath } from "next/cache";

import { DRAFT_TASK } from "@/lib/cases/drafts";
import { settleDraftReading } from "@/lib/cases/drafts-work";
import { CHRONOLOGY_TASK, TRANSCRIPTION_TASK } from "@/lib/cases/statements";
import { queueStatementWork } from "@/lib/cases/statements-work";
import { CONVERSATION_TASK } from "@/lib/conversations/agent";
import { sendApprovedReply } from "@/lib/conversations/agent-work";
import { getMemberContext } from "@/lib/member/context";

/**
 * What a person of a firm does to an answer that waits in the approval queue.
 *
 * The rule is the database's (`decide_approval`, migration 0016): who may
 * decide (the functions the task names), that it takes the second factor,
 * that it happens once and never from a support visit, and that an answer is
 * sent back only where the task reads the note. This action only carries the
 * decision and turns the answer into a code the screen has words for.
 */

export type Decision = "approved" | "rejected" | "returned";

export type DecisionResult =
  | {
      ok: true;
      code: Decision;
      edited: boolean;
      /** An answer of ONE to a passenger, approved and not sent: why, as the database says it. */
      notSent?: string;
    }
  | { ok: false; code: string };

const KNOWN_CODES = [
  "second_factor_required",
  "not_allowed_in_support_session",
  "not_found",
  "not_an_approver",
  "already_decided",
  "note_required",
  "invalid_output",
  "invalid_decision",
  "document_already_decided",
  // The first text of a piece (migration 0029): it is approved on its case, where the text is read, and
  // never from the queue (`approve_on_case`); `not_proposed` is what approving an answer its draft no longer
  // has as its text meets. Turning it down here works, and one whose draft is gone leaves at the next sweep.
  "approve_on_case",
  "not_proposed",
  // An answer sent back with what to change: only of a task that reads the note, as many times as the
  // setting allows for what the answer is about, and, for the text of a piece, on its case.
  "not_revisable",
  "too_many_returns",
  "return_on_case",
] as const;

const codeOf = (message: string | null | undefined): string =>
  KNOWN_CODES.find((code) => (message ?? "").includes(code)) ?? "failed";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function decideApproval(input: {
  approvalId: string;
  decision: Decision;
  /** The answer as the person corrected it. Left out: the answer as the model gave it. */
  finalOutput?: Record<string, unknown> | null;
  /** Why it is turned down, or what to change in it when it is sent back. */
  note?: string | null;
}): Promise<DecisionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_found" };
  if (!UUID.test(input.approvalId)) return { ok: false, code: "not_found" };
  if (input.decision !== "approved" && input.decision !== "rejected" && input.decision !== "returned")
    return { ok: false, code: "invalid_decision" };

  const { data, error } = await context.supabase.rpc("decide_approval", {
    target_approval: input.approvalId,
    target_decision: input.decision,
    target_final_output: input.decision === "approved" ? (input.finalOutput ?? null) : null,
    target_note: input.note?.trim() || null,
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; edited?: boolean };
  if (!answer.ok) return { ok: false, code: codeOf(answer.code) };

  // What a decision leaves owed is done now, instead of at the next sweep (and on a machine with no jobs,
  // after this response): a transcription approved is the text of its statement, whose chronology is the
  // next work; a chronology sent back is asked again; and a rewriting of a piece turned down puts the text
  // before it back as a version whose citations are still to be read.
  const { data: decided } = await context.supabase
    .from("approvals")
    .select("task, ai_runs(subject_type, subject_id)")
    .eq("id", input.approvalId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  const run = Array.isArray(decided?.ai_runs) ? decided?.ai_runs[0] : decided?.ai_runs;
  const subject = UUID.test(run?.subject_id ?? "") ? (run?.subject_id as string) : null;
  if (subject && run?.subject_type === "case_statement") {
    const asked =
      (input.decision === "approved" && decided?.task === TRANSCRIPTION_TASK) ||
      (input.decision === "returned" && decided?.task === CHRONOLOGY_TASK);
    if (asked) await queueStatementWork(subject);
  }
  if (subject && run?.subject_type === "case_draft" && decided?.task === DRAFT_TASK && input.decision === "rejected") {
    await settleDraftReading(subject);
  }
  // An answer of ONE to a passenger, approved: it goes now, as ONE's answer this person approved (0048).
  let notSent: string | null = null;
  if (run?.subject_type === "wa_conversation" && decided?.task === CONVERSATION_TASK) {
    if (input.decision === "approved") {
      const sent = await sendApprovedReply(input.approvalId);
      if (sent !== "queued" && sent !== "already_sent") notSent = sent;
    }
    revalidatePath("/atendimento");
  }

  revalidatePath("/aprovacoes");
  revalidatePath("/inicio");
  return { ok: true, code: input.decision, edited: Boolean(answer.edited), ...(notSent ? { notSent } : {}) };
}
