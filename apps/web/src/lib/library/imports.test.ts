import { describe, expect, it } from "vitest";

import { MODEL_DOCUMENTS } from "@/lib/cases/drafts";
import {
  changesShown,
  composeModel,
  DOCUMENT_NAMED_KEY,
  exchangesOf,
  type FirmRecord,
  firmRecordTexts,
  firmTextsOf,
  HELD_KEY,
  HELD_REASONS,
  heldReasonOf,
  IMPORT_STATUS_KEY,
  IMPORT_STATUSES,
  importFailureKey,
  importRefusalKey,
  isOtherTextFormat,
  markingBriefing,
  MISSING_CODES,
  MISSING_KEY,
  modelChecks,
  papersSavedAt,
  proposalOf,
  questionsOf,
  refusalOf,
  REFUSED_KEY,
  requestSettled,
  saveGate,
} from "@/lib/library/imports";
import product from "@flyee/content/messages/pt-BR.json";

/**
 * A model of the library made from a document (migrations 0067 and 0079):
 * what the marking reads, the model written from the paragraphs and the
 * changes, what still looks like the original case, what ONE asks and why it
 * refuses, and when ONE saves the model by itself. Every name, number and
 * fact here is invented; the CPF and the CNPJ are the ones manuals use as
 * examples.
 */

const words = (product as { product: Record<string, string> }).product;

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
    expect(briefing.startsWith("O escritório mandou este documento para virar um modelo, sem dizer qual.")).toBe(true);
    expect(briefing).toContain("Documento com 6 parágrafos");
    expect(briefing).toContain("§1\nEXCELENTÍSSIMO SENHOR JUIZ");
    expect(briefing).toContain("§6\nFulano de Tal\nOAB/GO 12.345");
    expect(briefing).toContain("CPF [CPF]");
    expect(briefing).toContain("CEP [CEP]");
    expect(briefing).not.toContain("529.982.247-25");
  });
});

describe("what the marking reads of a round answered", () => {
  it("says what the document was sent as, every question with its answer masked, and the last round", () => {
    const briefing = markingBriefing(["CONTRATO DE HONORÁRIOS", "HONORÁRIOS: ____%."], {
      expected: "contrato",
      exchanges: [
        {
          questions: [
            { question: "Qual é o percentual dos honorários?", why: "Em branco." },
            { question: "A quem o cliente escreve?", why: "Em branco." },
          ],
          answers: ["30% do proveito econômico", ""],
        },
        {
          questions: [{ question: "Qual é o e-mail do escritório?", why: "Em branco." }],
          answers: ["contato@souza-exemplo.invalid, telefone (62) 99999-1234"],
        },
      ],
      lastRound: true,
    });
    expect(
      briefing.startsWith("O escritório mandou este documento como o contrato de honorários que o escritório usa."),
    ).toBe(true);
    expect(briefing).toContain(
      "Rodada 1:\nPergunta: Qual é o percentual dos honorários?\nResposta: 30% do proveito econômico",
    );
    expect(briefing).toContain("Pergunta: A quem o cliente escreve?\nResposta: (sem resposta)");
    expect(briefing).toContain("Rodada 2:");
    expect(briefing).not.toContain("contato@souza-exemplo.invalid");
    expect(briefing).not.toContain("99999-1234");
    expect(briefing.endsWith("Esta é a última rodada: não faça perguntas.")).toBe(true);
  });

  it("reads the rounds, the questions and the refusal the database kept, leaving out what is not one", () => {
    expect(questionsOf([{ question: " Qual o prazo? ", why: "Em branco." }, { question: "" }, 7])).toEqual([
      { question: "Qual o prazo?", why: "Em branco." },
    ]);
    expect(exchangesOf([{ questions: [{ question: "Qual o prazo?", why: "" }], answers: ["10 dias"] }, {}])).toEqual([
      { questions: [{ question: "Qual o prazo?", why: "" }], answers: ["10 dias"] },
    ]);
    expect(refusalOf({ code: "missing", found: "procuracao", missing: ["poderes", "nada"] })).toEqual({
      code: "missing",
      found: "procuracao",
      what: null,
      missing: ["poderes"],
    });
    expect(refusalOf({ code: "wrong_kind", found: "contrato", what: "um contrato" })?.found).toBe("contrato");
    expect(refusalOf({ code: "something" })).toBeNull();
    expect(heldReasonOf("notes")).toBe("notes");
    expect(heldReasonOf("other")).toBeNull();
  });
});

