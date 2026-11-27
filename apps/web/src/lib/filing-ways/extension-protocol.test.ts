import { describe, expect, it } from "vitest";

import {
  LINK_CODE_LETTERS,
  linkCodeOf,
  readDone,
  readPath,
  readScreen,
  readSteps,
  receiptDigits,
  receiptText,
} from "@/lib/filing-ways/extension-protocol";

// Every person, number and address here is invented.
const FRAME = {
  system: "eproc-tjsp",
  host: "eproc1g.tjsp.jus.br",
  path: "/eproc/controlador.php",
  params: { acao: "processo_ajuizamento", hash: "9f8e7d6c5b4a39281706aabb", processo: "10001230720998260100" },
  title: "eproc - TJSP",
  headings: ["Peticionamento Eletrônico (1 de 5)"],
  fields: [
    {
      kind: "select",
      type: null,
      id: "selClasse",
      name: "selClasse",
      label: "Classe processual",
      required: true,
      disabled: false,
      readOnly: false,
      visible: true,
      options: [
        { value: "436", text: "Procedimento do Juizado Especial Cível" },
        { value: "52998224725", text: "Marina marina@teste.invalid" },
      ],
      optionCount: 2,
      selector: "#selClasse",
      index: 0,
      value: "436",
    },
    { kind: "script", selector: "#x", index: 0 },
  ],
  tables: [{ selector: "#tblPartes", index: 0, headers: ["Nome", "CPF"], rows: 2 }],
  capturedAt: "2026-11-21T15:00:00.000Z",
};

const STEP = {
  assinatura: {
    params: { acao: "processo_ajuizamento" },
    titulo: "peticionamento eletrônico (1 de 5)",
    campos: ["select:selclasse"],
  },
  tipo: "formulario",
  acoes: [
    { fazer: "escolher", alvo: "0|#selClasse|0", opcao: "436" },
    { fazer: "preencher", alvo: "0|#txtValor|0", fato: "processo.valor_causa", motivo: "o valor da causa" },
    { fazer: "anexar", alvo: "0|#arquivo|0", arquivo: 1 },
    { fazer: "clicar", alvo: "0|#btnFinalizar|0", envia: true },
  ],
  forma: { autores: 1, reus: 1, arquivos: 1 },
};

