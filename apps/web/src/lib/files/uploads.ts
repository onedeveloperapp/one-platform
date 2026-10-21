import "server-only";

import { FIRM_FILES_BUCKET, supabaseFileStore } from "@/lib/files/store";
import type { MemberContext } from "@/lib/member/context";
import { createServiceClient } from "@flyee/auth/service";
import { measureFile } from "@flyee/documents/measure";

/**
 * How a person of a firm sends and opens a file (migration
 * 0018_files_documents). The bytes never pass through a function of the app:
 * the browser sends them straight to storage with a signed upload URL, and
 * reads them back with a signed URL of a minute.
 *
 *   startUpload   the person's own session reserves the upload (the database
 *                 checks the firm, the type and the size); the backend mints
 *                 the signed upload URL for the reserved path;
 *   finishUpload  the backend measures what arrived (hash, size, the type its
 *                 bytes say, pages) and keeps it or rejects it;
 *   downloadUrl   the person's session reads the file's row (row-level
 *                 security is what proves they belong to the firm) and the
 *                 backend mints the short signed URL.
 *
 * Screens wrap these in their own server actions; nothing here is one.
 */

/** How long a download link works: long enough to open the file, short enough not to be passed on. */
const DOWNLOAD_SECONDS = 60;

export type StartedUpload =
  | { ok: true; fileId: string; uploadUrl: string; uploadToken: string; storagePath: string; expiresAt: string }
  | { ok: false; code: string };

const KNOWN_CODES = [
  "not_allowed_in_support_session",
  "not_authorized",
  "purpose_not_allowed",
  "unknown_purpose",
  "invalid_name",
  "type_not_allowed",
  "invalid_size",
  "too_large",
] as const;

const codeOf = (message: string | null | undefined): string =>
  KNOWN_CODES.find((code) => (message ?? "").includes(code)) ?? "failed";

