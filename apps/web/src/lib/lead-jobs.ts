import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/**
 * Daily retention of the waitlist (purge_expired_leads, migration 0013): an
 * address that never confirmed is erased after 7 days, an opted-out one after
 * 6 months, the per-network window after a day, change history included. The
 * waitlist page and the confirmation e-mail promise the 7 days, so this job is
 * part of the promise, not housekeeping.
 */
export const purgeExpiredLeadsFunction = inngest.createFunction(
  { id: "one-purge-expired-leads" },
  { cron: "40 4 * * *" },
  async () => {
    const { data, error } = await createServiceClient().rpc("purge_expired_leads");
    if (error) throw new Error(`purge_expired_leads failed: ${error.message}`);
    return data;
  },
);

export const leadFunctions = [purgeExpiredLeadsFunction];
