// @vitest-environment node
import { describe, expect, it } from "vitest";

import { FILING_STEP_KEYS } from "@/lib/cases/filing";
import {
  filingGuideOf,
  type FilingSheetData,
  filingSheetOf,
  GUIDE_KEYS,
  type GuideStep,
  missingRows,
  type SheetRow,
} from "@/lib/cases/filing-sheet";
import ptBR from "@flyee/content/messages/pt-BR.json";

// Invented people only: the CPFs every manual uses as an example.
const ANSWER = {
  package_id: "p1",
  kind: "juizado",
  court: "TJSP",
  court_state: "SP",
  system: "eproc",
  screen: {
    key: "eproc-tjsp",
    name: "eproc do TJSP",
    host: "eproc1g.tjsp.jus.br",
    login_kind: "password_app",
    asks_contact: true,
  },
  comarca: "Campinas",
  unit: null,
  incident: "delay",
  value_cents: 400000,
  codes: { class: 436, subject: 4829, moral: 7779 },
  claimants: [
    {
      party_id: "a1",
      name: "Marina Teste",
      cpf: "52998224725",
      birth_date: "1960-03-14",
      street: "Rua das Flores",
      number: "120",
      complement: "apto 31",
      district: "Centro",
      city: "Campinas",
      state: "SP",
      zip: "13010000",
      email: "marina@exemplo.com",
      phone: "5519987654321",
      free_justice: null,
      guardian: null,
    },
    {
      party_id: "a2",
      name: "Pedro Teste",
      cpf: "11144477735",
      birth_date: "2018-05-02",
      street: "Rua das Flores",
      number: "120",
      complement: null,
      district: "Centro",
      city: "Campinas",
      state: "SP",
      zip: "13010000",
      email: null,
      phone: null,
      free_justice: true,
      guardian: { name: "Marina Teste", cpf: "52998224725", email: "marina@exemplo.com", phone: "5519987654321" },
    },
  ],
  defendant: {
    name: "Companhia Aérea Teste S.A.",
    cnpj: "11222333000181",
    address: "Avenida Teste, nº 1, São Paulo/SP",
  },
  lawyers: [{ user_id: "u1", name: "Ana Advogada", oab: { uf: "SP", number: "123456" } }],
  items: [{ position: 1, name: "01 Petição inicial.pdf", part: 1, parts: 1, document_kind: "petition" }],
};

// A change of the answer, as the database could give it (a value it lacks is null).
const sheetOf = (change: Record<string, unknown> = {}): FilingSheetData => {
  const sheet = filingSheetOf({ ...ANSWER, ...change });
  if (!sheet) throw new Error("not a sheet");
  return sheet;
};

const stepOf = (steps: GuideStep[], id: string) => steps.find((step) => step.id === id);
const rowsOf = (step: GuideStep | undefined): SheetRow[] => step?.groups.flatMap((group) => group.rows) ?? [];
const rowOf = (steps: GuideStep[], id: string) =>
  steps.flatMap((step) => rowsOf(step)).find((row) => row.id === id) ?? null;

