import { anchorOf, followArrivals } from "./anchor-arrival";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every follower of an arrival (the tab of a card, the card, the line that asks) hears the same three moments: the
// address at once, a `hashchange`, and the click on a link to an anchor of this page, whatever draws the link.

let stop: (() => void) | null = null;

beforeEach(() => window.history.replaceState(null, "", "/casos/c1?aba=acao"));
afterEach(() => {
  stop?.();
  stop = null;
  document.body.innerHTML = "";
});

/** A link as the router draws it: the router takes the click for itself, so the browser follows nothing. */
function routerLink(href: string, attributes: Record<string, string> = {}): HTMLAnchorElement {
  const link = document.createElement("a");
  link.setAttribute("href", href);
  for (const [name, value] of Object.entries(attributes)) link.setAttribute(name, value);
  link.textContent = href;
  link.addEventListener("click", (event) => event.preventDefault());
  document.body.append(link);
  return link;
}

const click = (target: Element, init: MouseEventInit = {}) =>
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));

describe("the id an address names", () => {
  it("reads it decoded, and an address somebody typed wrong as none", () => {
    expect(anchorOf("#case-people")).toBe("case-people");
    expect(anchorOf("#a%C3%A7%C3%A3o")).toBe("ação");
    expect(anchorOf("")).toBeNull();
    expect(anchorOf("#")).toBeNull();
    expect(anchorOf("#%E0%A4%A")).toBeNull();
    expect(anchorOf("#50%")).toBeNull();
  });
});

describe("an arrival on the page", () => {
  it("is heard from the address at once, then on each hashchange", () => {
    window.history.replaceState(null, "", "/casos/c1?aba=cliente#case-people");
    const arrive = vi.fn();
    stop = followArrivals(arrive);
    expect(arrive).toHaveBeenCalledTimes(1);
    expect(arrive.mock.calls[0][0]).toBe("case-people");
    expect((arrive.mock.calls[0][1] as URL).search).toBe("?aba=cliente");
    window.history.replaceState(null, "", "/casos/c1#case-drafts");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(arrive).toHaveBeenLastCalledWith("case-drafts", expect.any(URL));
  });

  it("is heard from a link the router draws, which says no hashchange, with the link's own address", () => {
    const arrive = vi.fn();
    stop = followArrivals(arrive);
    const heard = vi.fn();
    window.addEventListener("hashchange", heard);
    click(routerLink("/casos/c1?acesso=pje-tjrj#case-filing"));
    window.removeEventListener("hashchange", heard);
    expect(heard).not.toHaveBeenCalled();
    expect(arrive).toHaveBeenCalledTimes(1);
    expect(arrive.mock.calls[0][0]).toBe("case-filing");
    expect((arrive.mock.calls[0][1] as URL).search).toBe("?acesso=pje-tjrj");
  });

  it("from a link of the page's own anchor, with the page's query, and from a click on what the link holds", () => {
    const arrive = vi.fn();
    stop = followArrivals(arrive);
    click(routerLink("#case-people"));
    expect(arrive).toHaveBeenLastCalledWith("case-people", expect.any(URL));
    expect((arrive.mock.calls[0][1] as URL).search).toBe("?aba=acao");
    const inside = document.createElement("span");
    routerLink("#case-drafts").append(inside);
    click(inside);
    expect(arrive).toHaveBeenLastCalledWith("case-drafts", expect.any(URL));
  });

  it("is not heard from another page, another site, a click that opens a new tab, or a link to no anchor", () => {
    const arrive = vi.fn();
    stop = followArrivals(arrive);
    click(routerLink("/casos/c2#case-filing"));
    click(routerLink("https://example.com/casos/c1#case-filing"));
    click(routerLink("#case-filing"), { ctrlKey: true });
    click(routerLink("#case-filing"), { metaKey: true });
    click(routerLink("#case-filing"), { shiftKey: true });
    click(routerLink("#case-filing"), { altKey: true });
    click(routerLink("#case-filing"), { button: 1 });
    click(routerLink("#case-filing", { target: "_blank" }));
    click(routerLink("/casos/c1"));
    click(routerLink("#"));
    click(routerLink("#%E0%A4%A"));
    expect(arrive).not.toHaveBeenCalled();
  });

  it("never breaks on an address somebody typed wrong", () => {
    window.history.replaceState(null, "", "/casos/c1#%E0%A4%A");
    const arrive = vi.fn();
    expect(() => {
      stop = followArrivals(arrive);
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }).not.toThrow();
    expect(arrive).not.toHaveBeenCalled();
  });

  it("is no longer heard once the follower gives its listening back", () => {
    const arrive = vi.fn();
    followArrivals(arrive)();
    click(routerLink("#case-people"));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(arrive).not.toHaveBeenCalled();
  });
});
