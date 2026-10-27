import "server-only";

import { after } from "next/server";

import { runFirmTask } from "@/lib/ai/executor";
import { supabaseFileStore } from "@/lib/files/store";
import { readDocx } from "@/lib/library/docx";
import { MARK_TASK, markingBriefing, paragraphsOf, TRANSCRIBE_TASK } from "@/lib/library/imports";
import type { RunResult } from "@flyee/ai/runs";
import { createServiceClient } from "@flyee/auth/service";
import { sendEvent } from "@flyee/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of a model made from a document (migration 0067). A
 * request owes two works, one at a time, each under a numbered claim: its
 * text (a Word file read here, word for word; a PDF transcribed by the task
 * `biblioteca.modelo.transcricao`), then the marking (the task
 * `biblioteca.modelo.marcacao`, which says which paragraphs change).
 *
 * Nothing here says what a model answered: the worker names the run, and the
 * database reads its answer and decides whether it can be kept. Once the
 * text is kept, the database forgets the document's record and answers
 * where its bytes were, which are removed here at once (the upkeep of the
 * bucket would take them otherwise). Only ids and outcomes leave this file:
 * nothing of a document is kept in a job's state.
 */

export type ImportClaim = { importId: string; claim: number };

/**
 *   read       the text was kept: the marking is owed;
 *   ready      what ONE prepared waits for a person;
 *   retry      a passing failure: tried again by the next claim;
 *   in_course  the run of this very work still runs elsewhere: looked at again shortly;
 *   failed     nothing can be prepared, and the request says why;
 *   not_held   the claim is no longer this worker's.
 */
export type ImportOutcome = "read" | "ready" | "retry" | "in_course" | "failed" | "not_held";

type ToWork = {
  ok?: boolean;
  import_id: string;
  org_id: string;
  requested_by: string | null;
  work: "reading" | "marking";
  source: "docx" | "pdf";
  storage_path: string | null;
  paragraphs: unknown;
  run_key: string;
  max_chars: number;
  max_paragraphs: number;
};

const OUTCOMES: readonly ImportOutcome[] = ["read", "ready", "retry", "in_course", "failed"];

/** A run that could not reach a model able to read the document: no try passes it by itself. */
const NO_PROVIDER = new Set(["provider_not_configured", "provider_cannot_read_documents"]);
/** A run the store would not start for a moment: the database or the backend's key did not answer. */
const PASSING_REFUSALS = new Set(["backend_not_configured", "store_unavailable"]);

export async function claimTemplateImports(
  service: SupabaseClient,
  limit = 1,
  importId: string | null = null,
): Promise<ImportClaim[]> {
  const { data, error } = await service.rpc("claim_template_imports", {
    target_limit: limit,
    target_import: importId,
  });
  if (error) throw new Error(`claim_template_imports failed: ${error.message}`);
  return (Array.isArray(data) ? (data as { import_id?: unknown; claim?: unknown }[]) : []).flatMap((row) =>
    typeof row.import_id === "string" && Number.isInteger(Number(row.claim))
      ? [{ importId: row.import_id, claim: Number(row.claim) }]
      : [],
  );
}

