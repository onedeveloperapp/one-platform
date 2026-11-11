import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FakeIndexSource } from "./fake.ts";
import { BcbIndexSource } from "./providers/bcb.ts";
import { type IndexSource, InvalidMonthError } from "./types.ts";

/** The rates of the scenario are invented: a test never depends on the real series. */
const IPCA = { "2025-01": 0.16, "2025-02": 1.31, "2025-03": 0.56 };
const SELIC = { "2025-01": 1.01, "2025-02": 0.99, "2025-03": 0.96 };

type Scripted = { status: number; body: unknown } | Error;

function scriptedFetch(answers: Scripted[]) {
  const calls: string[] = [];
  const run = (async (input: Parameters<typeof fetch>[0]) => {
    calls.push(String(input));
    const next = answers.shift();
    if (!next) throw new Error(`unexpected call to ${String(input)}`);
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { run, calls };
}

const sgs = (rates: Record<string, number>) =>
  Object.entries(rates).map(([month, value]) => ({ data: `01/${month.slice(5, 7)}/${month.slice(0, 4)}`, valor: String(value) }));

function contract(name: string, make: (answers: Scripted[]) => IndexSource) {
  describe(`${name}: the monthly rates of a series`, () => {
    it("answers each month of the range it has, in percent", async () => {
      const source = make([{ status: 200, body: sgs(IPCA) }]);
      assert.deepEqual(await source.monthly("ipca", "2025-01", "2025-03"), { kind: "read", rates: IPCA });
    });

    it("leaves out a month outside the range", async () => {
      const source = make([{ status: 200, body: sgs(SELIC) }]);
      const answer = await source.monthly("selic", "2025-02", "2025-02");
      assert.deepEqual(answer, { kind: "read", rates: { "2025-02": 0.99 } });
    });

    it("refuses a month that is no month before asking", async () => {
      const source = make([]);
      await assert.rejects(() => source.monthly("ipca", "2025-13", "2025-14"), InvalidMonthError);
    });
  });
}

contract("the fake", () => new FakeIndexSource({ ipca: IPCA, selic: SELIC }));
contract("the Banco Central", (answers) => new BcbIndexSource({ fetch: scriptedFetch(answers).run }));

describe("the Banco Central's own answers", () => {
  it("asks series 433 for the IPCA and 4390 for the Selic, by days of the months", async () => {
    const script = scriptedFetch([
      { status: 200, body: [] },
      { status: 200, body: [] },
    ]);
    const source = new BcbIndexSource({ fetch: script.run });
    await source.monthly("ipca", "2024-02", "2024-02");
    await source.monthly("selic", "2025-01", "2025-03");
    assert.match(script.calls[0], /bcdata\.sgs\.433\/dados\?formato=json&dataInicial=01%2F02%2F2024&dataFinal=29%2F02%2F2024$/);
    assert.match(script.calls[1], /bcdata\.sgs\.4390\/dados\?formato=json&dataInicial=01%2F01%2F2025&dataFinal=31%2F03%2F2025$/);
  });

  it("takes a 404 as a range with no value, and anything else as unavailable", async () => {
    const source = new BcbIndexSource({
      fetch: scriptedFetch([{ status: 404, body: { error: "x" } }, { status: 503, body: {} }, new Error("offline")]).run,
    });
    assert.deepEqual(await source.monthly("ipca", "2030-01", "2030-02"), { kind: "read", rates: {} });
    assert.deepEqual(await source.monthly("ipca", "2025-01", "2025-02"), { kind: "unavailable", detail: "status_503" });
    assert.deepEqual(await source.monthly("ipca", "2025-01", "2025-02"), { kind: "unavailable", detail: "network" });
  });

  it("the fake says when its series is out", async () => {
    assert.deepEqual(await new FakeIndexSource({}, { down: true }).monthly("selic", "2025-01", "2025-01"), {
      kind: "unavailable",
      detail: "down",
    });
  });
});
