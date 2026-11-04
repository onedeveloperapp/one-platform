import type { Sweep } from "@/lib/jobs/schedule";

/**
 * Daily retention of the waitlist (purge_expired_leads, migration 0013): an
 * address that never confirmed is erased after 7 days, an opted-out one after
 * 6 months, the per-network window after a day, change history included. The
 * waitlist page and the confirmation e-mail promise the 7 days, so this sweep
 * is part of the promise, not housekeeping.
 */
export const leadSweeps: Sweep[] = [
  {
    key: "purge-leads",
    when: { daily: { hour: 4, minute: 40 } },
    run: async (service) => {
      const { data, error } = await service.rpc("purge_expired_leads");
      if (error) throw new Error(`purge_expired_leads failed: ${error.message}`);
      return { purged: data };
    },
  },
];
