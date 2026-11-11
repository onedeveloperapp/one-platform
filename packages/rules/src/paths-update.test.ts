import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pathOpen, pathsAfter } from "@flyee/rules/paths";
import { depositShortfall, enforcementFine, monthsBetween, updateAmount } from "@flyee/rules/update";

describe("caminhos-v1: what may follow a decision", () => {
  it("a judgment of the small-claims court takes embargos or the recurso inominado, with its preparo and fees", () => {
    const paths = pathsAfter({ kind: "juizado", stage: "sentenca", condemnation: true });
    assert.deepEqual(
      paths.map((path) => path.option),
      ["aceitar", "embargos_declaracao", "recurso_inominado"],
    );
    const appeal = paths.find((path) => path.option === "recurso_inominado");
    assert.deepEqual(appeal?.costs, { preparo: true, fees: { min: 10, max: 20, base: "condenacao" }, suspended: false });
  });

  it("free justice takes off the preparo and suspends what losing costs", () => {
    const appeal = pathsAfter({ kind: "juizado", stage: "sentenca", freeJustice: true }).find(
      (path) => path.option === "recurso_inominado",
    );
    assert.deepEqual(appeal?.costs, { preparo: false, fees: { min: 10, max: 20, base: "causa" }, suspended: true });
  });

  it("never the recurso especial from the small-claims court; the uniformization only where the court has it", () => {
    assert.equal(pathOpen({ kind: "juizado", stage: "acordao" }, "recurso_especial"), false);
    assert.equal(pathOpen({ kind: "juizado", stage: "acordao" }, "recurso_extraordinario"), true);
    assert.equal(pathOpen({ kind: "juizado", stage: "acordao" }, "pedido_uniformizacao"), false);
    assert.equal(pathOpen({ kind: "juizado", stage: "acordao", uniformization: true }, "pedido_uniformizacao"), true);
  });

  it("the civil court's judgment takes the apelação, and its acórdão the special and the extraordinary appeals", () => {
    assert.equal(pathOpen({ kind: "comum", stage: "sentenca" }, "apelacao"), true);
    assert.deepEqual(
      pathsAfter({ kind: "comum", stage: "acordao" }).map((path) => path.option),
      ["aceitar", "embargos_declaracao", "recurso_especial", "recurso_extraordinario"],
    );
  });
});

describe("atualizacao-v1: a condemnation updated by Lei 14.905/2024", () => {
  it("counts the months from the one after the start, or the start's own when it is the first day", () => {
    assert.deepEqual(monthsBetween("2024-06-15", "2024-09-10"), ["2024-07", "2024-08", "2024-09"]);
    assert.deepEqual(monthsBetween("2024-06-01", "2024-07-10"), ["2024-06", "2024-07"]);
    assert.deepEqual(monthsBetween("2024-09-10", "2024-08-10"), []);
  });

  it("corrects by the judgment's index before 30/08/2024 and by the IPCA after, interest by the Selic less the IPCA", () => {
    const result = updateAmount({
      principalCents: 100_000,
      correctionFrom: "2024-06-10",
      interestFrom: "2024-06-10",
      until: "2024-10-05",
      before: { index: { "2024-07": 1 }, interestMonthly: 1 },
      ipca: { "2024-08": 0.5, "2024-09": 0.4, "2024-10": 0.5 },
      selic: { "2024-08": 0.9, "2024-09": 0.3, "2024-10": 0.9 },
    });
    // 1.01 * 1.005 * 1.004 * 1.005 over 1,000.00
    assert.equal(result.correctedCents, Math.round(100_000 * 1.01 * 1.005 * 1.004 * 1.005));
    // Interest: 1% in July, then 0.4 (Aug), 0 (Sep: the Selic below the IPCA), 0.4 (Oct)
    assert.equal(result.interestCents, Math.round((result.correctedCents * 1.8) / 100));
    assert.deepEqual(result.missing, []);
    assert.equal(result.months.find((month) => month.month === "2024-09")?.interest, 0);
    assert.equal(result.months.find((month) => month.month === "2024-07")?.regime, "sentenca");
  });

  it("names a month with no rate, never guesses it", () => {
    const result = updateAmount({
      principalCents: 50_000,
      correctionFrom: "2025-01-01",
      interestFrom: "2025-01-01",
      until: "2025-02-15",
      before: { index: {}, interestMonthly: 1 },
      ipca: { "2025-01": 0.2 },
      selic: { "2025-01": 1.0 },
    });
    assert.deepEqual(result.missing, ["2025-02"]);
  });

  it("says what a deposit leaves owed, and the fine of a payment not made", () => {
    assert.deepEqual(depositShortfall(300_000, 300_000), { kind: "inteiro", shortCents: 0 });
    assert.deepEqual(depositShortfall(300_000, 250_000), { kind: "a_menor", shortCents: 50_000 });
    assert.equal(enforcementFine(300_000), 30_000);
  });
});
