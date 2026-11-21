import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { optionOfReply, type TriageScript, triageVerdict } from "@flyee/rules/area-triage";

// An invented family area: two kinds, one question of every kind and one of a divorce alone.
const script: TriageScript = {
  types: [
    { key: "divorcio", name: "Divórcio" },
    { key: "alimentos", name: "Pensão alimentícia" },
  ],
  questions: [
    {
      key: "cidade",
      text: "Você mora em Goiás?",
      types: [],
      options: [
        { key: "sim", text: "Sim", criterion: "segue" },
        { key: "nao", text: "Não", criterion: "nao_atendemos" },
      ],
    },
    {
      key: "bens",
      text: "Há bens a dividir?",
      types: ["divorcio"],
      options: [
        { key: "nao", text: "Não", criterion: "segue" },
        { key: "brasil", text: "Sim, no Brasil", criterion: "segue" },
        { key: "exterior", text: "Sim, no exterior", criterion: "pessoa" },
      ],
    },
  ],
};

describe("triageVerdict", () => {
  it("asks the kind of case first, when the area has more than one", () => {
    assert.deepEqual(triageVerdict(script, { type: null, answers: {} }), { outcome: "pending", next: { ask: "type" } });
  });

  it("takes the area's only kind without asking it", () => {
    const one: TriageScript = { types: [script.types[0]!], questions: script.questions };
    const verdict = triageVerdict(one, { type: null, answers: {} });
    assert.equal(verdict.outcome, "pending");
    assert.equal(verdict.outcome === "pending" && verdict.next.ask === "question" && verdict.next.question.key, "cidade");
  });

  it("sends a kind that is none of the area's to a person", () => {
    assert.deepEqual(triageVerdict(script, { type: "outro", answers: {} }), { outcome: "person", type: null, because: [] });
  });

  it("asks only the questions of the kind, in order", () => {
    const verdict = triageVerdict(script, { type: "alimentos", answers: { cidade: "sim" } });
    assert.deepEqual(verdict, { outcome: "goes", type: "alimentos" });
    const divorce = triageVerdict(script, { type: "divorcio", answers: { cidade: "sim" } });
    assert.equal(divorce.outcome === "pending" && divorce.next.ask === "question" && divorce.next.question.key, "bens");
  });

  it("ends at once on an answer the firm does not take", () => {
    assert.deepEqual(triageVerdict(script, { type: "divorcio", answers: { cidade: "nao" } }), {
      outcome: "declined",
      question: "cidade",
      option: "nao",
    });
  });

  it("goes on after an answer a person decides, and then hands every reason to a person", () => {
    assert.deepEqual(triageVerdict(script, { type: "divorcio", answers: { cidade: "sim", bens: "exterior" } }), {
      outcome: "person",
      type: "divorcio",
      because: [{ question: "bens", option: "exterior" }],
    });
  });

  it("never takes an option that is not of the question", () => {
    const verdict = triageVerdict(script, { type: "divorcio", answers: { cidade: "talvez" } });
    assert.equal(verdict.outcome, "pending");
  });
});

describe("optionOfReply", () => {
  const options = script.questions[1]!.options;

  it("takes the number of an option, or its very words", () => {
    assert.equal(optionOfReply(options, "3")?.key, "exterior");
    assert.equal(optionOfReply(options, "opção 2")?.key, "brasil");
    assert.equal(optionOfReply(options, "2.")?.key, "brasil");
    assert.equal(optionOfReply(options, "sim, no EXTERIOR")?.key, "exterior");
  });

  it("leaves anything else to be read", () => {
    assert.equal(optionOfReply(options, "temos uma casa em Portugal"), null);
    assert.equal(optionOfReply(options, "9"), null);
    assert.equal(optionOfReply(options, ""), null);
  });
});
