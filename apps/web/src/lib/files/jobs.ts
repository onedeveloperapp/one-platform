import "server-only";

import { FIRM_FILES_BUCKET } from "@/lib/files/store";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/**
 * The upkeep of the firms' files, every hour, recomputed from the data on
 * every pass (migration 0018):
 *
 * - a reservation whose time ended without an upload is removed;
 * - the objects nothing keeps (no record, or a rejected one) are removed
 *   from the bucket. Removing an object twice removes nothing twice.
 */
const REMOVE_BATCH = 100;

export const filesUpkeepFunction = inngest.createFunction(
  { id: "one-files-upkeep", retries: 1, concurrency: { limit: 1 } },
  { cron: "20 * * * *" },
  async ({ step }) => {
    const expired = await step.run("expire-reservations", async () => {
      const { data, error } = await createServiceClient().rpc("expire_file_reservations");
      if (error) throw new Error(`expire_file_reservations failed: ${error.message}`);
      return Number(data ?? 0);
    });

    const removed = await step.run("remove-orphans", async () => {
      const service = createServiceClient();
      const { data, error } = await service.rpc("orphaned_firm_files", { target_limit: 500 });
      if (error) throw new Error(`orphaned_firm_files failed: ${error.message}`);
      const paths = Array.isArray(data) ? (data as string[]) : [];
      let gone = 0;
      for (let index = 0; index < paths.length; index += REMOVE_BATCH) {
        const { data: deleted, error: removeError } = await service.storage
          .from(FIRM_FILES_BUCKET)
          .remove(paths.slice(index, index + REMOVE_BATCH));
        if (removeError) throw new Error(`remove failed: ${removeError.message}`);
        gone += deleted?.length ?? 0;
      }
      return gone;
    });

    return { expired, removed };
  },
);

export const fileFunctions = [filesUpkeepFunction];
