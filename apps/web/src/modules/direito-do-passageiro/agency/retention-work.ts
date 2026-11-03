import "server-only";

import { FIRM_FILES_BUCKET } from "@/lib/files/bucket";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of forgetting an agency's passengers (migration 0072): the database forgets the records (the
 * daily sweep, the agency's deletion, the passenger's request on the link) and lists the storage paths of the files
 * whose records went; this removes their bytes, then their rows. Records first, bytes after: a removal that fails
 * leaves the path listed for the next sweep, never a record pointing at nothing.
 */

/** How many paths one call removes, and how many calls one run makes at most. */
const PATHS_PER_CALL = 100;
const CALLS_PER_RUN = 20;

export async function removeForgottenBytes(service: SupabaseClient): Promise<number> {
  let removed = 0;
  for (let call = 0; call < CALLS_PER_RUN; call += 1) {
    const { data, error } = await service.rpc("pax_file_removals_due", { target_limit: PATHS_PER_CALL });
    if (error) throw new Error(`pax_file_removals_due failed: ${error.message}`);
    const paths = ((data ?? []) as { storage_path: string }[]).map((row) => row.storage_path);
    if (paths.length === 0) break;
    const { error: removeError } = await service.storage.from(FIRM_FILES_BUCKET).remove(paths);
    if (removeError) throw new Error(`the bytes could not be removed: ${removeError.message}`);
    const { error: doneError } = await service.rpc("pax_file_removals_done", { target_paths: paths });
    if (doneError) throw new Error(`pax_file_removals_done failed: ${doneError.message}`);
    removed += paths.length;
    if (paths.length < PATHS_PER_CALL) break;
  }
  return removed;
}

/**
 * The daily sweep: who the setting keeps no longer is forgotten, and so are the passengers an agency started from
 * documents and never confirmed within the setting's hours (0083); the bytes of their files are removed after.
 */
export async function sweepRetention(service: SupabaseClient): Promise<{ forgotten: number; drafts: number }> {
  const { data, error } = await service.rpc("pax_retention_sweep");
  if (error) throw new Error(`pax_retention_sweep failed: ${error.message}`);
  const { data: drafts, error: draftsError } = await service.rpc("pax_forget_drafts");
  if (draftsError) throw new Error(`pax_forget_drafts failed: ${draftsError.message}`);
  return {
    forgotten: Number((data as { forgotten?: unknown } | null)?.forgotten ?? 0) || 0,
    drafts: Number(drafts ?? 0) || 0,
  };
}
