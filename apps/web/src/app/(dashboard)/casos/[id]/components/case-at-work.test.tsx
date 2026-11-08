import CaseAtWork from "./case-at-work";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NowItem } from "@/lib/cases/now";
import messages from "@flyee/content/messages/pt-BR.json";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// The notice that holds the case screen while ONE works on the case (the screen pattern after ADVBox, approved by
// the owner on 2026-11-07), drawn from invented work.

const NOW = Date.parse("2026-11-07T17:31:18Z");

const work = (id: string, patch: Partial<NowItem> = {}): NowItem => ({
  id,
  owner: "one",
  actor: null,
  tone: "waiting",
  text: { key: "case-now-draft-writing", values: { kind: { message: "case-proceeding-kind-juizado" } } },
  section: "drafts",
  href: null,
  since: "2026-11-07T17:31:00Z",
  ask: null,
  fields: null,
  slow: false,
  ...patch,
});

function Screen({ working }: { working: NowItem[] }) {
  return (
    <NextIntlClientProvider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <input aria-label="Outro campo" />
      <CaseAtWork caseId="case-1" working={working} events={[]} />
    </NextIntlClientProvider>
  );
}

const notice = () => screen.queryByRole("alertdialog");
const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CaseAtWork", () => {
  it("holds the screen while ONE works, with what it does, how long, what follows and when it started", () => {
    render(<Screen working={[work("draft:1")]} />);
    tick(1000);
    expect(notice()).toBeTruthy();
    expect(screen.getByRole("heading", { name: "O ONE está trabalhando neste caso" })).toBeTruthy();
    expect(screen.getByText("O ONE está escrevendo a peça da ação (Juizado especial cível).")).toBeTruthy();
    expect(screen.getByText("Agora, há 19 segundos")).toBeTruthy();
    expect(screen.getByText("Conferir as citações na biblioteca")).toBeTruthy();
    expect(screen.getByText("Começou às 14:31.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continuar sem esperar" })).toBeNull();
  });

  it("never holds it for a look ONE takes soon, a work it said is late, or a wait on a court", () => {
    render(
      <Screen
        working={[
          work("advance:due", { text: { key: "case-now-one-looks-soon" } }),
          work("draft:1", { slow: true }),
          work("filing:1", { outside: true }),
        ]}
      />,
    );
    tick(1000);
    expect(notice()).toBeNull();
  });

  it("says ONE is taking longer after two minutes, and gives the screen back for that work only", () => {
    const view = render(<Screen working={[work("draft:1")]} />);
    tick(1000);
    expect(screen.queryByRole("button", { name: "Continuar sem esperar" })).toBeNull();
    tick(2 * 60_000);
    expect(screen.getByRole("heading", { name: "O ONE está demorando mais que o normal" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Esperar mais" }));
    expect(screen.queryByRole("button", { name: "Continuar sem esperar" })).toBeNull();
    tick(2 * 60_000 + 1000);
    fireEvent.click(screen.getByRole("button", { name: "Continuar sem esperar" }));
    tick(1000);
    expect(notice()).toBeNull();
    // Another work holds it again.
    view.rerender(<Screen working={[work("draft:1"), work("documents:checking", { since: null })]} />);
    tick(1000);
    expect(notice()).toBeTruthy();
  });

  it("lets the screen go once the work ends", () => {
    const view = render(<Screen working={[work("draft:1")]} />);
    tick(1000);
    expect(notice()).toBeTruthy();
    view.rerender(<Screen working={[]} />);
    tick(1000);
    expect(notice()).toBeNull();
  });

  it("waits for a person typing elsewhere to leave the field", () => {
    const view = render(<Screen working={[]} />);
    const field = screen.getByLabelText("Outro campo");
    field.focus();
    view.rerender(<Screen working={[work("draft:1")]} />);
    tick(3000);
    expect(notice()).toBeNull();
    field.blur();
    tick(1000);
    expect(notice()).toBeTruthy();
  });
});
