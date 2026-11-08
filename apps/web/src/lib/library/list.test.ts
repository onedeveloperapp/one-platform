import { describe, expect, it } from "vitest";

import type { LibraryData, LibrarySource, LibraryTemplate } from "@/lib/library/facts";
import type { LibraryImport } from "@/lib/library/import-read";
import {
  familyOf,
  firstView,
  isLibrarySort,
  isLibraryView,
  LIBRARY_VIEWS,
  libraryCounts,
  libraryRows,
} from "@/lib/library/list";

const template = (patch: Partial<LibraryTemplate> & { id: string; name: string }): LibraryTemplate => ({
  documentKind: "piece",
  proceedingKind: "juizado",
  isDefault: false,
  platform: false,
  provisional: false,
  usedByOne: false,
  preparedByOne: false,
  updatedAt: "2026-11-01T10:00:00+00:00",
  updatedLabel: "1 nov., 07:00",
  updatedBy: null,
  cited: 0,
  missing: 0,
  ...patch,
});

const source = (patch: Partial<LibrarySource> & { id: string; citation: string }): LibrarySource => ({
  kind: "lei",
  title: "Código de Defesa do Consumidor",
  quote: null,
  sourceUrl: "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm",
  note: null,
  status: "verified",
  platform: false,
  verifiedBy: null,
  verifiedAt: "2026-11-01T10:00:00+00:00",
  verifiedLabel: "1 nov., 07:00",
  retiredReason: null,
  retiredLabel: null,
  ...patch,
});

const request = (patch: Partial<LibraryImport> & { id: string }): LibraryImport => ({
  fileName: "procuracao.docx",
  source: "docx",
  status: "reading",
  failure: null,
  expected: null,
  refusal: null,
  requestedBy: null,
  sentLabel: "7 nov., 10:00",
  ...patch,
});

const data = (patch: Partial<LibraryData> = {}): LibraryData => ({
  sources: [
    source({ id: "s1", citation: "Lei 8.078/1990", verifiedAt: "2026-10-01T10:00:00+00:00" }),
    source({ id: "s2", citation: "Lei 9.099/1995", title: "Juizados Especiais", platform: true }),
    source({ id: "s3", citation: "Súmula 54 do STJ", status: "retired", retiredReason: "Revogada" }),
  ],
  templates: [
    template({ id: "t1", name: "Inicial do juizado", updatedAt: "2026-10-01T10:00:00+00:00" }),
    template({ id: "t2", name: "Inicial da vara cível (modelo do ONE)", platform: true, proceedingKind: "comum" }),
    template({ id: "t3", name: "Procuração do escritório", documentKind: "procuracao", proceedingKind: null }),
  ],
  missing: [
    {
      key: "art-14-cdc",
      label: "Art. 14 da Lei 8.078/1990",
      raw: "art. 14 do CDC",
      gap: null,
      templates: ["Inicial do juizado"],
    },
  ],
  maxTemplates: 40,
  imports: [request({ id: "i1" }), request({ id: "i2", fileName: "contrato.pdf", source: "pdf", status: "ready" })],
  importLimits: { megabytes: 10, pages: 30 },
  ...patch,
});

const query = { search: "", writes: null, sort: "natural" as const };

describe("the library's list", () => {
  it("knows its views and orders", () => {
    expect(LIBRARY_VIEWS.every(isLibraryView)).toBe(true);
    expect(isLibraryView("lixeira")).toBe(false);
    expect(isLibrarySort("recent")).toBe(true);
    expect(isLibrarySort("oldest")).toBe(false);
    expect(familyOf("do-one")).toBe("modelos");
    expect(familyOf("retiradas")).toBe("fontes");
  });

  it("counts each view as the list shows it", () => {
    const library = data();
    const counts = libraryCounts(library, query);
    expect(counts).toEqual({
      faltam: 1,
      modelos: 3,
      "do-escritorio": 2,
      "do-one": 1,
      enviados: 2,
      fontes: 2,
      retiradas: 1,
    });
    for (const view of LIBRARY_VIEWS) {
      const rows = libraryRows(library, view, query);
      const shown = rows.missing.length + rows.templates.length + rows.imports.length + rows.sources.length;
      expect(shown, view).toBe(counts[view]);
    }
  });

  it("searches by words in any order, without accents", () => {
    const library = data();
    expect(libraryRows(library, "modelos", { ...query, search: "vara civel" }).templates.map((t) => t.id)).toEqual([
      "t2",
    ]);
    expect(libraryRows(library, "fontes", { ...query, search: "especiais 9.099" }).sources.map((s) => s.id)).toEqual([
      "s2",
    ]);
    // A missing source is found by the model that cites it, too.
    expect(libraryRows(library, "faltam", { ...query, search: "juizado" }).missing).toHaveLength(1);
    expect(libraryCounts(library, { ...query, search: "contrato" }).enviados).toBe(1);
  });

  it("filters the models by what they write, and the filter counts", () => {
    const library = data();
    const papers = { ...query, writes: "procuracao" as const };
    expect(libraryRows(library, "modelos", papers).templates.map((t) => t.id)).toEqual(["t3"]);
    expect(libraryCounts(library, papers)["do-one"]).toBe(0);
    // The filter is of models only: the sources are not narrowed by it.
    expect(libraryCounts(library, papers).fontes).toBe(2);
  });

  it("keeps the library's own order unless the latest is asked first", () => {
    const library = data();
    expect(libraryRows(library, "modelos", query).templates.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(libraryRows(library, "modelos", { ...query, sort: "recent" }).templates.map((t) => t.id)).toEqual([
      "t2",
      "t3",
      "t1",
    ]);
    expect(libraryRows(library, "fontes", { ...query, sort: "recent" }).sources.map((s) => s.id)).toEqual(["s2", "s1"]);
  });

  it("opens on what keeps a piece from being approved, then on what ONE asks of a person", () => {
    expect(firstView(data())).toBe("faltam");
    expect(firstView(data({ missing: [] }))).toBe("enviados");
    expect(firstView(data({ missing: [], imports: [request({ id: "i1" })] }))).toBe("modelos");
    expect(firstView(data({ missing: [], imports: [], templates: [] }))).toBe("fontes");
    expect(firstView(data({ missing: [], imports: [], templates: [], sources: [] }))).toBe("modelos");
  });
});
