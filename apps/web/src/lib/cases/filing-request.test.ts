// @vitest-environment node
import { describe, expect, it } from "vitest";

import { lawsuitFilingOf, mniOab, submissionOf } from "@/lib/cases/filing-request";

// Every person, company and number here is invented.

const raw = (overrides: Record<string, unknown> = {}) => ({
  submission_id: "11111111-1111-4111-8111-111111111111",
  claim: 2,
  channel: "mni",
  org_id: "22222222-2222-4222-8222-222222222222",
  case_id: "33333333-3333-4333-8333-333333333333",
  case_seq: 7,
  incident: "cancellation",
  package_id: "44444444-4444-4444-8444-444444444444",
  proceeding_id: "55555555-5555-4555-8555-555555555555",
  kind: "juizado",
  court: "TJGO",
  court_state: "GO",
  comarca: "Goiânia",
  test_number: null,
  endpoint: "https://projudi.tjgo.jus.br/IntercomunicacaoService",
  codes: {
    classes: { juizado: 436, comum: 7 },
    document_types: { petition: "202", power_of_attorney: "99", identity: "65" },
    subjects: { cancellation: [4830], moral: [7779] },
    localities: { Goiânia: "5208707" },
    judging_bodies: { "Goiânia|juizado": { code: "9999", name: "Juizado de teste", ibge: "5208707" } },
  },
  value_cents: 1000000,
  claimants: [
    {
      name: "Maria Teste",
      cpf: "529.982.247-25",
      street: "Rua das Flores",
      number: "10",
      complement: null,
      district: "Centro",
      city: "Goiânia",
      state: "GO",
      zip: "74000-000",
      guardian: null,
    },
  ],
  defendant: { name: "Companhia Aérea de Teste S.A.", cnpj: "12.345.678/0001-95", airline: "LA" },
  lawyers: [{ name: "Ana Lima", cpf: "12345678909", oab: { uf: "GO", number: "12345" } }],
  items: [
    { position: 1, name: "01-peticao-inicial.pdf", part: 1, parts: 1, document_kind: "petition", storage_path: "a/1" },
    {
      position: 2,
      name: "02-procuracao.pdf",
      part: 1,
      parts: 2,
      document_kind: "power_of_attorney",
      storage_path: "a/2",
    },
    {
      position: 3,
      name: "03-procuracao.pdf",
      part: 2,
      parts: 2,
      document_kind: "power_of_attorney",
      storage_path: "a/3",
    },
  ],
  ...overrides,
});

const pdf = new Uint8Array([37, 80, 68, 70]);
const files = () => ({ pdf, signature: null });
const now = new Date("2026-11-05T15:00:00Z");

