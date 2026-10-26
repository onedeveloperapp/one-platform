"use server";

import { revalidatePath } from "next/cache";

import { queueCaseAdvance } from "@/lib/cases/advance-work";
import { isModelDocument, type ModelDocument, sourceFromCitation } from "@/lib/cases/drafts";
import { getMemberContext } from "@/lib/member/context";

/**
 * What a partner or a lawyer does with the firm's verified library and its
 * models of pieces (migration 0029). A source enters the library the way a
 * lawyer cites it ("art. 14 do CDC", "Súmula 387 do STJ"): the same
 * reader that reads a piece reads what was typed, so an entry always has the
 * key its citations are read into. Every write is a function of the
 * database, which decides who may.
 */

export type LibraryResult<T extends object = object> =
  | ({ ok: true; code: string } & T)
  | { ok: false; code: string; field?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const RAISED = ["not_allowed_in_support_session", "not_authorized"] as const;
const raised = (message: string | null | undefined): string =>
  RAISED.find((code) => (message ?? "").includes(code)) ?? "failed";

type RpcAnswer = { ok?: boolean; code?: string; field?: string | null } & Record<string, unknown>;

function fold<T extends object>(
  data: unknown,
  error: { message: string } | null,
  pick: (answer: RpcAnswer) => T,
): LibraryResult<T> {
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as RpcAnswer;
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed"), field: answer.field ?? null };
  return { ok: true, code: String(answer.code ?? "saved"), ...pick(answer) };
}

const NUL = String.fromCharCode(0);
const clean = (text: unknown, most: number): string =>
  String(text ?? "")
    .split(NUL)
    .join("")
    .replace(/\p{Cs}/gu, "")
    .slice(0, most);

const refresh = () => {
  revalidatePath("/biblioteca");
};

/**
 * A lawyer adds a source they checked. `citation` is the source as they
 * would write it in a piece; `sourceId` changes what the firm wrote about
 * one already there (what the source is does not change).
 */
export async function saveLegalSource(input: {
  sourceId?: string | null;
  citation?: string;
  title: string;
  sourceUrl: string;
  quote?: string | null;
  note?: string | null;
}): Promise<LibraryResult<{ sourceId: string }>> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const fields: Record<string, unknown> = {
    title: clean(input.title, 300).trim(),
    source_url: clean(input.sourceUrl, 500).trim(),
    quote: clean(input.quote, 6000).trim() || null,
    note: clean(input.note, 1000).trim() || null,
  };
  let sourceId: string | null = null;
  if (input.sourceId) {
    if (!isId(input.sourceId)) return { ok: false, code: "not_found" };
    sourceId = input.sourceId;
  } else {
    const read = sourceFromCitation(clean(input.citation, 300));
    if (!read.ok) return { ok: false, code: read.code, field: "citation" };
    Object.assign(fields, read.source);
  }
  const { data, error } = await context.supabase.rpc("save_legal_source", {
    target_org: context.firm.id,
    target_source: sourceId,
    fields,
  });
  const result = fold(data, error, (answer) => ({ sourceId: String(answer.source_id ?? "") }));
  if (result.ok) refresh();
  return result;
}

/** A lawyer retires a source, with the reason: a draft that cites it stops being approvable. */
export async function retireLegalSource(input: { sourceId: string; reason: string }): Promise<LibraryResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.sourceId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("retire_legal_source", {
    target_source: input.sourceId,
    target_reason: clean(input.reason, 500).trim(),
  });
  const result = fold(data, error, () => ({}));
  if (result.ok) refresh();
  return result;
}

/** A lawyer writes a model of the firm, or changes one: of a piece, or of a paper ONE sends clients to sign (0054). */
export async function saveDraftTemplate(input: {
  templateId?: string | null;
  name: string;
  /** What the model writes; a piece when not said. */
  documentKind?: ModelDocument;
  proceedingKind: "juizado" | "comum" | null;
  /** The model ONE writes the pieces of its kind from: the one before stops being it. */
  isDefault: boolean;
  body: string;
}): Promise<LibraryResult<{ templateId: string }>> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (input.templateId && !isId(input.templateId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("save_draft_template", {
    target_org: context.firm.id,
    target_template: input.templateId ?? null,
    fields: {
      name: clean(input.name, 120).trim(),
      document_kind: isModelDocument(input.documentKind) ? input.documentKind : "piece",
      proceeding_kind:
        input.proceedingKind === "juizado" || input.proceedingKind === "comum" ? input.proceedingKind : null,
      is_default: input.isDefault === true,
      body: clean(input.body, 250_000),
    },
  });
  const result = fold(data, error, (answer) => ({ templateId: String(answer.template_id ?? "") }));
  if (result.ok) {
    refresh();
    // A default model may be what ONE waited for to ask for a piece (0039).
    await queueCaseAdvance(null);
  }
  return result;
}

/** A lawyer removes a model. The pieces written from it keep their own text. */
export async function removeDraftTemplate(templateId: string): Promise<LibraryResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(templateId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("remove_draft_template", { target_template: templateId });
  const result = fold(data, error, () => ({}));
  if (result.ok) refresh();
  return result;
}

/**
 * The text of a model, read when a person opens it: a list never reads every text whole. A model of the
 * platform (0045) is read too, to be copied into one of the firm's.
 */
export async function readDraftTemplate(
  templateId: string,
): Promise<{ ok: true; body: string; isDefault: boolean } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(templateId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase
    .from("draft_templates")
    .select("id, body, is_default")
    .eq("id", templateId)
    .or(`org_id.eq.${context.firm.id},org_id.is.null`)
    .maybeSingle();
  if (error) return { ok: false, code: "failed" };
  if (!data) return { ok: false, code: "not_found" };
  // Whether it is the default now, read with its text: a colleague may have changed it since the list was read.
  return { ok: true, body: String(data.body ?? ""), isDefault: data.is_default === true };
}
