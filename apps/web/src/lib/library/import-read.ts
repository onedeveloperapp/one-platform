import "server-only";

import { momentLabel } from "@/lib/ai/approvals";
import type { ModelDocument } from "@/lib/cases/drafts";
import {
  type ChangeShown,
  changesShown,
  composeModel,
  IMPORT_STATUSES,
  type ImportSource,
  type ImportStatus,
  type ModelCheck,
  modelChecks,
  paragraphsOf,
  proposalOf,
} from "@/lib/library/imports";
import { unwritableCharacters } from "@flyee/documents/text-pdf";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the screens read of a model made from a document (migration 0067),
 * under the person's own session: row-level security shows a request to who
 * writes the firm's models only. The model is written here from the
 * paragraphs and the changes the database kept, with what changed and what a
 * lawyer should check, on the server, where the writer of the PDF is.
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

export type TemplateImportView = {
  id: string;
  fileName: string;
  source: ImportSource;
  status: ImportStatus;
  failure: string | null;
  prepared: PreparedModel | null;
};

/** A request as the library lists it. */
export type LibraryImport = {
  id: string;
  fileName: string;
  source: ImportSource;
  status: ImportStatus;
  failure: string | null;
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
  paragraphs?: unknown;
  proposal?: unknown;
  claimed_at?: string | null;
  requested_by?: string | null;
  created_at: string;
};

const statusOf = (value: string): ImportStatus =>
  (IMPORT_STATUSES as readonly string[]).includes(value) ? (value as ImportStatus) : "failed";
const sourceOf = (value: string): ImportSource => (value === "pdf" ? "pdf" : "docx");

/** A request as the dialog reads it: the model ONE prepared, written whole, once it is ready. */
export function importView(row: ImportRow): TemplateImportView {
  const status = statusOf(row.status);
  const proposal = status === "ready" ? proposalOf(row.proposal) : null;
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
        ...modelChecks(body, proposal.people, proposal.documentKind),
        ...(unwritable.length > 0 ? [{ kind: "unwritable" as const, characters: unwritable }] : []),
      ],
      notes: proposal.notes,
    };
  }
  return {
    id: row.id,
    fileName: row.file_name,
    source: sourceOf(row.source),
    status: proposal || status !== "ready" ? status : "failed",
    failure: status === "ready" && !proposal ? "answer_unusable" : row.failure,
    prepared,
  };
}

/** Whether a request owes a work that nobody holds now: the screen that waits for it asks for the work again. */
export function owesWork(
  row: Pick<ImportRow, "status" | "claimed_at">,
  workingMinutes: number,
  now = Date.now(),
): boolean {
  if (row.status !== "reading" && row.status !== "marking") return false;
  if (!row.claimed_at) return true;
  return now - new Date(row.claimed_at).getTime() > workingMinutes * 60_000;
}

const IMPORT_COLUMNS = "id, file_name, source, status, failure, claimed_at, requested_by, created_at";

/** The firm's requests, the newest first: none for who does not write models. A read that fails throws. */
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
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("the requests could not be read");
  return ((data ?? []) as ImportRow[]).map((row) => ({
    id: row.id,
    fileName: row.file_name,
    source: sourceOf(row.source),
    status: statusOf(row.status),
    failure: row.failure,
    requestedBy: row.requested_by ? names.get(row.requested_by) || null : null,
    sentLabel: momentLabel(row.created_at, timeZone),
  }));
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
