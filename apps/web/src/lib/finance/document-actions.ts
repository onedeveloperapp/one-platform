"use server";

import { runFirmTask } from "@/lib/ai/executor";
import { attachmentOf, IMAGE_MIMES } from "@/lib/cases/document-prefill-work";
import { FIRM_FILES_BUCKET, supabaseFileStore } from "@/lib/files/store";
import { discardUpload, downloadUrl, finishUpload } from "@/lib/files/uploads";
import {
  type DocumentCategory,
  FINANCE_DOCUMENT_TASK,
  financeDocumentBriefing,
  type FinanceDocumentRead,
  readFinanceDocumentOutput,
} from "@/lib/finance/documents";
import { INVOICE_TASK, invoiceBriefing, type InvoiceRead, readInvoiceOutput } from "@/lib/finance/invoice-reading";
import { readStatementPdfOutput, STATEMENT_PDF_TASK, type StatementPdfRead } from "@/lib/finance/statement-pdf";
import { getMemberContext } from "@/lib/member/context";
import { createServiceClient } from "@flyee/auth/service";

/**
 * A document of the books read by ONE into a form (migration 0140): the person reserves it (`reserve_finance_upload`,
 * only who writes in the books), the browser sends the bytes straight to storage, the backend measures them, and the
 * reading's task (a shadow task: its runs are nobody's of the firm to read) says what the document says, which comes
 * back to that person to confirm. Nothing is written here: the form saves what the person confirms, and the document
 * is kept with the bill or the entry after (`attach_finance_document`). Never in a support visit.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

const KINDS_OF: Record<"pay" | "receive", string[]> = {
  pay: ["expense", "partner_out", "client_money"],
  receive: ["income", "partner_in", "client_money"],
};

export type StartedFinanceUpload =
  | { ok: true; fileId: string; storagePath: string; uploadToken: string }
  | { ok: false; code: string };

export async function startFinanceUpload(input: {
  name: string;
  mime: string;
  bytes: number;
}): Promise<StartedFinanceUpload> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_allowed" };
  const { data, error } = await context.supabase.rpc("reserve_finance_upload", {
    target_org: context.firm.id,
    target_name: String(input?.name ?? "").slice(0, 200) || "documento",
    target_mime: String(input?.mime ?? ""),
    target_bytes: Number(input?.bytes ?? 0),
  });
  if (error) return { ok: false, code: error.code === "42501" ? "not_allowed" : "failed" };
  const reserved = (data ?? {}) as { ok?: boolean; code?: string; file_id?: string; storage_path?: string };
  if (reserved.ok !== true || !reserved.file_id || !reserved.storage_path) {
    return { ok: false, code: String(reserved.code ?? "failed") };
  }
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, code: "backend_not_configured" };
  }
  const { data: signed, error: signError } = await service.storage
    .from(FIRM_FILES_BUCKET)
    .createSignedUploadUrl(reserved.storage_path);
  // The reservation stays: it expires by itself, and the sweep of the books takes it back.
  if (signError || !signed) return { ok: false, code: "storage_unavailable" };
  return { ok: true, fileId: reserved.file_id, storagePath: reserved.storage_path, uploadToken: signed.token };
}

export type FinanceDocumentAnswer = { ok: true; read: FinanceDocumentRead } | { ok: false; code: string };

export async function readFinanceDocument(input: {
  fileId: string;
  direction: "pay" | "receive";
  target: "bill" | "entry";
}): Promise<FinanceDocumentAnswer> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.fileId)) return { ok: false, code: "not_found" };
  const direction = input.direction === "receive" ? "receive" : "pay";
  const target = input.target === "entry" ? "entry" : "bill";

  const finished = await finishUpload(context, input.fileId);
  if (!finished.ok) return { ok: false, code: finished.code };

  const { data: allowed, error } = await context.supabase.rpc("finance_document_reading_allowed", {
    target_org: context.firm.id,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (allowed ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: String(answer.code ?? "failed") };

  // The chart the model chooses from: this way's categories in force, by number, never by id.
  const { data: chart } = await context.supabase
    .from("finance_categories")
    .select("id, name, kind, archived_at, position")
    .eq("org_id", context.firm.id)
    .is("archived_at", null)
    .in("kind", KINDS_OF[direction])
    .order("position", { ascending: true });
  const categories: DocumentCategory[] = (chart ?? []).map((row) => ({ id: String(row.id), name: String(row.name) }));

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, code: "backend_not_configured" };
  }
  const { data: file } = await service
    .from("files")
    .select("id, storage_path, detected_mime, sha256, status, purpose")
    .eq("id", input.fileId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  if (!file || file.status !== "stored" || file.purpose !== "finance") return { ok: false, code: "not_found" };
  const mime = String(file.detected_mime ?? "").toLowerCase();
  if (!IMAGE_MIMES.includes(mime) && mime !== "application/pdf") return { ok: false, code: "unsupported_type" };
  const bytes = await supabaseFileStore(service).get(String(file.storage_path));
  if (!bytes) return { ok: false, code: "not_found" };
  const attachment = await attachmentOf(bytes, mime);
  if ("code" in attachment) return { ok: false, code: attachment.code };

  const result = await runFirmTask({
    orgId: context.firm.id,
    task: FINANCE_DOCUMENT_TASK,
    // What is hashed for the record: the way, what it is for and the file's own hash, never its bytes nor its name.
    input: { direction, target, sha256: file.sha256 ?? null },
    messages: [
      { role: "user", content: financeDocumentBriefing({ direction, target, categories }), attachments: [attachment] },
    ],
    requestedBy: context.userId,
    subject: { type: "file", id: input.fileId },
  });
  if (result.kind === "finished") {
    return { ok: true, read: readFinanceDocumentOutput(result.output, { categories, today: today() }) };
  }
  if (result.kind === "replayed") return { ok: false, code: "read_running" };
  return { ok: false, code: result.code };
}

export type InvoiceAnswer = { ok: true; read: InvoiceRead } | { ok: false; code: string };

/**
 * The invoice the firm issued, read by ONE for "Registrar a nota emitida" (migration 0165): the file the person sent
 * as a document of the books, measured now, within the books' readings of a day, read against the fee it is of.
 * Nothing is written here: the person records the invoice, with the file.
 */
