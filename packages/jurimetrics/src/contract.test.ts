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
    const decision = readMarketDecision({
      key: "h1",
      court: "tjgo",
      unit: "1º Juizado Especial Cível de Goiânia",
      party: query.party,
      day: query.day,
      text: WON,
    });
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
    const lost = readMarketDecision({
      key: "h2",
      court: "TJGO",
      unit: "2ª Turma Recursal",
      party: query.party,
      day: query.day,
      text: LOST,
    });
    assert.equal(lost?.result, "improcedente");
    assert.equal(lost?.moralCents, null);
    assert.equal(lost?.problem, "cancellation");
    assert.equal(lost?.judge, "Carlos Alberto Modelo");
    assert.equal(lost?.instance, "appeal");
    const extinct = readMarketDecision({
      key: "h3",
      court: "TJGO",
      unit: null,
      party: query.party,
      day: query.day,
      text: EXTINGUISHED,
    });
    assert.equal(extinct?.result, "extinto");
    assert.equal(extinct?.priorComplaint, true);
    assert.equal(
      readMarketDecision({ key: "h4", court: "TJGO", unit: null, party: query.party, day: query.day, text: ORDER }),
      null,
    );
  });

  it("takes identifiers out, tells the problems apart and finds no judge where none signed", () => {
    assert.equal(
      withoutIdentifiers("CPF 529.982.247-25, e-mail a@b.invalid, CEP 74000-000"),
      "CPF [documento], e-mail [e-mail], CEP [cep]",
    );
    assert.equal(problemOf("extravio da bagagem"), "baggage");
    assert.equal(problemOf("passageira impedida de embarcar por overbooking"), "overbooking");
    assert.equal(judgeOf("Intime-se."), null);
  });
});

// ---------- mercado-v2: the moral damages from their own clause, the accents joined, why it was extinguished ----------

const MATERIAL_FIRST = `SENTENÇA. A autora relata o extravio da bagagem. Ante o exposto, JULGO PARCIALMENTE PROCEDENTES os pedidos para condenar a ré ao pagamento de R$ 314,40 a título de danos materiais, corrigidos desde o desembolso, e de R$ 5.000,00 a título de danos morais. Ana Paula Exemplo, Juíza de Direito`;
const MORAL_ONLY = `SENTENÇA. Cancelamento do voo sem assistência. Ante o exposto, JULGO PROCEDENTE o pedido e condeno a ré a pagar R$ 4.000,00 de indenização por dano moral.`;
const ABSENT = `SENTENÇA. Aberta a audiência de conciliação, ausente a parte autora, embora intimada. Ante o exposto, JULGO EXTINTO o processo, sem resolução do mérito, nos termos do art. 51, I, da Lei 9.099/95.`;
const GIVEN_UP = `SENTENÇA. A parte autora requereu a desistência da ação. Ante o exposto, HOMOLOGO a desistência e JULGO EXTINTO o processo sem resolução do mérito.`;
const COMPLEX = `SENTENÇA. A causa exige prova pericial, incompatível com o rito. Ante o exposto, JULGO EXTINTO o processo, sem resolução do mérito, pela incompetência do juizado.`;

