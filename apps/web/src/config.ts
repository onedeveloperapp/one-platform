import { ContentType, MenuType } from "./types";

import { ModeVariant, ThemeVariant } from "@/constants";

export const DEFAULTS = {
  appRoot: "/inicio",
  locale: "pt-BR",
  themeColor: "theme-blue" as ThemeVariant,
  // Light-first (docs/DESIGN.md): light is the default; dark stays an explicit
  // user choice via the mode switcher.
  themeMode: "light" as ModeVariant,
  // The shell's layout is the product's, not a person's: no screen offers the
  // template's layout switches, so nothing of it is kept in the browser.
  contentType: ContentType.Fluid,
  // The menu is a thin rail of icons, each named in a tooltip and to assistive technology, as ADVBox's (the
  // owner, 2026-11-07): the page keeps its width. On a phone the menu that opens is the list with the names
  // (`layout-context.tsx`), since a tooltip needs a pointer.
  leftMenuType: MenuType.Minimal,
  leftMenuWidth: {
    [MenuType.Minimal]: { primary: 60, secondary: 240 },
    [MenuType.Comfort]: { primary: 116, secondary: 240 },
    [MenuType.SingleLayer]: { primary: 280, secondary: 0 },
  },
  transitionDuration: 150,
};
