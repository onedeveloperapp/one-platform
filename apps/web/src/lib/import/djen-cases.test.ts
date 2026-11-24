import { addressedTo, djenCasesOf, portfolioLines, portfolioStateOf, skipReasonKey } from "./djen-cases";
import { describe, expect, it } from "vitest";

import type { DjenCommunication } from "@flyee/courts/types";

/** Every person, number and text here is invented. */
const communication = (overrides: Partial<DjenCommunication>): DjenCommunication => ({
  hash: "h",
  court: "TJGO",
  cnj: "28710012820998090051",
  availableOn: "2026-11-20",
  kind: "Intimação",
  documentType: null,
  text: "Texto que nunca vai ao banco.",
  link: null,
  unit: null,
  className: null,
  active: true,
  cancelReason: null,
  parties: [],
  lawyers: [],
  ...overrides,
});

describe("the cases ONE opens from the DJEN (0287)", () => {
  it("hands the database whom each communication is addressed to, and nothing of its text", () => {
    const handed = addressedTo([
      communication({
        parties: [
          { name: "Maria Inventada", side: "active" },
          { name: "COMPANHIA AEREA DE TESTE SA", side: "passive" },
        ],
        lawyers: [{ uf: "GO", number: "28701" }],
      }),
    ]);
    expect(handed).toEqual([
      {
        parties: [
          { name: "Maria Inventada", side: "active" },
          { name: "COMPANHIA AEREA DE TESTE SA", side: "passive" },
        ],
        lawyers: [{ uf: "GO", number: "28701" }],
      },
    ]);
    expect(JSON.stringify(handed)).not.toContain("Texto");
  });

  it("reads what the import's screen says: ONE's work, why it left the rest, and the clients with no CPF", () => {
    const read = djenCasesOf({
      ok: true,
      mode: "auto",
      module: true,
      opening: 2,
      opened: 5,
      skipped: { firm_on_defense: 1, airline_unclear: 3, nothing: 0 },
      waiting: 0,
      without_cpf_total: 7,
      without_cpf: [
        { person_id: "p1", name: "Maria Inventada", case_id: "c1", seq: 12, cnj: "28710012820998090051" },
        { person_id: "p2", name: "Sem caso" },
      ],
    });
    expect(read).toMatchObject({ mode: "auto", module: true, opening: 2, opened: 5, withoutCpfTotal: 7 });
    expect(read?.skipped).toEqual([
      { reason: "airline_unclear", count: 3 },
      { reason: "firm_on_defense", count: 1 },
    ]);
    expect(read?.withoutCpf).toEqual([
      { personId: "p1", name: "Maria Inventada", caseId: "c1", seq: 12, cnj: "28710012820998090051" },
    ]);
    expect(djenCasesOf({ ok: false, code: "not_allowed" })).toBeNull();
  });

  it("says each reason in its words, and one it does not know as a lawsuit ONE could not read", () => {
    expect(skipReasonKey("firm_on_defense")).toBe("import-djen-skip-firm-on-defense");
    expect(skipReasonKey("djen_too_many")).toBe("import-djen-skip-other");
  });

  it("asks the firm to bring its portfolio only while it said it used a system and brought nothing of it", () => {
    const state = (overrides: Record<string, unknown>) =>
      portfolioStateOf({
        ok: true,
        system: "astrea",
        brought: false,
        can_import: true,
        opening: 0,
        opened: 0,
        without_cpf: 0,
        ...overrides,
      });
    expect(portfolioLines(state({}))).toEqual({ bring: "astrea", opened: 0, opening: 0, withoutCpf: 0 });
    // Brought, or never said: nothing to ask, and with nothing of ONE's either, nothing drawn.
    expect(portfolioLines(state({ brought: true }))).toBeNull();
    expect(portfolioLines(state({ system: null }))).toBeNull();
    // Who may not bring it reads ONE's work, never the firm's step nor what only the firm gives.
    expect(portfolioLines(state({ can_import: false, opened: 3, without_cpf: 2 }))).toEqual({
      bring: null,
      opened: 3,
      opening: 0,
      withoutCpf: 0,
    });
    expect(portfolioLines(state({ brought: true, opening: 4, without_cpf: 1 }))).toEqual({
      bring: null,
      opened: 0,
      opening: 4,
      withoutCpf: 1,
    });
    expect(portfolioLines(null)).toBeNull();
  });
});