describe("a decision read by rule (mercado-v2)", () => {
  it("takes the moral damages from their own clause, never the material damages written before them", () => {
    const decision = readMarketDecision({
      key: "v2a",
      court: "TJGO",
      unit: "1º Juizado Especial Cível de Goiânia",
      party: query.party,
      day: query.day,
      text: MATERIAL_FIRST,
    });
    assert.equal(decision?.result, "parcial");
    assert.equal(decision?.moralCents, 500000);
    assert.equal(decision?.problem, "baggage");
    const alone = readMarketDecision({
      key: "v2b",
      court: "TJGO",
      unit: null,
      party: query.party,
      day: query.day,
      text: MORAL_ONLY,
    });
    assert.equal(alone?.moralCents, 400000);
  });

  it("reads a judge's name whose accent came apart from its letter", () => {
    const decomposed = `${WON.replace("Ana Paula Exemplo", "LÍCIA EXEMPLO TESTE")}`.normalize("NFD");
    const decision = readMarketDecision({
      key: "v2c",
      court: "TJGO",
      unit: null,
      party: query.party,
      day: query.day,
      text: decomposed,
    });
    assert.equal(decision?.judge, "LÍCIA EXEMPLO TESTE");
  });

  it("says why a lawsuit was extinguished, and says nothing of it for a judgment", () => {
    const reason = (key: string, text: string) =>
      readMarketDecision({ key, court: "TJGO", unit: null, party: query.party, day: query.day, text })
        ?.extinctionReason;
    assert.equal(reason("v2d", ABSENT), "ausencia_autor");
    assert.equal(reason("v2e", GIVEN_UP), "desistencia");
    assert.equal(reason("v2f", COMPLEX), "incompetencia");
    assert.equal(reason("v2g", EXTINGUISHED), "reclamacao_previa");
    assert.equal(reason("v2h", WON), null);
  });

  it("decodes the DJEN's HTML entities before reading, and keys the same text once", () => {
    const escaped = `SENTEN&Ccedil;A. Cancelamento do voo. Ante o exposto, JULGO PROCEDENTES, EM PARTE, os pedidos para condenar a r&eacute; a pagar R$ 3.000,00 para cada autor a t&iacute;tulo de danos morais. Goi&acirc;nia. L&Iacute;CIA EXEMPLO TESTE, Ju&iacute;za de Direito`;
    const decision = readMarketDecision({
      key: "v2i",
      court: "TJGO",
      unit: null,
      party: query.party,
      day: query.day,
      text: escaped,
    });
    assert.equal(decision?.result, "parcial");
    assert.equal(decision?.moralCents, 300000);
    assert.equal(decision?.perClaimant, true);
    assert.equal(decision?.judge, "LÍCIA EXEMPLO TESTE");
    const again = readMarketDecision({
      key: "v2j",
      court: "TJGO",
      unit: null,
      party: query.party,
      day: query.day,
      text: escaped.replace("&eacute;", "é"),
    });
    assert.equal(again?.contentKey, decision?.contentKey);
  });

  it("reads a lay judge's project, a settlement approved in part and a value written in words; an order's warning is no extinction", () => {
    const read = (key: string, text: string) =>
      readMarketDecision({ key, court: "TJGO", unit: null, party: query.party, day: query.day, text });
    const project = read(
      "v2l",
      `PROJETO DE SENTENÇA. Atraso de voo. Ante o exposto, sugiro JULGAR PARCIALMENTE PROCEDENTES os pedidos para condenar a ré ao pagamento da quantia de 4.000,00 (quatro mil reais) a título de danos morais.`,
    );
    assert.equal(project?.result, "parcial");
    assert.equal(project?.moralCents, 400000);
    assert.equal(
      read(
        "v2m",
        `SENTENÇA. Ante o exposto, HOMOLOGO parcialmente o acordo celebrado entre as partes e declaro extinto o processo.`,
      )?.result,
      "acordo",
    );
    assert.equal(
      read(
        "v2n",
        `DESPACHO. Designo audiência de conciliação. A ausência da parte autora importará a extinção do processo sem resolução do mérito.`,
      ),
      null,
    );
    assert.equal(
      read("v2o", `SENTENÇA. Ante o exposto, JULGO IMPROCEDENTES os embargos à execução opostos pela ré.`),
      null,
    );
  });

  it("counts an enforcement phase ended by payment as no decision of the claim", () => {
    const paid = `SENTENÇA. Satisfeita a obrigação, JULGO EXTINTA a presente fase de cumprimento de sentença, nos termos do art. 924, II, do CPC.`;
    assert.equal(
      readMarketDecision({ key: "v2k", court: "TJGO", unit: null, party: query.party, day: query.day, text: paid }),
      null,
    );
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
      day === query.day &&
      url.searchParams.get("nomeParte") === query.party &&
      url.searchParams.get("siglaTribunal") === "TJGO"
        ? [
            {
              hash: "h1",
              siglaTribunal: "TJGO",
              nomeOrgao: "1º Juizado Especial Cível de Goiânia",
              texto: WON,
              ativo: true,
            },
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
