import { describe, expect, it } from "vitest";

import {
  addressWords,
  cepOf,
  choose,
  DATA_OPTIONS,
  dataSummary,
  FIELD_OPTIONS,
  MARITAL_OPTIONS,
  missingAsk,
  numberOf,
  type PersonData,
  personDataOf,
  readValue,
} from "@/lib/conversations/data-check";

// Every person here is invented; the CPF is one every manual uses as an example.

const NIDIA: PersonData = {
  caseId: "c-1",
  personId: "p-1",
  fullName: "Nídia Teste Farias",
  cpf: "12345678909",
  birthDate: "1990-03-14",
  minor: false,
  nationality: "brasileira",
  maritalStatus: null,
  profession: null,
  postalCode: "74000000",
  street: "Rua Exemplo",
  addressNumber: "100",
  complement: null,
  district: "Setor Teste",
  city: "Goiânia",
  uf: "GO",
  documentsIn: true,
  checked: false,
  step: null,
  field: null,
};

describe("the client checks their data in the chat (0232)", () => {
  it("reads the database's answer with the step it waits on", () => {
    const read = personDataOf({
      case_id: "c-1",
      person_id: "p-1",
      full_name: "Nídia Teste Farias",
      cpf: "12345678909",
      documents_in: true,
      checked: false,
      step: { step: "valor", field: "cpf", checked: ["c-0"] },
    });
    expect(read).toMatchObject({ caseId: "c-1", cpf: "12345678909", documentsIn: true, step: "valor", field: "cpf" });
    expect(personDataOf({ case_id: "c-1", person_id: "p-1", step: { step: "inventado" } })?.step).toBeNull();
    expect(personDataOf({ ok: true })).toBeNull();
  });

  it("shows what ONE read in one message, the CPF whole for the client to check", () => {
    expect(dataSummary(NIDIA)).toBe(
      [
        "Confira os seus dados, Nídia, que li nos documentos:",
        "Nome: Nídia Teste Farias",
        "CPF: 123.456.789-09",
        "Nascimento: 14/03/1990",
        "Endereço: Rua Exemplo, 100, Setor Teste, Goiânia (GO), CEP 74000-000",
        "1. Está tudo certo",
        "2. Corrigir algo",
      ].join("\n"),
    );
    expect(
      addressWords({ ...NIDIA, street: null, addressNumber: null, district: null, postalCode: null, city: null }),
    ).toBeNull();
    expect(dataSummary(NIDIA)).not.toMatch(/[—–!]/);
  });

  it("reads the answers: the confirmation, the field, a marital status", () => {
    expect(choose(DATA_OPTIONS, "1")).toBe("certo");
    expect(choose(DATA_OPTIONS, "está tudo certo")).toBe("certo");
    expect(choose(DATA_OPTIONS, "2")).toBe("corrigir");
    expect(choose(FIELD_OPTIONS, "o cpf")).toBe("cpf");
    expect(choose(FIELD_OPTIONS, "4")).toBe("address");
    expect(choose(MARITAL_OPTIONS, "casada")).toBe("casado");
    expect(choose(MARITAL_OPTIONS, "3")).toBe("uniao_estavel");
  });

  it("checks a value before it is written, and says why one does not serve", () => {
    expect(readValue("cpf", "123.456.789-09")).toEqual({ ok: true, value: "12345678909" });
    expect(readValue("cpf", "123.456.789-00")).toMatchObject({ ok: false });
    expect(readValue("birth_date", "14/03/1990")).toEqual({ ok: true, value: "1990-03-14" });
    expect(readValue("birth_date", "31/02/1990")).toMatchObject({ ok: false });
    expect(readValue("full_name", "Nídia Teste Farias")).toEqual({ ok: true, value: "Nídia Teste Farias" });
    expect(readValue("full_name", "Nídia")).toMatchObject({ ok: false });
    expect(cepOf("74000-000")).toBe("74000000");
    expect(cepOf("7400")).toBeNull();
    expect(numberOf("120, apto 31")).toEqual({ number: "120", complement: "apto 31" });
    expect(numberOf("s/n")).toEqual({ number: "S/N", complement: null });
    expect(numberOf("rua tal")).toBeNull();
  });

  it("asks what the papers need and no document gives, one at a time, and nothing of a child", () => {
    expect(missingAsk(NIDIA)?.step).toBe("estado_civil");
    expect(missingAsk({ ...NIDIA, nationality: null })?.question).toBe(
      "Qual é a sua nacionalidade?\n1. Brasileira\n2. Outra",
    );
    expect(missingAsk({ ...NIDIA, maritalStatus: "casado" })).toEqual({
      step: "profissao",
      question: "Qual é a sua profissão?",
    });
    expect(missingAsk({ ...NIDIA, maritalStatus: "casado", profession: "Professora" })).toBeNull();
    expect(missingAsk({ ...NIDIA, minor: true })).toBeNull();
  });
});
