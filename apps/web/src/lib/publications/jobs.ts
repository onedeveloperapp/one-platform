import "server-only";

import { djenClient } from "@/lib/courts/djen";
import type { Sweep } from "@/lib/jobs/schedule";
import { tellPublicationAcks } from "@/lib/publications/ack-notices";
import { captureNext, prepareDjenCaptures } from "@/lib/publications/capture";
import { readHistoryNext } from "@/lib/publications/history-work";
import { TRIAGE_TASK } from "@/lib/publications/publications";
import { READING_TASK } from "@/lib/publications/reading";
import { readingReadyKinds, readNext, settlePublicationReadings } from "@/lib/publications/reading-work";
import { queuePublicationTriage, triageNext, triageReady } from "@/lib/publications/triage-work";

/**
 * How many registrations one round of the capture reads: the next round, five
 * minutes later, takes the rest. One lane, one registration at a time, so
 * this and the cadence are the ceiling of the reading: about five thousand
 * readings a day, which is every registration four times a day for some
 * fourteen hundred of them. Past that the readings come late, and the
 * operator sees it (`admin_djen_health`).
 */
const CAPTURES_PER_ROUND = 20;

const HISTORIES_PER_ROUND = 5;

/**
 * How many publications one round of the shadow triage classifies. Past what
 * the rounds reach, the publications the AI did not reach within the days the
 * setting gives stay unclassified (`triage_days`): the measure is a sample of
 * what arrives, never a backlog of what arrived long ago.
 */
const TRIAGES_PER_ROUND = 10;

/**
 * How many readings one round of ONE's reading takes: a publication is read
 * right after a person triaged it (`queuePublicationReading`), so the sweep
 * only takes what that did not reach.
 */
const READINGS_PER_ROUND = 5;

export const publicationSweeps: Sweep[] = [
  /**
   * The reading of the DJEN (migration 0028), recomputed from the data on
   * every pass: who is read is worked out first, then each registration at
   * the bar held by somebody of a firm is read a few times a day; a reading a
   * person asked for is done right after their answer (`queueFirmCapture`).
   * One is read at a time, and only by the clock: the public API counts calls
   * per address, so the platform never asks it for two things at once. When
   * the DJEN limits the calls the round stops, and the next one goes on. A
   * registration is claimed and read in one go. Where the reading is off
   * (`DJEN_CAPTURE`), nothing is claimed.
   */
  {
    key: "djen-capture",
    when: { every: 5 },
    run: async (service, until) => {
      if (!djenClient()) return { off: true };
      await prepareDjenCaptures(service);
      const outcomes: Record<string, number> = {};
      for (let turn = 0; turn < CAPTURES_PER_ROUND && Date.now() < until; turn += 1) {
        const client = djenClient();
        // Turned off meanwhile: nothing is claimed.
        const outcome = client ? await captureNext(service, client, null) : "none";
        if (outcome === "none") break;
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
        // The DJEN limited the calls or did not answer: the next registration would only meet the same.
        if (outcome === "retry") break;
      }
      // What arrived is triaged by ONE right after, not at the next beat (0104).
      if (Object.keys(outcomes).length > 0) await queuePublicationTriage();
      return outcomes;
    },
  },
  /**
   * The history of each lawsuit filed before its case was in ONE (migration 0286), read from the DJEN by its number
   * once: what is owed is read one at a time and only by the clock, as the reading by registration is (the public API
   * counts calls per address); right after the lawyer's receipt it is read at once (`queueProceedingHistory`). When the
   * DJEN limits the calls the round stops, and the next one goes on. Where the reading is off (`DJEN_CAPTURE`),
   * nothing is claimed.
   */
  {
    key: "djen-history",
    when: { every: 5 },
    run: async (service, until) => {
      if (!djenClient()) return { off: true };
      const outcomes: Record<string, number> = {};
      for (let turn = 0; turn < HISTORIES_PER_ROUND && Date.now() < until; turn += 1) {
        const client = djenClient();
        const outcome = client ? await readHistoryNext(service, client) : "none";
        if (outcome === "none") break;
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
        if (outcome === "retry") break;
      }
      if ((outcomes.done ?? 0) > 0) await queuePublicationTriage();
      return outcomes;
    },
  },
  /**
   * The shadow triage (migration 0028), recomputed from the data on every
   * pass: each publication captured is classified by the AI once, its answer
   * kept beside the publication and out of the firm's sight. Where no model
   * can be asked, nothing is claimed, so nothing is marked as failed for the
   * lack of a key. When a publication fails for a reason that is not its own
   * (the provider is out, a key was refused), its try is given back; when the
   * next one meets the same, it is the provider, and the round stops, so an
   * incident of the provider closes no publication. One alone that the
   * provider refuses never stops the round for the others.
   */
  {
    key: "publication-triage",
    // Its work is a model's: it waits while the provider of these tasks refuses the platform's AI account (0255).
    ai: [TRIAGE_TASK],
    when: { every: 5 },
    whileUsed: true,
    run: async (service, until) => {
      if (!(await triageReady(service))) return { off: true };
      const outcomes: Record<string, number> = {};
      let released = 0;
      for (let turn = 0; turn < TRIAGES_PER_ROUND && Date.now() < until; turn += 1) {
        const outcome = await triageNext(service);
        if (outcome === "none") break;
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
        released = outcome === "released" ? released + 1 : 0;
        // Twice in a row, it is not the publications: the next one would only meet the same.
        if (released >= 2) break;
      }
      return outcomes;
    },
  },
  /**
   * ONE's reading of what a person triaged as a deadline or a hearing
   * (migration 0040), recomputed from the data on every pass: what is due
   * that ONE will not read is settled first, also where no model can be
   * asked (a reading that waited too long for one goes to a person); then
   * each reading due, of the kinds a model can read here, is claimed and read
   * in one go, and what ONE recorded is followed at once (the deadline
   * counted, the hearing written to the firm's calendar). When the provider
   * fails twice in a row the round stops, so an incident of the provider
   * closes no reading.
   */
  {
    key: "publication-reading",
    // Its work is a model's: it waits while the provider of these tasks refuses the platform's AI account (0255).
    ai: Object.values(READING_TASK),
    when: { every: 5 },
    whileUsed: true,
    run: async (service, until) => {
      const settled = await settlePublicationReadings(service);
      const kinds = await readingReadyKinds(service);
      if (kinds.length === 0) return { off: true, settled };
      const outcomes: Record<string, number> = { settled };
      let released = 0;
      for (let turn = 0; turn < READINGS_PER_ROUND && Date.now() < until; turn += 1) {
        const outcome = await readNext(service, null, undefined, kinds);
        if (outcome === "none") break;
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
        released = outcome === "released" ? released + 1 : 0;
        // Twice in a row, it is not the publications: the next one would only meet the same.
        if (released >= 2) break;
      }
      return outcomes;
    },
  },
  /**
   * The bell of the awareness of ONE's triage (migration 0104), recomputed from the data on every pass: each
   * publication ONE triaged that nobody said they are aware of is told to who it waits on once, and again once a day
   * after the setting's hours, until somebody says it. Written by key: two servers at once write nothing twice.
   */
  {
    key: "publication-acks",
    when: { every: 5 },
    whileUsed: true,
    run: async (service, until) => ({ ...(await tellPublicationAcks(service, until)) }),
  },
];
