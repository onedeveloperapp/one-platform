import { GlobalSearchField } from "./global-search";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMarkSetupShown } from "@/components/layout/setup-shown";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// On /inicio, while the firm's setup was on the screen, the browser filled the search with the person's e-mail and
// its list of "Nada encontrado." stood over the panel of the papers' step (2026-11-21).

vi.setConfig({ testTimeout: 30_000 });

vi.mock("next/navigation", () => ({
  usePathname: () => "/inicio",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const words = vi.hoisted(() => ({ useTranslations: () => (key: string) => key }));
vi.mock("next-intl", () => words);
vi.mock("use-intl", () => words);

// What is typed is asked of the database: here, nothing is ever found.
vi.mock("@/components/layout/search/use-global-search", () => ({
  useGlobalSearch: () => ({ kind: "ready", hits: [] }),
}));

vi.mock("@/icons/nexture/ni-search", () => ({ default: () => null }));
vi.mock("@/icons/nexture/ni-cross", () => ({ default: () => null }));

afterEach(cleanup);

function SetupOnScreen() {
  useMarkSetupShown();
  return null;
}

describe("the search at the top", () => {
  it("is a search, never a field the browser fills as a login", () => {
    render(<GlobalSearchField />);
    const field = screen.getByLabelText("search-label");
    expect(field.getAttribute("type")).toBe("search");
    expect(field.getAttribute("autocomplete")).toBe("off");
  });

  it("opens no list for text the browser put there with nobody in the field", () => {
    render(<GlobalSearchField />);
    const field = screen.getByLabelText("search-label") as HTMLInputElement;
    expect(document.activeElement).not.toBe(field);
    act(() => {
      fireEvent.change(field, { target: { value: "advogada@exemplo.com.br" } });
    });
    expect(field.value).toBe("");
    expect(screen.queryByText("search-empty")).toBeNull();
  });

  it("opens its list for the person who types in it", () => {
    render(<GlobalSearchField />);
    const field = screen.getByLabelText("search-label") as HTMLInputElement;
    act(() => {
      field.focus();
      fireEvent.change(field, { target: { value: "Maria" } });
    });
    expect(field.value).toBe("Maria");
    expect(screen.getByText("search-empty")).toBeTruthy();
  });

  it("is left out while a setup is on the screen, on /inicio too", () => {
    const { rerender } = render(<GlobalSearchField />);
    expect(screen.queryByLabelText("search-label")).not.toBeNull();
    rerender(
      <>
        <SetupOnScreen />
        <GlobalSearchField />
      </>,
    );
    expect(screen.queryByLabelText("search-label")).toBeNull();
    rerender(<GlobalSearchField />);
    expect(screen.queryByLabelText("search-label")).not.toBeNull();
  });
});
