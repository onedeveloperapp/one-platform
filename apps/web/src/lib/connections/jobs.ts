import "server-only";

import { getVault } from "@/lib/connections/vault";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/**
 * The upkeep of the vault, once a day, recomputed from the data on every pass
 * (so running it twice changes nothing twice):
 *
 * - `expire_connections`: a token past its validity is discarded and its
 *   account shows as expired; an account started and never sealed within a
 *   day is removed;
 * - the rotation: when `VAULT_KEYS` lists a newer key, every token an older
 *   key sealed is resealed with it, a batch per step, until none is left.
 *   After a pass with nothing pending the old key can leave `VAULT_KEYS`.
 */

const REWRAP_BATCH = 100;
const REWRAP_MAX_BATCHES = 50;

export const vaultUpkeepFunction = inngest.createFunction(
  { id: "one-vault-upkeep", retries: 1, concurrency: { limit: 1 } },
  { cron: "50 4 * * *" },
  async ({ step }) => {
    const expiry = await step.run("expire-connections", async () => {
      const { data, error } = await createServiceClient().rpc("expire_connections");
      if (error) throw new Error(`expire_connections failed: ${error.message}`);
      return data as { expired: number; abandoned: number };
    });

    let rewrapped = 0;
    const failedCodes: string[] = [];
    for (let batch = 0; batch < REWRAP_MAX_BATCHES; batch += 1) {
      // A step's answer is stored as JSON: plain numbers and strings only.
      const report = await step.run(`rewrap-${batch}`, async () => {
        const access = getVault();
        // No keys here: nothing can be resealed, and nothing is lost by waiting.
        if (!access.ok) return { rewrapped: 0, failedCodes: [] as string[], problem: access.problem as string | null };
        const done = await access.vault.rewrap(REWRAP_BATCH);
        return { rewrapped: done.rewrapped, failedCodes: done.failed.map((item) => item.code), problem: null };
      });
      rewrapped += report.rewrapped;
      failedCodes.push(...report.failedCodes);
      // A batch that resealed nothing ends the pass: what is left is either
      // nothing or what this key cannot open, which another pass will not fix.
      if (report.problem || report.rewrapped === 0) break;
    }

    if (failedCodes.length > 0) {
      console.error("vault_rewrap_failed", { count: failedCodes.length, codes: [...new Set(failedCodes)] });
    }
    return { ...expiry, rewrapped, failed: failedCodes.length };
  },
);

export const connectionFunctions = [vaultUpkeepFunction];
