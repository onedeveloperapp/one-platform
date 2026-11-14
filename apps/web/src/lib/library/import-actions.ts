"use server";

import { revalidatePath } from "next/cache";

import { isModelDocument, type ModelDocument } from "@/lib/cases/drafts";
import { discardUpload, finishUpload, startUpload } from "@/lib/files/uploads";
import { readFirmRecord } from "@/lib/library/firm-record";
import {
  IMPORT_VIEW_COLUMNS,
  type ImportRow,
  importView,
  owesWork,
  type SavedModel,
  type TemplateImportView,
  workingMinutesOf,
} from "@/lib/library/import-read";
import { queueTemplateImport } from "@/lib/library/import-work";
import { firmRecordTexts, IMPORT_WORKING, type ImportStatus, isOtherTextFormat } from "@/lib/library/imports";
import { getMemberContext } from "@/lib/member/context";
import { isSupportVisit } from "@/lib/whatsapp/session";

/**
 * What a partner or a lawyer does to have the firm's own model made from a
 * document the firm already uses (migrations 0067 and 0079): send the file
 * (straight from the browser to storage, as every file of a firm), say what
 * it is sent as (the setup's step of a paper sends its power of attorney or
 * its contract), read what ONE does with it while it does it, answer what ONE
 * asks, and give it up. ONE saves the model by itself where the firm lets
 * it; otherwise a person saves it through the library's own action
 * (`saveDraftTemplate` with the request), which closes the request. Every
 * write is a function of the database, which decides who may.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const RAISED = ["not_allowed_in_support_session", "not_authorized"] as const;
const raised = (message: string | null | undefined): string =>
  RAISED.find((code) => (message ?? "").includes(code)) ?? "failed";

const refresh = () => {
  revalidatePath("/biblioteca");
  revalidatePath("/configurar");
};

export type ModelSourceStart =
  | { ok: true; fileId: string; storagePath: string; uploadToken: string }
  | { ok: false; code: string };

/** The first half of a document sent for a model: the reservation and the address to send the bytes to. */
export async function startModelSource(input: {
  name: string;
  mime: string;
  bytes: number;
}): Promise<ModelSourceStart> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_allowed" };
  const name = String(input?.name ?? "").slice(0, 200);
  // A text in another format is said before anything is sent: the backend would refuse it by its bytes anyway.
  if (isOtherTextFormat(name)) return { ok: false, code: "type_not_allowed" };
  const started = await startUpload(context, {
    purpose: "model_source",
    name,
    mime: String(input?.mime ?? ""),
    bytes: Number(input?.bytes ?? 0),
  });
  if (!started.ok) return { ok: false, code: started.code };
  return { ok: true, fileId: started.fileId, storagePath: started.storagePath, uploadToken: started.uploadToken };
}

export type ModelRequest = { ok: true; importId: string } | { ok: false; code: string; most?: number };

/**
 * The second half: the backend measures what arrived, and ONE is asked for the model, of what the document was
 * sent as (`expected`; ONE refuses another thing) and, for a paper, to take the place of the firm's default of it.
 */
export async function requestModelFromDocument(
  fileId: string,
  options: { expected?: ModelDocument | null; makeDefault?: boolean } = {},
): Promise<ModelRequest> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(fileId)) return { ok: false, code: "not_found" };
  // ONE makes a model of a petition, a power of attorney or a contract (0079); a declaration is written in the library.
  const expected =
    isModelDocument(options?.expected) &&
    options.expected !== "declaracao_residencia" &&
    options.expected !== "declaracao_hipossuficiencia"
      ? options.expected
      : null;
  const finished = await finishUpload(context, fileId);
  if (!finished.ok) return { ok: false, code: finished.code };
  const { data, error } = await context.supabase.rpc("request_template_import", {
    target_org: context.firm.id,
    target_file: fileId,
    target_expected: expected,
    target_default: expected !== null && options?.makeDefault === true,
  });
  const answer = (data ?? {}) as { ok?: boolean; code?: string; import_id?: unknown; most?: unknown };
  if (!error && answer.ok && isId(answer.import_id)) {
    await queueTemplateImport(answer.import_id);
    refresh();
    return { ok: true, importId: answer.import_id };
  }
  // A document this request has just measured and that ONE was not asked for is taken back, never left where
  // nobody sees it. One that was already kept is somebody else's to decide.
  if (finished.measured && !(await isSupportVisit())) await discardUpload(context, fileId, "model_source");
  return {
    ok: false,
    code: error ? raised(error.message) : String(answer.code ?? "failed"),
    ...(typeof answer.most === "number" ? { most: answer.most } : {}),
  };
}

