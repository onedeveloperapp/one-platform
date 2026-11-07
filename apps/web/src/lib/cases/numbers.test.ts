import { describe, expect, it } from "vitest";

import { caseListOf, type CaseNumbers, caseNumbersOf } from "@/lib/cases/list";
import { caseCards, dayMonthText, spanText } from "@/lib/cases/numbers";

const numbers: CaseNumbers = {
  going: 1284,
  goingBefore: 1231,
  opened: 40,
  openedBefore: 52,
  filed: 312,
  filedBefore: 287,
  ended: 9,
  endedBefore: 9,
  since: "2026-11-01",
  until: "2026-11-07",
  beforeSince: "2026-10-01",
  beforeUntil: "2026-10-07",
};

describe("caseCards", () => {
  it("gives each card its number, what it was and the view of the list it counts", () => {
    const cards = caseCards(numbers);
    expect(cards.map((card) => [card.key, card.view, card.value, card.before])).toEqual([
      ["going", null, 1284, 1231],
      ["opened", "novos-mes", 40, 52],
      ["filed", "ajuizados-mes", 312, 287],
      ["ended", "encerrados-mes", 9, 9],
    ]);
    expect(cards.map((card) => card.compared.move)).toEqual(["up", "down", "up", "same"]);
  });

  it("hopes only for more cases opened and filed, never for a stock nor for cases ended", () => {
    expect(caseCards(numbers).map((card) => card.hope)).toEqual([null, "up", "up", null]);
  });
});

describe("spanText", () => {
  it("names the day, or the days, of the month before a card compares with", () => {
    expect(dayMonthText("2026-10-07")).toBe("7 de outubro");
    expect(spanText(numbers, "day")).toBe("7 de outubro");
    expect(spanText(numbers, "days")).toBe("1 a 7 de outubro");
    expect(spanText({ ...numbers, beforeUntil: "2026-10-01" }, "days")).toBe("1 de outubro");
  });
});

describe("caseNumbersOf", () => {
  it("reads the numbers as the database says them, and nothing that is not whole", () => {
    const said = {
      going: 3,
      going_before: 2,
      new: 1,
      new_before: 0,
      filed: 1,
      filed_before: 1,
      ended: 0,
      ended_before: 1,
      since: "2026-11-01",
      until: "2026-11-07",
      before_since: "2026-10-01",
      before_until: "2026-10-07",
    };
    expect(caseNumbersOf(said)).toMatchObject({ going: 3, goingBefore: 2, opened: 1, endedBefore: 1 });
    expect(caseNumbersOf({ ...said, until: "ontem" })).toBeNull();
    expect(caseNumbersOf(null)).toBeNull();
    // A database before 0108 says no numbers: the list is read all the same, with none.
    expect(caseListOf({ rows: [], total: 0, counts: {} })?.numbers).toBeNull();
  });
});
