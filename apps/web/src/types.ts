import { ButtonProps } from "@mui/material";

// Type-only: this module is loaded by the root providers for its enums, and a
// value import here would ship the whole icon set to every page.
import type { IconName } from "@/icons/icon-registry";
import type { MenuAccess, MenuViewer } from "@/lib/firm/menu";

export type Screens = {
  sm: string;
  md: string;
  lg: string;
  xl: string;
  "2xl": string;
  "3xl": string;
};

export type MenuItem = {
  id: string;
  label: string;
  description?: string;
  listIcon?: IconName;
  icon?: IconName;
  href?: string;
  color?: ButtonProps["color"];
  children?: MenuItem[];
  /**
   * Children that depend on who is looking (`lib/firm/menu.ts`): the modules of the firm, read from the catalog
   * by the server layout. Given, they stand for `children`.
   */
  childrenFor?: (viewer: MenuViewer | null) => MenuItem[];
  /** The words of an item that are data (a module's name), shown as they are, never as a message key. */
  text?: string;
  /** What the item says beside its name: a module still to come, or one the firm did not contract. */
  tag?: "soon" | "locked";
  /**
   * The words of the subtle link to the item's own page (`href`) beside the title of its submenu, when it has one
   * (a message key; "Todos" when left out). The page a group opens on is never an item of its own submenu (the
   * owner, 2026-11-07): "Todos os módulos" was one, and took a line of the submenu.
   */
  overviewLabel?: string;
  /** The item is the page at its address only, never the pages under it (the overview of the modules). */
  exact?: boolean;
  /** Who the item is for (`lib/firm/menu.ts`). Left out: anybody of a firm. */
  canAccess?: MenuAccess;
  isExternalLink?: boolean;
  content?: React.ReactNode;
};

export enum ContentType {
  Boxed = "boxed",
  Fluid = "fluid",
}

export enum MenuType {
  Minimal = "minimal",
  Comfort = "comfort",
  SingleLayer = "single-layer",
}

export enum MenuShowState {
  Show = "SHOW",
  Hide = "HIDE",
  TemporaryShow = "TEMPORARY_SHOW",
}

export type MenuWidth = { primary: number; secondary: number };
export type MenuDefaultWidth = {
  [MenuType.Minimal]: MenuWidth;
  [MenuType.Comfort]: MenuWidth;
  [MenuType.SingleLayer]: MenuWidth;
};
