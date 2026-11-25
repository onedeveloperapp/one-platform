import { describe, expect, it } from "vitest";

import {
  CASE_TABS,
  openingTab,
  SECTION_TAB,
  STEP_TAB,
  tabAddress,
  type TabLine,
  tabMarks,
} from "@/lib/cases/case-tabs";
import { JOURNEY_STEPS } from "@/lib/cases/journey";
import { CASE_SECTIONS } from "@/lib/cases/sections";

const line = (owner: TabLine["owner"], section: TabLine["section"], tone: TabLine["tone"] = "attention"): TabLine => ({
  owner,
  tone,
  section,
});

describe("the case in tabs", () => {
  it("puts every card and every step of the way in a tab, in the order of the way", () => {
    for (const section of CASE_SECTIONS) expect(CASE_TABS).toContain(SECTION_TAB[section]);
    for (const step of JOURNEY_STEPS) expect(CASE_TABS).toContain(STEP_TAB[step]);
    // The steps never go back to an earlier tab as the case goes on.
    const order = JOURNEY_STEPS.map((step) => CASE_TABS.indexOf(STEP_TAB[step]));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("opens on the tab the address asks for", () => {
    expect(openingTab("dinheiro", [line("firm", "publications")], "hearing")).toBe("dinheiro");
  });

  it("else on the tab of the first thing that waits for the firm, as the top lists them", () => {
    const blocking = [line("client", "documents"), line("firm", "publications"), line("firm", "drafts")];
    expect(openingTab(null, blocking, "documents")).toBe("processo");
  });

  it("else on the tab of the step the case is at; an address it does not know is no tab", () => {
    expect(openingTab("nada", [line("client", "documents"), line("firm", null)], "drafting")).toBe("acao");
    expect(openingTab(undefined, [], "closed")).toBe("historico");
  });

  it("says in each tab what waits there, the heaviest first, counting the lines of the top", () => {
    const marks = tabMarks(
      [
        line("firm", "publications"),
        line("firm", "deadlines"),
        line("client", "documents"),
        line("client", "documents"),
        line("client", "people"),
        line("firm", "filing", "failed"),
        line("firm", "drafts"),
        line("platform", "notices"),
      ],
      [line("one", "people"), line("one", null)],
    );
    expect(marks.processo).toEqual({ tone: "firm", count: 2 });
    expect(marks.documentos).toEqual({ tone: "client", count: 2 });
    // ONE at work weighs more than the client's turn; a failure more than the firm's turn.
    expect(marks.cliente).toEqual({ tone: "working", count: 1 });
    expect(marks.acao).toEqual({ tone: "failed", count: 1 });
    expect(marks.dinheiro).toBeNull();
    expect(marks.historico).toBeNull();
  });

  it("keeps the tab in the address, and the card the person was sent to after it", () => {
    expect(tabAddress("/casos/c1", "acao", "#case-drafts")).toBe("/casos/c1?aba=acao#case-drafts");
    expect(tabAddress("/casos/c1", "cliente")).toBe("/casos/c1?aba=cliente");
  });
});
