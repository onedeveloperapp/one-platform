"use server";

import { revalidatePath } from "next/cache";

import { isDjenCaptureOn } from "@/lib/courts/djen";
import { settleDeadlineCounts } from "@/lib/deadlines/count-work";
import { getMemberContext } from "@/lib/member/context";
import { settleFirmNotices } from "@/lib/notices/work";
import { queueFirmCapture } from "@/lib/publications/capture";
import {
  findPublications,
  type PublicationProgress,
  publicationProgress,
  type PublicationRow,
} from "@/lib/publications/facts";
import { isPublicationCategory, plainText, PUBLICATIONS_SHOWN, searchedCnj } from "@/lib/publications/publications";
import { type ReadingKind, readingKindOf } from "@/lib/publications/reading-words";
import { queuePublicationReading, readingReadyKinds } from "@/lib/publications/reading-work";
import { createServiceClient } from "@flyee/auth/service";
import { judgmentOf } from "@flyee/rules/judgment";

/**
 * What a person of the firm does with what the courts publish (migration
 * 0028): say what a publication is, say they saw that a court cancelled
 * one, read the whole of one, find the ones of a case number, and ask for a
 * reading of the DJEN now. Every write is a function of the database, which
 * decides who may; these actions carry the request and turn the answer into
 * a code the screen has words for.
 */

export type PublicationResult<T extends object = object> =
  | ({ ok: true; code: string } & T)
  | { ok: false; code: string; field?: string | null; minutes?: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const KNOWN_ERRORS = ["not_allowed_in_support_session", "not_authorized"] as const;
const raised = (message: string | null | undefined): string =>
  KNOWN_ERRORS.find((code) => (message ?? "").includes(code)) ?? "failed";

type RpcAnswer = { ok?: boolean; code?: string; field?: string | null; minutes?: number } & Record<string, unknown>;

function fold(data: unknown, error: { message: string } | null): PublicationResult {
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as RpcAnswer;
  if (!answer.ok) {
    return {
      ok: false,
      code: String(answer.code ?? "failed"),
      field: answer.field ?? null,
      ...(typeof answer.minutes === "number" ? { minutes: answer.minutes } : {}),
    };
  }
  return { ok: true, code: String(answer.code ?? "saved") };
}

/** What every list of publications is read again after: the screen itself and the home's counts. */
function refresh() {
  revalidatePath("/publicacoes");
  revalidatePath("/inicio");
}

/**
 * A person says what a publication is, with a note when one helps whoever
 * reads it next. A publication triaged as a deadline or a hearing, of a firm
 * that lets ONE read it, is read at once (migration 0040) where a model can
 * read that kind here: the answer says so, and the screen says ONE is
 * reading instead of opening the form. Where none can, the form opens as
 * before.
 */
export async function triagePublication(input: {
  publicationId: string;
  category: string;
  note?: string | null;
}): Promise<PublicationResult<{ reading?: ReadingKind | null; judgment?: boolean | null }>> {
  const context = await getMemberContext();
  // No session, or no firm: nothing here is this person's to do, and the screen says to try again.
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isId(input?.publicationId)) return { ok: false, code: "not_found" };
  if (!isPublicationCategory(input.category)) return { ok: false, code: "invalid_category", field: "category" };
  const { data, error } = await context.supabase.rpc("triage_publication", {
    target_publication: input.publicationId,
    target_category: input.category,
    target_note: typeof input.note === "string" ? input.note.slice(0, 1000) : null,
  });
  const result = fold(data, error);
  if (!result.ok) return result;
  refresh();
  // A payment warns the client against the scam: a test case's at once, a real case's after its minutes (0103).
  if (input.category === "pagamento") await settleFirmNotices(context.firm.id);
  // A decision: whether it is the lawsuit's judgment is read from its own words, and the person is asked only when
  // they say nothing clear (the owner, 2026-11-05; migration 0096).
  if (input.category === "decisao") {
    const judgment = await judgeDecision(context.supabase, input.publicationId);
    // A judgment proposes the terms the law gives it (0141): counted right after, so its day shows at once.
    if (judgment === true) settleDeadlineCounts();
    return { ...result, reading: null, judgment };
  }
  const kind = readingKindOf(input.category);
  if (!kind) return { ...result, reading: null };
  // Whether ONE owes it a reading is the database's word: the firm's choice and the publication's lawsuit decide.
  const { data: due } = await context.supabase
    .from("publication_readings")
    .select("kind")
    .eq("publication_id", input.publicationId)
    .eq("kind", kind)
    .eq("status", "due")
    .maybeSingle();
  if (!due) return { ...result, reading: null };
  let ready = false;
  try {
    ready = (await readingReadyKinds(createServiceClient())).includes(kind);
  } catch {
    ready = false;
  }
  if (!ready) return { ...result, reading: null };
  try {
    await queuePublicationReading(input.publicationId);
  } catch {
    // The sweep reads it.
  }
  return { ...result, reading: kind };
}

/**
 * Whether a publication a person just triaged as a decision is the lawsuit's judgment, by its type and its words
 * (`@flyee/rules/judgment`): what they say clearly is kept as the rule's (never over a word somebody already said),
 * and null is answered when they say nothing clear, for the screen to ask the person. A database without the word on
 * the judgment answers true, as every decision judged the case before.
 */
async function judgeDecision(
  supabase: NonNullable<Awaited<ReturnType<typeof getMemberContext>>>["supabase"],
  publicationId: string,
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("publications")
    .select("body, document_type, judgment, judgment_source")
    .eq("id", publicationId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    body: string;
    document_type: string | null;
    judgment: boolean | null;
    judgment_source: string | null;
  };
  if (row.judgment_source) return row.judgment;
  const reading = judgmentOf({ documentType: row.document_type, text: row.body });
  if (reading === null) return null;
  const saved = await supabase.rpc("set_publication_judgment", {
    target_publication: publicationId,
    target_judgment: reading,
    target_source: "rule",
  });
  return saved.error ? null : reading;
}

