import { readTestStatement, statementLines, writeTestStatement } from "./statement";
import { describe, expect, it } from "vitest";

import { isClientMoney, readOfx } from "@flyee/rules/finance";

// Every person, number and value here is invented.
const data = readTestStatement({
  firm: "Lima Advocacia",
  releases: [
    {
      id: "a9370000-0000-4000-8000-000000000001",
      cents: 1000000,
      on: "2026-11-05",
      cnj: "10003012720998090100",
      court: "TJGO",
    },
  ],
  transfers: [
    {
      id: "a6370000-0000-4000-8000-000000000002",
      cents: 700000,
      on: null,
      status: "owed",
      name: "Maria Teste",
      cpf: "52998224725",
    },
  ],
  bills: [
    {
      id: "b1000000-0000-4000-8000-000000000003",
      direction: "pay",
      cents: 18990,
      due_on: "2026-11-04",
      counterparty: "Energia Teste",
    },
    {
      id: "b1000000-0000-4000-8000-000000000004",
      direction: "receive",
      cents: 50000,
      due_on: "2026-11-20",
      counterparty: "João Teste",
    },
  ],
})!;

describe("the test statement", () => {
  it("puts each release, each transfer and each bill on its day, and the month's fee", () => {
    expect(statementLines(data, "2026-11-10").map((line) => [line.on, line.cents])).toEqual([
      ["2026-11-04", -18990],
      ["2026-11-05", 1000000],
      ["2026-11-10", -700000],
      ["2026-11-10", 50000],
      ["2026-11-10", -2990],
    ]);
  });

  it("is a statement the books read, the release as a client's money and the same ids every time", () => {
    const read = readOfx(writeTestStatement(data, "2026-11-10"));
    const reread = readOfx(writeTestStatement(data, "2026-11-10"));
    if (!read.ok || !reread.ok) throw new Error("not read");
    const first = read.statement;
    const again = reread.statement;
    expect(first.lines).toHaveLength(5);
    expect(first.lines.map((line) => line.bankId)).toEqual(again.lines.map((line) => line.bankId));
    const release = first.lines.find((line) => line.cents === 1000000)!;
    expect(isClientMoney(release)).toBe(true);
    expect(first.lines.find((line) => line.cents === -700000)?.memo).toBe("PIX ENVIADO MARIA TESTE ***982247**");
    expect(first.balance?.cents).toBe(1000000 - 700000 - 18990 + 50000 - 2990);
  });
});
