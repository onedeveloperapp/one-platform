/**
 * The theses a decision rests on, read by rule against the catalog (`teses-v1`, migration 0190): each thesis is data
 * (`jurimetry_theses`: its words, in a decision's grounds without accents and in lower case), and a decision's thesis
 * is the first of the catalog, in its order, whose words its grounds hold. Read at the moment the decision is read,
 * whose text is never kept; in the shadow until the operator checked a sample and released the reading. Pure.
 */
export const THESES_RULE = "teses-v1";

export type ThesisPattern = { slug: string; position: number; patterns: string[] };

/** A text as the catalog's words are written: no accents, lower case, one space. */
export const plainText = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ");

/** The thesis a decision's grounds rest on, or null when none of the catalog's words is there. */
export function thesisOf(grounds: string, catalog: readonly ThesisPattern[]): string | null {
  const text = plainText(grounds);
  if (!text.trim()) return null;
  for (const thesis of [...catalog].sort((a, b) => a.position - b.position)) {
    for (const pattern of thesis.patterns) {
      let expression: RegExp;
      try {
        expression = new RegExp(pattern);
      } catch {
        continue;
      }
      if (expression.test(text)) return thesis.slug;
    }
  }
  return null;
}

/** A catalog's rows as the rule reads them, leaving out what is not one. */
export function catalogOf(rows: unknown): ThesisPattern[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const item = (row ?? {}) as { slug?: unknown; position?: unknown; patterns?: unknown };
    return typeof item.slug === "string" && Array.isArray(item.patterns)
      ? [
          {
            slug: item.slug,
            position: Number(item.position) || 0,
            patterns: item.patterns.filter((pattern): pattern is string => typeof pattern === "string"),
          },
        ]
      : [];
  });
}
