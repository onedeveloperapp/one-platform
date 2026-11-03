import type { ModuleCatalogEntry, ModuleTone } from "@/lib/modules/offer";

/**
 * The setups of the modules a firm contracted (migration 0081), as pure rules: what the core's finish opens next,
 * what the home's list still asks for, and where one module's setup goes once it is answered. Only a module the
 * firm contracted, that is out and that has a setup of its own (`firmSetup` of its definition) has one: a module
 * to come is never set up (it is shown disabled, as what the firm could add one day).
 */

export type ModuleSetup = {
  key: string;
  name: string;
  icon: string | null;
  tone: ModuleTone;
  /** The page of the module's route group where it is set up. */
  href: string;
  /** Who manages the firm finished it or set it aside. */
  answered: boolean;
};

/**
 * The module setups of a firm, in the catalog's order, from the catalog, the firm's rows of `firm_modules` and the
 * registry's answer of where each module is set up; null when either read failed.
 */
export function moduleSetupsOf(
  catalog: readonly ModuleCatalogEntry[] | null,
  rows: unknown,
  firmSetupOf: (key: string) => string | null,
): ModuleSetup[] | null {
  if (!catalog || !Array.isArray(rows)) return null;
  const answered = new Map<string, boolean>();
  for (const item of rows) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.module_key === "string") answered.set(row.module_key, typeof row.setup_answered_at === "string");
  }
  return catalog.flatMap((module): ModuleSetup[] => {
    const href = firmSetupOf(module.key);
    if (module.status !== "available" || !answered.has(module.key) || !href) return [];
    return [
      {
        key: module.key,
        name: module.name,
        icon: module.icon,
        tone: module.tone,
        href,
        answered: answered.get(module.key) === true,
      },
    ];
  });
}

/** The first module setup never answered after the one named (or the first of all), which the finish opens. */
export function nextModuleSetup(
  setups: readonly ModuleSetup[] | null,
  after: string | null = null,
): ModuleSetup | null {
  if (!setups) return null;
  const from = after ? setups.findIndex((setup) => setup.key === after) + 1 : 0;
  return setups.slice(Math.max(0, from)).find((setup) => !setup.answered) ?? null;
}
