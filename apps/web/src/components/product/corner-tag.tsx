import type { ReactNode } from "react";

import { Box } from "@mui/material";

import type { StatusTone } from "@/components/product/status-chip";
import { cn } from "@/lib/utils";

/** The tint of each tone, over the paper so the tag stays opaque wherever it floats. */
const TINT: Record<StatusTone, string> = {
  neutral: "bg-grey-100",
  primary: "bg-primary-light/15",
  positive: "bg-success-light/15",
  attention: "bg-accent-3-light/20",
  info: "bg-accent-4-light/15",
  danger: "bg-error-light/15",
};

/**
 * Where the tag floats. `icon`: off the top right corner of an icon, overlapping it a little, as the count on the
 * bell of the header (a menu item's icon, a tile's). `edge`: over the top edge of a wide element, near its right
 * corner (a card, a tab).
 */
const PLACEMENT = {
  // Its foot on the icon's top line and its start over the icon's corner, so the words beside the icon stay clear.
  icon: "bottom-full left-[calc(100%-0.5rem)]",
  edge: "top-0 right-3 -translate-y-1/2",
} as const;

/**
 * A short tag that floats over the corner of what it marks, as the count on the bell of the header (the owner,
 * 2026-11-07): a menu item still to come ("Em breve"), a lock on what the account did not contract, a "Novo" on a
 * tab. It takes no room of the words beside it, so a name never breaks onto a second line for it.
 *
 * Put it inside the element it marks, which must be positioned: a wrapper of the icon with `relative` for `icon`, the
 * element itself for `edge` (a MUI Button is positioned). It is drawn for the eye only (`aria-hidden`): the element
 * it marks says the same in its own name, as "Direito Previdenciário, Em breve".
 */
export default function CornerTag({
  label,
  icon,
  tone = "neutral",
  placement = "icon",
  className,
}: {
  /** The state, in a word or two. */
  label?: string;
  /** A mark in place of the words (a lock), drawn in a small round tag. */
  icon?: ReactNode;
  tone?: StatusTone;
  placement?: keyof typeof PLACEMENT;
  className?: string;
}) {
  if (!label && !icon) return null;
  return (
    <Box
      component="span"
      aria-hidden
      className={cn(
        "bg-background-paper ring-background-paper text-text-primary pointer-events-none absolute z-10 inline-flex h-4 items-center overflow-hidden rounded-full shadow-sm ring-2",
        PLACEMENT[placement],
        label ? "px-1.5" : "w-4 justify-center",
        className,
      )}
    >
      <Box component="span" className={cn("absolute inset-0", TINT[tone])} />
      {icon ? (
        <Box component="span" className="relative inline-flex">
          {icon}
        </Box>
      ) : null}
      {label ? (
        <Box component="span" className="relative text-xs leading-none font-semibold whitespace-nowrap">
          {label}
        </Box>
      ) : null}
    </Box>
  );
}
