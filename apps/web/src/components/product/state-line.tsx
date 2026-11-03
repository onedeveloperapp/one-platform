"use client";

import type { ReactNode } from "react";

import { Box, Typography } from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import NiClock from "@/icons/nexture/ni-clock";
import NiCrossSquare from "@/icons/nexture/ni-cross-square";
import NiExclamationSquare from "@/icons/nexture/ni-exclamation-square";
import NiInfoSquare from "@/icons/nexture/ni-info-square";
import { cn } from "@/lib/utils";

/**
 * Where one thing stands, in a line (the owner, 2026-11-03): an icon in the colour of the state and the words.
 * `done` is the success green with a check; `waiting`, the palette's amber with a clock (something is under way,
 * nobody needs to act); `attention`, what a person should look at or do, in the accent the app uses for "look at
 * this", with an exclamation; `failed`, red, kept for a failure; `info`, grey, what is only said. The words keep
 * the text colours (no hue reaches 4.5:1 as small text on a light ground), so the state reads from the words too,
 * never from the colour alone.
 *
 * Closest catalog entries: `StatusChip`, which names a state as a badge, and `ProgressNow`, which says where a way
 * of several steps stands, in the same tinted box `emphasis` draws; this says the state of one thing (a document,
 * an agreement, the WhatsApp the alerts go to) in a sentence, beside it, with the one action it may need.
 */
export type StateTone = "done" | "waiting" | "attention" | "failed" | "info";

const LOOK: Record<StateTone, { icon: ReactNode; colour: string }> = {
  done: { icon: <NiCheck size="medium" />, colour: "text-success" },
  waiting: { icon: <NiClock size="medium" />, colour: "text-accent-4" },
  attention: { icon: <NiExclamationSquare size="medium" />, colour: "text-accent-3" },
  failed: { icon: <NiCrossSquare size="medium" />, colour: "text-error" },
  info: { icon: <NiInfoSquare size="medium" />, colour: "text-text-secondary" },
};

export default function StateLine({
  tone,
  children,
  action,
  icon,
  emphasis = false,
}: {
  tone: StateTone;
  children: ReactNode;
  /** The one thing the line asks for, beside it. */
  action?: ReactNode;
  /** What the line is about, in place of the state's own icon (a phone for the WhatsApp); the colour stays the state's. */
  icon?: ReactNode;
  /** A line that is the card's answer: on its state's tint, in a box. */
  emphasis?: boolean;
}) {
  return (
    <Box
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-center",
        emphasis && "rounded-2xl border p-4",
        emphasis && tone === "done" && "border-success/30 bg-success/5",
        emphasis && tone === "waiting" && "border-accent-4/40 bg-accent-4-light/15",
        emphasis && tone === "attention" && "border-accent-3/30 bg-accent-3-light/10",
        emphasis && tone === "failed" && "border-error/30 bg-error/5",
        emphasis && tone === "info" && "border-grey-200 bg-grey-25",
      )}
    >
      <Box className="flex min-w-0 flex-1 flex-row items-start gap-2">
        <span aria-hidden className={cn("flex-none", LOOK[tone].colour)}>
          {icon ?? LOOK[tone].icon}
        </span>
        <Typography variant="body2" component="div" className="text-text-primary min-w-0 flex-1 pt-0.5">
          {children}
        </Typography>
      </Box>
      {action ? <Box className="flex-none self-start sm:self-auto">{action}</Box> : null}
    </Box>
  );
}
