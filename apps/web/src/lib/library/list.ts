import type { ModelDocument } from "@/lib/cases/drafts";
import type { LibraryData, LibrarySource, LibraryTemplate, MissingSource } from "@/lib/library/facts";
import type { LibraryImport } from "@/lib/library/import-read";

/**
 * The firm's library as a list of the screen pattern (the bar of every list, 2026-11-07): its ready views, its
 * search, its filter by what a model writes and its order. The library is read whole, so all of it is decided here,
 * in the browser, and never asks the server again. Pure, so the numbers of the cards and of the views are the very
 * rows the list shows.
 */

/** The ready views, in the order the bar lists them: what keeps a piece from being approved first. */
export const LIBRARY_VIEWS = [
  "faltam",
  "modelos",
  "do-escritorio",
  "do-one",
  "enviados",
  "fontes",
  "retiradas",
] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];

export const isLibraryView = (value: unknown): value is LibraryView =>
  typeof value === "string" && (LIBRARY_VIEWS as readonly string[]).includes(value);

/** The family a view is of: the bar's menu groups them, and the filter and the orders follow it. */
export type LibraryFamily = "faltam" | "modelos" | "enviados" | "fontes";

export const familyOf = (view: LibraryView): LibraryFamily =>
  view === "modelos" || view === "do-escritorio" || view === "do-one"
    ? "modelos"
    : view === "retiradas"
      ? "fontes"
      : view;

/** The orders a list offers: its own (the models by name, the sources as the norms go), or the latest change first. */
export const LIBRARY_SORTS = ["natural", "recent"] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export const isLibrarySort = (value: unknown): value is LibrarySort =>
  typeof value === "string" && (LIBRARY_SORTS as readonly string[]).includes(value);

/** What the bar narrows every view by: the words typed, and what a model writes (models only). */
export type LibraryQuery = { search: string; writes: ModelDocument | null; sort: LibrarySort };

/** Words compared as a person types them: no accents, no case, single spaces. */
const folded = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Whether every word typed is in the text: a search of nothing finds everything. */
function matches(text: string, search: string): boolean {
  const words = folded(search).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = folded(text);
  return words.every((word) => haystack.includes(word));
}

const missingText = (source: MissingSource) => [source.label, source.raw, ...source.templates].join(" ");
const sourceText = (source: LibrarySource) => [source.citation, source.title, source.note ?? ""].join(" ");

/** The models a view holds, before the order: the platform's and the firm's, or one of them. */
function templatesOf(data: LibraryData, view: LibraryView, query: Omit<LibraryQuery, "sort">): LibraryTemplate[] {
  return data.templates.filter(
    (template) =>
      (view !== "do-escritorio" || !template.platform) &&
      (view !== "do-one" || template.platform) &&
      (query.writes === null || template.documentKind === query.writes) &&
      matches(template.name, query.search),
  );
}

/** How many each view holds under the bar's search and filter: the numbers the bar and the cards say. */
export function libraryCounts(data: LibraryData, query: Omit<LibraryQuery, "sort">): Record<LibraryView, number> {
  const sources = data.sources.filter((source) => matches(sourceText(source), query.search));
  return {
    faltam: data.missing.filter((source) => matches(missingText(source), query.search)).length,
    modelos: templatesOf(data, "modelos", query).length,
    "do-escritorio": templatesOf(data, "do-escritorio", query).length,
    "do-one": templatesOf(data, "do-one", query).length,
    enviados: data.imports.filter((item) => matches(item.fileName, query.search)).length,
    fontes: sources.filter((source) => source.status === "verified").length,
    retiradas: sources.filter((source) => source.status === "retired").length,
  };
}

/** What a view shows, in its order. Each view lists one kind of thing; the others are empty. */
export type LibraryRows = {
  missing: MissingSource[];
  templates: LibraryTemplate[];
  imports: LibraryImport[];
  sources: LibrarySource[];
};

const latestFirst = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

export function libraryRows(data: LibraryData, view: LibraryView, query: LibraryQuery): LibraryRows {
  const none: LibraryRows = { missing: [], templates: [], imports: [], sources: [] };
  switch (familyOf(view)) {
    case "faltam":
      return { ...none, missing: data.missing.filter((source) => matches(missingText(source), query.search)) };
    case "enviados":
      return { ...none, imports: data.imports.filter((item) => matches(item.fileName, query.search)) };
    case "modelos": {
      const templates = templatesOf(data, view, query);
      // The library reads the models by name: that order is kept unless the latest change is asked first.
      return {
        ...none,
        templates:
          query.sort === "recent" ? [...templates].sort((a, b) => latestFirst(a.updatedAt, b.updatedAt)) : templates,
      };
    }
    case "fontes": {
      const status = view === "retiradas" ? "retired" : "verified";
      const sources = data.sources.filter(
        (source) => source.status === status && matches(sourceText(source), query.search),
      );
      // The library reads the sources as the norms go (kind, number): kept unless the latest check is asked first.
      return {
        ...none,
        sources:
          query.sort === "recent" ? [...sources].sort((a, b) => latestFirst(a.verifiedAt, b.verifiedAt)) : sources,
      };
    }
  }
}

/** Whether a request ONE prepares a model for waits on a person now: a question to answer, a model to read. */
export const importWaitsOnPerson = (item: LibraryImport) => item.status === "asking" || item.status === "ready";

/**
 * The view the library opens on: the firm's own models (the owner, 2026-11-13). What waits on a person is said above
 * the list, in "Esperam você", and never moves the list away from the models.
 */
export function firstView(data: LibraryData): LibraryView {
  return data.templates.some((template) => !template.platform) ? "do-escritorio" : "modelos";
}

/**
 * What waits on a person of the firm, in the order "Esperam você" says it: what ONE asks, what it has ready to check,
 * what it refused or could not read (to send another or let go), then the citations no source answers for.
 */
export function waitingOnPerson(data: LibraryData): { imports: LibraryImport[]; missing: number } {
  const order: Record<string, number> = { asking: 0, ready: 1, refused: 2, failed: 3 };
  return {
    imports: data.imports.filter((item) => item.status in order).sort((a, b) => order[a.status]! - order[b.status]!),
    missing: data.missing.length,
  };
}
