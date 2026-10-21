import "server-only";

import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Nightly housekeeping of the things that only grow.
 *
 * - `rollup_product_events`: yesterday's usage events folded into
 *   `product_events_daily`;
 * - `purge_product_events`: raw events older than 13 months (the rollup stays).
 *
 * Every task is idempotent and independent: each runs as its own step, so one
 * that fails is retried alone and does not hold the others back.
 */

async function call(service: SupabaseClient, fn: string): Promise<unknown> {
  const { data, error } = await service.rpc(fn);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data;
}

/** Every night at 01:30 in Brasília (04:30 UTC), after the day in São Paulo has closed. */
export const maintenanceFunction = inngest.createFunction(
  { id: "one-maintenance", retries: 2, concurrency: { limit: 1 } },
  { cron: "30 4 * * *" },
  async ({ step }) => {
    const rolledUp = await step.run("rollup-product-events", async () =>
      call(createServiceClient(), "rollup_product_events"),
    );
    const eventsPurged = await step.run("purge-product-events", async () =>
      call(createServiceClient(), "purge_product_events"),
    );
    return { rolledUp, eventsPurged };
  },
);

export const maintenanceFunctions = [maintenanceFunction];
