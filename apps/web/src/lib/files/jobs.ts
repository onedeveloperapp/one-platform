import "server-only";

import { FIRM_FILES_BUCKET } from "@/lib/files/store";
import type { Sweep } from "@/lib/jobs/schedule";

/**
 * The upkeep of the firms' files, every hour, recomputed from the data on
 * every pass (migration 0018):
 *
 * - a reservation whose time ended without an upload is removed;
 * - the objects nothing keeps (no record, or a rejected one) are removed
 *   from the bucket. Removing an object twice removes nothing twice.
 */
const REMOVE_BATCH = 100;

export const fileSweeps: Sweep[] = [
  {
    key: "files-upkeep",
    when: { hourly: 20 },
    run: async (service) => {
      const { data: expiredCount, error: expireError } = await service.rpc("expire_file_reservations");
      if (expireError) throw new Error(`expire_file_reservations failed: ${expireError.message}`);
      const expired = Number(expiredCount ?? 0);

      const { data, error } = await service.rpc("orphaned_firm_files", { target_limit: 500 });
      if (error) throw new Error(`orphaned_firm_files failed: ${error.message}`);
      const paths = Array.isArray(data) ? (data as string[]) : [];
      let removed = 0;
      for (let index = 0; index < paths.length; index += REMOVE_BATCH) {
        const { data: deleted, error: removeError } = await service.storage
          .from(FIRM_FILES_BUCKET)
          .remove(paths.slice(index, index + REMOVE_BATCH));
        if (removeError) throw new Error(`remove failed: ${removeError.message}`);
        removed += deleted?.length ?? 0;
      }
      return { expired, removed };
    },
  },
];
