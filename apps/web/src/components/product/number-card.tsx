"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Box, Card, Typography } from "@mui/material";

import RatioGauge from "@/components/product/ratio-gauge";
import StatusChip from "@/components/product/status-chip";
import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import { cn } from "@/lib/utils";

/** What a number was, and how it moved since: shown under the number. */
export type NumberComparison = {
  /** The move in a few characters ("+9%", "-4"), or null when nothing moved. */
  delta: string | null;
  /** The words for a number that did not move ("igual"). */
  same: string;
  /** The move is the one the card hopes for: said in green. Any other move is said in grey, never in red. */
  hoped: boolean;
  /** With what it is compared, and what that was: "vs 1 a 7 de outubro: 287". */
  text: string;
};

/**
 * A big number in a card, with what it was in the same span before and the list it counts one click away (the
 * screen pattern after ADVBox, approved by the owner on 2026-11-07): the icon of what it counts on its family's
 * tint beside a short label, the number, and under it the move ("+9%") and what it is compared with ("vs 1 a 7
 * de outubro: 287"). A move is green only when it is the one the card hopes for (more cases filed); a stock that
 * grows or a month with fewer cases is said in grey, since red is kept for risk and failure.
 *
 * `onClick` with `pressed` makes it the filter of the list beside it (a real button); `href` a link to the list it
 * counts; neither, a readout. Closest catalog entry: `StatTile`, the home's tile, whose band and centred number
 * stay the home's; this is the card of a list's numbers.
 */
export default function NumberCard({
  icon,
  tone,
  label,
  value,
  comparison,
  ratio,
  hint,
  onClick,
  pressed,
  href,
}: {
  /** Pass the icon at `size="medium"`. */
  icon: ReactNode;
  tone: TileTone;
  label: string;
  value: string;
  comparison?: NumberComparison | null;
  /**
   * The number as a part of a whole, when that is what it says (the people's funnel, 2026-11-12): a ring with the share
   * at the card's right, and under the number its x/y in words ("de 12 pessoas").
   */
  ratio?: { part: number; whole: number; text: string; label: string } | null;
  /** One line of what the number counts, on hover and to assistive technology. */
  hint?: string;
  onClick?: () => void;
  pressed?: boolean;
  href?: string;
}) {
  const style = TILE_TONE[tone];
  const shell = onClick
    ? { component: "button" as const, type: "button" as const, onClick, "aria-pressed": pressed }
    : href
      ? { component: Link, href }
      : { component: "div" as const };
  return (
    <Card
      {...shell}
      title={hint}
      className={cn(
        "flex h-full w-full px-4! py-3! text-left sm:px-5! sm:py-4!",
        ratio ? "flex-row items-center gap-3" : "flex-col",
        (onClick || href) && "hover:bg-grey-25 cursor-pointer transition-colors",
        // The card a list is filtered by keeps the ring the app uses for selection.
        pressed && "outline-primary outline-2 -outline-offset-2",
      )}
    >
      <Box className={cn("flex min-w-0 flex-col gap-1 sm:gap-1.5", ratio && "flex-1")}>
        <Box className="flex items-center gap-2.5">
          <Box
            aria-hidden
            // Two cards side by side on a phone: the label alone, as the drawing has it.
            className={cn(
              "hidden h-8 w-8 flex-none items-center justify-center rounded-lg sm:flex",
              style.bg,
              style.text,
            )}
          >
            {icon}
          </Box>
          <Typography variant="body1" component="span" className="text-text-secondary font-semibold">
            {label}
          </Typography>
        </Box>
        <Typography variant="h3" component="p" className="mb-0 tabular-nums max-sm:text-2xl">
          {value}
        </Typography>
        {comparison ? (
          <Box className="flex flex-wrap items-center gap-2">
            <StatusChip
              tone={comparison.delta && comparison.hoped ? "positive" : "neutral"}
              label={comparison.delta ?? comparison.same}
            />
            <Typography variant="body2" component="span" className="text-text-secondary">
              {comparison.text}
            </Typography>
          </Box>
        ) : null}
        {ratio ? (
          <Typography variant="body2" component="span" className="text-text-secondary">
            {ratio.text}
          </Typography>
        ) : null}
      </Box>
      {ratio ? (
        <RatioGauge value={ratio.part} total={ratio.whole} tone={tone} label={ratio.label} className="max-sm:hidden" />
      ) : null}
    </Card>
  );
}
