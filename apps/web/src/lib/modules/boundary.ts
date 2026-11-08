/**
 * Where the core may import a product module (lib/modules/types.ts), read by the lint (eslint.config.ts) and by
 * `boundary.test.ts`.
 *
 * A module's own code is in `src/modules/<key>/`, and its routes in a route group named after it
 * (`app/.../(<key>)/...`). The core reaches it through `registry.ts` and `jobs.ts`; tests may import anything.
 */

/**
 * The files of the core that still import the passenger module directly (the flight checks, the weather, the
 * status of a flight and the trips of the test chat), from before the module had a folder of its own: paths from
 * `apps/web`. Each is a seam to move into the module or behind the registry. A file leaves this list when it no
 * longer imports the module, and none joins it: the test fails either way.
 */
export const LEGACY_MODULE_IMPORTS: readonly string[] = [
  "src/app/(dashboard)/admin/ai/page.tsx",
  "src/app/(dashboard)/casos/[id]/case-types.ts",
  "src/app/(dashboard)/casos/[id]/components/trip-card.tsx",
  "src/app/(dashboard)/casos/[id]/load-case.ts",
  "src/app/t/[token]/test-chat.tsx",
  "src/lib/cases/actions.ts",
  "src/lib/cases/client-link-actions.ts",
  "src/lib/cases/dossier-work.ts",
  "src/lib/cases/rule-actions.ts",
  "src/lib/test-chat/actions.ts",
];

/** The files of the core that know which modules exist. */
export const MODULE_DOORS: readonly string[] = ["src/lib/modules/registry.ts", "src/lib/modules/jobs.ts"];
