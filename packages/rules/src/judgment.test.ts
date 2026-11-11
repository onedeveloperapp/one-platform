import assert from "node:assert/strict";
import test from "node:test";

import { decidesEmbargos, homologatesSettlement, judgmentOf, plainWords } from "./judgment.ts";

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
  assert.equal(
    judgmentOf({ text: "Homologo o projeto de sentença do juiz leigo, para que produza seus efeitos." }),
    true,
  );
  assert.equal(
    judgmentOf({ text: "Julgo extinto o processo, sem resolução do mérito, nos termos do artigo 485, VI." }),
    true,
  );
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

test("a judgment that homologates the parties' settlement, and one that only homologates the juiz leigo", () => {
  for (const text of [
    "Homologo o acordo celebrado entre as partes, para que produza seus efeitos.",
    "HOMOLOGO, por sentença, para que produza seus jurídicos e legais efeitos, a transação entabulada.",
    "Vistos. Homologado o acordo entre as partes, julgo extinto o processo com resolução do mérito.",
    "O acordo firmado entre as partes fica homologado. P.R.I.",
  ]) {
    assert.equal(homologatesSettlement(text), true, text);
  }
  for (const text of [
    "Homologo o projeto de sentença do juiz leigo, para que produza seus efeitos.",
    "Homologo o projeto de sentença do juiz leigo, que reconheceu não haver o acordo alegado.",
    "Julgo procedente o pedido. As partes não chegaram a acordo na audiência.",
    "Homologo os cálculos. Intime-se a ré para pagar.",
  ]) {
    assert.equal(homologatesSettlement(text), false, text);
  }
});

test("a decision that rules on embargos de declaração, and an order on their course", () => {
  for (const text of [
    "Conheço dos embargos de declaração e, no mérito, rejeito-os.",
    "Ante o exposto, REJEITO os embargos de declaração opostos pela ré.",
    "Acolho parcialmente os embargos para sanar a omissão apontada.",
    "Dou provimento aos embargos declaratórios, com efeitos infringentes.",
    "Embargos de declaração rejeitados. Mantenho a sentença por seus próprios fundamentos.",
    "Recebo os embargos de declaração, pois tempestivos. No mérito, nego-lhes provimento.",
  ]) {
    assert.equal(decidesEmbargos(text), true, text);
  }
  for (const text of [
    "Opostos embargos de declaração, intime-se a parte embargada para, querendo, manifestar-se em 5 dias.",
    "Julgo procedente o pedido. Nego provimento ao recurso.",
    "Recebo os embargos de declaração. Conclusos.",
  ]) {
    assert.equal(decidesEmbargos(text), false, text);
  }
});

test("reads the words as plain text: no accent, no case, no markup", () => {
  assert.equal(plainWords("<p>JULGO&nbsp;Procedente</p>"), "julgo procedente");
  assert.equal(judgmentOf({ text: "<b>JULGO IMPROCEDENTE</b> o pedido." }), true);
});
