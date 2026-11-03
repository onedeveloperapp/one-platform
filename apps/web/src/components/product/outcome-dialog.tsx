"use client";

import type { ReactNode } from "react";

import { Box, Button, Dialog, DialogActions, DialogContent, Typography, useMediaQuery } from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import NiInfoSquare from "@/icons/nexture/ni-info-square";
import { cn } from "@/lib/utils";

/** Paired with the title, so the dialog has an accessible name. */
const TITLE_ID = "outcome-dialog-title";

export type OutcomeLine = { key: string; icon: ReactNode; text: ReactNode };

/**
 * What an act a person just did changed, said whole and in front of them (the owner, 2026-11-03): an answer that
 * binds them (an agreement, a withdrawal), a decision others will act on. A small alert at the top of a page was
 * read past: the passenger agreed and could not tell what they had agreed to start. The dialog shows the state in
 * a large icon on its tint (`done`, the success green with a check; `info`, grey, for an answer that stops
 * something), the title in the person's words ("Acordo registrado"), each consequence on a line of its own with
 * the icon of what it is about (the trips followed, the WhatsApp the alerts go to, how to change one's mind), and
 * one button that closes it. Nothing in it asks for another decision.
 *
 * Closest catalog entry: `StepCelebrationDialog`, the beat between two steps of a setup, whose button loads the
 * next step; this one ends where the act ends.
 */
export default function OutcomeDialog({
  open,
  tone = "done",
  title,
  lines,
  closeLabel,
  onClose,
}: {
  open: boolean;
  tone?: "done" | "info";
  /** What now holds, in the person's words: "Acordo registrado", never "Sucesso". */
  title: string;
  /** What the act changed, one consequence a line, each with its icon. */
  lines: OutcomeLine[];
  /** The one button: "Entendi". */
  closeLabel: string;
  onClose: () => void;
}) {
  // The dialog appears unprompted after an answer: its entrance is motion, kept out where motion is reduced.
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      transitionDuration={reduceMotion ? 0 : undefined}
      aria-labelledby={TITLE_ID}
    >
      <DialogContent className="flex flex-col items-center gap-4 pt-8! text-center">
        <span
          aria-hidden
          className={cn(
            "flex h-16 w-16 flex-none items-center justify-center rounded-full",
            tone === "done" ? "bg-success/15 text-success" : "bg-grey-50 text-text-secondary",
          )}
        >
          {tone === "done" ? <NiCheck size="large" /> : <NiInfoSquare size="large" />}
        </span>
        <Typography id={TITLE_ID} variant="h4" component="h2" className="mb-0">
          {title}
        </Typography>
        <Box component="ul" className="m-0 flex w-full list-none flex-col gap-3 p-0 text-left">
          {lines.map((line) => (
            <Box component="li" key={line.key} className="flex flex-row items-start gap-3">
              <span
                aria-hidden
                className="bg-grey-25 text-text-secondary flex h-9 w-9 flex-none items-center justify-center rounded-xl"
              >
                {line.icon}
              </span>
              <Typography variant="body1" component="span" className="text-text-primary min-w-0 flex-1 pt-1.5">
                {line.text}
              </Typography>
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions className="justify-center pb-6!">
        {/* Focused on open: closing it is Enter, and nothing else is asked. */}
        <Button variant="contained" color="primary" onClick={onClose} autoFocus className="min-w-40">
          {closeLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
