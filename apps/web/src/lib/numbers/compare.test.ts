import { describe, expect, it } from "vitest";

import { compared, countText, deltaText, isHoped, PERCENT_FROM } from "@/lib/numbers/compare";

describe("compared", () => {
  it("says a move of a large number as a share of what it was", () => {
    expect(compared(312, 287)).toEqual({ move: "up", difference: 25, percent: 9 });
    expect(deltaText(compared(312, 287))).toBe("+9%");
    expect(deltaText(compared(1231, 1284))).toBe("-4%");
  });

  it("says a move of a small number as the difference itself", () => {
    expect(compared(37, PERCENT_FROM - 1).percent).toBeNull();
    expect(deltaText(compared(5, 9))).toBe("-4");
    expect(deltaText(compared(3, 0))).toBe("+3");
  });

  it("never says a real move as nothing, nor a still number as a move", () => {
    expect(deltaText(compared(1001, 1000))).toBe("+1");
    expect(compared(40, 40)).toEqual({ move: "same", difference: 0, percent: 0 });
    expect(deltaText(compared(40, 40))).toBeNull();
  });

  it("writes a large difference as Brazil writes a count", () => {
    expect(deltaText(compared(1500, 10))).toBe("+1.490");
    expect(countText(1284)).toBe("1.284");
  });
});

describe("isHoped", () => {
  it("is the move a card hopes for, and nothing for a card that hopes for none", () => {
    expect(isHoped(compared(12, 10), "up")).toBe(true);
    expect(isHoped(compared(8, 10), "up")).toBe(false);
    expect(isHoped(compared(12, 10), null)).toBe(false);
    expect(isHoped(compared(10, 10), "up")).toBe(false);
  });
});
