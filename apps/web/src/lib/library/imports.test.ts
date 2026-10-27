import { describe, expect, it } from "vitest";

import {
  changesShown,
  composeModel,
  importFailureKey,
  importRefusalKey,
  isOtherTextFormat,
  markingBriefing,
  modelChecks,
  proposalOf,
} from "@/lib/library/imports";

/**
 * A model of the library made from a document (migration 0067): what the
 * marking reads, the model written from the paragraphs and the changes, and
 * what still looks like the original case. Every name, number and fact here
 * is invented; the CPF and the CNPJ are the ones manuals use as examples.
 */

const PARAGRAPHS = [
  "EXCELENTÍSSIMO SENHOR JUIZ DE DIREITO DO JUIZADO ESPECIAL CÍVEL DA COMARCA DE GOIÂNIA",
  "MARIA TESTE DE SOUZA, brasileira, CPF 529.982.247-25, residente na Rua das Flores, 10, CEP 74000-000, vem propor ação em face de AÉREA EXEMPLO S.A.",
  "No dia 3 de maio, a autora embarcaria no voo XX 1234.",
  "O voo foi cancelado sem aviso.",
  "A responsabilidade do transportador é objetiva, nos termos do art. 14 da Lei nº 8.078.",
  "Fulano de Tal\nOAB/GO 12.345",
];

describe("what the marking reads", () => {
  it("is each paragraph after its number, with what identifies a person taken out, and never the file's name", () => {
    const briefing = markingBriefing(PARAGRAPHS);
    expect(briefing.startsWith("Documento com 6 parágrafos")).toBe(true);
    expect(briefing).toContain("§1\nEXCELENTÍSSIMO SENHOR JUIZ");
    expect(briefing).toContain("§6\nFulano de Tal\nOAB/GO 12.345");
    expect(briefing).toContain("CPF [CPF]");
    expect(briefing).toContain("CEP [CEP]");
    expect(briefing).not.toContain("529.982.247-25");
  });
});

describe("the model written from the paragraphs and the changes", () => {
  const changes = [
    { from: 2, to: 2, text: "[[PARTES]], vem propor ação em face de [[RE]]", reason: "a qualificação das partes" },
    { from: 3, to: 4, text: "[COMPLETAR: narrar os fatos do caso]", reason: "os fatos do caso" },
    { from: 6, to: 6, text: "[[ADVOGADOS]]", reason: "quem assina" },
  ];

  it("keeps every paragraph no change names word for word, each change in the place of the ones it names", () => {
    expect(composeModel(PARAGRAPHS, changes)).toBe(
      [
        PARAGRAPHS[0],
        "[[PARTES]], vem propor ação em face de [[RE]]",
        "[COMPLETAR: narrar os fatos do caso]",
        PARAGRAPHS[4],
        "[[ADVOGADOS]]",
      ].join("\n\n"),
    );
  });

  it("takes the paragraphs of an empty change out, and leaves a document no change names as it was", () => {
    expect(composeModel(PARAGRAPHS, [{ from: 6, to: 6, text: "  ", reason: "a data" }])).toBe(
      PARAGRAPHS.slice(0, 5).join("\n\n"),
    );
    expect(composeModel(PARAGRAPHS, [])).toBe(PARAGRAPHS.join("\n\n"));
  });

  it("never applies a change over a paragraph twice, past the last one, or backwards", () => {
    const odd = [
      { from: 2, to: 3, text: "A", reason: "" },
      { from: 3, to: 3, text: "B", reason: "" },
      { from: 5, to: 9, text: "C", reason: "" },
      { from: 6, to: 5, text: "D", reason: "" },
    ];
    expect(composeModel(PARAGRAPHS, odd)).toBe(
      [PARAGRAPHS[0], "A", PARAGRAPHS[3], PARAGRAPHS[4], PARAGRAPHS[5]].join("\n\n"),
    );
  });

  it("shows each change with what was there and what goes there", () => {
    expect(changesShown(PARAGRAPHS, changes)[1]).toEqual({
      from: 3,
      to: 4,
      reason: "os fatos do caso",
      before: `${PARAGRAPHS[2]}\n\n${PARAGRAPHS[3]}`,
      after: "[COMPLETAR: narrar os fatos do caso]",
    });
  });
});

