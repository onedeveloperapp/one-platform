"use client";

import NextureIcons, { IconMap, type IconName } from "@/icons/icon-registry";
import { GENERIC_MODULE_ICON } from "@/lib/modules/offer";

/**
 * The icon that says what a module is (`product_modules.icon`, migration 0078): the passenger module's plane, the
 * umbrella of the one to come on social security, the hard hat of the one on labour. The name is data, so it is
 * read through the registry (`icon-registry.tsx`), which the menu ships anyway; a name the set does not have shows
 * the generic module icon, never nothing.
 *
 * Closest catalog entry: the icons the tiles take as nodes (`QuickActionTile`); nothing existing turned a name
 * into an icon with a fallback.
 */
export default function ModuleIcon({
  name,
  size = "large",
  className,
  variant = "outlined",
}: {
  name: string | null | undefined;
  size?: "small" | "medium" | "large" | number;
  className?: string;
  variant?: "outlined" | "contained";
}) {
  const icon = name && Object.prototype.hasOwnProperty.call(IconMap, name) ? (name as IconName) : GENERIC_MODULE_ICON;
  return <NextureIcons icon={icon as IconName} size={size} className={className} variant={variant} />;
}
