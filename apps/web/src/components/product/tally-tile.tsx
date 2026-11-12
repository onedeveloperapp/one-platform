"use client";

import type { ReactNode } from "react";

import { Box, Card, Typography } from "@mui/material";

import MetricBars, { type MetricBarItem } from "@/components/product/metric-bars";
import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import { cn } from "@/lib/utils";

/**
 * One way of counting the same people, in a tile (the owner, 2026-11-12, who found "Quem o escritório atende" seven
 * headings each over one bar, with most of the card empty, and sent the template's tiles of levels as the model): the
 * icon of the dimension on its tint in a full-height column, its name, and its few largest parts as shares of one
 * whole, the rest said in a word. Tiles of one card sit four across and share their height.
 *
 * Closest catalog entries: `QuickActionTile`, whose tinted column and outlined card this keeps (it is a shortcut, with
 * no numbers), and `MetricBars`, whose rows it holds (they had a heading of their own each, loose in a card).
 */
export default function TallyTile({
  icon,
  tone,
  title,
  items,
  total,
  shown = 3,
  more,
  empty,
}: {
  /** Pass the icon at `size="medium"`. */
  icon: ReactNode;
  tone: TileTone;
  title: string;
  items: MetricBarItem[];
  /** The whole the shares are of; the sum of the items by default. */
  total?: number;
  /** How many of the largest parts are drawn. */
  shown?: number;
  /** What is said of the parts not drawn ("e mais 4"), given how many there are. */
  more?: (count: number) => string;
  /** What the tile says when nothing was counted. */
  empty: string;
}) {
  const style = TILE_TONE[tone];
  const whole = total ?? items.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const drawn = items.slice(0, shown);
  const left = items.length - drawn.length;
  return (
    <Card elevation={0} className="border-grey-100 flex h-full flex-row border p-1">
      <Box
        aria-hidden
        className={cn("flex w-14 flex-none items-center justify-center rounded-xl", style.bg, style.text)}
      >
        {icon}
      </Box>
      <Box className="flex min-w-0 flex-1 flex-col gap-3 px-4 py-3">
        <Typography variant="subtitle2" component="h3" className="mb-0 leading-5">
          {title}
        </Typography>
        {drawn.length === 0 ? (
          <Typography variant="body2" className="text-text-secondary">
            {empty}
          </Typography>
        ) : (
          <MetricBars items={drawn} total={whole} spacing="dense" />
        )}
        {left > 0 && more ? (
          <Typography variant="caption" className="text-text-secondary">
            {more(left)}
          </Typography>
        ) : null}
      </Box>
    </Card>
  );
}