describe("what ONE takes from the lawyer's extension", () => {
  it("reads a link code as the lawyer types it, and nothing that cannot be one", () => {
    expect(linkCodeOf("abc-defg")).toBe("ABCDEFG");
    expect(linkCodeOf(" HJK MNPQ ")).toBe("HJKMNPQ");
    expect(linkCodeOf("ABCDEF0")).toBeNull();
    expect(linkCodeOf("ABCDEF")).toBeNull();
    expect(linkCodeOf(42)).toBeNull();
    expect(LINK_CODE_LETTERS).not.toMatch(/[01IOL]/);
  });

  it("takes a screen's structure only, redacted again, before the AI reads it", () => {
    const frames = readScreen([FRAME]);
    expect(frames).not.toBeNull();
    const kept = JSON.stringify(frames);
    // No value, no person's number or e-mail, no token nor lawsuit's number in the address.
    for (const secret of [
      "52998224725",
      "marina@teste.invalid",
      "9f8e7d6c5b4a39281706aabb",
      "10001230720998260100",
      '"value":"436"}',
    ])
      expect(kept).not.toContain(secret);
    expect(frames?.[0]?.params).toEqual({ acao: "processo_ajuizamento" });
    expect(frames?.[0]?.fields).toHaveLength(1);
    expect(frames?.[0]?.fields[0]).not.toHaveProperty("value");
    expect(frames?.[0]?.fields[0]?.options?.[0]).toEqual({
      value: "436",
      text: "Procedimento do Juizado Especial Cível",
    });
    expect(readScreen([])).toBeNull();
    expect(readScreen("tela")).toBeNull();
    expect(readScreen(Array.from({ length: 9 }, () => FRAME))).toBeNull();
  });

  it("takes a learned path whole, by targets, keys, codes and positions, without what the AI said of it", () => {
    const steps = readSteps([STEP]);
    expect(steps).not.toBeNull();
    expect(JSON.stringify(steps)).not.toContain("motivo");
    expect(steps?.[0]?.acoes[3]).toEqual({ fazer: "clicar", alvo: "0|#btnFinalizar|0", envia: true });
  });

  it("refuses a path that would carry a value, a person, a bad target or an unknown kind", () => {
    const withValue = { ...STEP, acoes: [{ fazer: "preencher", alvo: "0|#txtNome|0", fato: "Marina Teste" }] };
    const withNumber = { ...STEP, acoes: [{ fazer: "escolher", alvo: "0|#sel|0", opcao: "52998224725" }] };
    const badTarget = { ...STEP, acoes: [{ fazer: "clicar", alvo: "#btn" }] };
    const badKind = { ...STEP, tipo: "pagamento" };
    const badTitle = { ...STEP, assinatura: { ...STEP.assinatura, titulo: "processo 1000123-07.2099.8.26.0100" } };
    const badShape = { ...STEP, forma: { autores: -1, reus: 1, arquivos: 1 } };
    for (const step of [withValue, withNumber, badTarget, badKind, badTitle, badShape])
      expect(readSteps([STEP, step])).toBeNull();
    expect(readSteps([])).toBeNull();
    expect(readSteps({})).toBeNull();
  });

  it("takes what a field holds now as a code of the system's list or a yes or a no, never a value (0306)", () => {
    const frames = readScreen([
      {
        ...FRAME,
        fields: [
          { ...FRAME.fields[0], chosen: "436" },
          {
            kind: "select",
            selector: "#selAdvogado",
            index: 0,
            label: "Advogado",
            options: null,
            optionCount: 2,
            chosen: "Ana Souza",
          },
          {
            kind: "input",
            type: "text",
            selector: "#txtValor",
            index: 0,
            label: "Valor",
            filled: true,
            value: "10.000,00",
          },
          { kind: "input", type: "checkbox", selector: "#chk", index: 0, label: "Não se aplica", checked: "sim" },
        ],
      },
    ]);
    const [classe, advogado, valor, caixa] = frames?.[0]?.fields ?? [];
    expect(classe?.chosen).toBe("436");
    // A list of people keeps no lines, so it keeps no choice either.
    expect(advogado).not.toHaveProperty("chosen");
    expect(valor?.filled).toBe(true);
    expect(caixa).not.toHaveProperty("checked");
    expect(JSON.stringify(frames)).not.toContain("10.000,00");
    expect(JSON.stringify(frames)).not.toContain("Ana Souza");
  });

  it("takes the lines of a table of the system's codes only, read again by its columns", () => {
    const lines = [
      {
        cells: ["4830", "Cancelamento de vôo", "Não"],
        actions: [{ kind: "link", selector: "#add1", index: 0, label: "Adicionar" }],
      },
    ];
    const frames = readScreen([
      {
        ...FRAME,
        tables: [
          { selector: "#assuntos", index: 0, headers: ["Cod.", "Assunto", "Complementar?"], rows: 1, lines },
          // The extension sent the lines of a table of people: the backend takes none of them.
          {
            selector: "#tblPartes",
            index: 0,
            headers: ["Cód.", "Nome", "CPF"],
            rows: 1,
            lines: [{ cells: ["1", "Marina Teste", "529.982.247-25"], actions: [] }],
          },
        ],
      },
    ]);
    const [assuntos, partes] = frames?.[0]?.tables ?? [];
    expect(assuntos?.lines).toEqual([
      {
        cells: ["4830", "Cancelamento de vôo", "Não"],
        actions: [expect.objectContaining({ kind: "link", selector: "#add1", index: 0, label: "Adicionar" })],
      },
    ]);
    expect(partes).not.toHaveProperty("lines");
    expect(JSON.stringify(frames)).not.toContain("Marina Teste");
    expect(JSON.stringify(frames)).not.toContain("529.982.247-25");
  });

  it("takes what ONE did on a screen as a path's actions are taken, with what came of each (0306)", () => {
    expect(
      readDone([
        { acao: { fazer: "escolher", alvo: "0|#materia|0", opcao: "1215", motivo: "matéria" }, resultado: "ok" },
        { acao: { fazer: "escolher", alvo: "0|#jurisdicao|0", opcao: "77" }, resultado: "not_done" },
        { acao: { fazer: "preencher", alvo: "0|#txtNome|0", fato: "Marina Teste" }, resultado: "ok" },
        { acao: { fazer: "clicar", alvo: "0|#btn|0" }, resultado: "talvez" },
        "nada",
      ]),
    ).toEqual([
      { acao: { fazer: "escolher", alvo: "0|#materia|0", opcao: "1215" }, resultado: "ok" },
      { acao: { fazer: "escolher", alvo: "0|#jurisdicao|0", opcao: "77" }, resultado: "not_done" },
    ]);
    expect(readDone(undefined)).toEqual([]);
    expect(
      readDone(Array.from({ length: 50 }, () => ({ acao: { fazer: "esperar", alvo: "" }, resultado: "ok" }))),
    ).toHaveLength(40);
  });

  it("keeps the words of the field each action was done on, redacted again (2026-11-27)", () => {
    expect(
      readDone([
        { acao: { fazer: "escolher", alvo: "0|#materia|0", opcao: "1215" }, resultado: "ok", rotulo: "Matéria" },
        { acao: { fazer: "clicar", alvo: "0|#btn|0" }, resultado: "ok", rotulo: "Marina marina@teste.invalid" },
        { acao: { fazer: "clicar", alvo: "0|#btn2|0" }, resultado: "ok", rotulo: 7 },
      ]).map((done) => done.rotulo),
    ).toEqual(["Matéria", "Marina [e-mail]", undefined]);
  });

  it("takes the screens ONE went through in a filing as the AI may read them, and nothing else (2026-11-27)", () => {
    expect(
      readPath([
        {
          tela: "Cadastro de processo · Assuntos",
          feito: [
            { fazer: "preencher", rotulo: "Código", fato: "processo.assunto_principal_codigo" },
            { fazer: "clicar", rotulo: "Aba Partes" },
            { fazer: "esperar", rotulo: null },
            { fazer: "preencher", rotulo: "CPF 529.982.247-25 52998224725", fato: "Marina Teste" },
            { fazer: "apagar", rotulo: "Tudo" },
            "nada",
          ],
        },
        { tela: "Vazia", feito: [{ fazer: "esperar", rotulo: null }] },
        { tela: "Sem lista", feito: "nada" },
        "nada",
      ]),
    ).toEqual([
      {
        tela: "Cadastro de processo · Assuntos",
        feito: [
          { fazer: "preencher", rotulo: "Código", fato: "processo.assunto_principal_codigo" },
          { fazer: "clicar", rotulo: "Aba Partes" },
          // A fact that is not a key is left out; a person's number never reaches the AI.
          { fazer: "preencher", rotulo: "CPF [número]" },
        ],
      },
    ]);
    expect(readPath(undefined)).toEqual([]);
    const long = Array.from({ length: 40 }, (_, index) => ({
      tela: `Tela ${index}`,
      feito: Array.from({ length: 30 }, () => ({ fazer: "clicar", rotulo: "Próxima" })),
    }));
    const kept = readPath(long);
    expect(kept).toHaveLength(30);
    expect(kept[0]?.tela).toBe("Tela 10");
    expect(kept[0]?.feito).toHaveLength(20);
  });

  it("keeps the mark of a step that pressed the line a search found", () => {
    expect(readSteps([{ ...STEP, linhas: true }])?.[0]?.linhas).toBe(true);
    expect(readSteps([STEP])?.[0]).not.toHaveProperty("linhas");
  });

  it("reads the receipt's number and words as the extension sends them", () => {
    expect(receiptDigits("1000123-07.2099.8.26.0100")).toBe("10001230720998260100");
    expect(receiptDigits("123")).toBeNull();
    expect(receiptText("  Processo   distribuído\r\n\n\n\nao 1º Juizado  ")).toBe(
      "Processo distribuído\n\nao 1º Juizado",
    );
    expect(receiptText("   ")).toBeNull();
    expect(receiptText(5)).toBeNull();
  });
});
