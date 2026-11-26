import { useCaseTab } from "./use-case-tab";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TabLine } from "@/lib/cases/case-tabs";
import { CASE_TABS } from "@/lib/cases/case-tabs";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/casos/c1"));

/** A link as the router draws it: an anchor whose click the router takes for itself, so no `hashchange` follows. */
function RouterLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} onClick={(event) => event.preventDefault()}>
      {children}
    </a>
  );
}

/** The case's panels as the screen draws them: every one mounted, the ones not open hidden, a card in each. */
function Harness({ asked, blocking }: { asked: string | null; blocking: TabLine[] }) {
  const { tab, pick } = useCaseTab({ asked, blocking, step: "documents" });
  return (
    <>
      <p data-testid="tab">{tab}</p>
      <RouterLink href="#card-of-cliente">completar no cartão das pessoas</RouterLink>
      <RouterLink href="/casos/c1#card-of-processo">aviso do sino deste caso</RouterLink>
      <RouterLink href="/casos/c2#card-of-processo">aviso do sino de outro caso</RouterLink>
      <RouterLink href="#nenhum-cartao">um endereço sem cartão</RouterLink>
      <RouterLink href="#%E0%A4%A">um endereço mal escrito</RouterLink>
      {CASE_TABS.map((key) => (
        <button key={key} type="button" onClick={() => pick(key)}>
          {`aba ${key}`}
        </button>
      ))}
      {CASE_TABS.map((key) => (
        <div key={key} data-case-tab={key} hidden={tab !== key}>
          <section id={`card-of-${key}`}>
            <input aria-label={`campo ${key}`} />
          </section>
        </div>
      ))}
    </>
  );
}

const firmAt = (section: TabLine["section"]): TabLine => ({ owner: "firm", tone: "attention", section });

describe("the tab of the case screen", () => {
  it("opens where the firm is asked first, else on the step's tab, and the address chooses over both", () => {
    render(<Harness asked={null} blocking={[firmAt("publications")]} />);
    expect(screen.getByTestId("tab").textContent).toBe("processo");
    cleanup();
    render(<Harness asked={null} blocking={[]} />);
    expect(screen.getByTestId("tab").textContent).toBe("documentos");
    cleanup();
    render(<Harness asked="dinheiro" blocking={[firmAt("publications")]} />);
    expect(screen.getByTestId("tab").textContent).toBe("dinheiro");
  });

  it("keeps the tab the person picks in the address, without filling the history", () => {
    render(<Harness asked={null} blocking={[]} />);
    const before = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "aba acao" }));
    expect(screen.getByTestId("tab").textContent).toBe("acao");
    expect(window.location.search).toBe("?aba=acao");
    expect(window.history.length).toBe(before);
  });

  it("a link to a card opens the tab the card is in, and keeps the card in the address", () => {
    render(<Harness asked={null} blocking={[]} />);
    act(() => {
      window.location.hash = "card-of-processo";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByTestId("tab").textContent).toBe("processo");
    expect(`${window.location.search}${window.location.hash}`).toBe("?aba=processo#card-of-processo");
  });

  it("an address that arrives with a card opens its tab at once", () => {
    window.history.replaceState(null, "", "/casos/c1#card-of-historico");
    render(<Harness asked={null} blocking={[firmAt("publications")]} />);
    expect(screen.getByTestId("tab").textContent).toBe("historico");
  });

  it("a link the router draws to a card of this case opens its tab, though no hashchange is said", () => {
    render(<Harness asked={null} blocking={[]} />);
    // Nothing but the click may open the tab here: the hook that only listened to `hashchange` left this link dead.
    const heard = vi.fn();
    window.addEventListener("hashchange", heard);
    fireEvent.click(screen.getByRole("link", { name: "completar no cartão das pessoas" }));
    window.removeEventListener("hashchange", heard);
    expect(heard).not.toHaveBeenCalled();
    expect(screen.getByTestId("tab").textContent).toBe("cliente");
    expect(`${window.location.search}${window.location.hash}`).toBe("?aba=cliente#card-of-cliente");
  });

  it("and so does the whole address of the case that is open, as a notice of the bell carries it", () => {
    render(<Harness asked={null} blocking={[]} />);
    fireEvent.click(screen.getByRole("link", { name: "aviso do sino deste caso" }));
    expect(screen.getByTestId("tab").textContent).toBe("processo");
    expect(`${window.location.search}${window.location.hash}`).toBe("?aba=processo#card-of-processo");
  });

  it("leaves the tab alone for a link to another case, a click that opens a new tab of the browser and an address of no card", () => {
    render(<Harness asked={null} blocking={[]} />);
    fireEvent.click(screen.getByRole("link", { name: "aviso do sino de outro caso" }));
    fireEvent.click(screen.getByRole("link", { name: "completar no cartão das pessoas" }), { ctrlKey: true });
    fireEvent.click(screen.getByRole("link", { name: "completar no cartão das pessoas" }), { button: 1 });
    fireEvent.click(screen.getByRole("link", { name: "um endereço sem cartão" }));
    fireEvent.click(screen.getByRole("link", { name: "um endereço mal escrito" }));
    expect(screen.getByTestId("tab").textContent).toBe("documentos");
    expect(window.location.search).toBe("");
  });

  it("never loses what was typed in a tab the person left", () => {
    render(<Harness asked={null} blocking={[]} />);
    fireEvent.change(screen.getByLabelText("campo documentos"), { target: { value: "anotação do advogado" } });
    fireEvent.click(screen.getByRole("button", { name: "aba historico" }));
    fireEvent.click(screen.getByRole("button", { name: "aba documentos" }));
    expect((screen.getByLabelText("campo documentos") as HTMLInputElement).value).toBe("anotação do advogado");
  });
});
