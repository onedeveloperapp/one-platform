/**
 * The test cases in the firm's numbers (migration 0114). While a firm has no real case, the numbers of its controladoria
 * count its test cases and say so; once it has a real one they leave those numbers, with "Incluir casos de teste" one
 * click away. Pure: the answer read, and what the page counts for what was asked.
 */

/** How many real and test cases a firm has (`firm_test_cases`). */
export type TestCaseFacts = { real: number; test: number };

const whole = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

/** The answer of `firm_test_cases`, read; null when it is not one. */
export function testCaseFactsOf(raw: unknown): TestCaseFacts | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  return { real: whole(value.real), test: whole(value.test) };
}

/**
 * Where the page's numbers stand: the firm has no test case (`none`), or only test cases (`only`, which they count and
 * say); or both, with the test cases left out (`left-out`, the usual) or asked in (`included`).
 */
export type TestCaseState = "none" | "only" | "left-out" | "included";

export type TestCaseScope = {
  state: TestCaseState;
  /** How many test cases the firm has. */
  count: number;
  /** Whether the page's reads count them. */
  counted: boolean;
};

/**
 * What the page counts. With the facts unread, it counts every case, as the other pages do: a read that failed never
 * hides a case.
 */
export function testCaseScope(facts: TestCaseFacts | null, asked: boolean): TestCaseScope {
  if (!facts || facts.test === 0) return { state: "none", count: facts?.test ?? 0, counted: true };
  if (facts.real === 0) return { state: "only", count: facts.test, counted: true };
  return asked
    ? { state: "included", count: facts.test, counted: true }
    : { state: "left-out", count: facts.test, counted: false };
}

/** The address's word of test cases asked in, which a page's links keep (`?testes=1`). */
export const testCasesAsked = (word: string | null | undefined): boolean => word === "1";
