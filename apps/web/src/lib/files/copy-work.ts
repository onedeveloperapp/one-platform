import "server-only";

import { FIRM_FILES_BUCKET } from "@/lib/files/store";
import type { Sweep, SweepReport } from "@/lib/jobs/schedule";
import type { SupabaseClient } from "@supabase/supabase-js";

/** The second private bucket the firms' files are copied into (migration 0205). */
export const FIRM_FILES_COPY_BUCKET = "firm-files-copy";

/**
 * The copy of the firms' files (migration 0205), the backend's half: each stored file is copied into the second
 * bucket, a few at a time, and recorded; a copy whose file's record went is removed, first the ones the database
 * queued and then any copy made of a file that went while it was being copied, so an erasure reaches the copy too.
 */
export async function fileCopyRound(service: SupabaseClient, until: number): Promise<SweepReport> {
  const report = { copied: 0, removed: 0, failed: 0 };

  const { data: removals, error: removalsError } = await service.rpc("file_copy_removals_due", { target_limit: 200 });
  if (removalsError) throw new Error("file_copy_removals_due failed");
  for (const removal of (Array.isArray(removals) ? removals : []) as { id: string; storage_path: string }[]) {
    if (Date.now() >= until) return report;
    const { error } = await service.storage.from(FIRM_FILES_COPY_BUCKET).remove([removal.storage_path]);
    await service.rpc("finish_file_copy_removal", { target_removal: removal.id, target_done: !error });
    if (error) report.failed += 1;
    else report.removed += 1;
  }

  const { data: due, error: dueError } = await service.rpc("files_to_copy", { target_limit: 50 });
  if (dueError) throw new Error("files_to_copy failed");
  for (const file of (Array.isArray(due) ? due : []) as { file_id: string; storage_path: string }[]) {
    if (Date.now() >= until) return report;
    const { error } = await service.storage
      .from(FIRM_FILES_BUCKET)
      .copy(file.storage_path, file.storage_path, { destinationBucket: FIRM_FILES_COPY_BUCKET });
    // A copy already there (a round that stopped before recording it) is a copy.
    if (error && !/exists|duplicate/i.test(error.message)) {
      report.failed += 1;
      continue;
    }
    const { data: recorded, error: recordError } = await service.rpc("record_file_copy", {
      target_file: file.file_id,
      target_path: file.storage_path,
    });
    if (recordError) {
      report.failed += 1;
      continue;
    }
    if (recorded === false) {
      // The file went while it was being copied: its copy goes too.
      await service.storage.from(FIRM_FILES_COPY_BUCKET).remove([file.storage_path]);
      continue;
    }
    report.copied += 1;
  }
  return report;
}

export const fileCopySweeps: Sweep[] = [
  {
    // The clock's alone: a copy is no person's wait.
    key: "files-copy",
    when: { every: 30 },
    run: (service, until) => fileCopyRound(service, until),
  },
];
