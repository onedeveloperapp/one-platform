import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";
import { finishPassengerUpload, startPassengerUpload } from "@/modules/direito-do-passageiro/agency/actions";
import { finishAgreementUpload, startAgreementUpload } from "@/modules/direito-do-passageiro/agency/link-actions";
import type { PaxDocumentKind } from "@/modules/direito-do-passageiro/agency/passengers";

/**
 * How a document of the agency's area leaves the browser (migration 0070): the reservation and the signed address
 * from a server action, the bytes straight to storage, then the backend measures what arrived and the AI reads
 * it. The agency sends with its session; the passenger with the token of their link.
 */

export type Sent = { ok: true; documentId?: string } | { ok: false; code: string };

type Target = { travelerId: string; kind: PaxDocumentKind; tripId: string | null };

export async function sendAgencyFile(file: File, target: Target): Promise<Sent> {
  const mime = mimeOf(file);
  const started = await startPassengerUpload({ ...target, name: file.name, mime, bytes: file.size });
  if (!started.ok) return started;
  const uploaded = await uploadToSignedUrl({
    storagePath: started.storagePath,
    uploadToken: started.uploadToken,
    file,
    contentType: mime,
  });
  if (!uploaded) return { ok: false, code: "not_uploaded" };
  const finished = await finishPassengerUpload(started.fileId);
  return finished.ok ? { ok: true, documentId: started.documentId } : finished;
}

export async function sendLinkFile(token: string, file: File, target: Target): Promise<Sent> {
  const mime = mimeOf(file);
  const started = await startAgreementUpload(token, { ...target, name: file.name, mime, bytes: file.size });
  if (!started.ok) return started;
  const uploaded = await uploadToSignedUrl({
    storagePath: started.storagePath,
    uploadToken: started.uploadToken,
    file,
    contentType: mime,
  });
  if (!uploaded) return { ok: false, code: "not_uploaded" };
  const finished = await finishAgreementUpload(token, started.fileId);
  return finished.ok ? { ok: true } : finished;
}
