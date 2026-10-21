import { describe, expect, it } from "vitest";

import {
  acceptedShare,
  type AiTaskMeasure,
  approversLabel,
  autonomyLabel,
  decidedCount,
  formatBrlFromMicros,
  formatUsdMicros,
  providerState,
  spendFirmName,
} from "@/lib/admin/ai";
import {
  applyEdits,
  approvalErrorKey,
  blankEdits,
  fieldKind,
  fieldLabel,
  hasEdits,
  mayDecide,
  momentLabel,
} from "@/lib/ai/approvals";
import messages from "@flyee/content/messages/pt-BR.json";

const task = (overrides: Partial<AiTaskMeasure> = {}): AiTaskMeasure => ({
  task: "plataforma.verificacao",
  name: "Verificação do executor de IA",
  autonomy: "approval",
  shadow: false,
  samplePercent: 100,
  approvers: ["socio", "advogado"],
  activeVersion: 1,
  provider: "anthropic",
  model: "claude-opus-5-5",
  runs: 0,
  succeeded: 0,
  failed: 0,
  pending: 0,
  approved: 0,
  approvedEdited: 0,
  rejected: 0,
  returned: 0,
  revisable: false,
  ...overrides,
});

describe("what a suggestion looks like on the queue", () => {
  it("names a field from its key", () => {
    expect(fieldLabel("resposta")).toBe("Resposta");
    expect(fieldLabel("data_do_voo")).toBe("Data do voo");
    expect(fieldLabel("numero-do-voo")).toBe("Numero do voo");
    expect(fieldLabel("")).toBe("");
  });

  it("tells text, which a person may correct, from everything else", () => {
    expect(fieldKind("um texto")).toBe("text");
    expect(fieldKind("")).toBe("text");
    expect(fieldKind(true)).toBe("flag");
    expect(fieldKind(3)).toBe("number");
    expect(fieldKind(["a", 2])).toBe("list");
    expect(fieldKind(null)).toBe("empty");
    expect(fieldKind(undefined)).toBe("empty");
    expect(fieldKind({ a: 1 })).toBe("other");
    expect(fieldKind([{ a: 1 }])).toBe("other");
  });

  it("writes a moment on the reader's clock, and falls back to Brasília for a zone the runtime refuses", () => {
    const moment = "2026-10-08T17:32:00Z";
    expect(momentLabel(moment, "America/Sao_Paulo")).toBe("08/10/2026, 14:32");
    expect(momentLabel(moment, "America/Manaus")).toBe("08/10/2026, 13:32");
    expect(momentLabel(moment, null)).toBe("08/10/2026, 14:32");
    expect(momentLabel(moment, "Lugar/Nenhum")).toBe("08/10/2026, 14:32");
  });
});

describe("correcting a suggestion before approving it", () => {
  const output = { resposta: "Recebido.", tarefa: "verificacao", confianca: 0.9, itens: ["a"] };

  it("changes only the text fields the person typed in, and keeps every other field", () => {
    const corrected = applyEdits(output, { resposta: "Recebido, com a correção." });
    expect(corrected).toEqual({ ...output, resposta: "Recebido, com a correção." });
    expect(Object.keys(corrected)).toEqual(Object.keys(output));
    // The model's object is not touched: the run keeps what the model said.
    expect(output.resposta).toBe("Recebido.");
  });

  it("never lets a correction change a field that was not text, or add one", () => {
    expect(applyEdits(output, { confianca: "1", itens: "b", inventado: "x" })).toEqual(output);
  });

  it("knows when nothing was actually changed", () => {
    expect(hasEdits(output, {})).toBe(false);
    expect(hasEdits(output, { resposta: "Recebido." })).toBe(false);
    expect(hasEdits(output, { resposta: "Recebido" })).toBe(true);
    expect(hasEdits(output, { confianca: "1" })).toBe(false);
  });

  it("flags a text field the correction left blank", () => {
    expect(blankEdits(output, { resposta: "   ", tarefa: "ok" })).toEqual(["resposta"]);
    expect(blankEdits(output, {})).toEqual([]);
  });
});

