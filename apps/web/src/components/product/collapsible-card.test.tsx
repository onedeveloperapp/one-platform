import CollapsibleCard, { type CardMark, CollapsibleGroup } from "./collapsible-card";
import { afterEach, describe, expect, it } from "vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// What the top of a screen knows of a card opens it when something there comes to wait for the firm, and closes
// it once that is done, unless the person opened it (the owner, 2026-11-05).

const WORDS = { firm: "Pede o escritório", failed: "Falhou", client: "Espera o cliente" };
const quiet: CardMark = { firm: false, failed: false, client: false, working: null };

function Screen({ mark, defaultOpen = false }: { mark: CardMark; defaultOpen?: boolean }) {
  return (
    <CollapsibleGroup marks={{ "case-documents": mark }} words={WORDS}>
      <CollapsibleCard id="case-documents" title="Documentos" defaultOpen={defaultOpen}>
        <p>conteúdo</p>
      </CollapsibleCard>
    </CollapsibleGroup>
  );
}

const header = () => screen.getByRole("button", { name: "Documentos" });

afterEach(cleanup);

describe("CollapsibleCard and the marks of the top", () => {
  it("opens when something comes to wait for the firm, and closes once it is done", () => {
    const view = render(<Screen mark={quiet} />);
    expect(header().getAttribute("aria-expanded")).toBe("false");
    view.rerender(<Screen mark={{ ...quiet, firm: true }} />);
    expect(header().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Pede o escritório")).toBeTruthy();
    view.rerender(<Screen mark={quiet} />);
    expect(header().getAttribute("aria-expanded")).toBe("false");
  });

  it("stays open when the person opened it, whatever was resolved", () => {
    const view = render(<Screen mark={{ ...quiet, firm: true }} />);
    expect(header().getAttribute("aria-expanded")).toBe("true");
    // The person closes and opens it again: it is theirs now.
    fireEvent.click(header());
    fireEvent.click(header());
    view.rerender(<Screen mark={quiet} />);
    expect(header().getAttribute("aria-expanded")).toBe("true");
  });

  it("never closes a card that opened for its stage", () => {
    const view = render(<Screen mark={quiet} defaultOpen />);
    view.rerender(<Screen mark={{ ...quiet, firm: true }} defaultOpen />);
    view.rerender(<Screen mark={quiet} defaultOpen />);
    expect(header().getAttribute("aria-expanded")).toBe("true");
  });

  it("says on its head what ONE does there now, and what waits for the client", () => {
    const view = render(<Screen mark={{ ...quiet, working: "O ONE está conferindo" }} />);
    expect(screen.getByText("O ONE está conferindo")).toBeTruthy();
    view.rerender(<Screen mark={{ ...quiet, client: true }} />);
    expect(screen.getByText("Espera o cliente")).toBeTruthy();
    expect(header().getAttribute("aria-expanded")).toBe("false");
  });
});
