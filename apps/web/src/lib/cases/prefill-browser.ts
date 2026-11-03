import { startCaseUpload } from "@/lib/cases/actions";
import type { PrefillReading } from "@/lib/cases/document-prefill";
import { dropPrefillUpload, readForPrefill } from "@/lib/cases/prefill-actions";
import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";

/**
 * How a document a person of the firm sends to start a registration leaves the browser (migration 0085): the
 * reservation, the bytes straight to storage, then ONE's reading of it for the form. The file is kept (`fileId`)
 * also when ONE could not read it, so the form saved by hand still takes it to the case; one the backend refused on
 * its bytes is not.
 */
export type SentForReading =
  | { ok: true; fileId: string; output: Record<string, unknown> }
  | { ok: false; code: string; fileId: string | null };

/** What the backend refused on the file's own bytes: nothing of it was kept. */
const FILE_REFUSED = ["type_not_allowed", "too_large", "invalid_size", "not_uploaded", "rejected", "not_found"];

export async function sendForReading(file: File, reading: PrefillReading): Promise<SentForReading> {
  const mime = mimeOf(file);
  const started = await startCaseUpload({ name: file.name, mime, bytes: file.size });
  if (!started.ok) return { ok: false, code: started.code, fileId: null };
  const uploaded = await uploadToSignedUrl({
    storagePath: started.storagePath,
    uploadToken: started.uploadToken,
    file,
    contentType: mime,
  });
  if (!uploaded) return { ok: false, code: "not_uploaded", fileId: null };
  const read = await readForPrefill({ fileId: started.fileId, reading });
  if (read.ok) return { ok: true, fileId: started.fileId, output: read.output };
  return { ok: false, code: read.code, fileId: FILE_REFUSED.includes(read.code) ? null : started.fileId };
}

/** The files a form read and never saved go, when the form is closed or a file is sent again in their place. */
export function dropUnsaved(fileIds: readonly (string | null | undefined)[]): void {
  for (const fileId of fileIds) if (fileId) void dropPrefillUpload(fileId);
}
