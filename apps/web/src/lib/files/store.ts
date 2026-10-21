import "server-only";

import { FIRM_FILES_BUCKET } from "@/lib/files/bucket";
import type { FileMeasure, FileStore, ReservedFile } from "@flyee/documents/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export { FIRM_FILES_BUCKET };

/**
 * The firm's files over the database and the bucket (migration
 * 0018_files_documents): the backend's side of them, for what ONE writes
 * itself (an issued document) and for measuring what a person uploaded. It is
 * built from the service-role client and hands out an interface, never the
 * client: every record goes through a function that takes the firm.
 */
export function supabaseFileStore(service: SupabaseClient): FileStore {
  const bucket = () => service.storage.from(FIRM_FILES_BUCKET);

  return {
    async reserve(input): Promise<ReservedFile> {
      const { data, error } = await service.rpc("reserve_file", {
        target_org: input.orgId,
        target_purpose: input.purpose,
        target_name: input.name,
        target_mime: input.mime,
        target_bytes: input.bytes,
        target_requested_by: input.requestedBy ?? null,
      });
      if (error) throw new Error(`reserve_file failed: ${error.message}`);
      const answer = (data ?? {}) as { ok?: boolean; code?: string; file_id?: string; storage_path?: string };
      if (!answer.ok || !answer.file_id || !answer.storage_path) return { ok: false, code: answer.code ?? "refused" };
      return { ok: true, fileId: answer.file_id, storagePath: answer.storage_path };
    },

    async put(storagePath, bytes, mime): Promise<void> {
      const { error } = await bucket().upload(storagePath, bytes, { contentType: mime, upsert: true });
      if (error) throw new Error(`upload failed: ${error.message}`);
    },

    async get(storagePath): Promise<Uint8Array | null> {
      const { data, error } = await bucket().download(storagePath);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },

    async confirm(fileId, measure: FileMeasure) {
      const { data, error } = await service.rpc("confirm_file", {
        target_file: fileId,
        target_sha256: measure.sha256,
        target_bytes: measure.bytes,
        target_detected_mime: measure.detectedMime,
        target_pages: measure.pages,
      });
      if (error) throw new Error(`confirm_file failed: ${error.message}`);
      const answer = (data ?? {}) as { ok?: boolean; code?: string; reason?: string | null };
      return { ok: Boolean(answer.ok), code: answer.code ?? "refused", reason: answer.reason ?? null };
    },

    async discard(fileId): Promise<void> {
      const { data, error } = await service.rpc("discard_file", { target_file: fileId });
      if (error) throw new Error(`discard_file failed: ${error.message}`);
      // Something names the file after all: it stays, and so do its bytes (`takeBackFile`).
      const answer = (data ?? {}) as { ok?: boolean; code?: string };
      if (answer.ok === false) throw new Error(`discard_file refused: ${answer.code ?? "refused"}`);
    },

    async remove(storagePaths): Promise<void> {
      if (storagePaths.length === 0) return;
      const { error } = await bucket().remove(storagePaths);
      if (error) throw new Error(`remove failed: ${error.message}`);
    },
  };
}
