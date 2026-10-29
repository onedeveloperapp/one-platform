import "server-only";

import { supabaseFileStore } from "@/lib/files/store";
import { queuePaxReading } from "@/modules/direito-do-passageiro/agency/reading-work";
import { measureFile } from "@flyee/documents/measure";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The second half of an upload of a document of the agency's area (migration 0070): the backend measures what
 * arrived (only a file reserved for a document still uploading), keeps it or refuses it, and the database turns
 * a kept one into a document the AI reads next. Sent by the agency (`partnerId`, the caller's own partner, read
 * from their session first) or by the passenger on their link (`token`).
 *
 * Every answer is a code: `failed` for what did not work now and may work at the next request. Nothing throws for
 * what a database or a storage did.
 */
export type PaxUploadFinished = { ok: true; code: string; documentId: string } | { ok: false; code: string };

const failed = { ok: false as const, code: "failed" };

type ToFinish = {
  file_id: string;
  storage_path: string;
  declared_mime: string;
  partner_id: string;
  created_by: string | null;
};

export async function finishPaxUpload(
  service: SupabaseClient,
  fileId: string,
  by: { token: string } | { partnerId: string },
): Promise<PaxUploadFinished> {
  let row: ToFinish | undefined;
  try {
    const { data, error } = await service.rpc("pax_upload_to_finish", {
      target_file: fileId,
      target_token: "token" in by ? by.token : null,
    });
    if (error) return failed;
    row = ((data ?? []) as ToFinish[])[0];
  } catch {
    return failed;
  }
  // Not a file of this link, or of the caller's partner, still waiting for its bytes.
  if (!row || ("partnerId" in by && row.partner_id !== by.partnerId)) return { ok: false, code: "not_found" };

  const store = supabaseFileStore(service);
  const bytes = await store.get(row.storage_path);
  if (!bytes) return { ok: false, code: "not_uploaded" };
  try {
    const confirmed = await store.confirm(fileId, await measureFile(bytes));
    // What was refused does not stay in the bucket.
    if (!confirmed.ok && confirmed.code === "rejected") await store.remove([row.storage_path]).catch(() => undefined);
  } catch {
    return failed;
  }

  try {
    const { data, error } = await service.rpc("pax_document_uploaded", { target_file: fileId });
    if (error) return failed;
    const answer = (data ?? {}) as { ok?: boolean; code?: string; reason?: string | null; document_id?: string };
    if (!answer.ok)
      return {
        ok: false,
        code: answer.code === "rejected" ? (answer.reason ?? "rejected") : String(answer.code ?? "failed"),
      };
    const documentId = String(answer.document_id ?? "");
    if (answer.code === "pending" && documentId) await queuePaxReading(documentId);
    return { ok: true, code: String(answer.code ?? "pending"), documentId };
  } catch {
    return failed;
  }
}
