import assert from "node:assert/strict";
import test from "node:test";

import { judgmentOf, plainWords } from "./judgment.ts";

// Every text here is invented, in the forms courts write.

test("a judgment by its type or by the forms it is written in", () => {
  assert.equal(judgmentOf({ documentType: "Sentença", text: "Vistos. Julgo procedente o pedido." }), true);
  assert.equal(judgmentOf({ documentType: "Acórdão", text: "Nego provimento ao recurso." }), true);
  assert.equal(
    judgmentOf({
      documentType: null,
      text: "Dispensado o relatório, nos termos do art. 38 da Lei 9.099/95. JULGO PARCIALMENTE PROCEDENTE o pedido, com resolução do mérito, nos termos do art. 487, I, do CPC. P.R.I.",
    }),
    true,
  );
  assert.equal(judgmentOf({ text: "Homologo o projeto de sentença do juiz leigo, para que produza seus efeitos." }), true);
  assert.equal(judgmentOf({ text: "Julgo extinto o processo, sem resolução do mérito, nos termos do artigo 485, VI." }), true);
});

test("a decision before the judgment, or an order of the course of the lawsuit", () => {
  assert.equal(judgmentOf({ documentType: "Decisão", text: "Defiro a tutela de urgência requerida." }), false);
  assert.equal(judgmentOf({ documentType: "Despacho", text: "Cite-se. Intime-se." }), false);
  assert.equal(judgmentOf({ text: "Designo audiência de conciliação para o dia 10/12/2099, às 14h." }), false);
  assert.equal(judgmentOf({ text: "Emende a inicial no prazo de 15 dias, sob pena de indeferimento." }), false);
  assert.equal(judgmentOf({ text: "Defiro a gratuidade da justiça à parte autora." }), false);
});

test("unclear: both forms, neither, or a type the words contradict, and the person is asked", () => {
  // A judgment that also confirms the injunction says both.
  assert.equal(judgmentOf({ text: "Confirmo a liminar e julgo procedente o pedido." }), null);
  assert.equal(judgmentOf({ text: "Vistos. Ao cartório para as providências." }), null);
  assert.equal(judgmentOf({ documentType: "Decisão", text: "Julgo procedente o pedido." }), null);
  assert.equal(judgmentOf({ documentType: "Sentença", text: "Mantenho a liminar." }), null);
  assert.equal(judgmentOf({ documentType: "Outros", text: "Intimação da parte." }), null);
});

test("reads the words as plain text: no accent, no case, no markup", () => {
  assert.equal(plainWords("<p>JULGO&nbsp;Procedente</p>"), "julgo procedente");
  assert.equal(judgmentOf({ text: "<b>JULGO IMPROCEDENTE</b> o pedido." }), true);
});
