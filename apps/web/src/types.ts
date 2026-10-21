import { ButtonProps } from "@mui/material";

// Type-only: this module is loaded by the root providers for its enums, and a
// value import here would ship the whole icon set to every page.
import type { IconName } from "@/icons/icon-registry";
import type { MenuAccess } from "@/lib/firm/menu";

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
