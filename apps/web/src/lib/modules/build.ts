import type { CaseKind, ModuleDefinition } from "@/lib/modules/types";

/**
 * What the core asks of the modules installed, built from their definitions. Pure: `registry.ts` builds it from
 * the real modules, and a test builds it from a module that exists only in the test.
 */
export type ModuleRegistry = {
  /** Every module installed, in the order given. */
  modules: readonly ModuleDefinition[];
  /** The module of a key, or null. */
  moduleOf: (key: string | null | undefined) => ModuleDefinition | null;
  /** The kinds of problem of a module, in its order; none for a module not installed. */
  caseKindsOf: (moduleKey: string | null | undefined) => readonly CaseKind[];
  /** The kinds of problem of the modules a firm uses, in the order of the modules installed. */
  caseKindsOfFirm: (moduleKeys: readonly string[]) => readonly CaseKind[];
  /** Whether a value is a kind of problem of the module. */
  isCaseKindOf: (moduleKey: string | null | undefined, kind: unknown) => kind is string;
  /** The `product` message key of a kind of problem, whatever its module; null for one no module has. */
  caseKindLabelKey: (kind: string | null | undefined) => string | null;
  /** The words a model reads for a kind of problem; null for one no module has. */
  caseKindForModel: (kind: string | null | undefined) => string | null;
  /** Where somebody of a partner of this kind sets it up (0080); null for a kind no module has. */
  partnerSetupOf: (kind: string | null | undefined) => string | null;
};

/**
 * Refuses two modules of one key, a kind of problem two modules name (a kind names its module by itself), and a
 * kind of partner two modules set up.
 */
export function buildRegistry(definitions: readonly ModuleDefinition[]): ModuleRegistry {
  const byKey = new Map<string, ModuleDefinition>();
  const kinds = new Map<string, CaseKind>();
  const setups = new Map<string, string>();
  for (const definition of definitions) {
    if (byKey.has(definition.key)) throw new Error(`module_twice:${definition.key}`);
    byKey.set(definition.key, definition);
    if (definition.partnerSetup) {
      if (setups.has(definition.partnerSetup.kind))
        throw new Error(`partner_kind_twice:${definition.partnerSetup.kind}`);
      setups.set(definition.partnerSetup.kind, definition.partnerSetup.href);
    }
    for (const kind of definition.caseKinds) {
      if (kinds.has(kind.key)) throw new Error(`case_kind_twice:${kind.key}`);
      kinds.set(kind.key, kind);
    }
  }
  const moduleOf = (key: string | null | undefined) => (key ? (byKey.get(key) ?? null) : null);
  const caseKindsOf = (moduleKey: string | null | undefined) => moduleOf(moduleKey)?.caseKinds ?? [];
  return {
    modules: definitions,
    moduleOf,
    caseKindsOf,
    caseKindsOfFirm: (moduleKeys) =>
      definitions
        .filter((definition) => moduleKeys.includes(definition.key))
        .flatMap((definition) => definition.caseKinds),
    isCaseKindOf: (moduleKey, kind): kind is string =>
      typeof kind === "string" && caseKindsOf(moduleKey).some((item) => item.key === kind),
    caseKindLabelKey: (kind) => (kind ? (kinds.get(kind)?.labelKey ?? null) : null),
    caseKindForModel: (kind) => (kind ? (kinds.get(kind)?.forModel ?? null) : null),
    partnerSetupOf: (kind) => (kind ? (setups.get(kind) ?? null) : null),
  };
}
