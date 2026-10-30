/**
 * What a firm contracted of ONE's modules, and the modules still to come (migration 0075), as the screens read
 * them. A module is a package a firm contracts with its subscription of ONE (`product_modules.sold_as`); the
 * catalog says which modules are out and which are to come, and `firm_modules` which ones the firm has, since
 * when. The names and lines are the catalog's, so a module the platform adds shows with no change of code. Pure:
 * the read is `offer-read.ts`.
 */

export type ModuleSoldAs = "package" | "included";

export type ContractedModule = {
  key: string;
  name: string;
  /** One line on what the module is for; null when the catalog has none. */
  description: string | null;
  soldAs: ModuleSoldAs;
  /** When the firm got it. */
  since: string;
};

export type ComingModule = { key: string; name: string; description: string | null };

export type ModuleOffer = {
  /** What the firm has, in the catalog's order. */
  contracted: ContractedModule[];
  /** What ONE announces and no firm has yet, in the catalog's order. */
  comingSoon: ComingModule[];
};

type CatalogRow = {
  key: string;
  name: string;
  status: "available" | "coming_soon";
  soldAs: ModuleSoldAs;
  description: string | null;
  sort: number;
  retired: boolean;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

function catalogOf(rows: unknown[]): CatalogRow[] {
  return rows.flatMap((item): CatalogRow[] => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    const key = text(row.key);
    const name = text(row.name);
    // A state this code does not know (a newer database) is left out, never shown as another.
    if (!key || !name || (row.status !== "available" && row.status !== "coming_soon")) return [];
    return [
      {
        key,
        name,
        status: row.status,
        soldAs: row.sold_as === "included" ? "included" : "package",
        description: text(row.description),
        sort: typeof row.sort === "number" && Number.isFinite(row.sort) ? row.sort : 0,
        retired: row.retired_at !== null && row.retired_at !== undefined,
      },
    ];
  });
}

/**
 * The firm's modules and the ones to come, from the catalog's rows and the firm's; null when either is not a list.
 * A module the firm has that was retired, or that is not out, is not counted as contracted: no firm uses it.
 */
export function moduleOfferOf(catalog: unknown, firm: unknown): ModuleOffer | null {
  if (!Array.isArray(catalog) || !Array.isArray(firm)) return null;
  const known = catalogOf(catalog).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "pt-BR"));
  const since = new Map<string, string>();
  for (const item of firm) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    const key = text(row.module_key);
    if (key) since.set(key, text(row.enabled_at) ?? "");
  }
  return {
    contracted: known.flatMap((module): ContractedModule[] =>
      module.status === "available" && !module.retired && since.has(module.key)
        ? [
            {
              key: module.key,
              name: module.name,
              description: module.description,
              soldAs: module.soldAs,
              since: since.get(module.key) ?? "",
            },
          ]
        : [],
    ),
    comingSoon: known
      .filter((module) => module.status === "coming_soon" && !module.retired)
      .map((module) => ({ key: module.key, name: module.name, description: module.description })),
  };
}
