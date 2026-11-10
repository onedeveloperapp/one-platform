import "server-only";

import { runFirmTask } from "@/lib/ai/executor";
import {
  DOCUMENT_READING_TASK,
  PREFILL_TASK,
  prefillBriefing,
  type PrefillReading,
} from "@/lib/cases/document-prefill";
import { base64, MODEL_IMAGE } from "@/lib/cases/documents-work";
import { supabaseFileStore } from "@/lib/files/store";
import { measureFile } from "@flyee/documents/measure";
import { normalizeImage } from "@flyee/documents/normalize";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of reading a document for a form (migration 0085): a file a person of the firm just sent, and
 * the backend measured, is handed to the reading's task, and its answer goes back to that person, who confirms it
 * before anything is written. The run is recorded as every run is (the task, its instructions, the model, the cost);
 * nothing here writes to a case, a person or a lawsuit.
 */

export const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export type PrefillRead = { ok: true; output: Record<string, unknown> } | { ok: false; code: string };

/** The largest file handed to a reading: what a photo or a PDF of a document is. */
const MOST_BYTES = 20 * 1024 * 1024;

type Attachment = { kind: "image" | "document"; mime: string; dataBase64: string };

/** A file's bytes as the model reads them: a photo reduced and upright, a PDF whole. Also the books' (0140). */
export async function attachmentOf(bytes: Uint8Array, mime: string): Promise<Attachment | { code: string }> {
  if (IMAGE_MIMES.includes(mime)) {
    try {
      return { kind: "image", mime: "image/jpeg", dataBase64: base64((await normalizeImage(bytes, MODEL_IMAGE)).jpeg) };
    } catch {
      // An image the backend cannot read (a HEIC its build of sharp has no decoder for, a damaged file).
      return { code: "image_unreadable" };
    }
  }
  if (mime === "application/pdf") return { kind: "document", mime: "application/pdf", dataBase64: base64(bytes) };
  return { code: "unsupported_type" };
}

/**
 * Reads the document of a child a client sent through their link before the child is in the case (0085): the
 * database said which upload it is and that the link may have one more read today (`client_link_prefill_to_read`);
 * the bytes are measured here (their type by what they are, never by their name), and the answer goes back to the
 * client to confirm. The run is the firm's and is about that upload, by which the link's reads are counted.
 */
export async function readLinkUpload(
  service: SupabaseClient,
  input: { orgId: string; documentId: string; storagePath: string },
): Promise<PrefillRead> {
  const bytes = await supabaseFileStore(service).get(input.storagePath);
  if (!bytes) return { ok: false, code: "not_uploaded" };
  if (bytes.byteLength > MOST_BYTES) return { ok: false, code: "too_large" };
  const measure = await measureFile(bytes);
  const attachment = await attachmentOf(bytes, String(measure.detectedMime ?? "").toLowerCase());
  if ("code" in attachment) return { ok: false, code: attachment.code };
  const result = await runFirmTask({
    orgId: input.orgId,
    task: DOCUMENT_READING_TASK,
    input: { reading: "identity", sha256: measure.sha256 ?? null },
    messages: [{ role: "user", content: prefillBriefing("identity"), attachments: [attachment] }],
    subject: { type: "case_document", id: input.documentId },
  });
  if (result.kind === "finished") return { ok: true, output: result.output };
  if (result.kind === "replayed") return { ok: false, code: "read_running" };
  return { ok: false, code: result.code };
}

export async function readStoredFile(
  service: SupabaseClient,
  input: { orgId: string; fileId: string; reading: PrefillReading; requestedBy: string },
): Promise<PrefillRead> {
  // The file of this firm, kept after the backend measured it: a reservation, another firm's file or one refused
  // is not read.
  const { data: file } = await service
    .from("files")
    .select("id, storage_path, detected_mime, sha256, status")
    .eq("id", input.fileId)
    .eq("org_id", input.orgId)
    .maybeSingle();
  if (!file || file.status !== "stored") return { ok: false, code: "not_found" };

  const mime = String(file.detected_mime ?? "").toLowerCase();
  if (!IMAGE_MIMES.includes(mime) && mime !== "application/pdf") return { ok: false, code: "unsupported_type" };

  const bytes = await supabaseFileStore(service).get(String(file.storage_path));
  if (!bytes) return { ok: false, code: "not_found" };
  const attachment = await attachmentOf(bytes, mime);
  if ("code" in attachment) return { ok: false, code: attachment.code };

  const result = await runFirmTask({
    orgId: input.orgId,
    task: PREFILL_TASK[input.reading],
    // What is hashed for the record: what the file was said to be and its own hash, never its bytes nor its name.
    input: { reading: input.reading, sha256: file.sha256 ?? null },
    messages: [{ role: "user", content: prefillBriefing(input.reading), attachments: [attachment] }],
    requestedBy: input.requestedBy,
    subject: { type: "file", id: input.fileId },
  });
  if (result.kind === "finished") return { ok: true, output: result.output };
  if (result.kind === "replayed") return { ok: false, code: "read_running" };
  return { ok: false, code: result.code };
}
