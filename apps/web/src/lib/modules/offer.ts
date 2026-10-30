/**
 * What a firm contracted of ONE's modules, and the modules still to come (migration 0075), as the screens read
 * them. A module is a package a firm contracts with its subscription of ONE (`product_modules.sold_as`); the
 * catalog says which modules are out and which are to come, and `firm_modules` which ones the firm has, since
 * when. The names, lines and icons are the catalog's (0078), so a module the platform adds shows with no change of
 * code. Pure: the reads are `offer-read.ts` and the member context.
 */

export type ModuleSoldAs = "package" | "included";

/**
 * Where a module stands for a firm: contracted (it works in it), to come (no firm has it yet), or out and not
 * contracted by this firm (locked: the firm would add it to its subscription).
 */
export type ModuleState = "contracted" | "soon" | "locked";

/** A module of the catalog as every screen names it: its key, its name and its icon. */
export type ModuleCard = {
  key: string;
  name: string;
  /** One line on what the module is for; null when the catalog has none. */
  description: string | null;
  /** The icon that says what it is, by its name in the app's set (`IconMap`); null for the generic one. */
  icon: string | null;
};

export type ContractedModule = ModuleCard & {
  soldAs: ModuleSoldAs;
  /** When the firm got it. */
  since: string;
};

export type ComingModule = ModuleCard;

/** A module that is out and the firm did not contract. */
export type LockedModule = ModuleCard & { soldAs: ModuleSoldAs };

export type ModuleOffer = {
  /** What the firm has, in the catalog's order. */
  contracted: ContractedModule[];
  /** What ONE announces and no firm has yet, in the catalog's order. */
  comingSoon: ComingModule[];
  /** What is out and this firm did not contract, in the catalog's order. */
  locked: LockedModule[];
};

/** A row of the catalog, as the member context keeps it for every screen of the request. */
export type ModuleCatalogEntry = ModuleCard & {
  status: "available" | "coming_soon";
  soldAs: ModuleSoldAs;
  sort: number;
};

/** The modules as the menu lists them: each with where it stands for the firm. */
export type ModuleMenuEntry = { key: string; name: string; icon: string | null; state: ModuleState };

/** The icon the screens use for a module that names none. */
export const GENERIC_MODULE_ICON = "NiPuzzle";

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

const ICON = /^Ni[A-Z][A-Za-z0-9]{1,40}$/;

/**
 * The catalog from its rows (`product_modules`), in its order, without the modules retired; null when it is not a
 * list. A state this code does not know (a newer database) is left out, never shown as another.
 */
export function moduleCatalogOf(rows: unknown): ModuleCatalogEntry[] | null {
  if (!Array.isArray(rows)) return null;
  return rows
    .flatMap((item): ModuleCatalogEntry[] => {
      if (typeof item !== "object" || item === null) return [];
      const row = item as Record<string, unknown>;
      const key = text(row.key);
      const name = text(row.name);
      if (!key || !name || (row.status !== "available" && row.status !== "coming_soon")) return [];
      if (row.retired_at !== null && row.retired_at !== undefined) return [];
      const icon = text(row.icon);
      return [
        {
          key,
          name,
          status: row.status,
          soldAs: row.sold_as === "included" ? "included" : "package",
          description: text(row.description),
          icon: icon && ICON.test(icon) ? icon : null,
          sort: typeof row.sort === "number" && Number.isFinite(row.sort) ? row.sort : 0,
        },
      ];
    })
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "pt-BR"));
}

const card = (module: ModuleCatalogEntry): ModuleCard => ({
  key: module.key,
  name: module.name,
  description: module.description,
  icon: module.icon,
});

/**
 * The firm's modules, the ones to come and the ones it could add, from the catalog (`moduleCatalogOf`) and the
 * firm's rows (`firm_modules`); null when either could not be read. A module the firm has that was retired, or
 * that is not out, is not counted as contracted: no firm uses it.
 */
export function moduleOfferOf(catalog: readonly ModuleCatalogEntry[] | null, firm: unknown): ModuleOffer | null {
  if (!catalog || !Array.isArray(firm)) return null;
  const since = new Map<string, string>();
  for (const item of firm) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const key = text(row.module_key);
    if (key) since.set(key, text(row.enabled_at) ?? "");
  }
  return {
    contracted: catalog.flatMap((module): ContractedModule[] =>
      module.status === "available" && since.has(module.key)
        ? [{ ...card(module), soldAs: module.soldAs, since: since.get(module.key) ?? "" }]
        : [],
    ),
    comingSoon: catalog.filter((module) => module.status === "coming_soon").map(card),
    locked: catalog
      .filter((module) => module.status === "available" && !since.has(module.key))
      .map((module) => ({ ...card(module), soldAs: module.soldAs })),
  };
}

/**
 * The modules as the menu lists them, in the catalog's order: the ones the firm works in, the ones still to come
 * (said "Em breve") and the ones out that it did not contract (said locked). Nothing for no catalog.
 */
export function moduleMenuOf(
  catalog: readonly ModuleCatalogEntry[] | null,
  contracted: readonly string[],
): ModuleMenuEntry[] {
  return (catalog ?? []).map((module) => ({
    key: module.key,
    name: module.name,
    icon: module.icon,
    state:
      module.status === "coming_soon" ? "soon" : contracted.includes(module.key) ? "contracted" : ("locked" as const),
  }));
}

/** Whose work a page shows: the modules the firm contracted, and the one the page is under (null: every module). */
export type PageScope = { modules: ModuleCard[]; current: ModuleCard | null };

/**
 * Whose work a page shows (0078): the modules the firm contracted, for the choice above the page, and the one the
 * address names (`?modulo=`), when the firm has it; null for every module.
 */
export function pageScopeOf(
  catalog: readonly ModuleCatalogEntry[] | null,
  contracted: readonly string[],
  param: unknown,
): PageScope {
  const modules = (catalog ?? [])
    .filter((module) => module.status === "available" && contracted.includes(module.key))
    .map(card);
  const key = moduleScopeOf(
    param,
    modules.map((module) => module.key),
  );
  return { modules, current: modules.find((module) => module.key === key) ?? null };
}

/** A module's key as an address carries it: what the catalog allows (0068), nothing else. */
const MODULE_KEY = /^[a-z][a-z0-9-]{2,40}$/;

/**
 * The module a page is scoped to, from its address (`?modulo=`): only one the firm works in, so an address can
 * never open the scope of a module the firm does not have (the lists are the database's to filter, under the
 * person's session, either way). Null for every module.
 */
export function moduleScopeOf(value: unknown, contracted: readonly string[]): string | null {
  const key = typeof value === "string" ? value : Array.isArray(value) ? value[0] : null;
  return typeof key === "string" && MODULE_KEY.test(key) && contracted.includes(key) ? key : null;
}

/**
 * The way back of a page of the work: home, then, under a module, the module's area, then the page. The labels are
 * the screen's words.
 */
export function scopeCrumbs(
  home: string,
  title: string,
  current: ModuleCard | null,
): { label: string; href?: string }[] {
  return current
    ? [{ label: home, href: "/inicio" }, { label: current.name, href: `/modulos/${current.key}` }, { label: title }]
    : [{ label: home, href: "/inicio" }, { label: title }];
}

/** The address of a page of the work, under a module's scope or for every module. */
export function scopedHref(path: string, module: string | null, params?: Record<string, string | null | undefined>) {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params ?? {})) if (value) query.set(name, value);
  if (module) query.set("modulo", module);
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}
