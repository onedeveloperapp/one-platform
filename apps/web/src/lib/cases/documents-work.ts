import "server-only";

import { after } from "next/server";

import { runFirmTask } from "@/lib/ai/executor";
import { checkBriefing, DOCUMENT_CHECK_TASK, isPassingFailure, processingPlan } from "@/lib/cases/document-check";
import { readQuality } from "@/lib/cases/document-quality";
import { keepQuality, measurePhoto } from "@/lib/cases/document-quality-work";
import { supabaseFileStore } from "@/lib/files/store";
import { createServiceClient } from "@flyee/auth/service";
import { takeBackFile } from "@flyee/documents/files";
import { measureFile } from "@flyee/documents/measure";
import { imagesToPdf, normalizeImage } from "@flyee/documents/normalize";
import { sendEvent } from "@flyee/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of a document of a case (migration 0024): each one a
 * client or the firm sent is claimed, a photo becomes a PDF kept beside it,
 * and the AI checks it when the document still waits for the firm and the
 * setting asks for its kind. The check's answer waits in the firm's queue;
 * nothing here accepts or refuses a document (except the answer of a task
 * that earned autonomy, applied by the database). Every step is a function
 * of the database the service role alone may call; a document claimed and
 * never recorded goes back to the line by itself, and one that failed for a
 * passing reason is tried again until the setting's attempts are spent.
 *
 * Only ids leave this file: what a client's document says is read inside the
 * work on it, never carried in a job's recorded state.
 */

/** What the work on one document needs, read while the sweep holds it (`case_document_to_process`). */
type DocumentToProcess = {
  document_id: string;
  org_id: string;
  case_id: string;
  kind: string;
  storage_path: string;
  detected_mime: string | null;
  sha256: string | null;
  person_name: string | null;
  incident: string | null;
  flight_date: string | null;
  airline: string | null;
  normalized_file_id: string | null;
  attempt: number;
  wants_check: boolean;
  /** What the rule measured of its photo where it arrived, when it did. */
  quality: unknown;
  /** The rule a photo of its kind is measured by, or null for a kind the setting does not name. */
  quality_rule: unknown;
};

/** Claims what waits (or the one document named) and answers the ids only. */
export async function claimCaseDocuments(
  service: SupabaseClient,
  limit = 10,
  documentId: string | null = null,
): Promise<string[]> {
  const { data, error } = await service.rpc("claim_case_documents", {
    target_limit: limit,
    target_document: documentId,
  });
  if (error) throw new Error(`claim_case_documents failed: ${error.message}`);
  return ((data ?? []) as { document_id: string }[]).map((row) => row.document_id);
}

/** The reduced photo the model reads: enough to read a document, far fewer tokens than a phone photo. */
const MODEL_IMAGE = { maxPixels: 1568, quality: 80 };

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

const pdfName = (documentId: string) => `documento-${documentId.slice(0, 8)}.pdf`;

export type Processed = { outcome: "done" | "failed" | "retry" | "not_held"; code: string | null };

/**
 * Processes one claimed document and records what came of it. Never throws
 * for what a file or a model did: a failure is recorded with a short code,
 * passing ones go back to the line, and the document waits for a person as
 * it always did. Throws only when the database itself could not be reached,
 * and then the claim expires and the document is taken again.
 */
