"use client";

import type { ReactNode } from "react";

import { Box, Card, CardContent, Typography } from "@mui/material";

import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import { cn } from "@/lib/utils";

/** A small tinted icon on the hero's arcs: what the screen is about, said in decoration only. */
export type HeroOrnament = { key: string; icon: ReactNode; tone: TileTone };

/** Where each ornament sits on its arc, in degrees from the arc's rightmost point (left side) or leftmost (right). */
const ANGLES = [-40, 0, 40];

/**
 * The template's hero of a home (the "Time to Get Creative!" card of its AI pages, the owner's model of
 * 2026-11-05): one wide card with the greeting and a line centred over a row of quick actions, and at both sides
 * two dashed arcs carrying a few small tinted icons. The arcs and their icons are decoration: hidden from
 * assistive technology, and drawn only where the row of actions has room beside them (`lg` and up).
 *
 * Closest catalog entries: `PageHeader` (the title of a screen, never a card) and `ModulesQuickAccess` (the quick
 * actions under a heading of their own). Neither greets the person and opens the way in from one place at the top
 * of the home, which is the job here; the tiles inside it are `QuickActionTile`, outlined.
 */
export default function HomeHero({
  id,
  title,
  description,
  aside,
  ornaments = [],
  children,
}: {
  id: string;
  title: string;
  /** One line under the title. */
  description?: string;
  /** A smaller line under it (when the screen last knew it was current). */
  aside?: string;
  /** Up to six, the first three on the left arc and the rest on the right. */
  ornaments?: HeroOrnament[];
  /** The row of quick actions. */
  children?: ReactNode;
}) {
  return (
    <Card component="section" aria-labelledby={id} className="relative overflow-hidden">
      <Arc side="left" ornaments={ornaments.slice(0, 3)} />
      <Arc side="right" ornaments={ornaments.slice(3, 6)} />
      <CardContent className="relative flex flex-col items-center gap-6 px-4 py-9 text-center lg:px-36">
        <Box className="flex max-w-xl flex-col items-center gap-1">
          <Typography id={id} variant="h4" component="h2" className="mb-0">
            {title}
          </Typography>
          {description ? (
            <Typography variant="body1" className="text-text-secondary">
              {description}
            </Typography>
          ) : null}
          {aside ? (
            <Typography variant="body2" className="text-text-secondary">
              {aside}
            </Typography>
          ) : null}
        </Box>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Two dashed circles, half outside the card, so only their arcs show; the ornaments sit on the outer one. The box is
 * a square centred on the card's height, so the arcs keep their shape whatever the card's height.
 */
function Arc({ side, ornaments }: { side: "left" | "right"; ornaments: HeroOrnament[] }) {
  return (
    <Box
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-1/2 hidden h-80 w-80 -translate-y-1/2 lg:block",
        side === "left" ? "-left-56" : "-right-56",
      )}
    >
      <Box className="border-grey-200 absolute inset-0 rounded-full border border-dashed" />
      <Box className="border-grey-100 absolute inset-12 rounded-full border border-dashed" />
      {ornaments.map((ornament, index) => {
        const degrees = side === "left" ? ANGLES[index] : 180 - ANGLES[index];
        const radians = (degrees * Math.PI) / 180;
        const style = TILE_TONE[ornament.tone];
        return (
          <Box
            key={ornament.key}
            className="bg-background-paper absolute flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-xl"
            style={{ left: `${50 + 50 * Math.cos(radians)}%`, top: `${50 + 50 * Math.sin(radians)}%` }}
          >
            <Box className={cn("flex h-full w-full items-center justify-center rounded-xl", style.bg, style.text)}>
              {ornament.icon}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