function service() {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

export async function startUpload(
  context: MemberContext,
  input: { purpose: string; name: string; mime: string; bytes: number },
): Promise<StartedUpload> {
  if (!context.firm) return { ok: false, code: "not_authorized" };
  const backend = service();
  if (!backend) return { ok: false, code: "backend_not_configured" };

  const { data, error } = await context.supabase.rpc("reserve_file_upload", {
    target_org: context.firm.id,
    target_purpose: input.purpose,
    target_name: input.name,
    target_mime: input.mime,
    target_bytes: input.bytes,
  });
  if (error) return { ok: false, code: codeOf(error.message) };
  const reserved = (data ?? {}) as {
    ok?: boolean;
    code?: string;
    file_id?: string;
    storage_path?: string;
    expires_at?: string;
  };
  if (!reserved.ok || !reserved.file_id || !reserved.storage_path) return { ok: false, code: codeOf(reserved.code) };

  const { data: signed, error: signError } = await backend.storage
    .from(FIRM_FILES_BUCKET)
    .createSignedUploadUrl(reserved.storage_path);
  // The reservation stays: it expires by itself and the upkeep removes it.
  if (signError || !signed) return { ok: false, code: "storage_unavailable" };

  return {
    ok: true,
    fileId: reserved.file_id,
    uploadUrl: signed.signedUrl,
    uploadToken: signed.token,
    storagePath: reserved.storage_path,
    expiresAt: reserved.expires_at ?? "",
  };
}

/** `measured`: this call measured the file now (it was still reserved); false when it was already kept. */
export type FinishedUpload = { ok: true; measured: boolean } | { ok: false; code: string };

export async function finishUpload(context: MemberContext, fileId: string): Promise<FinishedUpload> {
  if (!context.firm) return { ok: false, code: "not_authorized" };
  const backend = service();
  if (!backend) return { ok: false, code: "backend_not_configured" };

  // Read under the person's session: a file of another firm is not found.
  const { data: file } = await context.supabase
    .from("files")
    .select("id, storage_path, status")
    .eq("id", fileId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  if (!file) return { ok: false, code: "not_found" };
  if (file.status === "stored") return { ok: true, measured: false };
  if (file.status !== "reserved") return { ok: false, code: "rejected" };

  const store = supabaseFileStore(backend);
  const bytes = await store.get(file.storage_path as string);
  if (!bytes) return { ok: false, code: "not_uploaded" };

  const confirmed = await store.confirm(fileId, await measureFile(bytes));
  if (confirmed.ok) return { ok: true, measured: true };
  // What was rejected does not stay in the bucket.
  await store.remove([file.storage_path as string]).catch(() => undefined);
  return { ok: false, code: confirmed.reason ?? confirmed.code };
}

/** The type of a file signed by ONE with a lawyer's certificate in the cloud: an attached CMS. */
const SIGNED_COPY_MIME = "application/pkcs7-mime";

export type DownloadLink = { ok: true; url: string; name: string } | { ok: false; code: string };

/**
 * `downloadName`: the name the browser saves it under, when it is not the file's own (a file of a filing package).
 * A file signed by ONE with a lawyer's certificate (a `.p7s`, migration 0042) leaves only in the hands of the lawyer
 * whose certificate signed it: only the action that asked the database so (`signedCopy`) hands one out.
 */
export async function downloadUrl(
  context: MemberContext,
  fileId: string,
  downloadName?: string,
  options: { signedCopy?: boolean } = {},
): Promise<DownloadLink> {
  if (!context.firm) return { ok: false, code: "not_authorized" };
  const backend = service();
  if (!backend) return { ok: false, code: "backend_not_configured" };

  const { data: file } = await context.supabase
    .from("files")
    .select("id, storage_path, status, name, detected_mime")
    .eq("id", fileId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  if (!file || file.status !== "stored") return { ok: false, code: "not_found" };
  if (file.detected_mime === SIGNED_COPY_MIME && !options.signedCopy) return { ok: false, code: "not_found" };

  const { data: signed, error } = await backend.storage
    .from(FIRM_FILES_BUCKET)
    .createSignedUrl(file.storage_path as string, DOWNLOAD_SECONDS, {
      download: downloadName || (file.name as string),
    });
  if (error || !signed) return { ok: false, code: "storage_unavailable" };
  return { ok: true, url: signed.signedUrl, name: downloadName || (file.name as string) };
}

/**
 * Takes back an upload that measured fine but found no place (the case it was
 * meant for refused it): the row and the object go, so no stored file is left
 * that no screen lists. Only for the file the same request has just measured
 * (the caller knows it from `finishUpload`), never in a support visit, and
 * never a file something already uses.
 */
export async function discardUpload(
  context: MemberContext,
  fileId: string,
  purpose: "upload" | "statement" = "upload",
): Promise<void> {
  if (!context.firm) return;
  const backend = service();
  if (!backend) return;
  // Read under the person's session, and only a file this person reserved for an upload: a file of
  // another firm, another purpose (a client's, a conversation's) or another person is not found.
  const { data: file } = await context.supabase
    .from("files")
    .select("id, storage_path")
    .eq("id", fileId)
    .eq("org_id", context.firm.id)
    .eq("purpose", purpose)
    .eq("uploaded_by", context.userId)
    .maybeSingle();
  if (!file) return;
  const { data: used } = await context.supabase.from("case_documents").select("id").eq("file_id", fileId).maybeSingle();
  if (used) return;
  const { data: told } = await context.supabase
    .from("case_statements")
    .select("id")
    .eq("audio_file_id", fileId)
    .maybeSingle();
  if (told) return;
  const { data: discarded } = await backend.rpc("discard_file", { target_file: fileId });
  if ((discarded as { ok?: boolean } | null)?.ok) {
    await supabaseFileStore(backend)
      .remove([file.storage_path as string])
      .catch(() => undefined);
  }
}
