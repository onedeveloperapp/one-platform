"use server";

import { revalidatePath } from "next/cache";

import { queueCaseAdvance } from "@/lib/cases/advance-work";
import { queueInterview } from "@/lib/cases/interview-work";
import { STATEMENT_AUDIO_MIMES } from "@/lib/cases/statements";
import { queueStatementWork } from "@/lib/cases/statements-work";
import { discardUpload, finishUpload, startUpload } from "@/lib/files/uploads";
import { getMemberContext } from "@/lib/member/context";
import { isSupportVisit } from "@/lib/whatsapp/session";
import { isInterviewQuestion } from "@flyee/rules/interview";

/**
 * What a person of the firm does with a client's account and with the
 * administrative complaint of a case (migration 0026). Every write is a
 * function of the database that takes the case; these actions carry the
 * request and turn the answer into a code the screen has words for.
 */

export type StatementResult<T extends object = object> =
  | ({ ok: true; code: string } & T)
  | { ok: false; code: string; field?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const KNOWN_ERRORS = ["not_allowed_in_support_session", "not_authorized", "case_not_found"] as const;
const raised = (message: string | null | undefined): string =>
  KNOWN_ERRORS.find((code) => (message ?? "").includes(code)) ?? "failed";

type RpcAnswer = { ok?: boolean; code?: string; field?: string | null } & Record<string, unknown>;

function fold<T extends object>(
  data: unknown,
  error: { message: string } | null,
  pick: (answer: RpcAnswer) => T,
): StatementResult<T> {
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as RpcAnswer;
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed"), field: answer.field ?? null };
  return { ok: true, code: String(answer.code ?? "saved"), ...pick(answer) };
}

const refresh = (caseId: string) => revalidatePath(`/casos/${caseId}`);

// ---------- The account ----------

/** A person of the firm adds what the client told: written, or an audio the firm already holds (one from WhatsApp). */
export async function addCaseStatement(input: {
  caseId: string;
  partyId: string | null;
  fileId?: string | null;
  text?: string | null;
}): Promise<StatementResult<{ statementId: string }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId)) return { ok: false, code: "case_not_found" };
  const { data, error } = await context.supabase.rpc("add_case_statement", {
    target_case: input.caseId,
    target_party: isId(input.partyId) ? input.partyId : null,
    target_file: isId(input.fileId) ? input.fileId : null,
    target_text: input.text ? String(input.text).slice(0, 20000) : null,
  });
  const result = fold(data, error, (answer) => ({ statementId: String(answer.statement_id ?? "") }));
  if (result.ok) {
    refresh(input.caseId);
    if (isId(result.statementId)) await queueStatementWork(result.statementId);
  }
  return result;
}

/** The first half of an audio the firm uploads as a client's account: the reservation and where the bytes go. */
export async function startStatementUpload(input: {
  name: string;
  mime: string;
  bytes: number;
}): Promise<StatementResult<{ fileId: string; storagePath: string; uploadToken: string }>> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  const mime = String(input?.mime ?? "").toLowerCase();
  if (!STATEMENT_AUDIO_MIMES.includes(mime)) return { ok: false, code: "type_not_allowed" };
  const started = await startUpload(context, {
    purpose: "statement",
    name: String(input?.name ?? "").slice(0, 200),
    mime,
    bytes: Math.trunc(Number(input?.bytes ?? 0)),
  });
  if (!started.ok) return { ok: false, code: started.code };
  return {
    ok: true,
    code: "reserved",
    fileId: started.fileId,
    storagePath: started.storagePath,
    uploadToken: started.uploadToken,
  };
}

/** The second half: the backend measures the audio, and it becomes a statement of the case, to be transcribed. */
export async function finishStatementUpload(input: {
  caseId: string;
  partyId: string | null;
  fileId: string;
}): Promise<StatementResult<{ statementId: string }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.fileId)) return { ok: false, code: "case_not_found" };
  const finished = await finishUpload(context, input.fileId);
  if (!finished.ok) return { ok: false, code: finished.code };
  const result = await addCaseStatement({ caseId: input.caseId, partyId: input.partyId, fileId: input.fileId });
  // An audio this request has just measured and that found no place in the case is taken back.
  if (!result.ok && finished.measured && !(await isSupportVisit())) {
    await discardUpload(context, input.fileId, "statement");
  }
  return result;
}

/** A person of the firm asks for the chronology of a statement again. */
export async function requestStatementChronology(caseId: string, statementId: string): Promise<StatementResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId) || !isId(statementId)) return { ok: false, code: "case_not_found" };
  const { data, error } = await context.supabase.rpc("request_statement_chronology", {
    target_statement: statementId,
  });
  const result = fold(data, error, () => ({}));
  if (result.ok) {
    refresh(caseId);
    await queueStatementWork(statementId);
  }
  return result;
}

/** A person of the firm asks for the transcription of an audio again, after it could not be made. */
export async function requestStatementTranscription(caseId: string, statementId: string): Promise<StatementResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId) || !isId(statementId)) return { ok: false, code: "case_not_found" };
  const { data, error } = await context.supabase.rpc("request_statement_transcription", {
    target_statement: statementId,
  });
  const result = fold(data, error, () => ({}));
  if (result.ok) {
    refresh(caseId);
    await queueStatementWork(statementId);
  }
  return result;
}

