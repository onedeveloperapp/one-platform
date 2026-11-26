import ItemRows, { type ItemSection } from "./item-rows";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import messages from "@flyee/content/messages/pt-BR.json";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// A person who arrives for a card of lines (its address, from the top of the screen, the bell or a link of the
// screen) finds the first line that asks for them open, whatever drew the link (2026-11-26).

const SECTIONS: ItemSection[] = [
  {
    key: "ask",
    title: "Pedem a sua ação",
    ask: true,
    rows: [
      {
        key: "p1",
        icon: <span />,
        tone: "accent-3",
        title: "Intimação de 07/11",
        content: () => <p>texto da intimação</p>,
        openLabel: "Abrir a intimação de 07/11",
      },
    ],
  },
  {
    key: "read",
    title: "Lidas",
    rows: [
      {
        key: "p2",
        icon: <span />,
        tone: "accent-1",
        title: "Despacho de 01/11",
        content: () => <p>texto do despacho</p>,
        openLabel: "Abrir o despacho de 01/11",
      },
    ],
  },
];

function Card() {
  return (
    <NextIntlClientProvider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <a href="/casos/c1#case-publications" onClick={(event) => event.preventDefault()}>
        aviso do sino deste caso
      </a>
      <ItemRows sections={SECTIONS} arrival={["case-publications"]} />
    </NextIntlClientProvider>
  );
}

const asking = () => screen.getByRole("button", { name: "Abrir a intimação de 07/11" });

afterEach(cleanup);
beforeEach(() => window.history.replaceState(null, "", "/casos/c1"));

describe("ItemRows and the person who arrives for its card", () => {
  it("opens the first line that asks for them when the address names the card", () => {
    window.history.replaceState(null, "", "/casos/c1#case-publications");
    render(<Card />);
    expect(asking().getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("texto da intimação")).toBeTruthy();
  });

  it("and when a link the router draws brings them, which says no hashchange", () => {
    render(<Card />);
    expect(asking().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("link", { name: "aviso do sino deste caso" }));
    expect(asking().getAttribute("aria-expanded")).toBe("true");
  });

  it("opens nothing and breaks nothing for an address somebody typed wrong", () => {
    window.history.replaceState(null, "", "/casos/c1#%E0%A4%A");
    render(<Card />);
    expect(asking().getAttribute("aria-expanded")).toBe("false");
  });
});
