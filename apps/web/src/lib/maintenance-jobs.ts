import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Nightly housekeeping of the things that only grow.
 *
 * - `rollup_product_events`: yesterday's usage events folded into
 *   `product_events_daily`;
 * - `purge_product_events`: raw events older than 13 months (the rollup stays).
 *
 * Every task is idempotent and independent: one that fails leaves the other to
 * run, and the next night does it again.
 */

async function call(service: SupabaseClient, fn: string): Promise<unknown> {
  const { data, error } = await service.rpc(fn);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data;
}

/** Every night at 01:30 in Brasília (04:30 UTC), after the day in São Paulo has closed. */
export const maintenanceSweeps: Sweep[] = [
  {
    key: "maintenance",
    when: { daily: { hour: 4, minute: 30 } },
    run: async (service) => {
      const rolledUp = await call(service, "rollup_product_events").catch(() => "failed");
      const eventsPurged = await call(service, "purge_product_events").catch(() => "failed");
      return { rolledUp, eventsPurged };
    },
  },
];
