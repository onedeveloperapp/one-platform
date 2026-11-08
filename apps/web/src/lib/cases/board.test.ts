import { describe, expect, it } from "vitest";

import { boardColumns, caseBoardOf, hiddenOf, withMore } from "@/lib/cases/board";
import { OPEN_STEPS } from "@/lib/cases/journey";

const item = (seq: number, days = 3) => ({
  id: `case-${seq}`,
  seq,
  client: `Cliente ${seq}`,
  holder: "client",
  why: "lacks",
  days,
  stagnant: days > 7,
});

describe("caseBoardOf", () => {
  it("reads each column with its cases, and leaves out a step this code does not know", () => {
    const columns = caseBoardOf({
      columns: [
        { step: "intake", cases: 3, stagnant: 1, limit: 7, items: [item(1, 20), { seq: 2 }, item(3)] },
        { step: "someday", cases: 1, stagnant: 0, limit: null, items: [] },
      ],
    });
    expect(columns).toEqual([
      {
        step: "intake",
        cases: 3,
        stagnant: 1,
        limit: 7,
        items: [
          { id: "case-1", seq: 1, client: "Cliente 1", holder: "client", why: "lacks", days: 20, stagnant: true },
          { id: "case-3", seq: 3, client: "Cliente 3", holder: "client", why: "lacks", days: 3, stagnant: false },
        ],
      },
    ]);
  });

  it("is null for anything that is not an answer: a read that failed is never an empty board", () => {
    expect(caseBoardOf(null)).toBeNull();
    expect(caseBoardOf([])).toBeNull();
    expect(caseBoardOf({ rows: [] })).toBeNull();
  });
});

describe("boardColumns", () => {
  it("shows every step of the way in its order, a step with no case as an empty column", () => {
    const columns = boardColumns(caseBoardOf({ columns: [{ step: "hearing", cases: 1, items: [item(4)] }] }) ?? []);
    expect(columns.map((column) => column.step)).toEqual([...OPEN_STEPS]);
    expect(columns.find((column) => column.step === "intake")).toMatchObject({ cases: 0, items: [] });
    expect(columns.find((column) => column.step === "hearing")?.cases).toBe(1);
  });

  it("shows the last step only while a case paid and not archived is at it", () => {
    const columns = boardColumns(caseBoardOf({ columns: [{ step: "closed", cases: 1, items: [item(9)] }] }) ?? []);
    expect(columns.at(-1)?.step).toBe("closed");
    expect(boardColumns([]).map((column) => column.step)).not.toContain("closed");
  });
});

describe("withMore", () => {
  it("puts the next cases after the ones shown, each case once, with the latest counts", () => {
    const first = caseBoardOf({ columns: [{ step: "intake", cases: 3, items: [item(1), item(2)] }] })?.[0];
    const next = caseBoardOf({ columns: [{ step: "intake", cases: 4, items: [item(2), item(3)] }] })?.[0];
    if (!first || !next) throw new Error("fixture");
    const merged = withMore(first, next);
    expect(merged.items.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(merged.cases).toBe(4);
    expect(hiddenOf(merged)).toBe(1);
    expect(hiddenOf({ ...merged, cases: 2 })).toBe(0);
  });
});
