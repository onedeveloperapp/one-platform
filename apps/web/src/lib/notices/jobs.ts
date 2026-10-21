import "server-only";

import { sweepNotices } from "@/lib/notices/work";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/**
 * The notices to clients (migration 0038): every ten minutes, what is due
 * recomputed from the data, reserved by the database once per person, kind
 * and occurrence, and sent by the outbox. One run at a time: the database
 * fences each firm's reservation besides. The step carries counts only.
 */
export const clientNoticesFunction = inngest.createFunction(
  { id: "one-client-notices", retries: 1, concurrency: { limit: 1 } },
  { cron: "*/10 * * * *" },
  async ({ step }) => step.run("sweep", () => sweepNotices(createServiceClient())),
);

/**
 * At once when a firm switched a kind on or somebody agreed to be told
 * (`one/notices.sweep`): requests that come together make one run, after
 * they stop coming, so no link nor screen sweeps without end.
 */
export const clientNoticesNowFunction = inngest.createFunction(
  { id: "one-client-notices-now", retries: 1, concurrency: { limit: 1 }, debounce: { period: "30s", timeout: "2m" } },
  { event: "one/notices.sweep" },
  async ({ step }) => step.run("sweep", () => sweepNotices(createServiceClient())),
);

export const noticeFunctions = [clientNoticesFunction, clientNoticesNowFunction];
