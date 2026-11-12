"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Box, Card, CardContent, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import { cn } from "@/lib/utils";

/** One count of the card, and where the work it counts is done. */
export type CountItem = {
  key: string;
  href: string;
  /** The icon of what it counts, at `size="medium"`. */
  icon: ReactNode;
  tone: TileTone;
  label: string;
  /** What the count counts, on hover and to assistive technology. */
  hint?: string;
  value: number | string;
};

/**
 * A card of a few counts, each one a way into where its work is done (the home's "Para acompanhar", the owner,
 * 2026-11-12): one line per count with the icon of what it counts on its family's tint, what it counts, the number
 * and a chevron, the whole line the link. One column in a side column of the page, two or three as the card widens
 * (a container query, so the card reads its own width, never the screen's).
 *
 * Closest catalog entries: `StatTile`, one count per tile, a tall band over the label, four across (a home with one
 * count left three quarters of its row empty, the owner's screenshot of 2026-11-12), and `AttentionList`, one card
 * per thing that holds a case, with its kind and its case. Neither lists a few counts compactly beside the rest of a
 * page, which is the job here; the lines take AttentionList's outlined shape.
 */
export default function CountList({
  id,
  icon,
  tone = "primary",
  title,
  description,
  items,
}: {
  /** The heading's id: what the card's section is labelled by. */
  id: string;
  icon: ReactNode;
  tone?: TileTone;
  title: string;
  /** What the counts are, behind the "i" beside the title. */
  description?: string;
  items: readonly CountItem[];
}) {
  return (
    <Card component="section" aria-labelledby={id} className="@container">
      <CardContent className="flex flex-col gap-4">
        <CardTitle id={id} icon={icon} tone={tone} title={title} description={description} />
        <CountRows items={items} />
      </CardContent>
    </Card>
  );
}

/**
 * Where each line goes when the counts are split in two columns: its column, and its row there. Written out so the
 * classes are found by Tailwind; six rows a column at most.
 */
const SPLIT_COLUMN = ["@2xl:col-start-1", "@2xl:col-start-2"] as const;
const SPLIT_ROW = [
  "@2xl:row-start-1",
  "@2xl:row-start-2",
  "@2xl:row-start-3",
  "@2xl:row-start-4",
  "@2xl:row-start-5",
  "@2xl:row-start-6",
] as const;

/**
 * The lines of a `CountList`, for a card that holds more than them (the court's numbers on the controladoria, under
 * the card's own head and its chip): one column, then two or three as the card widens. `split` keeps two families of
 * counts apart on a wide card, the first `split` lines in the left column and the rest in the right, row by row, so a
 * line that wraps never pushes its neighbour out of line; on a narrow card they follow one another in their order.
 * Inside a card that reads its width (`@container`).
 */
export function CountRows({ items, split }: { items: readonly CountItem[]; split?: number }) {
  return (
    <Box
      component="ul"
      className={cn(
        "m-0 grid list-none grid-cols-1 gap-2 p-0",
        split === undefined ? "@2xl:grid-cols-2 @5xl:grid-cols-3" : "@2xl:grid-cols-2",
      )}
    >
      {items.map((item, index) => {
        const style = TILE_TONE[item.tone];
        const place =
          split === undefined
            ? null
            : index < split
              ? [SPLIT_COLUMN[0], SPLIT_ROW[index]]
              : [SPLIT_COLUMN[1], SPLIT_ROW[index - split]];
        return (
          <Box component="li" key={item.key} className={cn("flex", place)}>
            <Box
              component={Link}
              href={item.href}
              title={item.hint}
              className="border-grey-100 hover:border-grey-200 hover:bg-grey-25 flex w-full flex-row items-center gap-3 rounded-2xl border px-3 py-2.5 no-underline outline-offset-2 transition-colors focus-visible:outline-2"
            >
              <Box
                aria-hidden
                className={cn("flex h-9 w-9 flex-none items-center justify-center rounded-xl", style.bg, style.text)}
              >
                {item.icon}
              </Box>
              <Typography variant="body1" component="span" className="text-text-primary min-w-0 flex-1 leading-5">
                {item.label}
              </Typography>
              <Typography variant="h6" component="span" className="text-text-primary flex-none tabular-nums">
                {item.value}
              </Typography>
              <NiChevronRightSmall size="medium" className="text-text-secondary flex-none" />
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