export async function readFinanceInvoice(input: { fileId: string; entryId: string }): Promise<InvoiceAnswer> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.fileId) || !isId(input?.entryId)) return { ok: false, code: "not_found" };

  const finished = await finishUpload(context, input.fileId);
  if (!finished.ok) return { ok: false, code: finished.code };

  const { data: allowed, error } = await context.supabase.rpc("finance_document_reading_allowed", {
    target_org: context.firm.id,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (allowed ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: String(answer.code ?? "failed") };

  const { data: entry } = await context.supabase
    .from("finance_entries")
    .select("id, cents")
    .eq("id", input.entryId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  if (!entry) return { ok: false, code: "not_found" };
  const entryCents = Number(entry.cents);

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, code: "backend_not_configured" };
  }
  const { data: file } = await service
    .from("files")
    .select("id, storage_path, detected_mime, sha256, status, purpose")
    .eq("id", input.fileId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  if (!file || file.status !== "stored" || file.purpose !== "finance") return { ok: false, code: "not_found" };
  const mime = String(file.detected_mime ?? "").toLowerCase();
  if (!IMAGE_MIMES.includes(mime) && mime !== "application/pdf") return { ok: false, code: "unsupported_type" };
  const bytes = await supabaseFileStore(service).get(String(file.storage_path));
  if (!bytes) return { ok: false, code: "not_found" };
  const attachment = await attachmentOf(bytes, mime);
  if ("code" in attachment) return { ok: false, code: attachment.code };

  const result = await runFirmTask({
    orgId: context.firm.id,
    task: INVOICE_TASK,
    // What is hashed for the record: the fee it is of and the file's own hash, never its bytes nor its name.
    input: { entry: input.entryId, sha256: file.sha256 ?? null },
    messages: [{ role: "user", content: invoiceBriefing(entryCents), attachments: [attachment] }],
    requestedBy: context.userId,
    subject: { type: "file", id: input.fileId },
  });
  if (result.kind === "finished") {
    return { ok: true, read: readInvoiceOutput(result.output, { today: today(), entryCents }) };
  }
  if (result.kind === "replayed") return { ok: false, code: "read_running" };
  return { ok: false, code: result.code };
}

/**
 * A statement or a card bill in PDF, read by ONE for the conciliation (migration 0169): the file the person sent as a
 * document of the books, measured now, within the books' readings of a day; what comes back is kept only when its lines
 * add up to the balances the document prints. Nothing is written here: the lines go to the books as an OFX's do.
 */
export async function readStatementPdf(input: {
  fileId: string;
}): Promise<{ ok: true; read: StatementPdfRead } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.fileId)) return { ok: false, code: "not_found" };

  const finished = await finishUpload(context, input.fileId);
  if (!finished.ok) return { ok: false, code: finished.code };

  const { data: allowed, error } = await context.supabase.rpc("finance_document_reading_allowed", {
    target_org: context.firm.id,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (allowed ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok !== true) return { ok: false, code: String(answer.code ?? "failed") };

  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, code: "backend_not_configured" };
  }
  const { data: file } = await service
    .from("files")
    .select("id, storage_path, detected_mime, sha256, status, purpose")
    .eq("id", input.fileId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  if (!file || file.status !== "stored" || file.purpose !== "finance") return { ok: false, code: "not_found" };
  if (String(file.detected_mime ?? "").toLowerCase() !== "application/pdf")
    return { ok: false, code: "unsupported_type" };
  const bytes = await supabaseFileStore(service).get(String(file.storage_path));
  if (!bytes) return { ok: false, code: "not_found" };
  const attachment = await attachmentOf(bytes, "application/pdf");
  if ("code" in attachment) return { ok: false, code: attachment.code };

  const result = await runFirmTask({
    orgId: context.firm.id,
    task: STATEMENT_PDF_TASK,
    // What is hashed for the record: the file's own hash, never its bytes nor its name.
    input: { sha256: file.sha256 ?? null },
    messages: [{ role: "user", content: "O extrato ou a fatura em PDF vai anexo.", attachments: [attachment] }],
    requestedBy: context.userId,
    subject: { type: "file", id: input.fileId },
  });
  if (result.kind === "finished") return { ok: true, read: readStatementPdfOutput(result.output) };
  if (result.kind === "replayed") return { ok: false, code: "read_running" };
  return { ok: false, code: result.code };
}

/** A document read for a form nobody saved goes, when the form is closed or another is sent in its place. */
export async function dropFinanceUpload(fileId: string): Promise<void> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(fileId)) return;
  await discardUpload(context, fileId, "finance");
}

/** The link that opens the document of a bill or an entry: only who reads the books sees its row (0140). */
export async function openFinanceDocument(fileId: string): Promise<{ ok: true; url: string } | { ok: false }> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(fileId)) return { ok: false };
  const link = await downloadUrl(context, fileId);
  return link.ok ? { ok: true, url: link.url } : { ok: false };
}