/**
 * A person says whether a decision the court published is the lawsuit's judgment: asked when its words do not say
 * it clearly, on the publication's card and on its case. Their word corrects the rule's.
 */
export async function setPublicationJudgment(publicationId: string, judgment: boolean): Promise<PublicationResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isId(publicationId) || typeof judgment !== "boolean") return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("set_publication_judgment", {
    target_publication: publicationId,
    target_judgment: judgment,
    target_source: "person",
  });
  const result = fold(data, error);
  if (result.ok) {
    refresh();
    revalidatePath("/casos");
    // A judgment proposes the terms the law gives it (0141): counted right after, so their day shows at once.
    if (judgment) settleDeadlineCounts();
  }
  return result;
}

/**
 * What ONE recorded of some publications since the screen read them, asked
 * for every few seconds while ONE reads them: what it read, and the
 * deadlines and hearings that came from them. Under the person's own
 * session.
 */
export async function readPublicationProgress(
  publicationIds: string[],
  askedAt: number,
): Promise<PublicationResult<{ progress: Record<string, PublicationProgress> }>> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const ids = [...new Set((Array.isArray(publicationIds) ? publicationIds : []).filter(isId))].slice(
    0,
    PUBLICATIONS_SHOWN,
  );
  if (ids.length === 0) return { ok: true, code: "read", progress: {} };
  // The screen's own clock: what the answer is compared with is the moment the same screen saved a triage.
  const readAt = Number.isFinite(askedAt) ? askedAt : 0;
  try {
    return {
      ok: true,
      code: "read",
      progress: await publicationProgress(context.supabase, context.firm.id, ids, readAt),
    };
  } catch {
    return { ok: false, code: "failed" };
  }
}

/**
 * Who writes hearings says the hearing a publication set needs nothing more
 * in the agenda (migration 0037): it is there already, written some other
 * way, or the publication moved or cancelled one that is. The publication
 * leaves the watch of `/agenda`.
 */
export async function settlePublicationHearing(publicationId: string): Promise<PublicationResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isId(publicationId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("settle_publication_hearing", {
    target_publication: publicationId,
  });
  const result = fold(data, error);
  // Settled, or no longer a publication that asks for a hearing: the lists are read again either way.
  if (result.ok || result.code === "cancelled" || result.code === "invalid_category") {
    refresh();
    revalidatePath("/agenda");
  }
  return result;
}

/**
 * A partner says whether the AI's word may be the firm's triage in the
 * categories the platform let out of the shadow (migration 0035).
 */
export async function setFirmAiTriage(enabled: boolean): Promise<PublicationResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("set_firm_publication_ai_triage", {
    target_org: context.firm.id,
    target_enabled: Boolean(enabled),
  });
  const result = fold(data, error);
  if (result.ok) refresh();
  return result;
}

/** A person says they saw that a court cancelled a publication somebody had triaged. */
export async function acknowledgePublicationCancel(publicationId: string): Promise<PublicationResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isId(publicationId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("acknowledge_publication_cancel", {
    target_publication: publicationId,
  });
  const result = fold(data, error);
  if (result.ok) refresh();
  return result;
}

/**
 * A person says they are aware of the triage ONE made of a publication (migration 0104): the lawyer it was addressed
 * to, or anybody of the firm who triages. To say ONE got it wrong, the person triages it themselves.
 */
export async function acknowledgePublication(
  publicationId: string,
  caseId: string | null = null,
): Promise<PublicationResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isId(publicationId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("acknowledge_publication", { target_publication: publicationId });
  const result = fold(data, error);
  if (result.ok) {
    refresh();
    if (isId(caseId)) revalidatePath(`/casos/${caseId}`);
  }
  return result;
}

/**
 * The whole text of a publication, as plain text, read under the person's
 * own session: one of another firm is not found.
 */
export async function readPublication(
  publicationId: string,
): Promise<{ ok: true; text: string; truncated: boolean } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isId(publicationId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase
    .from("publications")
    .select("id, body, truncated")
    .eq("id", publicationId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  if (error) return { ok: false, code: "failed" };
  if (!data) return { ok: false, code: "not_found" };
  return { ok: true, text: plainText(String(data.body ?? "")), truncated: Boolean(data.truncated) };
}

/**
 * The publications of a case number, wherever they are. The number comes in
 * the request and never in an address: a case number in a URL ends up in
 * logs.
 */
export async function searchPublications(
  typed: string,
): Promise<{ ok: true; rows: PublicationRow[]; more: boolean } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const digits = searchedCnj(typed);
  if (!digits) return { ok: false, code: "invalid_search" };
  try {
    const found = await findPublications(context.supabase, context.firm.id, digits, context.profile.timezone);
    return { ok: true, rows: found.rows, more: found.more };
  } catch {
    return { ok: false, code: "failed" };
  }
}

/**
 * A person asks for a reading of the DJEN now. The database decides whether
 * it may happen (who asks, and how long ago the firm was last read); where
 * this environment does not read the DJEN, the answer says so instead of
 * promising a reading nobody will make.
 */
export async function requestPublicationsCapture(): Promise<PublicationResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  if (!isDjenCaptureOn()) return { ok: false, code: "capture_off" };
  const { data, error } = await context.supabase.rpc("request_djen_capture", { target_org: context.firm.id });
  const result = fold(data, error);
  if (result.ok) {
    revalidatePath("/publicacoes");
    await queueFirmCapture(context.firm.id);
  }
  return result;
}
