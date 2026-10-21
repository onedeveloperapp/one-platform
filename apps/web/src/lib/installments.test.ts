// @vitest-environment node
import { describe, expect, it } from "vitest";

import { splitInstallments } from "@/lib/installments";

describe("splitInstallments: the split Asaas charges", () => {
  it("matches the example in the Asaas documentation", () => {
    expect(splitInstallments(35_000, 12)).toEqual({ each: 2_916, last: 2_924 });
  });

  it("puts the leftover cents of the access price on the last installment", () => {
    const split = splitInstallments(9_700, 12);
    expect(split).toEqual({ each: 808, last: 812 });
    expect(split.each * 11 + split.last).toBe(9_700);
  });

  it("is the whole price at once, and an even split when the price divides", () => {
    expect(splitInstallments(9_700, 1)).toEqual({ each: 9_700, last: 9_700 });
    expect(splitInstallments(12_000, 12)).toEqual({ each: 1_000, last: 1_000 });
    expect(splitInstallments(9_700, 0)).toEqual({ each: 9_700, last: 9_700 });
  });
});
