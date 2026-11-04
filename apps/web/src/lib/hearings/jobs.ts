import "server-only";

import { syncHearings } from "@/lib/hearings/calendar-work";
import type { Sweep } from "@/lib/jobs/schedule";

/** How many rounds one sweep makes, and how many hearings each writes. */
const MOST_ROUNDS = 3;
const PER_ROUND = 50;

/**
 * The firm's calendar of hearings (migration 0037): every ten minutes, and
 * right after a hearing changed or a calendar was connected
 * (`settleHearingSync`, `settleCalendarSync`), what is owed recomputed from
 * the data on each round (the events of hearings to write, then the ones of
 * hearings that went), a claim worked on where it was taken. The sweep ends
 * when a round finds nothing, gives back all it took, or meets the platform's
 * own side refusing (its project out of its day at Google, its client
 * refused, the API off). Counts only.
 */
export const hearingSweeps: Sweep[] = [
  {
    key: "hearing-calendar",
    when: { every: 10 },
    whileUsed: true,
    run: async (service, until) => {
      let synced = 0;
      let lost = 0;
      let removed = 0;
      for (let round = 0; round < MOST_ROUNDS && Date.now() < until; round += 1) {
        const report = await syncHearings(service, { limit: PER_ROUND });
        synced += report.synced;
        lost += report.lost;
        removed += report.removed;
        // A round the platform's side stopped, one that took nothing new, or one that gave back all it took ends
        // the sweep: the next one tries again.
        if (report.stopped) break;
        if (report.claimed === 0 && report.removed === 0) break;
        if (report.claimed > 0 && report.claimed === report.released) break;
      }
      return { synced, lost, removed };
    },
  },
];
