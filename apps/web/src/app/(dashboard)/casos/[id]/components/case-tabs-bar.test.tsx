import CaseTabsBar from "./case-tabs-bar";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CaseTab, TabMark } from "@/lib/cases/case-tabs";
import messages from "@flyee/content/messages/pt-BR.json";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

afterEach(cleanup);

const NONE: Record<CaseTab, TabMark | null> = {
  cliente: null,
  documentos: null,
  acao: null,
  processo: null,
  dinheiro: null,
  historico: null,
};

const draw = (marks: Partial<Record<CaseTab, TabMark | null>>, onPick = vi.fn()) => {
  render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <CaseTabsBar tab="processo" marks={{ ...NONE, ...marks }} flashed={new Set()} onPick={onPick} />
    </NextIntlClientProvider>,
  );
  return onPick;
};

describe("the strip of the case's tabs", () => {
  it("names the six tabs in the order of the case's way, the open one selected", () => {
    draw({});
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Cliente",
      "Documentos",
      "Ação",
      "Processo",
      "Dinheiro",
      "Histórico",
    ]);
    expect(screen.getByRole("tab", { selected: true }).textContent).toBe("Processo");
  });

  it("says under a tab's name what waits in it, in words", () => {
    draw({
      processo: { tone: "firm", count: 2 },
      documentos: { tone: "client", count: 3 },
      cliente: { tone: "working", count: 1 },
      acao: { tone: "failed", count: 1 },
    });
    expect(within(screen.getByRole("tab", { name: /Processo/ })).getByText("Pede o escritório · 2")).toBeTruthy();
    expect(within(screen.getByRole("tab", { name: /Documentos/ })).getByText("Espera o cliente · 3")).toBeTruthy();
    expect(within(screen.getByRole("tab", { name: /Cliente/ })).getByText("O ONE está trabalhando")).toBeTruthy();
    expect(within(screen.getByRole("tab", { name: /Ação/ })).getByText("Falhou · 1")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Dinheiro" })).toBeTruthy();
  });

  it("tells the screen which tab the person picked", () => {
    const onPick = draw({});
    fireEvent.click(screen.getByRole("tab", { name: "Histórico" }));
    expect(onPick).toHaveBeenCalledWith("historico");
  });
});
