import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";
import { expireTemplateImports, importNext } from "@/lib/library/import-work";

/** How many works on requests one sweep does: the next sweep takes the rest. */
const IMPORTS_PER_ROUND = 2;

/**
 * The models the library makes from documents (migrations 0067 and 0079),
 * recomputed from the data on every pass: each request owes its text, then its
 * marking, then, where the firm lets ONE, the save of the firm's model, one
 * work at a time, each claimed and done in one go. A request a person just made
 * or answered is worked on right after their answer (`queueTemplateImport`),
 * and the screen that waits for it asks for the next work; the sweep takes what
 * waits, and its upkeep forgets what waited longer than the setting's days.
 * Counts only: the text of a document never enters a round's record.
 */
export const librarySweeps: Sweep[] = [
  {
    key: "template-imports",
    when: { every: 5 },
    whileUsed: true,
    run: async (service, until) => {
      const outcomes: Record<string, number> = {};
      const expired = await expireTemplateImports(service);
      if (expired > 0) outcomes.expired = expired;
      for (let turn = 0; turn < IMPORTS_PER_ROUND && Date.now() < until; turn += 1) {
        const outcome = await importNext(service, null);
        if (outcome === "none") break;
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      }
      return outcomes;
    },
  },
];
