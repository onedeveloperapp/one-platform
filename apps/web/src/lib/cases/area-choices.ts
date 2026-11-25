/**
 * The areas of the firm a person opens a case of by hand (0292): an area of the firm's own (one no module serves),
 * not taken out, with its script published, and the kinds of case its script in force lists. A module's cases are
 * opened by the module's own kinds; an area with no script published opens nothing yet. Pure.
 */
export type AreaChoice = { id: string; name: string; types: { key: string; name: string }[] };

type AreaRow = { id: unknown; name: unknown; law_area: unknown };
type LawRow = { key: unknown; module: unknown };
type ScriptRow = { area_id: unknown; version: unknown; tipos: unknown };

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The kinds of case a script lists, in its order, each with its key and the name the client understands. */
export function scriptTypes(tipos: unknown): { key: string; name: string }[] {
  if (!Array.isArray(tipos)) return [];
  const seen = new Set<string>();
  const out: { key: string; name: string }[] = [];
  for (const entry of tipos) {
    if (typeof entry !== "object" || entry === null) continue;
    const key = text((entry as Record<string, unknown>).chave);
    const name = text((entry as Record<string, unknown>).nome);
    if (!key || !name || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name });
  }
  return out;
}

/** The choices from the firm's areas, the areas of law the platform's modules serve, and the scripts published. */
export function areaChoicesFrom(areas: AreaRow[], laws: LawRow[], scripts: ScriptRow[]): AreaChoice[] {
  const ofModule = new Set(laws.filter((law) => text(law.module)).map((law) => text(law.key)));
  // The script in force of an area is its latest published version.
  const inForce = new Map<string, { version: number; tipos: unknown }>();
  for (const script of scripts) {
    const area = text(script.area_id);
    const version = typeof script.version === "number" ? script.version : 0;
    const current = inForce.get(area);
    if (!current || version > current.version) inForce.set(area, { version, tipos: script.tipos });
  }
  const choices: AreaChoice[] = [];
  for (const area of areas) {
    const id = text(area.id);
    const law = text(area.law_area);
    if (!id || (law && ofModule.has(law))) continue;
    const types = scriptTypes(inForce.get(id)?.tipos);
    if (types.length === 0) continue;
    choices.push({ id, name: text(area.name), types });
  }
  return choices.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