describe("who decides", () => {
  it("is a person whose function the task names", () => {
    expect(mayDecide("advogado", ["socio", "advogado"])).toBe(true);
    expect(mayDecide("atendimento", ["socio", "advogado"])).toBe(false);
    expect(mayDecide("socio", [])).toBe(false);
  });

  it("has words for every answer the database gives, and for one it does not know", () => {
    const product = messages.product as Record<string, string>;
    for (const code of [
      "second_factor_required",
      "not_allowed_in_support_session",
      "not_found",
      "not_an_approver",
      "already_decided",
      "note_required",
      "invalid_output",
      // An answer sent back with what to change.
      "not_revisable",
      "too_many_returns",
      "return_on_case",
    ]) {
      // Words of its own: an answer the screen knows is never said as "try again".
      expect(approvalErrorKey(code), code).not.toBe("approvals-error-failed");
      expect(product[approvalErrorKey(code)], code).toBeTruthy();
    }
    expect(approvalErrorKey("something_new")).toBe("approvals-error-failed");
    expect(product[approvalErrorKey("something_new")]).toBeTruthy();
  });
});

describe("the operator's reading of cost", () => {
  it("writes a cost that is a fraction of a cent without rounding it to nothing", () => {
    expect(formatUsdMicros(0)).toBe("US$ 0,00");
    expect(formatUsdMicros(420)).toBe("US$ 0,00042");
    expect(formatUsdMicros(10_500)).toBe("US$ 0,0105");
    expect(formatUsdMicros(6_012_300)).toBe("US$ 6,01");
    expect(formatUsdMicros(null)).toBe("US$ 0,00");
  });

  it("converts to reais only when the price list has a rate", () => {
    expect(formatBrlFromMicros(2_000_000, 5.5)).toBe("R$ 11,00");
    expect(formatBrlFromMicros(2_000_000, null)).toBeNull();
    expect(formatBrlFromMicros(2_000_000, 0)).toBeNull();
  });

  it("names the platform's own calls apart from a firm's", () => {
    expect(spendFirmName({ orgId: null, name: null })).toBe("Plataforma (nenhum escritório)");
    expect(spendFirmName({ orgId: "a", name: "Souza Advogados" })).toBe("Souza Advogados");
    expect(spendFirmName({ orgId: "a", name: null })).toBe("Escritório sem nome");
  });
});

describe("the measure a task earns autonomy on", () => {
  it("is the share of decided answers approved exactly as the model gave them", () => {
    const measured = task({ approved: 8, approvedEdited: 1, rejected: 1, pending: 5 });
    expect(decidedCount(measured)).toBe(10);
    expect(acceptedShare(measured)).toBe(0.8);
  });

  it("counts an answer sent back with what to change as one that was not good as it came", () => {
    const measured = task({ approved: 6, approvedEdited: 1, rejected: 1, returned: 2, revisable: true });
    expect(decidedCount(measured)).toBe(10);
    expect(acceptedShare(measured)).toBe(0.6);
  });

  it("does not exist while nobody decided anything", () => {
    expect(acceptedShare(task({ pending: 3 }))).toBeNull();
  });

  it("says how much of what a task answers waits for a person", () => {
    expect(autonomyLabel(task())).toBe("toda resposta espera uma pessoa");
    expect(autonomyLabel(task({ autonomy: "sampled", samplePercent: 10 }))).toBe("amostra de 10% espera uma pessoa");
    expect(autonomyLabel(task({ autonomy: "autonomous" }))).toBe("age sozinha");
    // A task in shadow mode acts on nothing, whatever its autonomy says: the label says so first.
    expect(autonomyLabel(task({ autonomy: "autonomous", shadow: true }))).toBe("modo sombra: não decide nada");
  });

  it("names who decides in the words the firm uses", () => {
    expect(approversLabel(["socio", "advogado"])).toBe("Sociedade ou Advocacia");
    expect(approversLabel(["controladoria"])).toBe("Controladoria");
  });

  it("says what a run would find in this environment", () => {
    const keys = { anthropic: true, gemini: false, openai: false, openrouter: false };
    expect(providerState(task(), { fake: false, configured: keys })).toBe("ready");
    expect(providerState(task({ provider: "gemini" }), { fake: false, configured: keys })).toBe("missing");
    // The fake stands in for every provider, with or without a key.
    expect(providerState(task({ provider: "gemini" }), { fake: true, configured: keys })).toBe("fake");
    // No instructions in force: the task cannot run, whatever the keys.
    expect(providerState(task({ activeVersion: null, provider: null }), { fake: true, configured: keys })).toBe("none");
  });
});
