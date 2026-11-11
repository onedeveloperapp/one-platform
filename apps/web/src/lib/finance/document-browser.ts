import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";
import {
  dropFinanceUpload,
  readFinanceDocument,
  readFinanceInvoice,
  readStatementPdf,
  startFinanceUpload,
} from "@/lib/finance/document-actions";
import type { FinanceDocumentRead } from "@/lib/finance/documents";
import type { InvoiceRead } from "@/lib/finance/invoice-reading";
import { sha256, type StatementFile, withIds } from "@/lib/finance/statement-file";

/**
 * How a document of the books leaves the browser (migration 0140): the reservation, the bytes straight to storage,
 * then ONE's reading of it for the form. The file is kept (`fileId`) also when ONE could not read it, so a form
 * filled by hand still keeps it with the bill or the entry; one the backend refused on its bytes is not.
 */
export type FinanceDocumentSent =
  | { ok: true; fileId: string; read: FinanceDocumentRead }
  | { ok: false; code: string; fileId: string | null };

/** What the backend refused on the file's own bytes: nothing of it was kept. */
const FILE_REFUSED = ["type_not_allowed", "too_large", "invalid_size", "not_uploaded", "rejected", "not_found"];

export async function sendFinanceDocument(
  file: File,
  input: { direction: "pay" | "receive"; target: "bill" | "entry" },
): Promise<FinanceDocumentSent> {
  const mime = mimeOf(file);
  const started = await startFinanceUpload({ name: file.name, mime, bytes: file.size });
  if (!started.ok) return { ok: false, code: started.code, fileId: null };
  const uploaded = await uploadToSignedUrl({
    storagePath: started.storagePath,
    uploadToken: started.uploadToken,
    file,
    contentType: mime,
  });
  if (!uploaded) return { ok: false, code: "not_uploaded", fileId: null };
  const read = await readFinanceDocument({ fileId: started.fileId, ...input });
  if (read.ok) return { ok: true, fileId: started.fileId, read: read.read };
  return { ok: false, code: read.code, fileId: FILE_REFUSED.includes(read.code) ? null : started.fileId };
}

export type InvoiceSent =
  | { ok: true; fileId: string; read: InvoiceRead }
  | { ok: false; code: string; fileId: string | null };

/** The invoice the firm issued, sent for "Registrar a nota emitida" and read by ONE against its fee (0165). */
export async function sendInvoiceDocument(file: File, entryId: string): Promise<InvoiceSent> {
  const mime = mimeOf(file);
  const started = await startFinanceUpload({ name: file.name, mime, bytes: file.size });
  if (!started.ok) return { ok: false, code: started.code, fileId: null };
  const uploaded = await uploadToSignedUrl({
    storagePath: started.storagePath,
    uploadToken: started.uploadToken,
    file,
    contentType: mime,
  });
  if (!uploaded) return { ok: false, code: "not_uploaded", fileId: null };
  const read = await readFinanceInvoice({ fileId: started.fileId, entryId });
  if (read.ok) return { ok: true, fileId: started.fileId, read: read.read };
  return { ok: false, code: read.code, fileId: FILE_REFUSED.includes(read.code) ? null : started.fileId };
}

/**
 * A statement or a card bill in PDF, sent for ONE's reading (0169): the PDF goes up as a document of the books (taken
 * back by the sweep after a day), and what comes back, when it adds up, is a statement as the screen sends any: its
 * lines with their ids, the file's own hash, the format `pdf`.
 */
export async function sendStatementPdf(
  file: File,
): Promise<StatementFile | { ok: false; code: string; differenceCents?: number }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const started = await startFinanceUpload({ name: file.name, mime: "application/pdf", bytes: file.size });
  if (!started.ok) return { ok: false, code: started.code };
  const uploaded = await uploadToSignedUrl({
    storagePath: started.storagePath,
    uploadToken: started.uploadToken,
    file,
    contentType: "application/pdf",
  });
  if (!uploaded) return { ok: false, code: "not_uploaded" };
  const answer = await readStatementPdf({ fileId: started.fileId });
  if (!answer.ok) return { ok: false, code: answer.code };
  if (!answer.read.ok) {
    return { ok: false, code: `pdf_${answer.read.code}`, differenceCents: answer.read.differenceCents };
  }
  const read = answer.read;
  return {
    ok: true,
    statement: {
      startsOn: read.startsOn,
      endsOn: read.endsOn,
      balance: read.balance,
      lines: await withIds(read.lines),
    },
    sha256: await sha256(bytes),
    fileName: file.name.slice(0, 200),
    format: "pdf",
  };
}

/** The documents a form read and never saved go, when the form is closed or another is sent in their place. */
export function dropUnsavedFinance(fileIds: readonly (string | null | undefined)[]): void {
  for (const fileId of fileIds) if (fileId) void dropFinanceUpload(fileId);
}
