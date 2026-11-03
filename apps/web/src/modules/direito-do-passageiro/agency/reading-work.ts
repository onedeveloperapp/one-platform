import "server-only";

import { after } from "next/server";

import { runFirmTask } from "@/lib/ai/executor";
import { base64, MODEL_IMAGE } from "@/lib/cases/documents-work";
import { supabaseFileStore } from "@/lib/files/store";
import type { PaxDocumentKind } from "@/modules/direito-do-passageiro/agency/passengers";
import { createServiceClient } from "@flyee/auth/service";
import { normalizeImage } from "@flyee/documents/normalize";
import { sendEvent } from "@flyee/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of a document an agency or its passenger sent (migration 0070): each one is claimed under a
 * number, the AI reads it (task `parceiro.documento.leitura`, a shadow task: the firm never reads its runs) and the
 * database takes the answer from the run, never from this worker, writing what it says of the passenger where
 * their record has nothing. Nothing here decides anything about the passenger or the trip.
 *
 * The run is the firm's (the partnership's firm pays for it, as the plan the owner approved says), and only ids
 * leave this file: what a passenger's document says is read inside the work on it.
 */

export const PAX_READING_TASK = "parceiro.documento.leitura";

/** What the model is told the document was said to be, in its own language. */
const KIND_FOR_MODEL: Record<PaxDocumentKind, string> = {
  identity: "documento de identidade com foto (RG, CNH, passaporte ou outro documento oficial)",
  address_proof: "comprovante de endereço (conta de água, luz, telefone, internet, banco ou contrato de aluguel)",
  ticket:
    "bilhete ou confirmação de reserva da passagem aérea, que pode vir como print de tela do aplicativo, do site ou do e-mail, ou como foto do documento impresso",
  boarding_pass: "cartão de embarque, que pode vir como print de tela ou como foto do cartão impresso",
};

const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/** What fails for a moment and is tried again, never counted as the document's fault. */
const PASSING = ["provider_unavailable", "store_unavailable", "run_already_closed", "read_running", "file_unreadable"];

type ToRead = {
  document_id: string;
  org_id: string;
  kind: PaxDocumentKind;
  storage_path: string;
  detected_mime: string | null;
  sha256: string | null;
  traveler_name: string | null;
  attempt: number;
};

/** The briefing the model reads beside the file: what it was said to be, and whose. */
export function readingBriefing(kind: PaxDocumentKind, travelerName: string | null): string {
  return [
    `Tipo de documento que foi dito: ${KIND_FOR_MODEL[kind] ?? kind}.`,
    `Nome do passageiro a quem ele pertence: ${travelerName?.trim() || "não informado"}.`,
  ].join("\n");
}

export type Claim = { documentId: string; claim: number };

export async function claimPaxReadings(
  service: SupabaseClient,
  limit = 5,
  documentId: string | null = null,
): Promise<Claim[]> {
  const { data, error } = await service.rpc("claim_pax_document_readings", {
    target_limit: limit,
    target_document: documentId,
  });
  if (error) throw new Error(`claim_pax_document_readings failed: ${error.message}`);
  return ((data ?? []) as { document_id: string; claim: number }[]).map((row) => ({
    documentId: row.document_id,
    claim: row.claim,
  }));
}

export type ReadOutcome = "done" | "retry" | "failed" | "not_held";

/**
 * Reads one claimed document and records what came of it. Never throws for what a file or a model did: a passing
 * failure goes back to the line, and the database gives a document up after the setting's attempts. Throws only
 * when the database itself could not be reached, and then the claim expires and the document is taken again.
 */
export async function readClaimedPaxDocument(service: SupabaseClient, claim: Claim): Promise<ReadOutcome> {
  const { data, error } = await service.rpc("pax_document_to_read", {
    target_document: claim.documentId,
    target_claim: claim.claim,
  });
  if (error) throw new Error(`pax_document_to_read failed: ${error.message}`);
  const row = ((data ?? []) as ToRead[])[0];
  if (!row) return "not_held";

  let runId: string | null = null;
  const record = async (outcome: "done" | "retry" | "failed", code: string | null = null): Promise<ReadOutcome> => {
    const final = outcome === "failed" && code && PASSING.includes(code) ? "retry" : outcome;
    const { data: recorded, error: recordError } = await service.rpc("record_pax_document_reading", {
      target_document: row.document_id,
      target_claim: claim.claim,
      target_run: runId,
      target_outcome: final,
      target_code: code,
    });
    if (recordError) throw new Error(`record_pax_document_reading failed: ${recordError.message}`);
    const answer = String((recorded as { code?: string } | null)?.code ?? final);
    return answer === "done" || answer === "retry" || answer === "failed" ? answer : "not_held";
  };

  const mime = (row.detected_mime ?? "").toLowerCase();
  const image = IMAGE_MIMES.includes(mime);
  if (!image && mime !== "application/pdf") return record("failed", "unsupported_type");

  const bytes = await supabaseFileStore(service).get(row.storage_path);
  if (!bytes) return record("failed", "file_unreadable");

  let attachment: { kind: "image" | "document"; mime: string; dataBase64: string };
  if (image) {
    try {
      attachment = {
        kind: "image",
        mime: "image/jpeg",
        dataBase64: base64((await normalizeImage(bytes, MODEL_IMAGE)).jpeg),
      };
    } catch {
      // An image the backend cannot read (a HEIC its build of sharp has no decoder for, a damaged file).
      return record("failed", "image_unreadable");
    }
  } else {
    attachment = { kind: "document", mime: "application/pdf", dataBase64: base64(bytes) };
  }

  const result = await runFirmTask({
    orgId: row.org_id,
    task: PAX_READING_TASK,
    // What is hashed for the record: the kind and the file's own hash, never its bytes nor the name.
    input: { kind: row.kind, sha256: row.sha256 },
    messages: [{ role: "user", content: readingBriefing(row.kind, row.traveler_name), attachments: [attachment] }],
    subject: { type: "pax_document", id: row.document_id },
    // One run per attempt: the same attempt run again (a job step retried) is the same run.
    idempotencyKey: `pax:${row.document_id}:${row.sha256 ?? "sem-hash"}:${row.attempt}`.slice(0, 120),
  });
  if (result.kind === "refused") return record("failed", result.code);
  runId = result.runId;
  if (result.kind === "failed") return record("failed", result.code);
  if (result.kind === "replayed" && result.status !== "succeeded") {
    return record("failed", result.status === "running" ? "read_running" : "read_failed");
  }
  return record("done");
}

/** Claims and reads what waits (or the one document named), one after the other. */
export async function readPaxDocuments(
  service: SupabaseClient,
  limit = 5,
  documentId: string | null = null,
): Promise<{ done: number; other: number }> {
  const claimed = await claimPaxReadings(service, limit, documentId);
  let done = 0;
  let other = 0;
  for (const claim of claimed) {
    const outcome = await readClaimedPaxDocument(service, claim).catch(() => null);
    if (outcome === "done") done += 1;
    else other += 1;
  }
  return { done, other };
}

/**
 * A document just arrived: the jobs read it at once. Without them (a machine with no Inngest) it is read after
 * the response is sent, so nobody waits for the model. The sweep catches anything neither finished.
 */
export async function queuePaxReading(documentId: string): Promise<void> {
  const sent = await sendEvent("one/pax.document.uploaded", { documentId });
  if (sent.sent) return;
  after(async () => {
    try {
      await readPaxDocuments(createServiceClient(), 1, documentId);
    } catch {
      // Still pending: the sweep takes it.
    }
  });
}
