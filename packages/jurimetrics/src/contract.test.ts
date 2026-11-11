import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FakeMarketSource } from "./fake.ts";
import { MarketDjenSource } from "./providers/djen.ts";
import { judgeOf, problemOf, readMarketDecision, withoutIdentifiers } from "./read.ts";
import type { MarketQuery, MarketSource } from "./types.ts";
import { MarketUnavailableError } from "./types.ts";

// ---------- Invented decisions: people nobody is, a judge nobody is, the CPF the manuals use ----------

const WON = `SENTENÇA. Trata-se de ação de indenização em que a parte autora, Maria Teste, CPF 123.456.789-09, relata atraso de 8 horas no voo. Não há prova de força maior. Ante o exposto, JULGO PROCEDENTE o pedido para condenar a ré ao pagamento de R$ 5.000,00 a título de danos morais. Goiânia, 10 de outubro de 2099. Ana Paula Exemplo, Juíza de Direito`;
const LOST = `SENTENÇA. A autora narra o cancelamento do voo. A companhia comprovou condições meteorológicas adversas. Isto posto, JULGO IMPROCEDENTE o pedido. Juiz de Direito: Carlos Alberto Modelo`;
const EXTINGUISHED = `SENTENÇA. A parte autora não demonstrou a pretensão resistida, sem prévia reclamação administrativa no consumidor.gov.br. Ante o exposto, JULGO EXTINTO o processo, sem resolução do mérito, por falta de interesse de agir.`;
const ORDER = `DESPACHO. Intime-se a parte autora para se manifestar sobre a contestação no prazo de 15 dias.`;

const query: MarketQuery = { court: "TJGO", party: "TAM LINHAS AEREAS S/A", day: "2099-10-10" };

describe("a decision read by rule (mercado-v1)", () => {
  it("reads a judgment won, its moral damages, the problem and the judge, and keeps no passenger", () => {
    const decision = readMarketDecision({ key: "h1", court: "tjgo", unit: "1º Juizado Especial Cível de Goiânia", party: query.party, day: query.day, text: WON });
    assert.ok(decision);
    assert.equal(decision.result, "procedente");
    assert.equal(decision.moralCents, 500000);
    assert.equal(decision.problem, "delay");
    assert.equal(decision.judge, "Ana Paula Exemplo");
    assert.equal(decision.court, "TJGO");
    assert.equal(decision.instance, "first");
    assert.ok(!decision.grounds.includes("123.456.789-09"));
    assert.ok(!("lawsuit" in decision));
  });

  it("reads a judgment lost, an extinction for want of a prior complaint, and nothing of an order", () => {
    const lost = readMarketDecision({ key: "h2", court: "TJGO", unit: "2ª Turma Recursal", party: query.party, day: query.day, text: LOST });
    assert.equal(lost?.result, "improcedente");
    assert.equal(lost?.moralCents, null);
    assert.equal(lost?.problem, "cancellation");
    assert.equal(lost?.judge, "Carlos Alberto Modelo");
    assert.equal(lost?.instance, "appeal");
    const extinct = readMarketDecision({ key: "h3", court: "TJGO", unit: null, party: query.party, day: query.day, text: EXTINGUISHED });
    assert.equal(extinct?.result, "extinto");
    assert.equal(extinct?.priorComplaint, true);
    assert.equal(readMarketDecision({ key: "h4", court: "TJGO", unit: null, party: query.party, day: query.day, text: ORDER }), null);
  });

  it("takes identifiers out, tells the problems apart and finds no judge where none signed", () => {
    assert.equal(withoutIdentifiers("CPF 529.982.247-25, e-mail a@b.invalid, CEP 74000-000"), "CPF [documento], e-mail [e-mail], CEP [cep]");
    assert.equal(problemOf("extravio da bagagem"), "baggage");
    assert.equal(problemOf("passageira impedida de embarcar por overbooking"), "overbooking");
    assert.equal(judgeOf("Intime-se."), null);
  });
});

/** What any source of decisions must do, whatever is behind it. */
function sourceContract(name: string, make: () => { source: MarketSource; fail: () => void }) {
  describe(`market source contract: ${name}`, () => {
    it("answers the decisions of a court, a party and a day, each once and never an order", async () => {
      const { source } = make();
      const listing = await source.decisionsOn(query);
      assert.equal(listing.complete, true);
      assert.deepEqual(listing.decisions.map((decision) => decision.key).sort(), ["h1", "h2"]);
      assert.equal(listing.read, 3);
    });

    it("answers a day with nothing as nothing, and fails as unavailable when it cannot be read", async () => {
      const { source, fail } = make();
      const empty = await source.decisionsOn({ ...query, day: "2099-10-11" });
      assert.deepEqual(empty.decisions, []);
      fail();
      await assert.rejects(() => source.decisionsOn(query), MarketUnavailableError);
    });
  });
}

sourceContract("fake", () => {
  const source = new FakeMarketSource();
  source.give(query, [
    { key: "h1", unit: "1º Juizado Especial Cível de Goiânia", text: WON },
    { key: "h2", unit: "2ª Turma Recursal", text: LOST },
    { key: "h5", unit: null, text: ORDER },
  ]);
  return { source, fail: () => source.failNext() };
});

/** The DJEN in the shapes of its public API: a page of items, the last page not full. */
sourceContract("djen", () => {
  let failing = false;
  const fetcher = (async (input: string | URL) => {
    if (failing) return new Response("", { status: 503 });
    const url = new URL(String(input));
    const day = url.searchParams.get("dataDisponibilizacaoInicio");
    const items =
      day === query.day && url.searchParams.get("nomeParte") === query.party && url.searchParams.get("siglaTribunal") === "TJGO"
        ? [
            { hash: "h1", siglaTribunal: "TJGO", nomeOrgao: "1º Juizado Especial Cível de Goiânia", texto: WON, ativo: true },
            { hash: "h2", siglaTribunal: "TJGO", nomeOrgao: "2ª Turma Recursal", texto: LOST, ativo: true },
            { hash: "h5", siglaTribunal: "TJGO", nomeOrgao: null, texto: ORDER, ativo: true },
          ]
        : [];
    return new Response(JSON.stringify({ status: "success", count: items.length, items }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { source: new MarketDjenSource({ fetch: fetcher, pauseMs: 0 }), fail: () => (failing = true) };
});
