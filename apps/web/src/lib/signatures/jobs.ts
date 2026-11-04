import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";
import { openReservedEnvelopes, pollPendingEnvelopes, sendProviderCancels } from "@/lib/signatures/work";

/**
 * The signatures' sweep (migration 0023), recomputed from the data on every
 * pass: the envelopes a person reserved are opened at ZapSign, the ones
 * pending that nobody heard of for a while are asked for again, and the
 * cancels made in ONE are sent to ZapSign. A person's request opens its own
 * envelope at once; the sweep is what catches anything that did not finish.
 */
export const signatureSweeps: Sweep[] = [
  {
    key: "signatures",
    when: { every: 10 },
    whileUsed: true,
    run: async (service) => {
      const opened = await openReservedEnvelopes(service, 10);
      const asked = await pollPendingEnvelopes(service, 50);
      const cancelled = await sendProviderCancels(service, 20);
      return { ...opened, asked, cancelled };
    },
  },
];
