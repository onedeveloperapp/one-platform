import "server-only";

import { syncHearings } from "@/lib/hearings/calendar-work";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/** How many rounds one run makes, and how many hearings each writes. */
const MOST_ROUNDS = 10;
const PER_ROUND = 50;

/**
 * The firm's calendar of hearings (migration 0037): every ten minutes, and
 * at once when a hearing changed or a calendar was connected
 * (`one/hearings.changed`), what is owed recomputed from the data on each
 * round (the events of hearings to write, then the ones of hearings that
 * went), a claim worked on in the step that took it. The run ends when a
 * round finds nothing, gives back all it took, or meets the platform's own
 * side refusing (its project out of its day at Google, its client refused,
 * the API off). The steps carry counts only.
 */
export const hearingCalendarFunction = inngest.createFunction(
  { id: "one-hearing-calendar", retries: 1, concurrency: { limit: 1 } },
  [{ cron: "*/10 * * * *" }, { event: "one/hearings.changed" }],
  async ({ step }) => {
    let synced = 0;
    let lost = 0;
    let removed = 0;
    for (let round = 0; round < MOST_ROUNDS; round += 1) {
      const report = await step.run(`sync-${round}`, () => syncHearings(createServiceClient(), { limit: PER_ROUND }));
      synced += report.synced;
      lost += report.lost;
      removed += report.removed;
      // A round the platform's side stopped, one that took nothing new, or one that gave back all it took ends
      // the run: the next one tries again.
      if (report.stopped) break;
      if (report.claimed === 0 && report.removed === 0) break;
      if (report.claimed > 0 && report.claimed === report.released) break;
    }
    return { synced, lost, removed };
  },
);

export const hearingFunctions = [hearingCalendarFunction];
