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
  leftMenuType: MenuType.SingleLayer,
  leftMenuWidth: {
    [MenuType.Minimal]: { primary: 60, secondary: 240 },
    [MenuType.Comfort]: { primary: 116, secondary: 240 },
    [MenuType.SingleLayer]: { primary: 280, secondary: 0 },
  },
  transitionDuration: 150,
};