describe("when ONE saves the model by itself", () => {
  const clean = "PROCURAÇÃO\n\nOUTORGANTE: [[OUTORGANTE]].\n\n[[LOCAL_DATA]].";
  const gate = (overrides: Partial<Parameters<typeof saveGate>[0]> = {}) =>
    saveGate({ body: clean, people: ["MARIA TESTE"], document: "procuracao", notes: [], unwritable: [], ...overrides });

  it("saves a text with nothing a lawyer should look at", () => {
    expect(gate()).toEqual({ save: true });
  });

  it("leaves to a person a text that still looks like the original case, or that the PDF of a piece cannot write", () => {
    expect(gate({ body: `${clean} Assinado por MARIA TESTE.` })).toEqual({ save: false, reason: "checks" });
    expect(gate({ body: `${clean} CPF 529.982.247-25.` })).toEqual({ save: false, reason: "checks" });
    expect(gate({ body: `${clean} [COMPLETAR: o objeto]` })).toEqual({ save: false, reason: "checks" });
    expect(gate({ document: "piece", unwritable: ["ş"] })).toEqual({ save: false, reason: "checks" });
    // A paper is written in no PDF of a piece: what that writer cannot write is no reason there.
    expect(gate({ unwritable: ["ş"] })).toEqual({ save: true });
  });

  it("leaves to a person what the marking asked a lawyer to check, a question still open among it", () => {
    expect(gate({ notes: ["Qual é a cidade do foro do contrato?"] })).toEqual({ save: false, reason: "notes" });
    expect(gate({ notes: ["  "] })).toEqual({ save: true });
  });
});

