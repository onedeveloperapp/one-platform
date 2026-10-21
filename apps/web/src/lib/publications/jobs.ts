import "server-only";

import { djenClient } from "@/lib/courts/djen";
import { captureNext, prepareDjenCaptures } from "@/lib/publications/capture";
import { readingReadyKinds, readNext, settlePublicationReadings } from "@/lib/publications/reading-work";
import { triageNext, triageReady } from "@/lib/publications/triage-work";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

/**
 * How many registrations one run of the capture reads: the next run, five
 * minutes later, takes the rest. One lane, one registration at a time, so
 * this and the cadence are the ceiling of the reading: about eleven thousand
 * readings a day, which is every registration four times a day for some
 * twenty-eight hundred of them. Past that the readings come late, and the
 * operator sees it (`admin_djen_health`).
 */
const CAPTURES_PER_RUN = 40;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The reading of the DJEN (migration 0028), recomputed from the data on
 * every pass: who is read is worked out first, then each registration at
 * the bar held by somebody of a firm is read a few times a day, and a
 * reading a person asked for starts at once
 * (`one/publications.capture.requested`, for that firm only). One is read
 * at a time: the public API counts calls per address, so the platform never
 * asks it for two things at once. When the DJEN limits the calls the run
 * stops, and the next one goes on.
 *
 * A registration is claimed and read in the same step. The lane lets one
 * step run at a time while a run starts every five minutes whether or not
 * the last one ended, so a step may wait long for its turn: a claim taken in
 * one step and worked on in another would go stale in that line, and a
 * registration nobody read would be given up as one that failed.
 *
 * The steps carry outcomes only: a registration, a day or a communication
 * is read inside the work, never kept in a job's recorded state. Where the
 * reading is off (`DJEN_CAPTURE`), nothing is claimed.
 */
export const djenCaptureFunction = inngest.createFunction(
  { id: "one-djen-capture", retries: 1, concurrency: { limit: 1 } },
  [{ cron: "*/5 * * * *" }, { event: "one/publications.capture.requested" }],
  async ({ event, step }) => {
    if (!djenClient()) return { off: true };
    const asked = event.name === "one/publications.capture.requested" ? event.data?.orgId : null;
    const org = typeof asked === "string" && UUID.test(asked) ? asked : null;
    // A reading a person asked for was prepared by the request itself, for its firm.
    if (!org) await step.run("prepare", () => prepareDjenCaptures(createServiceClient()));
    const outcomes: Record<string, number> = {};
    for (let turn = 0; turn < CAPTURES_PER_RUN; turn += 1) {
      const outcome = await step.run(`capture-${turn}`, async () => {
        const client = djenClient();
        // Turned off meanwhile: nothing is claimed.
        return client ? captureNext(createServiceClient(), client, org) : "none";
      });
      if (outcome === "none") break;
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      // The DJEN limited the calls or did not answer: the next registration would only meet the same.
      if (outcome === "retry") break;
    }
    return outcomes;
  },
);

/**
 * How many publications one run of the shadow triage classifies: with the
 * cadence, some seven thousand a day for the whole platform. Past that the
 * AI does not reach every publication, and the ones it did not reach within
 * the days the setting gives stay unclassified (`triage_days`): the measure
 * is a sample of what arrives, never a backlog of what arrived long ago.
 */
const TRIAGES_PER_RUN = 25;

/**
 * The shadow triage (migration 0028), recomputed from the data on every
 * pass: each publication captured is classified by the AI once, its answer
 * kept beside the publication and out of the firm's sight. Where no model
 * can be asked, nothing is claimed, so nothing is marked as failed for the
 * lack of a key. When a run fails for a reason that is not the
 * publication's (the provider is out, a key was refused), that publication's
 * try is given back; when the next one meets the same, it is the provider,
 * and the run stops, so an incident of the provider closes no publication.
 * One alone that the provider refuses never stops the run for the others.
 * A publication is claimed and classified in the same step, for the reason
 * the capture's are.
 *
 * The steps carry outcomes only.
 */
export const publicationTriageFunction = inngest.createFunction(
  { id: "one-publication-triage", retries: 1, concurrency: { limit: 1 } },
  [{ cron: "*/5 * * * *" }],
  async ({ step }) => {
    const ready = await step.run("ready", () => triageReady(createServiceClient()));
    if (!ready) return { off: true };
    const outcomes: Record<string, number> = {};
    let released = 0;
    for (let turn = 0; turn < TRIAGES_PER_RUN; turn += 1) {
      const outcome = await step.run(`triage-${turn}`, () => triageNext(createServiceClient()));
      if (outcome === "none") break;
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      released = outcome === "released" ? released + 1 : 0;
      // Twice in a row, it is not the publications: the next one would only meet the same.
      if (released >= 2) break;
    }
    return outcomes;
  },
);

/**
 * How many readings one run of ONE's reading takes: a publication is read
 * minutes after a person triaged it (`one/publication.read`), so the sweep
 * only takes what a request did not reach.
 */
const READINGS_PER_RUN = 20;

/**
 * ONE's reading of what a person triaged as a deadline or a hearing
 * (migration 0040), recomputed from the data on every pass: what is due
 * that ONE will not read is settled first, also where no model can be
 * asked (a reading that waited too long for one goes to a person); then
 * each reading due, of the kinds a model can read here, is claimed and read
 * in the same step, for the reason the capture's are, and what ONE recorded
 * is followed at once (the deadline counted, the hearing written to the
 * firm's calendar). When the provider fails twice in a row the run stops,
 * so an incident of the provider closes no reading. A request names its
 * publication, and only it is read.
 *
 * The steps carry outcomes only.
 */
export const publicationReadingFunction = inngest.createFunction(
  { id: "one-publication-reading", retries: 1, concurrency: { limit: 1 } },
  [{ cron: "*/5 * * * *" }, { event: "one/publication.read" }],
  async ({ event, step }) => {
    const settled = await step.run("settle", () => settlePublicationReadings(createServiceClient()));
    const kinds = await step.run("ready", () => readingReadyKinds(createServiceClient()));
    if (kinds.length === 0) return { off: true, settled };
    const asked = event.name === "one/publication.read" ? event.data?.publicationId : null;
    const publication = typeof asked === "string" && UUID.test(asked) ? asked : null;
    const outcomes: Record<string, number> = { settled };
    let released = 0;
    for (let turn = 0; turn < READINGS_PER_RUN; turn += 1) {
      const outcome = await step.run(`read-${turn}`, () =>
        readNext(createServiceClient(), publication, undefined, kinds),
      );
      if (outcome === "none") break;
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      released = outcome === "released" ? released + 1 : 0;
      // Twice in a row, it is not the publications: the next one would only meet the same.
      if (released >= 2) break;
    }
    return outcomes;
  },
);

export const publicationFunctions = [djenCaptureFunction, publicationTriageFunction, publicationReadingFunction];
