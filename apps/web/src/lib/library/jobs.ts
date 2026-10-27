import "server-only";

import { expireTemplateImports, importNext } from "@/lib/library/import-work";
import { createServiceClient } from "@flyee/auth/service";
import { inngest } from "@flyee/jobs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** How many requests one run of the sweep works on: the next run takes the rest. */
const IMPORTS_PER_RUN = 4;

/**
 * The models the library makes from documents (migration 0067), recomputed
 * from the data on every pass: each request owes its text, then its marking,
 * one work at a time, each claimed and done in the same step (a step has the
 * time of the jobs route, which the transcription of a long PDF needs). A
 * request named in the event (a person just asked) is worked on at once,
 * both works in turn; the cron takes what waits, and its upkeep forgets what
 * waited longer than the setting's days.
 *
 * The steps carry ids and outcomes only: the text of a document never enters
 * a job's recorded state.
 */
export const templateImportsFunction = inngest.createFunction(
  { id: "one-template-imports", retries: 1, concurrency: { limit: 2 } },
  [{ cron: "*/5 * * * *" }, { event: "one/library.import.requested" }],
  async ({ event, step }) => {
    const asked = event.name === "one/library.import.requested" ? event.data?.importId : null;
    const target = typeof asked === "string" && UUID.test(asked) ? asked : null;
    const outcomes: Record<string, number> = {};
    if (!target) {
      const expired = await step.run("expire", () => expireTemplateImports(createServiceClient()));
      if (expired > 0) outcomes.expired = expired;
    }
    for (let turn = 0; turn < (target ? 2 : IMPORTS_PER_RUN); turn += 1) {
      const outcome = await step.run(`import-${turn}`, () => importNext(createServiceClient(), target));
      if (outcome === "none") break;
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      // A request named goes on to its marking once its text is kept, and stops there.
      if (target && outcome !== "read") break;
    }
    return outcomes;
  },
);

export const libraryFunctions = [templateImportsFunction];
