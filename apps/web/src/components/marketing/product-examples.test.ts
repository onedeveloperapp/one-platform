import { describe, expect, it } from "vitest";

import {
  calendarMonthOf,
  EXAMPLE_DEADLINE,
  EXAMPLE_PACKAGE,
  EXAMPLE_PACKAGE_NAMES,
  EXAMPLE_SYSTEM,
  EXAMPLE_WINDOW,
} from "@/components/marketing/product-examples";
import ptBR from "@flyee/content/messages/pt-BR.json";

const words = ptBR.marketing as Record<string, string>;

describe("the home's example figures", () => {
  it("counts the example deadline as the page describes it", () => {
    expect(EXAMPLE_DEADLINE.ok).toBe(true);
    if (!EXAMPLE_DEADLINE.ok) return;
    const count = EXAMPLE_DEADLINE.result;
    expect(count.publishedOn).toBe("2026-11-05");
    expect(count.startsOn).toBe("2026-11-06");
    expect(count.dueOn).toBe("2026-11-27");
    expect(count.skipped).toEqual([
      { from: "2026-11-20", to: "2026-11-20", reason: "holiday", label: expect.any(String) },
    ]);
    expect(count.moved).toBeNull();
    // Nothing the count could not know: the figure shows no note of an assumption.
    expect(count.assumptions).toEqual([]);

    const label = words["one-home-deadline-label"];
    for (const said of ["15 dias úteis", "5 de novembro", "27 de novembro", "20 de novembro"]) {
      expect(label).toContain(said);
    }
    expect(words["one-home-window-deadline-delta"]).toBe("15 dias úteis");
  });

  it("draws the month as the rule counted it", () => {
    if (!EXAMPLE_DEADLINE.ok) throw new Error("the example counts");
    const month = calendarMonthOf(EXAMPLE_DEADLINE.result);
    expect([month.year, month.month]).toEqual([2026, 11]);
    // November 2026 opens on a Sunday, so its first week has no blank before it.
    expect(month.leading).toBe(0);
    expect(month.days).toHaveLength(30);
    const of = (kind: string) => month.days.filter((day) => day.kind === kind).map((day) => day.day);
    expect(of("published")).toEqual([5]);
    expect(of("holiday")).toEqual([20]);
    expect(of("due")).toEqual([27]);
    // Fifteen business days, the last of them the day it ends.
    expect(of("counted").length + of("due").length).toBe(15);
    expect(of("counted")).toEqual([6, 9, 10, 11, 12, 13, 16, 17, 18, 19, 23, 24, 25, 26]);
  });

  it("names the example package as the page describes it", () => {
    expect(EXAMPLE_PACKAGE.ready).toBe(true);
    expect(EXAMPLE_PACKAGE_NAMES).toEqual([
      "01-peticao-inicial.pdf",
      "02-procuracao-mariana-souza.pdf",
      "03-documento-de-identidade-mariana-souza.pdf",
      "04-comprovante-de-endereco-mariana-souza.pdf",
      "05-comprovante-de-gastos.pdf",
    ]);
    expect(words["one-home-package-label"]).toContain(EXAMPLE_SYSTEM);
  });

  it("keeps the home's figures off the first module", () => {
    // The public site names a module at most in a line, never in the drawn screens (.claude/rules/marketing.md).
    for (const name of EXAMPLE_PACKAGE_NAMES) expect(name).not.toMatch(/embarque|voo|passagem/);
    const drawn = Object.entries(words)
      .filter(([key]) => /^one-home-(window|chat|docs|piece|deadline|package)-/.test(key))
      .map(([, text]) => text);
    for (const text of drawn) expect(text).not.toMatch(/embarque|\bvoo\b|passagem|companhia/i);
  });

  it("has every column of the window hold what it shows, the longest at the step first", () => {
    for (const column of EXAMPLE_WINDOW.columns) {
      expect(column.total).toBeGreaterThan(column.cases.length);
      const days = column.cases.map((item) => item.days);
      expect(days).toEqual([...days].sort((a, b) => b - a));
    }
    // The case the floating card says ONE is writing is at that step, with ONE.
    const writing = EXAMPLE_WINDOW.columns
      .find((column) => column.step === "drafting")
      ?.cases.find((item) => item.seq === EXAMPLE_WINDOW.writing);
    expect(writing?.holder).toBe("one");
  });
});
