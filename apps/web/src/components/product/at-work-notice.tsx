"use client";

import { Box, Button, CircularProgress, Dialog, DialogContent, Typography, useMediaQuery } from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import NiClock from "@/icons/nexture/ni-clock";
import NiSparkle from "@/icons/nexture/ni-sparkle";
import { cn } from "@/lib/utils";

const TITLE_ID = "at-work-notice-title";
const TEXT_ID = "at-work-notice-text";

/** A step of the work: what was done, what is under way, and what always follows. */
export type AtWorkStep = { key: string; state: "done" | "doing" | "next"; label: string; detail: string };

/**
 * The notice that holds a screen while the product works on the record it shows (the screen pattern after ADVBox,
 * approved by the owner on 2026-11-07): over the page under a veil, a ring that turns while the work goes on, what
 * the product is doing in one title, one line of what happens (the screen comes back by itself, read again), and
 * the steps, each with its mark: done (green, a check), under way (amber, a clock, how long), and what always
 * follows (grey, "next"). The time it started closes it. It is never closed by the person while the work is short:
 * the record is changing under them. From about two minutes on (`long`), it says the work is taking longer than
 * usual, its ring stops, and two buttons give the screen back: go on without waiting (what the work ends with shows
 * by itself later) or wait more; the first takes the focus.
 *
 * It holds only for the product's own work, which takes seconds or minutes, never for a wait on a person or an
 * outside party; the screen that mounts it decides that, and keeps it closed while the person is typing elsewhere.
 * Closest catalog entries: `OutcomeDialog`, which says what an act changed once it ended; and `ProgressNow`, a way
 * of several steps said in a card, which holds nothing.
 */
export default function AtWorkNotice({
  open,
  long,
  title,
  text,
  steps,
  footer,
  continueLabel,
  waitLabel,
  onContinue,
  onWaitMore,
  className,
}: {
  open: boolean;
  /** The work took longer than usual: the notice says so and offers the screen back. */
  long: boolean;
  /** What the product is doing, in one line ("O ONE está trabalhando neste caso"). */
  title: string;
  /** What happens now: wait, and the screen comes back by itself; or, when long, the person may go on. */
  text: string;
  steps: AtWorkStep[];
  /** When the work started ("Começou às 14:31."), said while it is short. */
  footer?: string | null;
  continueLabel: string;
  waitLabel: string;
  onContinue: () => void;
  onWaitMore: () => void;
  /** A class on the modal, so the screen that mounts it can tell it from its other windows. */
  className?: string;
}) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  return (
    <Dialog
      open={open}
      className={className}
      // Nothing closes it but its own buttons, Escape and the veil included: while the work is short, the record is
      // changing under the person.
      onClose={() => undefined}
      maxWidth="xs"
      fullWidth
      transitionDuration={reduceMotion ? 0 : undefined}
      slotProps={{
        paper: { role: "alertdialog", "aria-labelledby": TITLE_ID, "aria-describedby": TEXT_ID, "aria-modal": true },
      }}
    >
      <DialogContent className="flex flex-col gap-3.5 p-6! sm:p-7!">
        <Box className="flex flex-row items-center gap-3.5">
          <Box aria-hidden className="relative flex h-12 w-12 flex-none items-center justify-center">
            <CircularProgress
              variant="determinate"
              value={100}
              size={48}
              thickness={4}
              className="text-grey-100 absolute inset-0"
            />
            {long ? (
              <CircularProgress
                variant="determinate"
                value={25}
                size={48}
                thickness={4}
                className="text-accent-4 absolute inset-0"
              />
            ) : (
              <CircularProgress
                variant={reduceMotion ? "determinate" : "indeterminate"}
                value={25}
                size={48}
                thickness={4}
                className="text-primary absolute inset-0"
              />
            )}
            <span className={cn("relative flex", long ? "text-accent-4" : "text-primary")}>
              {long ? <NiClock size="medium" /> : <NiSparkle size="medium" />}
            </span>
          </Box>
          <Typography id={TITLE_ID} variant="h5" component="h2" className="mb-0">
            {title}
          </Typography>
        </Box>
        <Typography id={TEXT_ID} variant="body2" className="text-text-secondary">
          {text}
        </Typography>

        {steps.length > 0 ? (
          <Box
            component="ul"
            aria-live="polite"
            className="border-grey-100 m-0 flex list-none flex-col border-t p-0 pt-1.5"
          >
            {steps.map((step) => (
              <Box component="li" key={step.key} className="flex flex-row items-start gap-3 py-2">
                <span
                  aria-hidden
                  className={cn(
                    "flex h-7 w-7 flex-none items-center justify-center rounded-full",
                    step.state === "done" && "bg-success/15 text-success",
                    step.state === "doing" && "bg-accent-4-light/20 text-accent-4",
                    step.state === "next" && "bg-grey-50",
                  )}
                >
                  {step.state === "done" ? (
                    <NiCheck size="small" />
                  ) : step.state === "doing" ? (
                    <NiClock size="small" />
                  ) : (
                    <span className="bg-grey-200 h-2 w-2 rounded-full" />
                  )}
                </span>
                <Box className="flex min-w-0 flex-col">
                  <Typography
                    variant="body2"
                    component="span"
                    className={cn("font-bold", step.state === "next" ? "text-text-secondary" : "text-text-primary")}
                  >
                    {step.label}
                  </Typography>
                  <Typography variant="caption" component="span" className="text-text-secondary">
                    {step.detail}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        ) : null}

        {long ? (
          <Box className="flex flex-row flex-wrap items-center gap-2.5 pt-1">
            {/* Once the screen may be given back, the way to take it is where the keyboard is. */}
            <Button variant="contained" color="primary" onClick={onContinue} autoFocus>
              {continueLabel}
            </Button>
            <Button variant="text" color="grey" onClick={onWaitMore}>
              {waitLabel}
            </Button>
          </Box>
        ) : footer ? (
          <Typography variant="caption" className="text-text-secondary">
            {footer}
          </Typography>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