describe("the sheet of a package ready to file (0269)", () => {
  it("reads the database's answer, and nothing that is not one", () => {
    const sheet = sheetOf();
    expect(sheet.screen).toEqual({
      key: "eproc-tjsp",
      name: "eproc do TJSP",
      host: "eproc1g.tjsp.jus.br",
      loginKind: "password_app",
      asksContact: true,
    });
    expect(sheet.claimants.map((person) => person.partyId)).toEqual(["a1", "a2"]);
    expect(sheet.claimants[1].guardian?.name).toBe("Marina Teste");
    expect(sheet.valueCents).toBe(400000);
    expect(filingSheetOf(null)).toBeNull();
    expect(filingSheetOf({ ...ANSWER, kind: "outro" })).toBeNull();
    expect(filingSheetOf({ ...ANSWER, screen: null })?.screen).toBeNull();
  });

  it("guides the eproc of TJSP by its own steps, each value ready as its field takes it", () => {
    const steps = filingGuideOf(sheetOf(), { files: "court", today: "2026-11-23" });
    expect(steps.map((step) => step.id)).toEqual([
      "access",
      "info",
      "subjects",
      "claimants",
      "defendants",
      "documents",
      "finish",
      "receipt",
    ]);
    expect(steps[0].title).toEqual({ key: "filing-guide-step-access", values: { system: "eproc do TJSP" } });
    expect(steps[0].hint).toEqual({ key: "filing-guide-access-app", values: { host: "eproc1g.tjsp.jus.br" } });
    expect(rowOf(steps, "processo.classe")).toMatchObject({
      shown: { key: "filing-sheet-coded", values: { name: "Procedimento do Juizado Especial Cível", code: 436 } },
      copy: "Procedimento do Juizado Especial Cível",
    });
    expect(rowOf(steps, "processo.valor")).toMatchObject({ shown: "R$ 4.000,00", copy: "4.000,00" });
    expect(rowOf(steps, "advogado.u1")).toMatchObject({ shown: "OAB/SP 123456", copy: "SP123456" });
    expect(rowOf(steps, "processo.assunto_principal")?.copy).toBe("4829");
    expect(rowOf(steps, "processo.assunto_complementar")?.copy).toBe("7779");
    // A CPF and a phone as a person reads them, copied as the court's field takes them.
    expect(rowOf(steps, "autor.1.cpf")).toMatchObject({ shown: "529.982.247-25", copy: "52998224725" });
    expect(rowOf(steps, "autor.1.celular")).toMatchObject({ shown: "(19) 98765-4321", copy: "19987654321" });
    expect(rowOf(steps, "autor.1.cep")).toMatchObject({ shown: "13010-000", copy: "13010000" });
    expect(rowOf(steps, "reu.1.cnpj")).toMatchObject({ shown: "11.222.333/0001-81", copy: "11222333000181" });
    expect(stepOf(steps, "claimants")?.hint.key).toBe("filing-guide-eproc-claimants-contact");
  });

  it("gives a represented minor the contact of who answers for them, and says whose it is", () => {
    const steps = filingGuideOf(sheetOf(), { files: "court", today: "2026-11-23" });
    const minor = stepOf(steps, "claimants")?.groups[1];
    expect(minor?.title).toEqual({ key: "filing-sheet-claimant-minor", values: { position: 2, name: "Pedro Teste" } });
    expect(rowOf(steps, "autor.2.representante.nome")?.shown).toBe("Marina Teste");
    expect(rowOf(steps, "autor.2.email")).toMatchObject({
      shown: "marina@exemplo.com",
      note: { key: "filing-sheet-from-guardian" },
    });
    expect(rowOf(steps, "autor.2.justica_gratuita")?.shown).toEqual({ key: "filing-sheet-requested" });
    // The adult claimant of 66 years has the priority of the elderly.
    expect(rowOf(steps, "processo.prioridade")).toMatchObject({
      shown: { key: "filing-sheet-priority-elderly" },
      note: { values: { names: "Marina Teste" } },
    });
  });

  it("says missing what the screen asks and the case does not have, never filling it in", () => {
    const people = ANSWER.claimants.map((person, index) =>
      index === 0 ? { ...person, email: null, phone: null } : { ...person, guardian: null },
    );
    const steps = filingGuideOf(sheetOf({ claimants: people }), { files: "court", today: "2026-11-23" });
    expect(rowOf(steps, "autor.1.email")).toMatchObject({
      shown: null,
      copy: null,
      missing: { field: "email", whose: "Marina Teste" },
    });
    expect(missingRows(steps)).toEqual([
      { field: "email", whose: "Marina Teste" },
      { field: "mobile", whose: "Marina Teste" },
      { field: "email", whose: "Pedro Teste" },
      { field: "mobile", whose: "Pedro Teste" },
    ]);
    // A screen that does not ask the contact leaves it out when the case has none.
    const plain = filingGuideOf(sheetOf({ claimants: people, screen: null }), { files: "court", today: "2026-11-23" });
    expect(rowOf(plain, "autor.1.email")).toBeNull();
    expect(missingRows(plain)).toEqual([]);
  });

  it("names TJRJ's own screens, and a lawsuit with no value as the judge's to define", () => {
    const steps = filingGuideOf(sheetOf({ court: "TJRJ", value_cents: null }), { files: "court", today: "2026-11-23" });
    expect(stepOf(steps, "info")?.hint.key).toBe("filing-guide-eproc-info-tjrj");
    expect(stepOf(steps, "documents")?.hint.key).toBe("filing-guide-eproc-documents-tjrj");
    expect(rowOf(steps, "processo.valor")).toMatchObject({ shown: { key: "filing-sheet-value-none" }, copy: null });
  });

  it("guides the PJe by its steps, and a system no manual gave by what every filing asks", () => {
    const pje = filingGuideOf(sheetOf({ system: "pje", screen: null }), { files: "court", today: "2026-11-23" });
    expect(pje.map((step) => step.id)).toEqual([
      "access",
      "info",
      "subjects",
      "parties",
      "features",
      "documents",
      "finish",
      "receipt",
    ]);
    expect(pje[0].hint).toEqual({ key: "filing-step-access-pje" });
    expect(rowsOf(stepOf(pje, "features")).map((row) => row.id)).toEqual(["processo.valor", "processo.prioridade"]);
    // The Projudi of TJGO takes each file already signed: the files' words follow how they are signed.
    const projudi = filingGuideOf(sheetOf({ court: "TJGO", system: "projudi", screen: null }), {
      files: "sign_first",
      today: "2026-11-23",
    });
    expect(projudi.map((step) => step.id)).toEqual(["access", "info", "parties", "documents", "finish", "receipt"]);
    expect(stepOf(projudi, "documents")?.hint).toEqual({ key: "filing-step-files-sign-first" });
    expect(stepOf(projudi, "finish")?.hint).toEqual({ key: "filing-step-sign-sign-first" });
  });

  it("has every word it uses in the catalog", () => {
    const product = (ptBR as unknown as { product: Record<string, string> }).product;
    for (const key of [...GUIDE_KEYS, ...FILING_STEP_KEYS]) expect(product[key], key).toBeTruthy();
  });
});
