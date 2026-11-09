// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isStandingView, isStepView, isStockView, STANDING_VIEWS, STEP_VIEWS, stepView } from "@/lib/cases/list";
import {
  caseStockOf,
  HOLDER_VIEW,
  HOLDERS,
  REASON_KEYS,
  reasonKey,
  REASONS,
  standingCounts,
  stepCounts,
  stockKey,
  stockSteps,
} from "@/lib/cases/standing";

const ROOT = path.resolve(__dirname, "../../../../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0111_case_standing.sql"), "utf8");
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/content/messages/pt-BR.json"), "utf8")) as {
  product: Record<string, string>;
};

/** The reasons one block of `case_standing` gives (`... end as firm_why`), as the database writes them. */
function reasonsOf(block: string): string[] {
  const end = MIGRATION.indexOf(`end as ${block}`);
  expect(end, block).toBeGreaterThan(-1);
  const start = MIGRATION.lastIndexOf("case\n", end);
  return [...MIGRATION.slice(start, end).matchAll(/then '([a-z_]+)'/g)].map((match) => match[1]);
}

describe("why a case is with whom it is", () => {
  it("has words for every reason the database gives, and for nothing else", () => {
    expect(reasonsOf("firm_why").sort()).toEqual([...REASONS.firm].sort());
    expect(reasonsOf("one_why").sort()).toEqual([...REASONS.one].sort());
    expect(reasonsOf("client_why").sort()).toEqual([...REASONS.client].sort());
    expect(reasonsOf("platform_why").sort()).toEqual([...REASONS.platform].sort());
    for (const key of REASON_KEYS) expect(CATALOG.product[key], key).toBeTruthy();
  });

  it("says a wait ONE recorded in its holder's general words", () => {
    expect(reasonKey("firm", "documents")).toBe("standing-why-firm-documents");
    expect(reasonKey("firm", "wait:stuck")).toBe("standing-why-firm-wait");
    expect(reasonKey("client", "wait:account_missing")).toBe("standing-why-client-wait");
    expect(reasonKey("court", null)).toBeNull();
    expect(reasonKey("firm", "no_such_reason")).toBeNull();
    expect(reasonKey(null, "documents")).toBeNull();
  });

  it("opens a view of the list for each holder, the views the list has", () => {
    for (const holder of HOLDERS) expect(STANDING_VIEWS).toContain(HOLDER_VIEW[holder]);
  });
});

describe("the stock the controladoria reads", () => {
  it("is read whole, and anything else is a read that failed", () => {
    expect(
      caseStockOf({
        steps: [{ step: "intake", cases: 3, stagnant: 1, median_days: 4, oldest_days: 20, limit: 7 }, { cases: 2 }],
        holders: { firm: 1, client: "2", one: 1 },
        stagnant: 1,
        total: 3,
      }),
    ).toEqual({
      steps: [{ step: "intake", cases: 3, stagnant: 1, medianDays: 4, oldestDays: 20, limit: 7 }],
      holders: { firm: 1, client: 0, one: 1, court: 0, platform: 0 },
      stagnant: 1,
      total: 3,
    });
    expect(caseStockOf(null)).toBeNull();
    expect(caseStockOf({ steps: [] })).toBeNull();
    expect(caseStockOf([])).toBeNull();
  });
});

describe("the views of who has the case", () => {
  it("count what the stock says, each holder its view and the stagnant ones theirs", () => {
    expect(
      standingCounts({
        steps: [],
        holders: { firm: 4, client: 3, one: 2, court: 7, platform: 1 },
        stagnant: 5,
        total: 17,
      }),
    ).toEqual({
      "com-escritorio": 4,
      "com-cliente": 3,
      "com-one": 2,
      "no-tribunal": 7,
      "com-plataforma": 1,
      estagnados: 5,
    });
    expect(
      Object.keys(
        standingCounts({
          steps: [],
          holders: { firm: 0, client: 0, one: 0, court: 0, platform: 0 },
          stagnant: 0,
          total: 0,
        }),
      ).sort(),
    ).toEqual([...STANDING_VIEWS].sort());
  });

  it("count each step as the stock counts it, so a step opens a list of the size it says (0116)", () => {
    const counts = stepCounts({
      steps: [
        { step: "documents", cases: 4, stagnant: 1, medianDays: 3, oldestDays: 9, limit: 15 },
        { step: "closed", cases: 2, stagnant: 0, medianDays: 1, oldestDays: 2, limit: 90 },
      ],
      holders: { firm: 0, client: 0, one: 0, court: 0, platform: 0 },
      stagnant: 1,
      total: 6,
    });
    expect(counts["etapa-documents"]).toBe(4);
    expect(counts["etapa-closed"]).toBe(2);
    expect(counts["etapa-intake"]).toBe(0);
    expect(Object.keys(counts).sort()).toEqual([...STEP_VIEWS].sort());
    expect(stepView("hearing")).toBe("etapa-hearing");
    expect(STEP_VIEWS.every((view) => isStepView(view) && isStockView(view) && !isStandingView(view))).toBe(true);
    expect(isStockView("estagnados") && !isStepView("estagnados")).toBe(true);
  });

  it("are told apart from the list's other views", () => {
    expect(STANDING_VIEWS.every(isStandingView)).toBe(true);
    expect(isStandingView("documentos")).toBe(false);
    expect(isStandingView("mov-hoje")).toBe(false);
  });

  it("read the stock again only when its scope or the list's own filters change", () => {
    const base = { module: "direito-do-passageiro", incident: null, airline: null };
    expect(stockKey(base)).toBe(stockKey({ ...base }));
    expect(stockKey(base)).not.toBe(stockKey({ ...base, incident: "delay" }));
    expect(stockKey(base)).not.toBe(stockKey({ ...base, airline: "LA" }));
    expect(stockKey(base)).not.toBe(stockKey({ ...base, module: null }));
  });
});

describe("the steps of the stock", () => {
  const holders = { firm: 0, client: 0, one: 0, court: 0, platform: 0 };
  const step = (name: string, cases: number) => ({
    step: name,
    cases,
    stagnant: 0,
    medianDays: 0,
    oldestDays: 0,
    limit: null,
  });

  it("show every step a case in progress may be at", () => {
    const steps = stockSteps({ steps: [step("intake", 2)], holders, stagnant: 0, total: 2 });
    expect(steps[0]).toBe("intake");
    expect(steps).not.toContain("closed");
  });

  it("show the last step only while a case paid and not archived is at it, so the steps add up to the stock", () => {
    const stock = { steps: [step("payment", 1), step("closed", 1)], holders, stagnant: 0, total: 2 };
    expect(stockSteps(stock).at(-1)).toBe("closed");
    expect(
      stockSteps(stock).reduce((sum, name) => sum + (stock.steps.find((item) => item.step === name)?.cases ?? 0), 0),
    ).toBe(stock.total);
    expect(stockSteps(null)).not.toContain("closed");
  });
});