/**
 * A request as the dialog reads it while ONE prepares the model, and once it
 * did. A work it owes that nobody holds (the jobs did not take it, or a
 * worker stopped) is asked for again: each look is a request of its own, so
 * the next work has a request's whole time.
 */
export async function readModelFromDocument(
  importId: string,
): Promise<{ ok: true; view: TemplateImportView } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(importId)) return { ok: false, code: "not_found" };
  const [row, setting] = await Promise.all([
    context.supabase
      .from("template_imports")
      .select(IMPORT_VIEW_COLUMNS)
      .eq("id", importId)
      .eq("org_id", context.firm.id)
      .maybeSingle(),
    context.supabase.from("platform_settings").select("value").eq("key", "template_imports").maybeSingle(),
  ]);
  if (row.error) return { ok: false, code: "failed" };
  if (!row.data) return { ok: false, code: "not_found" };
  const found = row.data as ImportRow;
  if (owesWork(found, workingMinutesOf(setting.data?.value))) await queueTemplateImport(found.id);
  // The model ONE saved, read beside the request: the dialog edits it from then on.
  let saved: SavedModel | null = null;
  if (found.status === "saved" && found.saved_template_id && isId(found.saved_template_id)) {
    const { data: template } = await context.supabase
      .from("draft_templates")
      .select("id, name, document_kind, proceeding_kind, problem, piece_kind, is_default, body")
      .eq("id", found.saved_template_id)
      .eq("org_id", context.firm.id)
      .maybeSingle();
    if (template && isModelDocument(template.document_kind)) {
      saved = {
        templateId: String(template.id),
        name: String(template.name ?? ""),
        documentKind: template.document_kind,
        proceedingKind:
          template.proceeding_kind === "juizado" || template.proceeding_kind === "comum"
            ? template.proceeding_kind
            : null,
        problem: typeof template.problem === "string" ? template.problem : null,
        pieceKind: typeof template.piece_kind === "string" ? template.piece_kind : null,
        isDefault: template.is_default === true,
        body: String(template.body ?? ""),
      };
    }
  }
  // What the firm's record writes is the firm's own, as ONE's check took it (0244).
  const record = ["saving", "ready", "saved"].includes(found.status)
    ? await readFirmRecord(context.supabase, context.firm.id)
    : null;
  return { ok: true, view: importView(found, saved, firmRecordTexts(record)) };
}

/** The longest answer, as the setting says it: the dialog counts it before anything is sent. */
const MOST_ANSWER = 1000;

/**
 * A partner or a lawyer answers what ONE asked of a document, one answer per question in their order (a blank one
 * keeps the document as it is): ONE goes on with the model at once.
 */
export async function answerModelQuestions(
  importId: string,
  answers: string[],
): Promise<{ ok: true } | { ok: false; code: string; most?: number }> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(importId)) return { ok: false, code: "not_found" };
  const given = (Array.isArray(answers) ? answers : []).map((answer) => String(answer ?? "").slice(0, MOST_ANSWER + 1));
  const { data, error } = await context.supabase.rpc("answer_template_import", {
    target_import: importId,
    target_answers: given,
  });
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; most?: unknown };
  if (!answer.ok) {
    return {
      ok: false,
      code: String(answer.code ?? "failed"),
      ...(typeof answer.most === "number" ? { most: answer.most } : {}),
    };
  }
  await queueTemplateImport(importId);
  refresh();
  return { ok: true };
}

/**
 * The firm's requests ONE is still preparing, as the library watches them:
 * their states, and the work nobody holds asked for again.
 */
export async function watchModelImports(): Promise<
  { ok: true; pending: { id: string; status: ImportStatus }[] } | { ok: false }
> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false };
  const [rows, setting] = await Promise.all([
    context.supabase
      .from("template_imports")
      .select("id, status, claimed_at")
      .eq("org_id", context.firm.id)
      .in("status", [...IMPORT_WORKING]),
    context.supabase.from("platform_settings").select("value").eq("key", "template_imports").maybeSingle(),
  ]);
  if (rows.error) return { ok: false };
  const minutes = workingMinutesOf(setting.data?.value);
  const pending = (rows.data ?? []) as { id: string; status: ImportStatus; claimed_at: string | null }[];
  for (const row of pending) {
    if (owesWork(row, minutes)) await queueTemplateImport(row.id);
  }
  return { ok: true, pending: pending.map((row) => ({ id: row.id, status: row.status })) };
}

/** A partner or a lawyer gives up what ONE prepares or prepared: the request goes, with what was read. */
export async function dismissModelFromDocument(importId: string): Promise<{ ok: true } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(importId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("dismiss_template_import", { target_import: importId });
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  refresh();
  return { ok: true };
}
