import "server-only";

import { trackingSources } from "@/lib/courts/tracking";
import { projudiHoursNow, readNext } from "@/lib/courts/tracking-work";
import type { Sweep } from "@/lib/jobs/schedule";

/**
 * How many lawsuits one round reads. Projudi is asked four times a lawsuit
 * with a pause between calls, some five seconds a lawsuit: with the cadence,
 * about seven hundred lawsuits of TJGO in the eight hours of its night, and
 * the aggregator's all day. Past that the readings come late, and the case
 * says when each was last read.
 */
const READS_PER_ROUND = 15;

/**
 * The course of the lawsuits (migration 0031), recomputed from the data on
 * every pass: what a person asked for first (they also have it read right
 * after their answer, `queueProceedingRead`), then the routine, the
 * aggregator's at any hour and Projudi's in the hours the setting gives. One
 * lawsuit at a time, claimed and read in one go, and only by the clock: the
 * tribunal is read one call at a time, never from two servers at once. Where
 * the courts are not read (`COURT_TRACKING`), nothing is claimed. Counts only.
 */
export const courtSweeps: Sweep[] = [
  {
    key: "court-tracking",
    when: { every: 10 },
    run: async (service, until) => {
      const sources = trackingSources();
      if (!sources.projudi && !sources.aggregator) return { off: true };
      const projudiHours = await projudiHoursNow(service);
      const outcomes: Record<string, number> = {};
      // A key refused or a balance run out at the aggregator: its next lawsuit would only meet the same, so the
      // rest of the round reads Projudi alone.
      let aggregatorStopped = false;
      for (let turn = 0; turn < READS_PER_ROUND && Date.now() < until; turn += 1) {
        const at = trackingSources();
        const now = aggregatorStopped ? { ...at, aggregator: null } : at;
        const requested = await readNext(service, now, { requestedOnly: true, trackingId: null });
        const outcome =
          requested !== "none" ? requested : await readNext(service, projudiHours ? now : { ...now, projudi: null });
        if (outcome === "none") break;
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
        if (outcome === "stopped") aggregatorStopped = true;
      }
      return outcomes;
    },
  },
];