export async function processClaimedDocument(service: SupabaseClient, documentId: string): Promise<Processed> {
  const { data, error } = await service.rpc("case_document_to_process", { target_document: documentId });
  if (error) throw new Error(`case_document_to_process failed: ${error.message}`);
  const row = ((data ?? []) as DocumentToProcess[])[0];
  // Not held any more (taken back after the claim expired, or recorded by another run): nothing to do.
  if (!row) return { outcome: "not_held", code: null };

  const store = supabaseFileStore(service);
  let runId: string | null = null;
  const record = async (outcome: "done" | "failed", code: string | null = null): Promise<Processed> => {
    const final = outcome === "failed" && code && isPassingFailure(code) ? "retry" : outcome;
    const { data: recorded, error: recordError } = await service.rpc("record_document_processed", {
      target_document: row.document_id,
      target_outcome: final,
      target_run: runId,
      target_code: code,
    });
    if (recordError) throw new Error(`record_document_processed failed: ${recordError.message}`);
    const answer = String((recorded as { code?: string } | null)?.code ?? final);
    return { outcome: answer === "retry" || answer === "done" || answer === "failed" ? answer : final, code };
  };

  const plan = processingPlan({ mime: row.detected_mime, wantsCheck: row.wants_check });
  const original = await store.get(row.storage_path);
  if (!original) return record("failed", "file_unreadable");

  // How well the photo can be read, as the rule measured it where it arrived. A photo nobody measured yet
  // (it came in a conversation, or a person of the firm added it) is measured now, and the measure kept
  // beside it: the firm sees it on the case, and the check below reads it.
  let quality = readQuality(row.quality);
  if (!quality && plan.normalize) {
    const photo = await measurePhoto({ mime: row.detected_mime, rule: row.quality_rule, bytes: original });
    if (photo) {
      await keepQuality(service, row.document_id, photo);
      quality = readQuality(photo);
    }
  }

  // A photo is read once into what it becomes: a PDF page for the court systems (unless an earlier
  // attempt already kept one), and a reduced JPEG for the model.
  let picture: Uint8Array | null = null;
  if (plan.normalize) {
    let pdf: Uint8Array | null = null;
    try {
      if (!row.normalized_file_id) pdf = await imagesToPdf([original]);
      if (plan.check === "image") picture = (await normalizeImage(original, MODEL_IMAGE)).jpeg;
    } catch {
      // An image the backend cannot read (a HEIC its build of sharp has no decoder for, a damaged file).
      return record("failed", "image_unreadable");
    }
    // A storage that did not answer is tried again; a PDF the purpose refuses (too large) is left to a person.
    if (pdf && (await keepNormalized(service, row, pdf)) === "unavailable")
      return record("failed", "store_unavailable");
  }

  if (plan.check) {
    const attachment =
      plan.check === "image" && picture
        ? { kind: "image" as const, mime: "image/jpeg", dataBase64: base64(picture) }
        : { kind: "document" as const, mime: "application/pdf", dataBase64: base64(original) };
    const briefing = {
      kind: row.kind,
      personName: row.person_name,
      incident: row.incident,
      airline: row.airline,
      flightDate: row.flight_date,
      quality,
    };
    const result = await runFirmTask({
      orgId: row.org_id,
      task: DOCUMENT_CHECK_TASK,
      // What is hashed for the record: the briefing and the file's own hash, never its bytes.
      input: { ...briefing, sha256: row.sha256 },
      messages: [{ role: "user", content: checkBriefing(briefing), attachments: [attachment] }],
      subject: { type: "case_document", id: row.document_id },
      // One run per attempt: the same attempt run again (a job step retried) is the same run.
      idempotencyKey: `doc:${row.document_id}:${row.sha256 ?? "sem-hash"}:${row.attempt}`.slice(0, 120),
    });
    if (result.kind === "refused") return record("failed", result.code);
    runId = result.runId;
    if (result.kind === "failed") return record("failed", result.code);
    if (result.kind === "replayed" && result.status !== "succeeded") {
      return record("failed", result.status === "running" ? "check_running" : "check_failed");
    }
    // A check that did not wait for a person (the task earned autonomy) takes effect as given. Also for a run
    // replayed after a step died between finishing it and applying it: the database applies it once.
    if (result.kind === "replayed" || !result.approvalId) {
      const { error: applyError } = await service.rpc("apply_unattended_document_check", { target_run: result.runId });
      if (applyError) throw new Error(`apply_unattended_document_check failed: ${applyError.message}`);
      // The paper ONE just decided may be the last its case waited for (0039): the jobs look at the case now.
      await sendEvent("one/case.advance", { caseId: row.case_id }).catch(() => undefined);
    }
  }
  return record("done");
}

/** The PDF made from a photo, kept under the `normalized` purpose and recorded at once. */
async function keepNormalized(
  service: SupabaseClient,
  row: DocumentToProcess,
  pdf: Uint8Array,
): Promise<"kept" | "refused" | "unavailable"> {
  const store = supabaseFileStore(service);
  const reserved = await store.reserve({
    orgId: row.org_id,
    purpose: "normalized",
    name: pdfName(row.document_id),
    mime: "application/pdf",
    bytes: pdf.byteLength,
  });
  if (!reserved.ok) return "refused";
  let kept = false;
  try {
    await store.put(reserved.storagePath, pdf, "application/pdf");
    const confirmed = await store.confirm(reserved.fileId, await measureFile(pdf));
    if (confirmed.ok) {
      const { data, error } = await service.rpc("record_document_normalized", {
        target_document: row.document_id,
        target_file: reserved.fileId,
      });
      // A database that did not answer refused nothing: the work is tried again, never closed as refused.
      if (error) throw new Error("the copy could not be recorded");
      kept = Boolean((data as { ok?: boolean } | null)?.ok);
    }
  } catch {
    // The storage or the database did not answer: whatever was written is taken back, and the work tried
    // again. Record first: when it is the answer that got lost and the copy is the document's after all,
    // the database refuses to forget it and its bytes stay.
    await takeBackFile(store, reserved.fileId, reserved.storagePath);
    return "unavailable";
  }
  if (kept) return "kept";
  // A copy of somebody's document that no document points to is never left behind.
  await takeBackFile(store, reserved.fileId, reserved.storagePath);
  return "refused";
}

/** Claims and processes what waits (or the one document named), one after the other. */
export async function processCaseDocuments(
  service: SupabaseClient,
  limit = 10,
  documentId: string | null = null,
): Promise<{ done: number; other: number }> {
  const claimed = await claimCaseDocuments(service, limit, documentId);
  let done = 0;
  let other = 0;
  for (const id of claimed) {
    const processed = await processClaimedDocument(service, id).catch(() => null);
    if (processed?.outcome === "done") done += 1;
    else other += 1;
  }
  return { done, other };
}

/**
 * A document just reached a case: the jobs process it at once. Without them
 * (a machine with no Inngest), it is processed after the response is sent,
 * so the person who sent it never waits for the model. The sweep catches
 * anything neither finished.
 */
export async function queueDocumentProcessing(documentId: string): Promise<void> {
  const sent = await sendEvent("one/case.document.received", { documentId });
  if (sent.sent) return;
  after(async () => {
    try {
      await processCaseDocuments(createServiceClient(), 1, documentId);
    } catch {
      // Still pending: the sweep takes it.
    }
  });
}