/**
 * A person of the firm asks that the work a statement waits for be done now: one that waits after a
 * passing failure, or that no job picked up (a machine with no jobs works on it after this response).
 */
export async function resumeStatementWork(caseId: string, statementId: string): Promise<StatementResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId) || !isId(statementId)) return { ok: false, code: "case_not_found" };
  const { data, error } = await context.supabase.rpc("resume_statement_work", { target_statement: statementId });
  const result = fold(data, error, () => ({}));
  if (result.ok) {
    refresh(caseId);
    await queueStatementWork(statementId);
  }
  return result;
}

/** A person of the firm writes down what an audio says, when it could not be transcribed. */
export async function writeStatementText(caseId: string, statementId: string, text: string): Promise<StatementResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId) || !isId(statementId)) return { ok: false, code: "case_not_found" };
  const { data, error } = await context.supabase.rpc("write_statement_text", {
    target_statement: statementId,
    target_text: String(text ?? "").slice(0, 20000),
  });
  const result = fold(data, error, () => ({}));
  if (result.ok) {
    refresh(caseId);
    await queueStatementWork(statementId);
  }
  return result;
}

/** A person of the firm removes a statement from the case: never one the client confirmed. */
export async function removeCaseStatement(caseId: string, statementId: string): Promise<StatementResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId) || !isId(statementId)) return { ok: false, code: "case_not_found" };
  const { data, error } = await context.supabase.rpc("remove_case_statement", { target_statement: statementId });
  const result = fold(data, error, () => ({}));
  if (result.ok) refresh(caseId);
  return result;
}

/**
 * A partner or a lawyer decides the case goes on without what the client did not answer of their account
 * (migration 0094): the client is asked nothing more of it, and ONE looks at the case at once to create the
 * lawsuits; the piece leaves those points for a lawyer to complete.
 */
export async function closeAccountGaps(caseId: string, statementId: string): Promise<StatementResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId) || !isId(statementId)) return { ok: false, code: "case_not_found" };
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  const { data, error } = await context.supabase.rpc("close_account_gaps", {
    target_case: caseId,
    target_statement: statementId,
  });
  const result = fold(data, error, () => ({}));
  if (result.ok) {
    refresh(caseId);
    await queueCaseAdvance(caseId);
  }
  return result;
}

/**
 * A person of the firm answers a question of the passenger's interview for them (what they told on the phone), or
 * corrects an answer (migration 0095); with no words, the passenger does not know. The interview goes on at once.
 */
export async function answerInterviewQuestion(
  caseId: string,
  question: string,
  text: string | null,
): Promise<StatementResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId)) return { ok: false, code: "case_not_found" };
  if (!isInterviewQuestion(question)) return { ok: false, code: "invalid_question" };
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  const { data, error } = await context.supabase.rpc("answer_case_interview", {
    target_case: caseId,
    target_question: question,
    target_text: text ? String(text).slice(0, 2000) : null,
  });
  const result = fold(data, error, () => ({}));
  if (result.ok) {
    refresh(caseId);
    queueInterview({ caseId });
  }
  return result;
}

/**
 * A partner or a lawyer decides the case goes on without what the passenger did not answer (migration 0095): ONE
 * asks nothing more, and looks at the case at once to create the lawsuits.
 */
export async function closeInterview(caseId: string): Promise<StatementResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId)) return { ok: false, code: "case_not_found" };
  if (await isSupportVisit()) return { ok: false, code: "not_allowed_in_support_session" };
  const { data, error } = await context.supabase.rpc("close_case_interview", { target_case: caseId });
  const result = fold(data, error, () => ({}));
  if (result.ok) {
    refresh(caseId);
    await queueCaseAdvance(caseId);
  }
  return result;
}

// ---------- The administrative complaint ----------

const COMPLAINT_FIELDS = [
  "channel",
  "protocol",
  "filed_on",
  "answer_due_on",
  "answered_on",
  "outcome",
  "notes",
] as const;

export async function saveAdminComplaint(input: {
  caseId: string;
  complaintId: string | null;
  fields: Record<string, unknown>;
}): Promise<StatementResult<{ complaintId: string }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId)) return { ok: false, code: "case_not_found" };
  if (input.complaintId !== null && !isId(input.complaintId)) return { ok: false, code: "not_found" };
  const fields: Record<string, string> = {};
  for (const key of COMPLAINT_FIELDS) {
    const value = input.fields?.[key];
    if (typeof value === "string") fields[key] = value.slice(0, 2000);
  }
  const { data, error } = await context.supabase.rpc("save_admin_complaint", {
    target_case: input.caseId,
    target_complaint: input.complaintId,
    target_fields: fields,
  });
  const result = fold(data, error, (answer) => ({ complaintId: String(answer.complaint_id ?? "") }));
  if (result.ok) refresh(input.caseId);
  return result;
}

export async function removeAdminComplaint(caseId: string, complaintId: string): Promise<StatementResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId) || !isId(complaintId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("remove_admin_complaint", { target_complaint: complaintId });
  const result = fold(data, error, () => ({}));
  if (result.ok) refresh(caseId);
  return result;
}
