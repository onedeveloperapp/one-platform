import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { comparableWords, jaccard, shingles, signature, SIGNATURE_SLOTS, similarity } from "./similarity.ts";

/** A paragraph of invented text, different for each number: words drawn in a fixed order, never by chance. */
function paragraph(seed: number, words = 400): string {
  const vocabulary =
    "a companhia aérea atrasou o voo e a passageira perdeu a conexão no aeroporto de origem sem assistência material nem informação clara sobre o novo horário de embarque previsto pela empresa que cancelou a reserva feita meses antes da viagem com a família para o destino final onde havia compromisso marcado".split(
      " ",
    );
  let state = seed * 2654435761;
  const out: string[] = [];
  for (let index = 0; index < words; index += 1) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out.push(vocabulary[state % vocabulary.length]);
  }
  return out.join(" ");
}

describe("how alike two pieces are", () => {
  it("compares words with no case, accent or punctuation, and every figure as one word", () => {
    assert.deepEqual(comparableWords("A Ação, de 12/03/2026: R$ 5.000,00!"), ["a", "acao", "de", "0", "r", "0"]);
    assert.deepEqual(comparableWords("Voo G3 1234"), ["voo", "g", "0", "0"]);
    assert.deepEqual(comparableWords(""), []);
  });

  it("makes sequences of five words, and none of a text shorter than that", () => {
    assert.deepEqual([...shingles("um dois três quatro cinco seis")], ["um dois tres quatro cinco", "dois tres quatro cinco seis"]);
    assert.equal(shingles("um dois três quatro").size, 0);
    assert.equal(jaccard(shingles("um dois três quatro cinco seis"), shingles("um dois três quatro cinco sete")), 1 / 3);
    assert.equal(jaccard(new Set(), shingles("um dois três quatro cinco")), 0);
  });

  it("gives the same signature for the same text, and a signature of a fixed size", () => {
    const text = paragraph(1);
    assert.deepEqual(signature(text), signature(text));
    assert.equal(signature(text).length, SIGNATURE_SLOTS);
    assert.ok(signature(text).every((value) => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647));
    assert.deepEqual(signature("curto demais"), []);
    // The same on every machine: a signature kept in a database is compared with one computed years later.
    assert.deepEqual(signature("um dois três quatro cinco seis", 4), signature("UM, dois; TRÊS quatro. Cinco seis", 4));
  });

  it("says two texts that only change names, dates and amounts are the same text", () => {
    const model = (name: string, flight: string, day: string, amount: string) =>
      `${name} comprou passagem para o voo ${flight} do dia ${day}, que atrasou mais de quatro horas, e pede ${amount} de indenização por danos morais pelo descaso da companhia aérea com a sua situação.`;
    const one = signature(model("Maria Teste", "G3 1234", "12/03/2026", "R$ 10.000,00"));
    const other = signature(model("João Exemplo", "AD 4512", "05/07/2026", "R$ 8.000,00"));
    assert.ok(similarity(one, other) > 0.5, String(similarity(one, other)));
    // Every figure is one word: another flight number, another day and another amount change nothing.
    assert.equal(similarity(one, signature(model("Maria Teste", "G3 9999", "01/01/2027", "R$ 1,00"))), 1);
  });

  it("estimates the share of text two pieces have in common, within a few points", () => {
    const shared = paragraph(7, 600);
    for (const [own, expected] of [
      [0, 1],
      [200, null],
      [600, null],
      [2400, null],
    ] as const) {
      const a = `${shared} ${paragraph(11, own)}`;
      const b = `${shared} ${paragraph(13, own)}`;
      const truth = jaccard(shingles(a), shingles(b));
      const estimate = similarity(signature(a), signature(b));
      if (expected !== null) assert.equal(estimate, expected);
      assert.ok(Math.abs(estimate - truth) < 0.13, `own ${own}: estimate ${estimate}, truth ${truth}`);
    }
    // Two texts written apart share next to nothing.
    assert.ok(similarity(signature(paragraph(21, 800)), signature(paragraph(22, 800))) < 0.15);
  });

  it("says nothing of a text with no sequence, or of signatures of different sizes", () => {
    assert.equal(similarity([], []), 0);
    assert.equal(similarity(signature(paragraph(1)), []), 0);
    assert.equal(similarity([1, 2, 3], [1, 2]), 0);
    assert.equal(similarity([1, 2, 3, 4], [1, 2, 0, 0]), 0.5);
  });
});
