import { describe, expect, it } from "vitest";

import {
  brasiliaMonth,
  durationOf,
  familyLabelKey,
  familyLines,
  kindLabelKey,
  moneyOf,
  monthLabel,
  monthsBetween,
  monthShift,
  monthTotals,
  ONE_WORK_FAMILIES,
  oneWorkOf,
  oneWorkSheet,
  type Say,
} from "@/lib/one-work/work";

const answer = {
  from: "2026-09",
  to: "2026-10",
  decides: true,
  hour_cents: 15000,
  kinds: [
    { key: "documento_conferido", family: "documentos", default_minutes: 3, minutes: 3, own: false },
    { key: "texto_peca", family: "pecas", default_minutes: 30, minutes: 45, own: true },
    { key: "peca_aprovada", family: "pecas", default_minutes: 15, minutes: 15, own: false },
    { key: "novo_do_banco", family: "outra_familia", default_minutes: 1 },
  ],
  rows: [
    { month: "2026-10", kind: "documento_conferido", alone: 4, assisted: 1, test: 2, minutes: 15, test_minutes: 6 },
    { month: "2026-10", kind: "texto_peca", alone: 2, assisted: 1, test: 0, minutes: 135, test_minutes: 0 },
    { month: "2026-10", kind: "peca_aprovada", alone: 1, assisted: 0, test: 0, minutes: 15, test_minutes: 0 },
    { month: "2026-09", kind: "texto_peca", alone: 1, assisted: 0, test: 0, minutes: 45, test_minutes: 0 },
    { month: "2026-10", kind: "novo_do_banco", alone: 9, assisted: 0, test: 0, minutes: 9, test_minutes: 0 },
  ],
};

describe("what the database answers of ONE's work", () => {
  it("reads the rows, the kinds and what only who decides reads", () => {
    const work = oneWorkOf(answer);
    expect(work).not.toBeNull();
    expect(work?.decides).toBe(true);
    expect(work?.hourCents).toBe(15000);
    expect(work?.kinds.find((kind) => kind.key === "texto_peca")).toMatchObject({ minutes: 45, own: true });
    // A kind of a family the app does not know yet, and its rows, are left out rather than shown wrong.
    expect(work?.kinds.some((kind) => kind.key === "novo_do_banco")).toBe(false);
    expect(work?.rows.some((row) => row.kind === "novo_do_banco")).toBe(false);
  });

  it("a person who does not decide reads no minutes of the firm and no cost", () => {
    const work = oneWorkOf({
      ...answer,
      decides: false,
      hour_cents: undefined,
      kinds: answer.kinds.map(({ key, family, default_minutes }) => ({ key, family, default_minutes })),
    });
    expect(work?.hourCents).toBeNull();
    expect(work?.kinds.every((kind) => kind.minutes === null && !kind.own)).toBe(true);
  });

  it("an answer that is not a reading is a read that failed, never a month with nothing", () => {
    expect(oneWorkOf(null)).toBeNull();
    expect(oneWorkOf({ from: "2026-10", to: "2026-10" })).toBeNull();
    expect(oneWorkOf({ ...answer, from: "outubro" })).toBeNull();
  });
});

describe("the totals of a month", () => {
  const work = oneWorkOf(answer)!;

  it("counts ONE alone and what a person approved, the test cases apart, the pieces ONE approved on their own", () => {
    expect(monthTotals(work, "2026-10")).toEqual({
      tasks: 9,
      alone: 7,
      assisted: 2,
      minutes: 165,
      test: 2,
      testMinutes: 6,
      piecesApproved: 1,
      piecesMinutes: 15,
    });
    expect(monthTotals(work, "2026-09").tasks).toBe(1);
    expect(monthTotals(work, "2026-08").tasks).toBe(0);
  });

  it("lists every kind of each family the catalog has, zero where ONE did none", () => {
    const families = familyLines(work, "2026-09");
    expect(families.map((group) => group.family)).toEqual(["documentos", "pecas"]);
    const pieces = families.find((group) => group.family === "pecas")!;
    // The pieces ONE approved have a line of their own, never a second one in their family.
    expect(pieces.lines.map((line) => [line.kind.key, line.alone])).toEqual([["texto_peca", 1]]);
    expect(pieces).toMatchObject({ tasks: 1, minutes: 45 });
    expect(families.find((group) => group.family === "documentos")?.tasks).toBe(0);
  });
});

describe("hours, money and months", () => {
  it("says under an hour in minutes and else in whole hours, as an estimate", () => {
    expect(durationOf(0)).toEqual({ unit: "minutes", value: 0 });
    expect(durationOf(45)).toEqual({ unit: "minutes", value: 45 });
    expect(durationOf(90)).toEqual({ unit: "hours", value: 2 });
    expect(durationOf(1259)).toEqual({ unit: "hours", value: 21 });
  });

  it("says what the minutes are worth at the firm's cost of an hour, and nothing without one", () => {
    expect(moneyOf(165, 15000)).toBe(413);
    expect(moneyOf(165, null)).toBeNull();
  });

  it("counts the months of Brasília", () => {
    // 02:30 of the 1st of November by Greenwich is still the last day of October in Brasília.
    expect(brasiliaMonth(new Date("2026-11-01T02:30:00Z"))).toBe("2026-10");
    expect(brasiliaMonth(new Date("2026-11-01T03:30:00Z"))).toBe("2026-11");
    expect(monthShift("2026-01", -1)).toBe("2025-12");
    expect(monthShift("2026-11", -11)).toBe("2025-12");
    expect(monthsBetween("2026-09", "2026-11")).toEqual(["2026-11", "2026-10", "2026-09"]);
    expect(monthLabel("2026-11")).toBe("novembro de 2026");
  });

  it("names every family and kind by a key of the catalog", () => {
    expect(familyLabelKey("tribunal")).toBe("one-work-family-tribunal");
    expect(kindLabelKey("tema_1417")).toBe("one-work-kind-tema-1417");
    expect(ONE_WORK_FAMILIES).toHaveLength(10);
  });
});

describe("the spreadsheet", () => {
  const say: Say = (key) => key;

  it("has a line per month and kind, the latest month first, with the money for who decides", () => {
    const sheet = oneWorkSheet(oneWorkOf(answer)!, say);
    expect(sheet.columns.map((column) => column.title)).toContain("one-work-sheet-money");
    expect(sheet.rows[0]).toEqual([
      "outubro de 2026",
      "one-work-family-documentos",
      "one-work-kind-documento-conferido",
      4,
      1,
      15,
      2,
      38,
    ]);
    expect(sheet.rows.at(-1)?.[0]).toBe("setembro de 2026");
  });

  it("carries no money for who does not decide", () => {
    const sheet = oneWorkSheet(oneWorkOf({ ...answer, decides: false, hour_cents: undefined })!, say);
    expect(sheet.columns.map((column) => column.title)).not.toContain("one-work-sheet-money");
    expect(sheet.rows[0]).toHaveLength(7);
  });
});
