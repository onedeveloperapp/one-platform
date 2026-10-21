import { settleDueBillingCancellations } from "@/lib/billing-cancellation";
import { expireStaleBillingLeases, retireAbandonedCheckouts } from "@/lib/billing-maintenance";
import { sendAccessEndNotices, sendTermEndNotices, settleAccessEndings } from "@/lib/billing-notices";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

export const settleBillingCancellationsFunction = inngest.createFunction(
  { id: "one-settle-billing-cancellations" },
  { cron: "*/15 * * * *" },
  async () => settleDueBillingCancellations(),
);

/**
 * Nightly sweep of the two things that leak when a request dies mid-flight:
 * leases nobody released, and checkouts nobody finished (which on Asaas are
 * live recurring charges billing someone who never contracted them). Both are
 * idempotent, so a retried run costs nothing.
 */
export const billingMaintenanceFunction = inngest.createFunction(
  { id: "one-billing-maintenance" },
  { cron: "20 4 * * *" },
  async () => {
    const leases = await expireStaleBillingLeases();
    const checkouts = await retireAbandonedCheckouts();
    return { leases, checkouts };
  },
);

/**
 * Once a day, at 10:15 in Brasília (13:15 UTC): a paid period or an access
 * term that ends within two weeks is announced to its member, once, and an
 * access whose term ran out is settled (lib/billing-notices.ts). Three steps,
 * so one that fails is retried alone.
 */
export const termEndNoticeFunction = inngest.createFunction(
  { id: "one-term-end-notices", retries: 1, concurrency: { limit: 1 } },
  { cron: "15 13 * * *" },
  async ({ step }) => {
    const terms = await step.run("send-term-end-notices", async () => sendTermEndNotices(createServiceClient()));
    const accesses = await step.run("send-access-end-notices", async () => sendAccessEndNotices(createServiceClient()));
    const endings = await step.run("settle-access-endings", async () => settleAccessEndings(createServiceClient()));
    return { terms, accesses, endings };
  },
);

export const billingFunctions = [settleBillingCancellationsFunction, billingMaintenanceFunction, termEndNoticeFunction];
