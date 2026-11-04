import "server-only";

import { getVault } from "@/lib/connections/vault";
import type { Sweep } from "@/lib/jobs/schedule";

/**
 * The upkeep of the vault, once a day, recomputed from the data on every pass
 * (so running it twice changes nothing twice):
 *
 * - `expire_connections`: a token past its validity is discarded and its
 *   account shows as expired; an account started and never sealed within a
 *   day is removed;
 * - the rotation: when `VAULT_KEYS` lists a newer key, every token an older
 *   key sealed is resealed with it, a batch at a time, until none is left or
 *   the round's time is over (the next day's goes on). After a pass with
 *   nothing pending the old key can leave `VAULT_KEYS`.
 */

const REWRAP_BATCH = 100;
const REWRAP_MAX_BATCHES = 50;

export const connectionSweeps: Sweep[] = [
  {
    key: "vault-upkeep",
    when: { daily: { hour: 4, minute: 50 } },
    run: async (service, until) => {
      const { data, error } = await service.rpc("expire_connections");
      if (error) throw new Error(`expire_connections failed: ${error.message}`);
      const expiry = data as { expired: number; abandoned: number };

      let rewrapped = 0;
      const failedCodes: string[] = [];
      for (let batch = 0; batch < REWRAP_MAX_BATCHES && Date.now() < until; batch += 1) {
        const access = getVault();
        // No keys here: nothing can be resealed, and nothing is lost by waiting.
        if (!access.ok) break;
        const done = await access.vault.rewrap(REWRAP_BATCH);
        rewrapped += done.rewrapped;
        failedCodes.push(...done.failed.map((item) => item.code));
        // A batch that resealed nothing ends the pass: what is left is either
        // nothing or what this key cannot open, which another pass will not fix.
        if (done.rewrapped === 0) break;
      }

      if (failedCodes.length > 0) {
        console.error("vault_rewrap_failed", { count: failedCodes.length, codes: [...new Set(failedCodes)] });
      }
      return { ...expiry, rewrapped, failed: failedCodes.length };
    },
  },
];