describe("the lawsuit as a court's channel takes it (0101)", () => {
  it("reads what the database hands the worker, and nothing that is not its shape", () => {
    const sub = submissionOf(raw());
    expect(sub?.claimants[0]?.cpf).toBe("52998224725");
    expect(sub?.defendant?.cnpj).toBe("12345678000195");
    expect(sub?.items.map((item) => item.position)).toEqual([1, 2, 3]);
    expect(submissionOf({ ...raw(), channel: "robot" })).toBeNull();
    expect(submissionOf(null)).toBeNull();
  });

  it("writes a registration at the bar as the MNI does: the state, seven digits and a letter", () => {
    expect(mniOab("go", "12345")).toBe("GO0012345A");
    expect(mniOab("GO", "12345B")).toBe("GO0012345B");
    expect(mniOab("GO", "12345 b")).toBe("GO0012345B");
    expect(mniOab("G", "12345")).toBeNull();
    expect(mniOab("GO", "123456789")).toBeNull();
  });

  it("files the lawsuit with the court's codes, its people, its company and its files in order", () => {
    const sub = submissionOf(raw());
    const answer = sub ? lawsuitFilingOf(sub, files, now) : null;
    expect(answer?.ok).toBe(true);
    if (!answer?.ok) return;
    const filing = answer.filing;
    expect([filing.classCode, filing.localityCode, filing.judgingBody.code]).toEqual([436, "5208707", "9999"]);
    expect(filing.subjects).toEqual([
      { code: 4830, main: true },
      { code: 7779, main: false },
    ]);
    expect(filing.value).toBe(10000);
    expect(filing.plaintiffs[0]).toMatchObject({
      name: "Maria Teste",
      sex: "D",
      kind: "fisica",
      document: "52998224725",
      lawyers: [{ name: "Ana Lima", oab: "GO0012345A", cpf: "12345678909" }],
    });
    expect(filing.plaintiffs[0]?.address?.zip).toBe("74000000");
    expect(filing.defendants[0]).toMatchObject({ kind: "juridica", document: "12345678000195", lawyers: [] });
    expect(filing.documents.map((document) => [document.id, document.typeCode, document.description])).toEqual([
      ["1", "202", "Petição inicial"],
      ["2", "99", "Procuração (parte 1 de 2)"],
      ["3", "99", "Procuração (parte 2 de 2)"],
    ]);
    expect(filing.sentAt).toBe(now);
  });

  it("goes with no value when nobody asked one, and says a minor's guardian", () => {
    const sub = submissionOf(
      raw({
        value_cents: null,
        claimants: [{ ...raw().claimants[0], guardian: { name: "Pai Teste", cpf: "12345678909" } }],
      }),
    );
    const answer = sub ? lawsuitFilingOf(sub, files, now) : null;
    expect(answer?.ok && answer.filing.value).toBeNull();
    expect(answer?.ok && answer.filing.plaintiffs[0]?.representedBy).toEqual({
      name: "Pai Teste",
      document: "12345678909",
    });
  });

  it("marks the priority of an elderly claimant by the court's code, and none the court did not give", () => {
    const elder = { ...raw().claimants[0], birth_date: "1950-03-01" };
    const coded = submissionOf(
      raw({ claimants: [elder], codes: { ...raw().codes, priorities: { elderly: "IDOSO-GO" } } }),
    );
    const marked = coded ? lawsuitFilingOf(coded, files, now) : null;
    expect(marked?.ok && marked.filing.priorities).toEqual(["IDOSO-GO"]);
    const uncoded = submissionOf(raw({ claimants: [elder] }));
    const plain = uncoded ? lawsuitFilingOf(uncoded, files, now) : null;
    expect(plain?.ok && plain.filing.priorities).toEqual([]);
    const young = submissionOf(raw({ codes: { ...raw().codes, priorities: { elderly: "IDOSO-GO" } } }));
    const none = young ? lawsuitFilingOf(young, files, now) : null;
    expect(none?.ok && none.filing.priorities).toEqual([]);
  });

  it("never sends a court a code its table lacks, and the test court takes its placeholders", () => {
    const missing = submissionOf(raw({ codes: { classes: { juizado: 436 } } }));
    const refused = missing ? lawsuitFilingOf(missing, files, now) : null;
    expect(refused).toMatchObject({ ok: false, code: "court_codes_missing" });
    expect(refused && !refused.ok ? refused.missing : []).toEqual(
      expect.arrayContaining([
        "locality",
        "judging_body",
        "subject",
        "document:petition",
        "document:power_of_attorney",
      ]),
    );
    const test = submissionOf(raw({ channel: "test_court", codes: {}, test_number: "00012342099809000" }));
    const taken = test ? lawsuitFilingOf(test, files, now) : null;
    expect(taken?.ok).toBe(true);
  });

  it("needs a petition first, a claimant, the company and a lawyer with a registration", () => {
    const noLawyer = submissionOf(raw({ lawyers: [{ name: "Ana Lima", cpf: null, oab: null }] }));
    expect(noLawyer ? lawsuitFilingOf(noLawyer, files, now) : null).toMatchObject({ ok: false, code: "no_lawyer" });
    const noCompany = submissionOf(raw({ defendant: null }));
    expect(noCompany ? lawsuitFilingOf(noCompany, files, now) : null).toMatchObject({
      ok: false,
      code: "no_defendant",
    });
    const noPetition = submissionOf(raw({ items: [raw().items[1]] }));
    expect(noPetition ? lawsuitFilingOf(noPetition, files, now) : null).toMatchObject({
      ok: false,
      code: "no_petition",
    });
  });
});
