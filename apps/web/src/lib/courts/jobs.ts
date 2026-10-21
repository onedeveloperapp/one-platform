import "server-only";

import { trackingSources } from "@/lib/courts/tracking";
import { projudiHoursNow, readNext } from "@/lib/courts/tracking-work";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/**
 * How many lawsuits one run reads. Projudi is asked four times a lawsuit with
 * a pause between calls, some five seconds a lawsuit: with the cadence, about
 * a thousand five hundred lawsuits of TJGO in the eight hours of its night,
 * and the aggregator's all day. Past that the readings come late, and the
 * case says when each was last read.
 */
const READS_PER_RUN = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The course of the lawsuits (migration 0031), recomputed from the data on
 * every pass: a reading a person asked for first, from any source and at any
 * hour (`one/proceedings.read.requested`, that one alone), then the routine,
 * the aggregator's at any hour and Projudi's in the hours the setting gives.
 * One lawsuit at a time, claimed and read in the same step, for the reason
 * the DJEN's reading is. Where the courts are not read (`COURT_TRACKING`),
 * nothing is claimed. The steps carry outcomes only.
 */
export const courtTrackingFunction = inngest.createFunction(
  { id: "one-court-tracking", retries: 1, concurrency: { limit: 1 } },
  [{ cron: "*/10 * * * *" }, { event: "one/proceedings.read.requested" }],
  async ({ event, step }) => {
    const sources = trackingSources();
    if (!sources.projudi && !sources.aggregator) return { off: true };
    const asked = event.name === "one/proceedings.read.requested" ? event.data?.trackingId : null;
    const trackingId = typeof asked === "string" && UUID.test(asked) ? asked : null;
    const projudiHours = trackingId ? false : await step.run("hours", () => projudiHoursNow(createServiceClient()));
    const outcomes: Record<string, number> = {};
    // A key refused or a balance run out at the aggregator: its next lawsuit would only meet the same, so
    // the rest of the run reads Projudi alone.
    let aggregatorStopped = false;
    for (let turn = 0; turn < (trackingId ? 1 : READS_PER_RUN); turn += 1) {
      const skipAggregator = aggregatorStopped;
      const outcome = await step.run(`read-${turn}`, async () => {
        const at = trackingSources();
        const now = skipAggregator ? { ...at, aggregator: null } : at;
        const service = createServiceClient();
        const requested = await readNext(service, now, { requestedOnly: true, trackingId });
        if (requested !== "none" || trackingId) return requested;
        return readNext(service, projudiHours ? now : { ...now, projudi: null });
      });
      if (outcome === "none") break;
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      if (outcome === "stopped") aggregatorStopped = true;
    }
    return outcomes;
  },
);

export const courtFunctions = [courtTrackingFunction];
