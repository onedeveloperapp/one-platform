import type { DocumentQuality } from "@/lib/cases/document-quality";
import type { FirmFunction } from "@/lib/firm/roles";
import { DEFAULT_TIME_ZONE } from "@/lib/messages/format";

/**
 * The approval queue of a firm, as the screen reads it: what the AI suggested
 * and waits for a person (migration 0016). Types and the pure rules of the
 * screen live here; the reads are in the page and the one write is the
 * `decideApproval` action.
 */

/** One suggestion waiting for a decision. */
export type PendingApproval = {
  id: string;
  task: string;
  /** The task's name and what it is for, as the platform's catalog words them. */
  taskName: string;
  taskDescription: string | null;
  /** The functions of the firm that may decide this one. */
  approverFunctions: FirmFunction[];
  /** An answer of this task may be sent back with what to change in it: the task is asked again, and what it answers waits here. */
  revisable: boolean;
  /** When it entered the queue, already written on the reader's clock. */
  receivedLabel: string;
  /** What the model answered: an object, one field per thing it was asked. */
  output: Record<string, unknown>;
  /** The document of a case the answer is about, for the check of a document (migration 0024). */
  document: ApprovalDocument | null;
  /** The client's account the answer is about, for its transcription and its chronology (migration 0026). */
  statement: ApprovalStatement | null;
  /** The draft of a piece the answer is the first text of (migration 0029). */
  draft: ApprovalDraft | null;
  /** The conversation an answer of ONE to a passenger is of (migration 0048). */
  conversation: ApprovalConversation | null;
};

/** The conversation an answer of ONE answers: its last words, and whether the answer can still go. */
export type ApprovalConversation = {
  id: string;
  /** The name the firm has for the passenger, else the one WhatsApp shows; empty when neither. */
  contact: string;
  windowOpen: boolean;
  optedOut: boolean;
  numberActive: boolean;
  /** The last messages, oldest first. */
  messages: { id: string; author: "cliente" | "one" | "escritorio"; text: string; momentLabel: string }[];
};

/** The draft a text of the AI is of: the case and the lawsuit it is written for, and the model it came from. */
export type ApprovalDraft = {
  id: string;
  caseId: string;
  caseSeq: number | null;
  templateName: string;
  /** The version the piece is at on its case: beyond the one the AI wrote, a lawyer already wrote on from it. */
  version: number;
  proceedingKind: string | null;
  /** The version this answer is, once it is one (a rewriting still on its way to the draft has none yet). */
  answerVersion: number | null;
  /** What a lawyer asked the AI to change, when this text is one it rewrote, and who asked. */
  request: { note: string; askedBy: string | null } | null;
  /**
   * What the AI said a lawyer should check in the version this answer is, with the words each mark stood for
   * put back (the answer itself keeps the marks of a rewriting). Empty while the answer is no version yet.
   */
  notes: string[];
};

/** The account a transcription or a chronology is about: whose it is, and what the client said. */
export type ApprovalStatement = {
  id: string;
  caseId: string;
  caseSeq: number | null;
  personName: string | null;
  /** The client's own words, when they are already text: what a chronology is read against. */
  text: string | null;
  /** The audio, when it was spoken: what a transcription is heard against. */
  audioFileId: string | null;
  /** What the client said is wrong in the chronology before this one, and that chronology: what this one answers. */
  clientNote: string | null;
  previousChronology: string | null;
  /** What the firm asked to change in a proposal it sent back, and that proposal: what this one answers. */
  firmNote: string | null;
  returnedProposal: string | null;
  /** How many more times a proposal of this statement may be sent back: none, and the card says so before anybody writes. */
  returnsLeft: number;
};

/** The document a check is about, as the queue names it and opens it. */
export type ApprovalDocument = {
  id: string;
  caseId: string;
  caseSeq: number | null;
  kind: string;
  personName: string | null;
  fileId: string;
  /** What the rule measured of its photo where it arrived, when it did: read beside what the AI found. */
  quality: DocumentQuality | null;
};

/** A decision already made, for the short list under the queue. */
export type DecidedApproval = {
  id: string;
  taskName: string;
  /** `returned`: sent back with what to change (`note`); what the task answered then is another answer. */
  status: "approved" | "rejected" | "returned";
  /** Approved after the person corrected the suggestion. */
  edited: boolean;
  /** Decided by ONE where the firm lets it (0016): nobody of the firm. */
  decidedAuto: boolean;
  /** Null when who decided is no longer in the firm, or when ONE did. */
  decidedByName: string | null;
  /** When it was decided, already written on the reader's clock. */
  decidedLabel: string;
  note: string | null;
};

/**
 * `ok`: this session passed the second factor. `challenge`: the account has a
 * factor and this session has not confirmed it. `missing`: no factor yet.
 */