describe("the marking's answer as the database kept it", () => {
  it("is read with what it writes, a paper never for a kind of lawsuit", () => {
    const kept = proposalOf({
      document_kind: "procuracao",
      proceeding_kind: "juizado",
      name: "Procuração do escritório",
      changes: [{ from: 1, to: 2, text: "[[OUTORGANTE]]", reason: "o cliente" }, { from: "x" }],
      people: ["Maria Teste", 3],
      notes: ["Confira os poderes."],
    });
    expect(kept).toEqual({
      name: "Procuração do escritório",
      documentKind: "procuracao",
      proceedingKind: null,
      changes: [{ from: 1, to: 2, text: "[[OUTORGANTE]]", reason: "o cliente" }],
      people: ["Maria Teste"],
      notes: ["Confira os poderes."],
    });
    expect(proposalOf({ document_kind: "outro" })).toBeNull();
    expect(proposalOf(null)).toBeNull();
  });
});

describe("what still looks like the original case", () => {
  it("finds the people the marking listed, a whole name before the first name alone, however it is written", () => {
    const body = "MARIA TESTE DE SOUZA viajou. Depois, Maria reclamou. A Maríamente não conta. Joana não está no caso.";
    expect(modelChecks(body, ["Maria", "Maria Teste de Souza", "Pedro Teste"], "piece")).toEqual([
      { kind: "person", name: "Maria Teste de Souza", count: 1 },
      { kind: "person", name: "Maria", count: 1 },
    ]);
  });

  it("counts what is written as an identifier: a CPF or a CNPJ only when it checks, a telephone, a registration at the bar", () => {
    const body = [
      "CPF 529.982.247-25 e o número 123.456.789-00, que não é um CPF.",
      "CNPJ 11.222.333/0001-81.",
      "CEP 74000-000, telefone (62) 99999-0001, e-mail maria@exemplo.invalid.",
      "OAB/GO 12.345, e o processo 5123456-12.2020.8.09.0051 julgado em 10/05/2025.",
    ].join("\n");
    expect(modelChecks(body, [], "piece")).toEqual([
      { kind: "identifier", identifier: "cpf", count: 1 },
      { kind: "identifier", identifier: "cnpj", count: 1 },
      { kind: "identifier", identifier: "cep", count: 1 },
      { kind: "identifier", identifier: "telefone", count: 1 },
      { kind: "identifier", identifier: "email", count: 1 },
      { kind: "identifier", identifier: "oab", count: 1 },
    ]);
  });

  it("says what is left to complete in a paper a client signs, and nothing of it in a piece", () => {
    const body = "OUTORGANTE: [[OUTORGANTE]]. Poderes para [COMPLETAR: o objeto].";
    expect(modelChecks(body, [], "procuracao")).toEqual([{ kind: "to_complete", count: 1 }]);
    expect(modelChecks(body, [], "piece")).toEqual([]);
  });
});

describe("the screen's words", () => {
  it("names each failure and refusal by a key of its own, and anything else by a general one", () => {
    expect(importFailureKey("too_long")).toBe("library-import-failed-too-long");
    expect(importFailureKey("something")).toBe("library-import-failed-gave-up");
    expect(importRefusalKey("too_many_pages")).toBe("library-import-refused-pages");
    expect(importRefusalKey("anything")).toBe("library-import-refused-failed");
  });

  it("tells a text in another format before it is sent", () => {
    expect(isOtherTextFormat("Inicial.doc")).toBe(true);
    expect(isOtherTextFormat("Contrato.odt")).toBe(true);
    expect(isOtherTextFormat("Inicial.docx")).toBe(false);
    expect(isOtherTextFormat("Inicial.pdf")).toBe(false);
  });
});
