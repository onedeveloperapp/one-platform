/**
 * Which court system a communication of the DJEN points to, and which kind of lawsuit it is of (pure).
 *
 * Every communication carries a link into the court's own system, so the host of the link names the system
 * (projudi.tjgo.jus.br, eproc1g.tjsp.jus.br, pje...). The platform's watch over the DJEN counts them per court and kind
 * to see a court move its new lawsuits to another system before its table says so (`scripts/djen-systems.mjs` reads the
 * same hosts by hand).
 */

export type CourtSystemName = "projudi" | "eproc" | "pje" | "esaj" | "outro";
export type LawsuitKindName = "juizado" | "comum";

/** The class of the small-claims procedure and of the ordinary civil one, in the CNJ's unified tables. */
const SMALL_CLAIMS_CLASS = 436;
const ORDINARY_CIVIL_CLASS = 7;

/** The host of a link, or null when it has none or is not one. */
export function hostOfLink(link: string | null | undefined): string | null {
  if (!link) return null;
  try {
    const host = new URL(link).host.toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

/** The system a host belongs to; `outro` for a host of no system the platform knows. */
export function systemOfHost(host: string | null | undefined): CourtSystemName | null {
  const name = String(host ?? "").toLowerCase();
  if (!name) return null;
  if (name.includes("projudi")) return "projudi";
  if (name.includes("eproc")) return "eproc";
  if (/(^|\.)pje/.test(name)) return "pje";
  if (name.includes("esaj") || name === "www2.tjal.jus.br") return "esaj";
  return "outro";
}

/** The kind of lawsuit a communication is of, by its class's code or the words of its class and unit; null when neither says. */
export function kindOfCommunication(input: {
  classCode?: number | null;
  className?: string | null;
  unit?: string | null;
}): LawsuitKindName | null {
  const words = `${input.unit ?? ""} ${input.className ?? ""}`.toUpperCase();
  if (input.classCode === SMALL_CLAIMS_CLASS || words.includes("JUIZADO ESPECIAL") || words.includes("JUIZADOS ESPECIAIS")) {
    return "juizado";
  }
  if (input.classCode === ORDINARY_CIVIL_CLASS || words.includes("PROCEDIMENTO COMUM")) return "comum";
  return null;
}

/** A text that says nothing once its marks are taken out: a communication published empty. */
export const isEmptyText = (text: string | null | undefined): boolean =>
  String(text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .trim() === "";
