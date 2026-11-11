import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  againstClient,
  certifiesFinal,
  endsLawsuit,
  movementFact,
  readClaims,
  readJudgment,
  readRelease,
} from "./outcome.ts";

describe("what a lawsuit came to, read by rule", () => {
  it("reads the facts a court's movements say", () => {
    assert.deepEqual(movementFact("Certificado o trânsito em julgado da sentença"), { kind: "transito" });
    assert.deepEqual(movementFact("Arquivado definitivamente", "Baixa do processo."), { kind: "arquivamento" });
    assert.deepEqual(movementFact("Expedido alvará eletrônico em favor da parte autora"), {
      kind: "alvara",
      release: "alvara",
    });
    assert.deepEqual(movementFact("Expedida Requisição de Pequeno Valor"), { kind: "alvara", release: "rpv" });
    assert.deepEqual(movementFact("Juntado o comprovante do depósito judicial feito pela ré"), { kind: "deposito" });
    assert.deepEqual(movementFact("Homologado o acordo entre as partes"), { kind: "acordo" });
    assert.deepEqual(movementFact("Interposto recurso inominado pela parte ré"), { kind: "recurso", by: "re" });
    assert.deepEqual(movementFact("Recurso inominado da parte autora recebido"), { kind: "recurso", by: "autor" });
    assert.deepEqual(movementFact("Julgado procedente o pedido"), { kind: "sentenca", result: "procedente" });
    assert.deepEqual(movementFact("Julgado parcialmente procedente o pedido"), { kind: "sentenca", result: "parcial" });
    assert.deepEqual(movementFact("Julgado improcedente o pedido"), { kind: "sentenca", result: "improcedente" });
  });

  it("never reads a provisional archiving, a suspension or an order of costs as an end or a release", () => {
    assert.equal(movementFact("Arquivado provisoriamente"), null);
    assert.equal(movementFact("Autos arquivados em razão da suspensão do processo"), null);
    assert.equal(movementFact("Intimação para recolhimento de custas"), null);
    assert.equal(movementFact("Juntada de petição"), null);
    assert.equal(movementFact(""), null);
  });

  it("reads a judgment's operative part: the result, the value beside the condemnation, and whether each claimant's", () => {
    const granted = readJudgment(
      "SENTENÇA. Dispensado o relatório. A ré alegou força maior, sem provas, e pediu R$ 1.000,00 de custas. Ante o exposto, JULGO PROCEDENTE o pedido para condenar a ré a pagar à parte autora indenização por danos morais de R$ 5.000,00 (cinco mil reais) por autor, com correção monetária.",
    );
    assert.equal(granted?.result, "procedente");
    assert.equal(granted?.cents, 500000);
    assert.equal(granted?.perClaimant, true);
    assert.ok(granted?.words.includes("JULGO PROCEDENTE"));

    const part = readJudgment(
      "Isto posto, JULGO PARCIALMENTE PROCEDENTE o pedido para condenar a requerida ao pagamento de R$ 3.000,00 a título de danos morais.",
    );
    assert.deepEqual([part?.result, part?.cents, part?.perClaimant], ["parcial", 300000, false]);

    const denied = readJudgment("Diante do exposto, JULGO IMPROCEDENTE o pedido. Sem custas.");
    assert.deepEqual([denied?.result, denied?.cents], ["improcedente", null]);

    const settled = readJudgment("Pelo exposto, HOMOLOGO o acordo celebrado entre as partes, no valor de R$ 4.500,00.");
    assert.deepEqual([settled?.result, settled?.cents], ["acordo", 450000]);

    assert.equal(readJudgment("Intime-se a parte autora para se manifestar."), null);
  });

  it("reads what the operative part decided of each claim, with the value beside it (pedidos-v1)", () => {
    // One clause, two claims and two values, each value before its claim.
    assert.deepEqual(
      readClaims(
        "Ante o exposto, JULGO PARCIALMENTE PROCEDENTES os pedidos para condenar a ré ao pagamento de R$ 5.000,00 a título de danos morais e de R$ 1.234,56 a título de danos materiais, corrigidos desde a citação.",
      ),
      [
        { claim: "danos_morais", result: "concedido", cents: 500000, perClaimant: false },
        { claim: "danos_materiais", result: "concedido", cents: 123456, perClaimant: false },
      ],
    );
    // Each value after its claim, a denial in its own sentence, and a value each claimant's.
    assert.deepEqual(
      readClaims(
        "Isto posto, condeno a requerida a pagar, a título de danos morais, R$ 4.000,00 (quatro mil reais) para cada autor. Julgo improcedente o pedido de danos materiais, não comprovados.",
      ),
      [
        { claim: "danos_morais", result: "concedido", cents: 400000, perClaimant: true },
        { claim: "danos_materiais", result: "negado", cents: null, perClaimant: false },
      ],
    );
    // A denial and a grant in one clause; the refund with its value after the verb; "deixo de condenar" is a denial.
    assert.deepEqual(
      readClaims(
        "Diante do exposto, julgo improcedente o pedido de lucros cessantes e procedente o de danos morais, condenando a ré a pagar R$ 6.000,00, e a restituir à autora o valor de R$ 850,00 referente às passagens; deixo de condenar a ré em danos materiais.",
      ),
      [
        { claim: "lucros_cessantes", result: "negado", cents: null, perClaimant: false },
        { claim: "danos_morais", result: "concedido", cents: 600000, perClaimant: false },
        { claim: "restituicao", result: "concedido", cents: 85000, perClaimant: false },
        { claim: "danos_materiais", result: "negado", cents: null, perClaimant: false },
      ],
    );
    // "danos morais e materiais" names both; a mention with no decision in its clause decides nothing.
    assert.deepEqual(
      readClaims(
        "Pelo exposto, JULGO IMPROCEDENTES os pedidos de danos morais e materiais. Sobre os danos morais não incidem juros.",
      ),
      [
        { claim: "danos_morais", result: "negado", cents: null, perClaimant: false },
        { claim: "danos_materiais", result: "negado", cents: null, perClaimant: false },
      ],
    );
    // Only the operative part: the reasoning before "ante o exposto" is not read.
    assert.deepEqual(
      readClaims(
        "A autora pede danos materiais de R$ 900,00, que rejeito por falta de prova. Ante o exposto, condeno a ré a pagar R$ 3.000,00 por danos morais.",
      ),
      [{ claim: "danos_morais", result: "concedido", cents: 300000, perClaimant: false }],
    );
    assert.deepEqual(readClaims("Ante o exposto, julgo procedente o pedido. Sem custas."), []);
    // The judgment's reading carries them, and a settlement has none.
    assert.equal(
      readJudgment(
        "Ante o exposto, JULGO PROCEDENTE o pedido para condenar a ré a pagar R$ 5.000,00 a título de danos morais.",
      )?.claims.length,
      1,
    );
    assert.deepEqual(readJudgment("Pelo exposto, HOMOLOGO o acordo, no valor de R$ 4.500,00.")?.claims, []);
  });

  it("ends a lawsuit only on its definitive archiving, and says a denial is against the client", () => {
    assert.equal(endsLawsuit([{ kind: "transito" }, { kind: "alvara" }]), false);
    assert.equal(endsLawsuit([{ kind: "arquivamento" }]), true);
    assert.equal(againstClient("improcedente"), true);
    assert.equal(againstClient("parcial"), false);
  });

  it("reads the value of a release a court ordered, never an order of costs", () => {
    assert.deepEqual(
      readRelease("Expeça-se alvará eletrônico em favor da parte autora no valor de R$ 10.000,00 para levantamento."),
      { release: "alvara", cents: 1000000 },
    );
    assert.equal(readRelease("Recolha a parte as custas de R$ 300,00 no prazo de 5 dias."), null);
    assert.equal(readRelease("Expeça-se alvará eletrônico em favor da parte autora."), null);
  });

  it("reads the court's certificate that the judgment became final, never the order of what follows it", () => {
    for (const certified of [
      "CERTIDÃO. Certifico, para os devidos fins, que a sentença proferida nos autos transitou em julgado em 10/11/2026.",
      "Certifico que o acórdão transitou em julgado.",
      "CERTIDÃO DE TRÂNSITO EM JULGADO. Nada mais.",
      "Sentença transitada em julgado em 03/11/2026. Intime-se a ré para pagamento.",
      "Certifico que a decisão transitada em julgado não foi objeto de recurso.",
    ]) {
      assert.equal(certifiesFinal(certified), true, certified);
    }
    for (const notYet of [
      "SENTENÇA. Julgo procedente o pedido. Após o trânsito em julgado, arquivem-se os autos.",
      "Com o trânsito em julgado, intime-se a parte autora.",
      "Certifico que a sentença ainda não transitou em julgado, pois há recurso pendente.",
      "Intime-se a parte autora para se manifestar.",
      "",
    ]) {
      assert.equal(certifiesFinal(notYet), false, notYet);
    }
  });
});
