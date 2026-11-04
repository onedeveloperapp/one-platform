import "server-only";

import { momentLabel } from "@/lib/ai/approvals";
import { isModelDocument, type ModelDocument } from "@/lib/cases/drafts";
import {
  type ChangeShown,
  changesShown,
  composeModel,
  exchangesOf,
  firmTextsOf,
  type HeldReason,
  heldReasonOf,
  IMPORT_STATUSES,
  type ImportQuestion,
  type ImportRefusal,
  type ImportSource,
  type ImportStatus,
  type ModelCheck,
  modelChecks,
  paragraphsOf,
  proposalOf,
  questionsOf,
  refusalOf,
} from "@/lib/library/imports";
import { unwritableCharacters } from "@flyee/documents/text-pdf";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the screens read of a model made from a document (migrations 0067 and
 * 0079), under the person's own session: row-level security shows a request
 * to who writes the firm's models only. The model is written here from the
 * paragraphs and the changes the database kept, with what changed and what a
 * lawyer should check, on the server, where the writer of the PDF is; with
 * what ONE asks, why it refused a document, why what it prepared waits for a
 * person, and the model it saved.
 */

/** What ONE prepared, as the dialog fills itself with it. */
export type PreparedModel = {
  name: string;
  documentKind: ModelDocument;
  proceedingKind: "juizado" | "comum" | null;
  body: string;
  changes: ChangeShown[];
  checks: ModelCheck[];
  notes: string[];
};

/** The model ONE saved from a document, as the dialog edits it from then on. */
export type SavedModel = {
  templateId: string;
  name: string;
  documentKind: ModelDocument;
  proceedingKind: "juizado" | "comum" | null;
  isDefault: boolean;
  body: string;
};

export type TemplateImportView = {
  id: string;
  fileName: string;
  source: ImportSource;
  status: ImportStatus;
  failure: string | null;
  /** What the firm sent the document as; null when it did not say. */
  expected: ModelDocument | null;
  /** What ONE asks now ("asking"). */
  questions: ImportQuestion[];
  /** The round of questions this is: the first, the second. */
  round: number;
  /** Why ONE refused the document ("refused"). */
  refusal: ImportRefusal | null;
  /** Why what ONE prepared waits for a person ("ready"). */
  heldReason: HeldReason | null;
  /** The model ONE saved ("saved"), read with the request; null when it was removed since. */
  saved: SavedModel | null;
  prepared: PreparedModel | null;
};

/** A request as the library lists it. */
export type LibraryImport = {
  id: string;
  fileName: string;
  source: ImportSource;
  status: ImportStatus;
  failure: string | null;
  expected: ModelDocument | null;
  refusal: ImportRefusal | null;
  requestedBy: string | null;
  sentLabel: string;
};

/** What may be sent for a model, as the setting says it. */
export type ImportLimits = { megabytes: number; pages: number };

export type ImportRow = {
  id: string;
  file_name: string;
  source: string;
  status: string;
  failure: string | null;
  expected_kind?: string | null;
  questions?: unknown;
  rounds?: number | null;
  refusal?: unknown;
  held_reason?: string | null;
  saved_template_id?: string | null;
  paragraphs?: unknown;
  proposal?: unknown;
  exchanges?: unknown;
  claimed_at?: string | null;
  requested_by?: string | null;
  created_at: string;
};

/** What a request's dialog reads of it. */
export const IMPORT_VIEW_COLUMNS =
  "id, file_name, source, status, failure, expected_kind, questions, rounds, refusal, held_reason, saved_template_id, paragraphs, proposal, exchanges, claimed_at, requested_by, created_at";

const statusOf = (value: string): ImportStatus =>
  (IMPORT_STATUSES as readonly string[]).includes(value) ? (value as ImportStatus) : "failed";
const sourceOf = (value: string): ImportSource => (value === "pdf" ? "pdf" : "docx");
const expectedOf = (value: unknown): ModelDocument | null => (isModelDocument(value) ? value : null);

/** The states that hold what ONE prepared: being saved by ONE, waiting for a person, saved. */
const PREPARED: readonly ImportStatus[] = ["saving", "ready", "saved"];

/**
 * A request as the dialog reads it: the model ONE prepared, written whole,
 * once there is one; what ONE asks, or why it refused; and the model ONE
 * saved, read beside it ("saved").
 */
