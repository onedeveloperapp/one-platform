import { describe, expect, it } from "vitest";

import { testCaseFactsOf, testCasesAsked, testCaseScope } from "@/lib/cases/test-cases";

describe("testCaseFactsOf", () => {
  it("reads how many real and test cases a firm has", () => {
    expect(testCaseFactsOf({ real: 3, test: 2 })).toEqual({ real: 3, test: 2 });
    expect(testCaseFactsOf({ test: "2" })).toEqual({ real: 0, test: 0 });
    expect(testCaseFactsOf(null)).toBeNull();
    expect(testCaseFactsOf([])).toBeNull();
  });
});

describe("testCaseScope", () => {
  it("has nothing to say of a firm with no test case", () => {
    expect(testCaseScope({ real: 3, test: 0 }, false)).toEqual({ state: "none", count: 0, counted: true });
    expect(testCaseScope({ real: 0, test: 0 }, true)).toEqual({ state: "none", count: 0, counted: true });
  });

  it("counts the test cases while the firm has no real one, whatever was asked", () => {
    expect(testCaseScope({ real: 0, test: 2 }, false)).toEqual({ state: "only", count: 2, counted: true });
    expect(testCaseScope({ real: 0, test: 2 }, true)).toEqual({ state: "only", count: 2, counted: true });
  });

  it("leaves them out once it has a real one, and takes them in one click", () => {
    expect(testCaseScope({ real: 1, test: 2 }, false)).toEqual({ state: "left-out", count: 2, counted: false });
    expect(testCaseScope({ real: 1, test: 2 }, true)).toEqual({ state: "included", count: 2, counted: true });
  });

  it("counts every case when the facts could not be read: a read that failed never hides a case", () => {
    expect(testCaseScope(null, false)).toEqual({ state: "none", count: 0, counted: true });
  });
});

describe("testCasesAsked", () => {
  it("is the address's word and nothing else", () => {
    expect(testCasesAsked("1")).toBe(true);
    expect(testCasesAsked("0")).toBe(false);
    expect(testCasesAsked(undefined)).toBe(false);
  });
});
