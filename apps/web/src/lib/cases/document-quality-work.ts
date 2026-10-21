import "server-only";

import { IMAGE_MIMES } from "@/lib/cases/document-check";
import { type PhotoProblem, readQuality } from "@/lib/cases/document-quality";
import { type ImageRecord, judgeImage, measureImage } from "@flyee/documents/quality";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of the measure of a photo (migration 0024): the photo
 * of a paper to be read is measured where it arrives, by the rule of
 * `@flyee/documents/quality`, against the limits the database gives for its
 * kind of document. A client's photo is measured on their link, so that one
 * nobody will read is said at once; a photo that came some other way (a
 * conversation, a person of the firm) is measured by the sweep. What was
 * measured is kept beside the document, once: a photo is told what it is by
 * what is on record, never by a second measure.
 *
 * Nothing here accepts or refuses a document, and nothing of a photo leaves
 * this file but its measure.
 */

/** Whether a file is a photo the rule measures, by what its bytes are. */
export const isPhoto = (mime: string | null | undefined): boolean =>
  IMAGE_MIMES.includes(String(mime ?? "").toLowerCase());

/**
 * The rule the photo of a document of a kind is measured by, or null for a
 * kind the setting does not name and while the setting does not hold every
 * limit. The database is the one place that says which kinds are measured
 * (`document_quality_rule`).
 */
export async function qualityRuleOf(service: SupabaseClient, kind: string): Promise<unknown> {
  try {
    const { data, error } = await service.rpc("document_quality_rule", { target_kind: kind });
    // A rule that could not be read judges nothing: the photo goes on, and the sweep measures it.
    return error ? null : (data ?? null);
  } catch {
    return null;
  }
}

/**
 * Measures a photo against the rule of its kind: what is kept of it. Null
 * when there is nothing to say of it: the file is no photo, its kind has no
 * rule, or this build reads no image of its format (a HEIC with no decoder):
 * what was not measured is never called good or bad.
 */
export async function measurePhoto(input: {
  mime: string | null | undefined;
  rule: unknown;
  bytes: Uint8Array;
}): Promise<ImageRecord | null> {
  if (!isPhoto(input.mime) || input.rule === null || input.rule === undefined) return null;
  const measure = await measureImage(input.bytes);
  return measure ? judgeImage(measure, input.rule) : null;
}

/**
 * What became of a measure handed to the database: `kept`, `already` when the
 * document had one (another request measured the same photo first: what is on
 * record stands), or `failed`.
 */
export type KeptQuality = "kept" | "already" | "failed";

/**
 * Keeps what was measured beside its document. Never throws: a measure that
 * could not be kept is taken again by the sweep, which measures every photo
 * that has none.
 */
export async function keepQuality(
  service: SupabaseClient,
  documentId: string,
  record: ImageRecord,
): Promise<KeptQuality> {
  try {
    const { data, error } = await service.rpc("record_document_quality", {
      target_document: documentId,
      target_quality: record,
    });
    if (error) return "failed";
    const answer = (data ?? {}) as { ok?: boolean; code?: string };
    if (answer.ok) return "kept";
    return answer.code === "already_measured" ? "already" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Records that a client, told their photo is hard to read, sends it all the
 * same: only of a photo still theirs to send whose measure on record has
 * something against it (the database checks both). Never throws.
 */
export async function keepInsisted(service: SupabaseClient, documentId: string): Promise<boolean> {
  try {
    const { data, error } = await service.rpc("record_document_insisted", { target_document: documentId });
    return !error && Boolean((data as { ok?: boolean } | null)?.ok);
  } catch {
    return false;
  }
}

/**
 * What a link says of the photo it was handed, before the file is kept:
 * `poor` (the client is asked for another, with what is wrong with this one),
 * `failed` (it could not be put on record that the client sends it all the
 * same, so it is not sent as if they had), `nothing` (the file goes on), or
 * `again` (another request measured this photo first: what is on record now
 * is to be read, and the question asked of it).
 */
export type ArrivedPhoto =
  | { say: "poor"; problems: PhotoProblem[] }
  | { say: "failed" }
  | { say: "nothing" }
  | { say: "again" };

/**
 * A client's photo where it arrives. It is measured once, and what was
 * measured is on record before anybody is told: every later request answers
 * from the record. So a photo is sent "all the same" (`insist`) only by a
 * client the record says was told, whatever the request asks, and what the
 * firm then reads of it is true.
 *
 * A measure that could not be kept is told to nobody (the client could never
 * send the photo then): the file goes on, and the sweep measures it for the
 * firm. A measure another request kept first is not this one's to tell
 * either: the record is (`again`).
 */
export async function judgeArrivedPhoto(
  service: SupabaseClient,
  input: {
    documentId: string;
    kind: string;
    /** What is on record of this photo (`case_documents.quality`). */
    quality: unknown;
    insist: boolean;
    mime: string | null | undefined;
    bytes: Uint8Array;
  },
): Promise<ArrivedPhoto> {
  const told = readQuality(input.quality);
  if (!told) {
    const photo = await measurePhoto({
      mime: input.mime,
      rule: await qualityRuleOf(service, input.kind),
      bytes: input.bytes,
    });
    if (!photo) return { say: "nothing" };
    const kept = await keepQuality(service, input.documentId, photo);
    if (kept === "already") return { say: "again" };
    return kept === "kept" && photo.problems.length > 0
      ? { say: "poor", problems: photo.problems }
      : { say: "nothing" };
  }
  if (told.problems.length === 0) return { say: "nothing" };
  if (!input.insist) return { say: "poor", problems: told.problems };
  return (await keepInsisted(service, input.documentId)) ? { say: "nothing" } : { say: "failed" };
}