export function importView(row: ImportRow, saved: SavedModel | null = null): TemplateImportView {
  const status = statusOf(row.status);
  const proposal = PREPARED.includes(status) ? proposalOf(row.proposal) : null;
  const paragraphs = paragraphsOf(row.paragraphs);
  let prepared: PreparedModel | null = null;
  if (proposal) {
    const body = composeModel(paragraphs, proposal.changes);
    const unwritable = proposal.documentKind === "piece" ? unwritableCharacters(body) : [];
    prepared = {
      name: proposal.name,
      documentKind: proposal.documentKind,
      proceedingKind: proposal.proceedingKind,
      body,
      changes: changesShown(paragraphs, proposal.changes),
      checks: [
        // The firm's own data, once it said they are its own, are no original case's (0093).
        ...modelChecks(
          body,
          proposal.people,
          proposal.documentKind,
          firmTextsOf(paragraphs, proposal, exchangesOf(row.exchanges)),
        ),
        ...(unwritable.length > 0 ? [{ kind: "unwritable" as const, characters: unwritable }] : []),
      ],
      notes: proposal.notes,
    };
  }
  // A state that holds what ONE prepared and holds nothing readable is said as a failure, never shown empty.
  const broken = PREPARED.includes(status) && !proposal && status !== "saved";
  return {
    id: row.id,
    fileName: row.file_name,
    source: sourceOf(row.source),
    status: broken ? "failed" : status,
    failure: broken ? "answer_unusable" : row.failure,
    expected: expectedOf(row.expected_kind),
    questions: status === "asking" ? questionsOf(row.questions) : [],
    round: Math.max(Number(row.rounds ?? 0), 0),
    refusal: status === "refused" ? refusalOf(row.refusal) : null,
    heldReason: status === "ready" ? heldReasonOf(row.held_reason) : null,
    saved: status === "saved" ? saved : null,
    prepared,
  };
}

/** Whether a request owes a work that nobody holds now: the screen that waits for it asks for the work again. */
export function owesWork(
  row: Pick<ImportRow, "status" | "claimed_at">,
  workingMinutes: number,
  now = Date.now(),
): boolean {
  if (row.status !== "reading" && row.status !== "marking" && row.status !== "saving") return false;
  if (!row.claimed_at) return true;
  return now - new Date(row.claimed_at).getTime() > workingMinutes * 60_000;
}

const IMPORT_COLUMNS =
  "id, file_name, source, status, failure, expected_kind, refusal, claimed_at, requested_by, created_at";

/**
 * The firm's requests, the newest first, but the ones ONE already saved, which are models of the library now:
 * none for who does not write models. A read that fails throws.
 */
export async function readLibraryImports(
  supabase: SupabaseClient,
  firmId: string,
  names: ReadonlyMap<string, string>,
  timeZone: string | null | undefined,
): Promise<LibraryImport[]> {
  const { data, error } = await supabase
    .from("template_imports")
    .select(IMPORT_COLUMNS)
    .eq("org_id", firmId)
    .neq("status", "saved")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("the requests could not be read");
  return ((data ?? []) as ImportRow[]).map((row) => {
    const status = statusOf(row.status);
    return {
      id: row.id,
      fileName: row.file_name,
      source: sourceOf(row.source),
      status,
      failure: row.failure,
      expected: expectedOf(row.expected_kind),
      refusal: status === "refused" ? refusalOf(row.refusal) : null,
      requestedBy: row.requested_by ? names.get(row.requested_by) || null : null,
      sentLabel: momentLabel(row.created_at, timeZone),
    };
  });
}

/** The request of a paper the setup follows: the latest one sent as that paper, unless ONE already saved it. */
export type PaperImport = {
  id: string;
  fileName: string;
  status: ImportStatus;
  failure: string | null;
  refusal: ImportRefusal | null;
};

/**
 * The latest request sent as each paper a client signs (the setup's step),
 * under the person's session: none for who does not write models, and none
 * once ONE saved it (the paper is then the firm's model, which the step says).
 */
export async function readPaperImports(
  supabase: SupabaseClient,
  firmId: string,
): Promise<{ procuracao: PaperImport | null; contrato: PaperImport | null }> {
  const { data, error } = await supabase
    .from("template_imports")
    .select("id, file_name, status, failure, expected_kind, refusal, created_at")
    .eq("org_id", firmId)
    .in("expected_kind", ["procuracao", "contrato"])
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { procuracao: null, contrato: null };
  const rows = (data ?? []) as Pick<
    ImportRow,
    "id" | "file_name" | "status" | "failure" | "expected_kind" | "refusal"
  >[];
  const latest = (paper: "procuracao" | "contrato"): PaperImport | null => {
    const row = rows.find((item) => item.expected_kind === paper);
    if (!row || row.status === "saved") return null;
    const status = statusOf(row.status);
    return {
      id: row.id,
      fileName: row.file_name,
      status,
      failure: row.failure,
      refusal: status === "refused" ? refusalOf(row.refusal) : null,
    };
  };
  return { procuracao: latest("procuracao"), contrato: latest("contrato") };
}

/** What may be sent for a model, from the setting (public): what the dialog says before anything is sent. */
export function importLimitsOf(value: unknown): ImportLimits {
  const setting = (value ?? {}) as Record<string, unknown>;
  const bytes = Number(setting.max_bytes);
  const pages = Number(setting.max_pdf_pages);
  return {
    megabytes: Number.isFinite(bytes) && bytes > 0 ? Math.floor(bytes / (1024 * 1024)) : 20,
    pages: Number.isFinite(pages) && pages > 0 ? pages : 30,
  };
}

/** How long a work may be held before another takes it, from the same setting. */
export function workingMinutesOf(value: unknown): number {
  const minutes = Number(((value ?? {}) as Record<string, unknown>).working_minutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 10;
}
