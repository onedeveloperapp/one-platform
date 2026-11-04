import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";
import { sweepNotices } from "@/lib/notices/work";

/**
 * The notices to clients (migration 0038): every ten minutes, what is due
 * recomputed from the data, reserved by the database once per person, kind
 * and occurrence, and sent by the outbox; also while ONE is used, since a
 * notice waits its minutes after what it tells and nothing else asks for it.
 * A firm that switched a kind on or a person who asked to be told again has
 * it done right after (`settleNotices`). The database fences each firm's
 * reservation, so two rounds at once send nothing twice. Counts only.
 */
export const noticeSweeps: Sweep[] = [
  {
    key: "client-notices",
    when: { every: 10 },
    whileUsed: true,
    run: async (service) => ({ ...(await sweepNotices(service)) }),
  },
];
