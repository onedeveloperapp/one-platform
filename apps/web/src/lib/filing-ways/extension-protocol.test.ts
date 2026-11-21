import { describe, expect, it } from "vitest";

import {
  LINK_CODE_LETTERS,
  linkCodeOf,
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
