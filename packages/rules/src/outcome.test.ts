import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { againstClient, endsLawsuit, movementFact, readJudgment, readRelease } from "./outcome.ts";

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
});
