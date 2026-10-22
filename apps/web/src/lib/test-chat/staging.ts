import "server-only";

import { FIRM_FILES_BUCKET } from "@/lib/files/bucket";
import type { MediaResult } from "@flyee/whatsapp/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Where a file the test chat's page sends as the passenger waits until the
 * backend brings it in (migration 0050), as the vendor keeps a media until
 * it is fetched: in the firm's private bucket, under the firm, by an id the
 * page was given. The media worker reads it through the test chat's
 * provider (`TestChatProvider.fetchMedia`) and forgets it once kept.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The place of a staged file; null for an id that is not one the page could have been given. */
export function stagedPath(orgId: string, mediaId: string): string | null {
  return UUID.test(orgId) && UUID.test(mediaId) ? `staging/test-chat/${orgId}/${mediaId}` : null;
}

/** A staged file read back, as the vendor would answer for a media id. */
export async function readStaged(service: SupabaseClient, orgId: string, mediaId: string): Promise<MediaResult> {
  const path = stagedPath(orgId, mediaId);
  if (!path) return { kind: "gone" };
  try {
    const { data, error } = await service.storage.from(FIRM_FILES_BUCKET).download(path);
    if (error || !data) return { kind: "gone" };
    const bytes = new Uint8Array(await data.arrayBuffer());
    // The type is the one the page declared when it sent the message: the worker measures the bytes anyway.
    return { kind: "fetched", bytes, mime: "" };
  } catch {
    return { kind: "later", detail: "staging_unavailable" };
  }
}

/** A staged file kept in the firm's files is forgotten where it waited. Never throws. */
export async function forgetStaged(service: SupabaseClient, orgId: string, mediaId: string): Promise<void> {
  const path = stagedPath(orgId, mediaId);
  if (!path) return;
  await service.storage
    .from(FIRM_FILES_BUCKET)
    .remove([path])
    .then(
      () => undefined,
      () => undefined,
    );
}