describe("the model written from the paragraphs and the changes", () => {
  const changes = [
    {
      from: 2,
      to: 2,
      text: "[[PARTES]], vem propor ação em face de [[RE]]",
      reason: "a qualificação das partes",
      pieces: [],
    },
    { from: 3, to: 4, text: "[COMPLETAR: narrar os fatos do caso]", reason: "os fatos do caso", pieces: [] },
    { from: 6, to: 6, text: "[[ADVOGADOS]]", reason: "quem assina", pieces: [] },
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
    expect(composeModel(PARAGRAPHS, [{ from: 6, to: 6, text: "  ", reason: "a data", pieces: [] }])).toBe(
      PARAGRAPHS.slice(0, 5).join("\n\n"),
    );
    expect(composeModel(PARAGRAPHS, [])).toBe(PARAGRAPHS.join("\n\n"));
  });

  it("never applies a change over a paragraph twice, past the last one, or backwards", () => {
    const odd = [
      { from: 2, to: 3, text: "A", reason: "", pieces: [] },
      { from: 3, to: 3, text: "B", reason: "", pieces: [] },
      { from: 5, to: 9, text: "C", reason: "", pieces: [] },
      { from: 6, to: 5, text: "D", reason: "", pieces: [] },
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

describe("a change of some words of a paragraph (0093)", () => {
  const form = [
    "PROCURAÇÃO",
    "Nome: {{NOME COMPLETO}}",
    "CPF: {{CPF}}",
    "contra {{EMPRESA}}, como {{EMPRESA}} responde.",
  ];

  it("replaces only those words, every time they are written, and keeps the rest of the paragraph as it is", () => {
    const changes = [
      { from: 2, to: 2, text: "", reason: "o nome", pieces: [{ before: "{{NOME COMPLETO}}", after: "[[NOME]]" }] },
      {
        from: 3,
        to: 3,
        text: "",
        reason: "o CPF",
        pieces: [{ before: "{{CPF}}", after: "[[CPF]]\n\n[[REPRESENTADOS]]" }],
      },
      { from: 4, to: 4, text: "", reason: "a companhia", pieces: [{ before: "{{EMPRESA}}", after: "[[RE]]" }] },
    ];
    expect(composeModel(form, changes)).toBe(
      "PROCURAÇÃO\n\nNome: [[NOME]]\n\nCPF: [[CPF]]\n\n[[REPRESENTADOS]]\n\ncontra [[RE]], como [[RE]] responde.",
    );
    expect(changesShown(form, changes)[0]).toEqual({
      from: 2,
      to: 2,
      reason: "o nome",
      before: "Nome: {{NOME COMPLETO}}",
      after: "Nome: [[NOME]]",
    });
  });
});

describe("the firm's own data (0093)", () => {
  const paragraphs = [
    "PROCURAÇÃO",
    "Nome: [[NOME]]",
    "nomeia a sociedade SOUZA ADVOGADOS, CNPJ 11.222.333/0001-81, e a advogada ANA SOUZA, OAB/RJ 123.456, CEP 74000-000.",
  ];
  const proposal = { firmParagraphs: [3, 9] };
  const answered = [{ questions: [{ question: "São do escritório?", why: "" }], answers: ["Sim"] }];

  it("are the paragraphs the marking named, only once the firm answered a round of questions", () => {
    expect(firmTextsOf(paragraphs, proposal, answered)).toEqual([paragraphs[2]]);
    expect(firmTextsOf(paragraphs, proposal, [])).toEqual([]);
    expect(firmTextsOf(paragraphs, proposal, [{ ...answered[0], answers: [" "] }])).toEqual([]);
    expect(firmTextsOf(paragraphs, null, answered)).toEqual([]);
  });

  it("are no original case's: their CNPJ, registration and CEP are not counted, a CPF always is", () => {
    const body = paragraphs.join("\n\n");
    expect(modelChecks(body, [], "procuracao")).toEqual([
      { kind: "identifier", identifier: "cnpj", count: 1 },
      { kind: "identifier", identifier: "cep", count: 1 },
      { kind: "identifier", identifier: "oab", count: 1 },
    ]);
    expect(modelChecks(body, [], "procuracao", [paragraphs[2]])).toEqual([]);
    expect(
      saveGate({ body, people: [], document: "procuracao", notes: [], unwritable: [], firmTexts: [paragraphs[2]] }),
    ).toEqual({ save: true });
    const withCpf = `${paragraphs[2]} CPF 529.982.247-25.`;
    expect(modelChecks(withCpf, [], "procuracao", [withCpf])).toEqual([
      { kind: "identifier", identifier: "cpf", count: 1 },
    ]);
  });
});

describe("the marking's answer as the database kept it", () => {
  it("is read with what it writes, a paper never for a kind of lawsuit", () => {
    const kept = proposalOf({
      document_kind: "procuracao",
      proceeding_kind: "juizado",
      name: "Procuração do escritório",
      changes: [
        { from: 1, to: 2, text: "[[OUTORGANTE]]", reason: "o cliente" },
        {
          from: 3,
          to: 3,
          text: "",
          reason: "o nome",
          pieces: [{ before: "{{NOME}}", after: "[[NOME]]" }, { after: "x" }],
        },
        { from: "x" },
      ],
      people: ["Maria Teste", 3],
      notes: ["Confira os poderes."],
      firm_paragraphs: [4, 0, "5", 6],
    });
    expect(kept).toEqual({
      name: "Procuração do escritório",
      documentKind: "procuracao",
      proceedingKind: null,
      problem: null,
      pieceKind: null,
      changes: [
        { from: 1, to: 2, text: "[[OUTORGANTE]]", reason: "o cliente", pieces: [] },
        { from: 3, to: 3, text: "", reason: "o nome", pieces: [{ before: "{{NOME}}", after: "[[NOME]]" }] },
      ],
      people: ["Maria Teste"],
      notes: ["Confira os poderes."],
      firmParagraphs: [4, 6],
    });
    expect(proposalOf({ document_kind: "outro" })).toBeNull();
    expect(proposalOf(null)).toBeNull();
  });

  it("keeps the problem of a petition and the kind of a piece of the process, and neither of another document (0244)", () => {
    expect(
      proposalOf({ document_kind: "piece", proceeding_kind: "comum", problem: "cancellation", piece_kind: "replica" }),
    ).toMatchObject({ documentKind: "piece", proceedingKind: "comum", problem: "cancellation", pieceKind: null });
    expect(
      proposalOf({
        document_kind: "peca_processo",
        proceeding_kind: "juizado",
        problem: "delay",
        piece_kind: "replica",
      }),
    ).toMatchObject({ documentKind: "peca_processo", proceedingKind: "juizado", problem: null, pieceKind: "replica" });
    expect(
      proposalOf({ document_kind: "declaracao_hipossuficiencia", proceeding_kind: "juizado", problem: "delay" }),
    ).toMatchObject({
      documentKind: "declaracao_hipossuficiencia",
      proceedingKind: null,
      problem: null,
      pieceKind: null,
    });
    expect(proposalOf({ document_kind: "piece", problem: "Cancelamento de voo" })?.problem).toBeNull();
  });
});

describe("the firm's record (0244)", () => {
  const record: FirmRecord = {
    name: "Souza Advogados",
    cnpj: "11222333000181",
    society: "OAB/RJ 9876",
    lawyers: [
      { name: "Ana Souza", oab: "OAB/RJ 123456" },
      { name: null, oab: "OAB/GO 7788" },
    ],
    address: "Rua das Palmeiras, 100, Centro, Goiânia/GO",
    postalCode: "74000000",
    email: "contato@souza-exemplo.invalid",
    phone: "62999990001",
  };

  it("is read by the marking before the document, without the e-mail, the telephone or the CEP", () => {
    const briefing = markingBriefing(PARAGRAPHS, { firmRecord: record });
    expect(briefing).toContain(
      [
        "Os dados do escritório no cadastro:",
        "Nome: Souza Advogados",
        "CNPJ: 11.222.333/0001-81",
        "Registro da sociedade na OAB: OAB/RJ 9876",
        "Advogado: Ana Souza, OAB/RJ 123456",
        "Advogado: OAB/GO 7788",
        "Endereço: Rua das Palmeiras, 100, Centro, Goiânia/GO",
      ].join("\n"),
    );
    expect(briefing.indexOf("Os dados do escritório no cadastro")).toBeLessThan(briefing.indexOf("§1"));
    expect(briefing).not.toContain("contato@souza-exemplo.invalid");
    expect(briefing).not.toContain("99999-0001");
    expect(markingBriefing(PARAGRAPHS)).not.toContain("cadastro");
    expect(markingBriefing(PARAGRAPHS, { firmRecord: null })).not.toContain("cadastro");
  });

  it("is no original case's however the document writes it, and another registration still is", () => {
    const body = [
      "SOUZA ADVOGADOS, CNPJ 11222333000181, registrada na OAB/RJ nº 9.876, e a advogada ANA SOUZA, OAB/RJ 123.456.",
      "CEP 74000-000, CONTATO@SOUZA-EXEMPLO.INVALID, telefone +55 62 99999-0001.",
    ].join("\n");
    expect(modelChecks(body, [], "procuracao")).toEqual([
      { kind: "identifier", identifier: "cnpj", count: 1 },
      { kind: "identifier", identifier: "cep", count: 1 },
      { kind: "identifier", identifier: "telefone", count: 1 },
      { kind: "identifier", identifier: "email", count: 1 },
      { kind: "identifier", identifier: "oab", count: 2 },
    ]);
    expect(modelChecks(body, [], "procuracao", firmRecordTexts(record))).toEqual([]);
    expect(
      modelChecks(`${body} O advogado do caso, OAB/RJ 123.457.`, [], "procuracao", firmRecordTexts(record)),
    ).toEqual([{ kind: "identifier", identifier: "oab", count: 1 }]);
    expect(
      saveGate({
        body,
        people: [],
        document: "procuracao",
        notes: [],
        unwritable: [],
        firmTexts: firmRecordTexts(record),
      }),
    ).toEqual({ save: true });
  });

  it("never takes a CPF as the firm's, nor what the firm did not give", () => {
    expect(firmRecordTexts({ ...record, cnpj: "52998224725" }).some((text) => text.includes("CNPJ"))).toBe(false);
    expect(
      firmRecordTexts({
        name: "Souza Advogados",
        cnpj: null,
        society: null,
        lawyers: [],
        address: null,
        postalCode: null,
        email: null,
        phone: null,
      }),
    ).toEqual([]);
    expect(firmRecordTexts(null)).toEqual([]);
  });
});

describe("a piece of the process (0244)", () => {
  it("is sent as one, and what it leaves to complete is a lawyer's, as in a petition", () => {
    expect(markingBriefing(["RÉPLICA"], { expected: "peca_processo" })).toContain(
      "O escritório mandou este documento como uma peça que o escritório apresenta num processo em curso.",
    );
    expect(modelChecks("Processo nº [COMPLETAR: número do processo].", [], "peca_processo")).toEqual([]);
    expect(
      saveGate({ body: "Texto", people: [], document: "peca_processo", notes: [], unwritable: ["\u0007"] }),
    ).toEqual({ save: false, reason: "checks" });
  });

  it("is named inside a refusal, as every model ONE uses", () => {
    expect(MODEL_DOCUMENTS.map((document) => DOCUMENT_NAMED_KEY[document]).filter((key) => !(key in words))).toEqual(
      [],
    );
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

  it("says every state, refusal, lack and reason to wait with a key the catalog has", () => {
    const keys = [
      ...IMPORT_STATUSES.map((status) => IMPORT_STATUS_KEY[status]),
      ...Object.values(REFUSED_KEY),
      ...MISSING_CODES.map((code) => MISSING_KEY[code]),
      ...HELD_REASONS.map((reason) => HELD_KEY[reason]),
    ];
    expect(keys.filter((key) => !(key in words))).toEqual([]);
  });

  it("tells a text in another format before it is sent", () => {
    expect(isOtherTextFormat("Inicial.doc")).toBe(true);
    expect(isOtherTextFormat("Contrato.odt")).toBe(true);
    expect(isOtherTextFormat("Inicial.docx")).toBe(false);
    expect(isOtherTextFormat("Inicial.pdf")).toBe(false);
  });
});

describe("a request behind the firm already", () => {
  const saved = papersSavedAt([
    { document_kind: "procuracao", updated_at: "2026-11-20T19:15:08Z" },
    { document_kind: "procuracao", updated_at: "2026-11-01T10:00:00Z" },
    { document_kind: "piece", updated_at: "2026-11-20T19:20:00Z" },
    { document_kind: "contrato", updated_at: null },
  ]);

  it("reads the latest save of each paper, and nothing of a petition", () => {
    expect(saved).toEqual({ procuracao: Date.parse("2026-11-20T19:15:08Z") });
  });

  it("tells moments a millisecond apart, given as text or as a Date", () => {
    const at = papersSavedAt([{ document_kind: "procuracao", updated_at: new Date("2026-11-20T19:15:08.100Z") }]);
    expect(
      requestSettled({ status: "refused", expected: "procuracao", sentAt: new Date("2026-11-20T19:15:08.101Z") }, at),
    ).toBe(false);
    expect(requestSettled({ status: "refused", expected: "procuracao", sentAt: "2026-11-20T19:15:08.099Z" }, at)).toBe(
      true,
    );
  });

  it("settles a failure or a refusal of a paper the firm saved a model of after it was sent", () => {
    // What the setup showed on 2026-11-20: the power of attorney saved at 19:15, and the failure of 16:15 back on screen.
    expect(requestSettled({ status: "failed", expected: "procuracao", sentAt: "2026-11-20T16:15:10Z" }, saved)).toBe(
      true,
    );
    expect(requestSettled({ status: "refused", expected: "procuracao", sentAt: "2026-11-20T16:15:10Z" }, saved)).toBe(
      true,
    );
  });

  it("keeps what came after the save, what is still under way, a petition and a paper with no model", () => {
    expect(requestSettled({ status: "failed", expected: "procuracao", sentAt: "2026-11-20T19:30:00Z" }, saved)).toBe(
      false,
    );
    expect(requestSettled({ status: "asking", expected: "procuracao", sentAt: "2026-11-20T16:15:10Z" }, saved)).toBe(
      false,
    );
    expect(requestSettled({ status: "failed", expected: "piece", sentAt: "2026-11-20T16:15:10Z" }, saved)).toBe(false);
    expect(requestSettled({ status: "failed", expected: "contrato", sentAt: "2026-11-20T15:25:25Z" }, saved)).toBe(
      false,
    );
    expect(requestSettled({ status: "failed", expected: null, sentAt: "2026-11-20T15:25:25Z" }, saved)).toBe(false);
  });
});
