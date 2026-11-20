import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { areaOfLawsuit, type LawsuitSign, proposeAreas } from "@flyee/rules/areas";

const sign = (over: Partial<LawsuitSign>): LawsuitSign => ({
  court: "TJGO",
  className: null,
  kind: null,
  airline: false,
  inss: false,
  ...over,
});

describe("areaOfLawsuit", () => {
  it("reads a labour court as labour, whatever the class", () => {
    assert.equal(areaOfLawsuit(sign({ court: "TRT18", className: "Ação Trabalhista - Rito Ordinário" })), "trabalhista");
    assert.equal(areaOfLawsuit(sign({ court: "TST" })), "trabalhista");
  });

  it("reads a federal court by the INSS, and leaves the rest of it untold", () => {
    assert.equal(areaOfLawsuit(sign({ court: "TRF1", inss: true })), "previdenciario");
    assert.equal(areaOfLawsuit(sign({ court: "TRF3", className: "Procedimento Comum Cível" })), null);
    assert.equal(areaOfLawsuit(sign({ court: "TRF4", className: "Execução Fiscal" })), "tributario");
  });

  it("reads the classes of family, crime, tax, real estate and companies wherever they run", () => {
    assert.equal(areaOfLawsuit(sign({ className: "Divórcio Litigioso" })), "familia");
    assert.equal(areaOfLawsuit(sign({ className: "Alimentos - Lei Especial Nº 5.478/68" })), "familia");
    assert.equal(areaOfLawsuit(sign({ className: "Inventário" })), "familia");
    assert.equal(areaOfLawsuit(sign({ className: "Ação Penal - Procedimento Ordinário" })), "criminal");
    assert.equal(areaOfLawsuit(sign({ court: "TRF1", className: "Habeas Corpus Criminal", inss: true })), "criminal");
    assert.equal(areaOfLawsuit(sign({ className: "Execução Fiscal" })), "tributario");
    assert.equal(areaOfLawsuit(sign({ className: "Despejo por Falta de Pagamento" })), "imobiliario");
    assert.equal(areaOfLawsuit(sign({ className: "Recuperação Judicial" })), "empresarial");
  });

  it("reads a state court's lawsuit naming an airline as the passenger's", () => {
    assert.equal(
      areaOfLawsuit(sign({ className: "Procedimento do Juizado Especial Cível", kind: "juizado", airline: true })),
      "passageiro",
    );
  });

  it("reads the small-claims court as the consumer's and the common procedure as civil, in a state court only", () => {
    assert.equal(areaOfLawsuit(sign({ kind: "juizado" })), "consumidor");
    assert.equal(areaOfLawsuit(sign({ kind: "comum" })), "civel");
    assert.equal(areaOfLawsuit(sign({ court: "STJ", kind: "comum" })), null);
    assert.equal(areaOfLawsuit(sign({})), null);
  });
});

describe("proposeAreas", () => {
  it("counts each area, the most frequent first, proposes the ones that weigh and says how many told none", () => {
    const signs: LawsuitSign[] = [
      ...Array.from({ length: 12 }, () => sign({ kind: "juizado", airline: true })),
      ...Array.from({ length: 5 }, () => sign({ court: "TRT18" })),
      sign({ className: "Divórcio Consensual" }),
      sign({ court: "STF" }),
      sign({ court: "STF" }),
    ];
    const { areas, untold } = proposeAreas(signs);
    assert.equal(untold, 2);
    assert.deepEqual(
      areas.map((area) => [area.area, area.lawsuits, area.share, area.proposed]),
      [
        ["passageiro", 12, 67, true],
        ["trabalhista", 5, 28, true],
        ["familia", 1, 6, false],
      ],
    );
  });

  it("proposes nothing from nothing", () => {
    assert.deepEqual(proposeAreas([]), { areas: [], untold: 0 });
  });
});
