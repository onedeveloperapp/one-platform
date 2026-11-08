"use client";

import type { ReactNode } from "react";

import { Box, Typography } from "@mui/material";

import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import { cn } from "@/lib/utils";

/**
 * The head of a card of a screen (the owner, 2026-11-03): the icon that says what the card is, on its family's
 * tint, the title, and on the right where the card stands (a `StatusChip`) and what it keeps one click away
 * (`QuickActions`); under it, in one line, what the card is for. A person reads at a glance which card is which and
 * which one asks for something, before reading any of them.
 *
 * Closest catalog entries: `QuickActionTile` and `EmptyState`, which lead with an icon on its tint; a card's title
 * was a bare heading.
 */
export default function CardTitle({
  id,
  icon,
  tone = "primary",
  title,
  description,
  chip,
  actions,
  as = "h2",
}: {
  /** The heading's id: what the card's section is labelled by. */
  id: string;
  icon: ReactNode;
  tone?: TileTone;
  title: string;
  description?: ReactNode;
  /** Where the card stands, as a `StatusChip`. */
  chip?: ReactNode;
  /** What the card keeps one click away, as `QuickActions`. */
  actions?: ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <Box className="flex flex-col gap-2">
      {/* A long chip never squeezes the title into a column of syllables: when both do not fit, the chip and the
          actions go to the next line, at the right. */}
      <Box className="flex flex-row flex-wrap items-center gap-x-3 gap-y-2">
        <span
          aria-hidden
          className={cn(
            "flex h-10 w-10 flex-none items-center justify-center rounded-xl",
            TILE_TONE[tone].bg,
            TILE_TONE[tone].text,
          )}
        >
          {icon}
        </span>
        <Typography id={id} variant="h5" component={as} className="mb-0 min-w-40 flex-1 break-words">
          {title}
        </Typography>
        {chip || actions ? (
          <Box className="ml-auto flex max-w-full flex-none flex-row items-center gap-1">
            {chip}
            {actions}
          </Box>
        ) : null}
      </Box>
      {description ? (
        <Typography variant="body2" component="div" className="text-text-secondary">
          {description}
        </Typography>
      ) : null}
    </Box>
  );
}
