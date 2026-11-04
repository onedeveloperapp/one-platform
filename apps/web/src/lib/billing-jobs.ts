import { settleDueBillingCancellations } from "@/lib/billing-cancellation";
import { expireStaleBillingLeases, retireAbandonedCheckouts } from "@/lib/billing-maintenance";
import { sendAccessEndNotices, sendTermEndNotices, settleAccessEndings } from "@/lib/billing-notices";
import type { Sweep } from "@/lib/jobs/schedule";

export const billingSweeps: Sweep[] = [
  {
    key: "billing-cancellations",
    when: { every: 15 },
    run: async () => ({ settled: await settleDueBillingCancellations() }),
  },
  /**
   * Nightly sweep of the two things that leak when a request dies mid-flight:
   * leases nobody released, and checkouts nobody finished (which on Asaas are
   * live recurring charges billing someone who never contracted them). Both are
   * idempotent, so a retried run costs nothing.
   */
  {
    key: "billing-maintenance",
    when: { daily: { hour: 4, minute: 20 } },
    run: async () => {
      const leases = await expireStaleBillingLeases();
      const checkouts = await retireAbandonedCheckouts();
      return { leases, checkouts };
    },
  },
  /**
   * Once a day, at 10:15 in Brasília (13:15 UTC): a paid period or an access
   * term that ends within two weeks is announced to its member, once, and an
   * access whose term ran out is settled (lib/billing-notices.ts). Each claims
   * what it sends, so a round that stops half way sends nothing twice.
   */
  {
    key: "billing-term-end",
    when: { daily: { hour: 13, minute: 15 } },
    run: async (service) => {
      const terms = await sendTermEndNotices(service);
      const accesses = await sendAccessEndNotices(service);
      const endings = await settleAccessEndings(service);
      return { terms, accesses, endings };
    },
  },
];