export type SecondFactorState = "ok" | "challenge" | "missing";

export type ApprovalsData = {
  firm: { id: string; name: string };
  me: { firmFunction: FirmFunction };
  pending: PendingApproval[];
  /** How many wait in all: `pending` holds the oldest of them. */
  pendingTotal: number;
  decided: DecidedApproval[];
  secondFactor: SecondFactorState;
  /** A support visit reads the queue and decides nothing. */
  supportVisit: boolean;
};

/**
 * What the screen renders from. `no-firm` is the platform operator, who works
 * in no firm; `unavailable` is a clone without Supabase; `error` is a read
 * that failed. None of them is ever shown as an empty queue.
 */
export type ApprovalsState =
  | ({ kind: "ready" } & ApprovalsData)
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

/** How many waiting suggestions the screen loads at once, oldest first. */
export const PENDING_PAGE = 30;

/** How many past decisions the screen shows. */
export const DECIDED_SHOWN = 8;

/**
 * A moment as the screen writes it, "08/10/2026, 14:32", on the reader's own
 * clock. The page formats it on the server and hands the text over, so the
 * server and the browser can never disagree about the hour. A time zone the
 * runtime refuses falls back to Brasília instead of failing the screen.
 */
export function momentLabel(value: string, timeZone: string | null | undefined): string {
  const write = (zone: string) =>
    new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: zone }).format(
      new Date(value),
    );
  try {
    return write(timeZone || DEFAULT_TIME_ZONE);
  } catch {
    return write(DEFAULT_TIME_ZONE);
  }
}

/** Who may decide a suggestion: a person whose function the task names. */
export const mayDecide = (firmFunction: FirmFunction, approvers: readonly FirmFunction[]): boolean =>
  approvers.includes(firmFunction);

/**
 * The name of a field of the answer, from its key: `data_do_voo` reads
 * "Data do voo". The keys are written in Portuguese by the instructions of
 * each task; a task that deserves better words gets its own view.
 */
export function fieldLabel(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/**
 * What a field of the answer is, for the way the screen shows it. Only text
 * can be corrected on the generic view: a number, a yes or no and a list keep
 * the value the model gave.
 */
export type FieldKind = "text" | "flag" | "number" | "list" | "empty" | "other";

export function fieldKind(value: unknown): FieldKind {
  if (value === null || value === undefined) return "empty";
  if (typeof value === "string") return "text";
  if (typeof value === "boolean") return "flag";
  if (typeof value === "number") return "number";
  if (Array.isArray(value) && value.every((item) => typeof item === "string" || typeof item === "number")) {
    return "list";
  }
  return "other";
}

/** A value that is neither text nor a simple list, written so a person can read it. */
export const structuredText = (value: unknown): string => JSON.stringify(value, null, 2) ?? "";

/** The corrections a person typed, by field. A field left out keeps the model's text. */
export type AnswerEdits = Record<string, string>;

/** True when a typed correction differs from what the model gave for that field. */
export function hasEdits(output: Record<string, unknown>, edits: AnswerEdits): boolean {
  return Object.entries(edits).some(([key, text]) => typeof output[key] === "string" && output[key] !== text);
}

/**
 * The answer as the person leaves it: the model's object with the text fields
 * they corrected. Only fields that were text change, and no field is added or
 * removed, so the result still has what the task's instructions require.
 */
export function applyEdits(output: Record<string, unknown>, edits: AnswerEdits): Record<string, unknown> {
  const result: Record<string, unknown> = { ...output };
  for (const [key, text] of Object.entries(edits)) {
    if (typeof output[key] === "string") result[key] = text;
  }
  return result;
}

/** A corrected text field left blank: the screen stops it before the database has to. */
export const blankEdits = (output: Record<string, unknown>, edits: AnswerEdits): string[] =>
  Object.entries(edits)
    .filter(([key, text]) => typeof output[key] === "string" && text.trim() === "")
    .map(([key]) => key);

/** The message key of each answer `decide_approval` gives (`product` namespace). */
const ERROR_KEYS: Record<string, string> = {
  second_factor_required: "approvals-error-second-factor",
  not_allowed_in_support_session: "approvals-error-support-session",
  not_found: "approvals-error-not-found",
  not_an_approver: "approvals-error-not-approver",
  already_decided: "approvals-error-already-decided",
  note_required: "approvals-error-note-required",
  invalid_output: "approvals-error-invalid-output",
  document_already_decided: "approvals-error-document-decided",
  approve_on_case: "draft-error-approve-on-case",
  not_proposed: "draft-blocker-not-proposed",
  not_revisable: "approvals-error-not-revisable",
  too_many_returns: "approvals-error-too-many-returns",
  return_on_case: "draft-error-return-on-case",
};

export const approvalErrorKey = (code: string): string => ERROR_KEYS[code] ?? "approvals-error-failed";
