import LeftMenu from "./left-menu";
import MenuBackdrop from "./menu-backdrop";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LayoutContextProvider from "@/components/layout/layout-context";
import { ViewerProvider } from "@/components/layout/viewer-context";
import type { MenuViewer } from "@/lib/firm/menu";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// A submenu opens over the page on its icon and closes once a page is reached, and it marks the page the person is
// on when it opens again (the owner, 2026-11-08). It stayed open from `xl` on, over the left of every page of its group.

// Finding by role reads the styles of the whole menu, which outlasts the default 5 seconds with the whole suite running.
vi.setConfig({ testTimeout: 30_000 });

const place = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => place.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const words = vi.hoisted(() => ({ useTranslations: () => (key: string) => key }));
vi.mock("next-intl", () => words);
vi.mock("use-intl", () => words);

// It reads the account's plan from the database, and has nothing of the submenu.
vi.mock("@/components/layout/menu/plan-indicator", () => ({ default: () => null }));

// The whole set of icons takes a test worker down, and no icon is under test here.
vi.mock("@/icons/icon-registry", () => ({
  default: () => null,
  IconMap: { NiPlane: true, NiUmbrella: true, NiPuzzle: true },
}));
vi.mock("@/icons/nexture/ni-lock", () => ({ default: () => null }));
vi.mock("@/icons/nexture/ni-chevron-right-small", () => ({ default: () => null }));

// A screen wide enough for the rail.
vi.mock("@/hooks/use-screen", async () => {
  const { useEffect } = await import("react");
  return {
    useScreenEffect: (_breakpoint: string, onChange: (match: boolean) => void) => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      useEffect(() => onChange(true), []);
    },
  };
});

const VIEWER: MenuViewer = {
  hasFirm: true,
  role: "owner",
  firmFunction: "socio",
  modules: ["direito-do-passageiro"],
  moduleMenu: [
    { key: "direito-do-passageiro", name: "Direito do Passageiro", icon: "NiPlane", state: "contracted" },
    { key: "direito-previdenciario", name: "Direito Previdenciário", icon: "NiUmbrella", state: "soon" },
  ],
  partner: false,
  isSuperadmin: false,
  owesSecondFactor: false,
};

const Shell = () => (
  <LayoutContextProvider>
    <ViewerProvider viewer={VIEWER}>
      <LeftMenu />
      <MenuBackdrop />
    </ViewerProvider>
  </LayoutContextProvider>
);

const rail = () => screen.getByRole("button", { name: "menu-modulos" });
const passenger = () => screen.getByRole("link", { name: "Direito do Passageiro" });
const social = () => screen.getByRole("link", { name: "Direito Previdenciário, menu-tag-soon" });
/** Closed, the submenu is out of the eye (no width) and out of the keyboard's and a screen reader's reach (`inert`). */
const closed = () => {
  expect(rail()).toHaveAttribute("aria-expanded", "false");
  expect(passenger().closest("[inert]")).not.toBeNull();
};
const open = () => {
  expect(rail()).toHaveAttribute("aria-expanded", "true");
  expect(passenger().closest("[inert]")).toBeNull();
};

beforeEach(() => {
  place.pathname = "/modulos/direito-do-passageiro";
});
afterEach(cleanup);

describe("the submenu of the rail", () => {
  it("stays closed on a page of its group, whatever the width, with the group marked on the rail", () => {
    render(<Shell />);
    closed();
    expect(rail()).toHaveAttribute("aria-current", "page");
  });

  it("opens on its icon, marks the page the person is on, and closes on the same icon", () => {
    render(<Shell />);
    fireEvent.click(rail());
    open();
    expect(passenger()).toHaveAttribute("aria-current", "page");
    expect(social()).not.toHaveAttribute("aria-current");
    fireEvent.click(rail());
    closed();
  });

  it("closes when the person reaches another page, and marks that page when opened again", () => {
    const view = render(<Shell />);
    fireEvent.click(rail());
    open();
    place.pathname = "/modulos/direito-previdenciario";
    view.rerender(<Shell />);
    closed();
    fireEvent.click(rail());
    expect(passenger()).not.toHaveAttribute("aria-current");
  });

  it("closes on following a link that stays on the path, which no change of page would tell", () => {
    place.pathname = "/modulos";
    render(<Shell />);
    fireEvent.click(rail());
    open();
    fireEvent.click(social());
    closed();
  });

  it("stays open for a link opened in another tab", () => {
    render(<Shell />);
    fireEvent.click(rail());
    // The browser's own default would leave the jsdom page: only the menu's answer is under test here.
    passenger().addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(passenger(), { ctrlKey: true });
    open();
  });

  it("closes on a click on the page, also on a page no item of the menu names", () => {
    place.pathname = "/aprovacoes";
    const { container } = render(<Shell />);
    expect(rail()).not.toHaveAttribute("aria-current");
    fireEvent.click(rail());
    open();
    const backdrop = container.querySelector(".fixed.inset-0");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as Element);
    // The page belongs to no group, so the submenu goes with its links.
    expect(rail()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Direito do Passageiro" })).toBeNull();
    // Nothing is left over the page to catch the next click.
    expect(container.querySelector(".fixed.inset-0")).toBeNull();
  });
});

describe("the submenu of the operator's consoles", () => {
  it("follows the same rule: closed on a page of its group, the page marked when opened", () => {
    place.pathname = "/admin/escritorios";
    render(
      <LayoutContextProvider>
        <ViewerProvider viewer={{ ...VIEWER, hasFirm: false, role: null, firmFunction: null, isSuperadmin: true }}>
          <LeftMenu />
        </ViewerProvider>
      </LayoutContextProvider>,
    );
    const consoles = screen.getByRole("button", { name: "menu-admin" });
    const firms = screen.getByRole("link", { name: "menu-admin-firms" });
    expect(consoles).toHaveAttribute("aria-expanded", "false");
    expect(firms.closest("[inert]")).not.toBeNull();
    fireEvent.click(consoles);
    expect(consoles).toHaveAttribute("aria-expanded", "true");
    expect(firms.closest("[inert]")).toBeNull();
    expect(firms).toHaveAttribute("aria-current", "page");
  });
});

describe("the state of a module on its line", () => {
  it("floats at the end of the line, never beside the icon, and is said in the item's own name", () => {
    render(<Shell />);
    const tag = screen.getByText("menu-tag-soon");
    expect(tag.closest("a")).toBe(social());
    expect(tag.closest(".MuiButton-startIcon")).toBeNull();
  });
});