/** Does the work a claimed request is owed and records what came of it. Never throws for what a model or a file did. */
export async function workClaimedImport(service: SupabaseClient, held: ImportClaim): Promise<ImportOutcome> {
  const { data, error } = await service.rpc("template_import_to_work", {
    target_import: held.importId,
    target_claim: held.claim,
  });
  if (error) throw new Error(`template_import_to_work failed: ${error.message}`);
  const row = (data ?? {}) as ToWork;
  if (!row.ok) return "not_held";
  const store = supabaseFileStore(service);

  const record = async (
    outcome: "read" | "ready" | "retry" | "in_course" | "failed",
    input: { paragraphs?: string[]; runId?: string | null; failure?: string | null } = {},
  ): Promise<ImportOutcome> => {
    const { data: recorded, error: recordError } = await service.rpc("record_template_import", {
      target_import: row.import_id,
      target_claim: held.claim,
      target_outcome: outcome,
      target_paragraphs: input.paragraphs ?? null,
      target_run: input.runId ?? null,
      target_failure: input.failure ?? null,
    });
    if (recordError) throw new Error(`record_template_import failed: ${recordError.message}`);
    const answer = (recorded ?? {}) as { ok?: boolean; code?: string; storage_path?: string | null };
    // The document's record went with what was read of it: its bytes go now, record first.
    if (answer.storage_path) await store.remove([answer.storage_path]).catch(() => undefined);
    if (answer.ok === false) {
      if (answer.code === "not_held") return "not_held";
      // The database did not take what was handed over (a run that is not this request's): tried again.
      return outcome === "retry" || outcome === "failed" ? "failed" : record("retry", { runId: input.runId });
    }
    return OUTCOMES.find((code) => code === answer.code) ?? "failed";
  };

  /** What the executor answered, as the database is told it; `done` is what a run that succeeded records. */
  const settle = (result: RunResult, done: "read" | "ready", cutShort: "too_long" | "answer_unusable") => {
    if (result.kind === "refused") {
      return PASSING_REFUSALS.has(result.code) ? record("retry") : record("failed", { failure: "no_provider" });
    }
    if (result.kind === "failed") {
      if (NO_PROVIDER.has(result.code)) return record("failed", { runId: result.runId, failure: "no_provider" });
      // An answer cut short says the text did not fit what the model may write.
      if (result.code === "output_truncated") return record("failed", { runId: result.runId, failure: cutShort });
      return record("retry", { runId: result.runId, failure: "gave_up" });
    }
    if (result.kind === "replayed") {
      if (result.status === "running") return record("in_course");
      if (result.status !== "succeeded") return record("retry", { runId: result.runId, failure: "gave_up" });
    }
    return record(done, { runId: result.runId });
  };

  if (row.work === "reading") {
    if (!row.storage_path) return record("failed", { failure: "unreadable" });
    const bytes = await store.get(row.storage_path);
    // The bucket did not answer: tried again, and given up after the setting's tries.
    if (!bytes) return record("retry", { failure: "gave_up" });
    if (row.source === "docx") {
      const read = readDocx(bytes);
      if (!read.ok) return record("failed", { failure: read.code === "too_large" ? "too_long" : "unreadable" });
      const characters = read.paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
      if (read.paragraphs.length > row.max_paragraphs || characters > row.max_chars) {
        return record("failed", { failure: "too_long" });
      }
      return record("read", { paragraphs: read.paragraphs });
    }
    const result = await runFirmTask({
      orgId: row.org_id,
      task: TRANSCRIBE_TASK,
      // What is hashed for the record: the request and the size of its document, never its bytes.
      input: { import: row.import_id, bytes: bytes.byteLength },
      messages: [
        {
          role: "user",
          content: "Transcreva este documento.",
          attachments: [
            { kind: "document", mime: "application/pdf", dataBase64: Buffer.from(bytes).toString("base64") },
          ],
        },
      ],
      subject: { type: "template_import", id: row.import_id },
      idempotencyKey: row.run_key,
      requestedBy: row.requested_by,
    });
    return settle(result, "read", "too_long");
  }

  const paragraphs = paragraphsOf(row.paragraphs);
  if (paragraphs.length === 0) return record("failed", { failure: "empty" });
  const result = await runFirmTask({
    orgId: row.org_id,
    task: MARK_TASK,
    input: { paragraphs },
    messages: [{ role: "user", content: markingBriefing(paragraphs) }],
    subject: { type: "template_import", id: row.import_id },
    idempotencyKey: row.run_key,
    requestedBy: row.requested_by,
  });
  return settle(result, "ready", "answer_unusable");
}

/** Claims the request that waits the longest (or the one named) and does the one work it is owed. */
export async function importNext(
  service: SupabaseClient,
  importId: string | null = null,
): Promise<ImportOutcome | "none"> {
  const held = (await claimTemplateImports(service, 1, importId))[0];
  return held ? workClaimedImport(service, held) : "none";
}

/** The upkeep of the requests: what waited longer than the setting's days goes. Answers how many. */
export async function expireTemplateImports(service: SupabaseClient): Promise<number> {
  const { data, error } = await service.rpc("expire_template_imports");
  if (error) throw new Error(`expire_template_imports failed: ${error.message}`);
  return Number(data ?? 0);
}

/**
 * A request owes a work: the jobs take it at once. Without them (a machine
 * with no Inngest), the one work owed is done after the response is sent,
 * and the screen that waits for the request asks again for the next one, so
 * each work has a request's whole time.
 */
export async function queueTemplateImport(importId: string): Promise<void> {
  const sent = await sendEvent("one/library.import.requested", { importId });
  if (sent.sent) return;
  after(async () => {
    try {
      await importNext(createServiceClient(), importId);
    } catch {
      // Still owed: the next look at it takes it.
    }
  });
}
