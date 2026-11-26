import type { CaseFiling } from "../case-types";
import FilingByOne from "./filing-by-one";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@flyee/content/messages/pt-BR.json";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// The bell's ask of a lawyer's access (0304) brings their choice of a way to file in front: when the case opens with
// the ask, and when it arrives while the case is open, since a page is never mounted again for a new query
// (2026-11-26). Every name here is invented.

// The query as the router gives it: the address the screen is at, which Next keeps in step with the history.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
// The dialog stands for itself: what matters here is whether it is in front.
vi.mock("@/components/firm/filing-choice-dialog", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Escolher a forma de protocolar">
      <button type="button" onClick={onClose}>
        Fechar
      </button>
    </div>
  ),
}));

const VIEWER = "u0000000-0000-4000-8000-000000000001";
const COLLEAGUE = "u0000000-0000-4000-8000-000000000002";
const ASKED = "/casos/c1?acesso=pje-tjrj&aba=acao#case-filing";

/** A package ready where the court has no channel: ONE files it on the PJe of the TJRJ once its lawyer chooses how. */
const filingOf = (lawyer: string) =>
  ({
    status: "ready",
    blocker: null,
    held: null,
    signature: { viewerSigns: true },
    byOne: {
      channel: null,
      blocker: "no_channel",
      mode: "auto",
      submission: null,
      screen: {
        key: "pje-tjrj",
        name: "PJe do TJRJ",
        ways: ["extension"],
        firmWay: "extension",
        lawyers: [{ userId: lawyer, way: null }],
        viewerId: VIEWER,
      },
    },
  }) as unknown as CaseFiling;

function Card({ lawyer = VIEWER, mayAct = true }: { lawyer?: string; mayAct?: boolean }) {
  return (
    <NextIntlClientProvider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <FilingByOne
        filing={filingOf(lawyer)}
        systemName="PJe do TJRJ"
        mayAct={mayAct}
        mayDecide={false}
        busy={false}
        nameOf={() => "Ana Souza"}
        onRequest={() => undefined}
        onRetry={() => undefined}
        onChanged={() => undefined}
      />
    </NextIntlClientProvider>
  );
}

const choice = () => screen.queryByRole("dialog", { name: "Escolher a forma de protocolar" });

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/casos/c1?aba=acao#case-filing"));

describe("the bell's ask of a lawyer's access, on the card of the filing", () => {
  it("puts the lawyer's choice in front when the case opens with the ask", () => {
    window.history.replaceState(null, "", ASKED);
    render(<Card />);
    expect(choice()).toBeTruthy();
  });

  it("and when the ask arrives while the case is open, once more after the lawyer set it aside", () => {
    const view = render(<Card />);
    expect(choice()).toBeNull();
    // The bell's notice clicked on this very case: the screen takes the notice's address in place (`useCaseTab`).
    window.history.replaceState(null, "", ASKED);
    view.rerender(<Card />);
    expect(choice()).toBeTruthy();
    // Set aside: the ask leaves the address, and the tab and the card stay in it.
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(choice()).toBeNull();
    expect(`${window.location.search}${window.location.hash}`).toBe("?aba=acao#case-filing");
    view.rerender(<Card />);
    expect(choice()).toBeNull();
    // The same notice clicked again is an ask again.
    window.history.replaceState(null, "", ASKED);
    view.rerender(<Card />);
    expect(choice()).toBeTruthy();
  });

  it("never puts it in front of a colleague whose choice it is not, nor of a support visit", () => {
    window.history.replaceState(null, "", ASKED);
    render(<Card lawyer={COLLEAGUE} />);
    expect(choice()).toBeNull();
    cleanup();
    render(<Card mayAct={false} />);
    expect(choice()).toBeNull();
  });
});
