"use client";

import type { ReactNode } from "react";

import { Box, Button, CircularProgress, Dialog, DialogContent, Typography, useMediaQuery } from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import NiClock from "@/icons/nexture/ni-clock";
import NiSparkle from "@/icons/nexture/ni-sparkle";
import { cn } from "@/lib/utils";

const ID = "at-work-notice";

/** A step of the work: what was done, what is under way, and what always follows. */
export type AtWorkStep = { key: string; state: "done" | "doing" | "next"; label: string; detail?: string };

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
 * of several steps said in a card, which holds nothing. Its body is `AtWorkBody`, which a panel the person opened
 * on that work draws in place (the model ONE makes from a document).
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
        paper: {
          role: "alertdialog",
          "aria-labelledby": `${ID}-title`,
          "aria-describedby": `${ID}-text`,
          "aria-modal": true,
        },
      }}
    >
      <DialogContent className="p-6! sm:p-7!">
        <AtWorkBody
          id={ID}
          long={long}
          title={title}
          text={text}
          steps={steps}
          footer={long ? null : footer}
          actions={
            long ? (
              <>
                {/* Once the screen may be given back, the way to take it is where the keyboard is. */}
                <Button variant="contained" color="primary" onClick={onContinue} autoFocus>
                  {continueLabel}
                </Button>
                <Button variant="text" color="grey" onClick={onWaitMore}>
                  {waitLabel}
                </Button>
              </>
            ) : null
          }
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * What the product is doing, drawn where the person is: the ring that turns while the work goes on (stopped, with a
 * clock, when it waits: `long`), the title, one line of what happens, the steps with their marks, and a foot with
 * when it started and what the person may do. `AtWorkNotice` holds a screen with it; a panel the person opened on
 * the work (the model ONE makes from a document, in the library and in the setup's step of the papers) draws it in
 * place, `compact`, where a still list of steps had left the person unsure anything was happening (2026-11-21).
 */
export function AtWorkBody({
  id,
  long,
  title,
  text,
  steps,
  footer,
  actions,
  compact = false,
  headingAs = "h2",
  className,
}: {
  /** The prefix of the title's and the text's ids (`<id>-title`, `<id>-text`). */
  id: string;
  long: boolean;
  title: string;
  text?: ReactNode;
  steps: AtWorkStep[];
  footer?: ReactNode;
  /** What the person may do about the work, at its foot. */
  actions?: ReactNode;
  /** Inside a panel: the ring and the title smaller. */
  compact?: boolean;
  headingAs?: "h2" | "h3";
  className?: string;
}) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const ring = compact ? 40 : 48;

  return (
    <Box className={cn("flex flex-col gap-3.5", className)}>
      <Box className="flex flex-row items-center gap-3.5">
        <Box
          aria-hidden
          className="relative flex flex-none items-center justify-center"
          style={{ width: ring, height: ring }}
        >
          <CircularProgress
            variant="determinate"
            value={100}
            size={ring}
            thickness={4}
            className="text-grey-100 absolute inset-0"
          />
          {long ? (
            <CircularProgress
              variant="determinate"
              value={25}
              size={ring}
              thickness={4}
              className="text-accent-4 absolute inset-0"
            />
          ) : (
            <CircularProgress
              variant={reduceMotion ? "determinate" : "indeterminate"}
              value={25}
              size={ring}
              thickness={4}
              className="text-primary absolute inset-0"
            />
          )}
          <span className={cn("relative flex", long ? "text-accent-4" : "text-primary")}>
            {long ? <NiClock size={compact ? "small" : "medium"} /> : <NiSparkle size={compact ? "small" : "medium"} />}
          </span>
        </Box>
        <Typography
          id={`${id}-title`}
          variant={compact ? "subtitle1" : "h5"}
          component={headingAs}
          className={cn("mb-0 min-w-0 break-words", compact && "font-semibold")}
        >
          {title}
        </Typography>
      </Box>
      {text ? (
        <Typography id={`${id}-text`} variant="body2" component="div" className="text-text-secondary">
          {text}
        </Typography>
      ) : null}

      {steps.length > 0 ? (
        <Box
          component="ul"
          aria-live="polite"
          className="border-grey-100 m-0 flex list-none flex-col border-t p-0 pt-1.5"
        >
          {steps.map((step) => (
            <Box
              component="li"
              key={step.key}
              aria-current={step.state === "doing" ? "step" : undefined}
              className="flex flex-row items-start gap-3 py-2"
            >
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
              <Box className="flex min-w-0 flex-col pt-0.5">
                <Typography
                  variant="body2"
                  component="span"
                  className={cn("font-bold", step.state === "next" ? "text-text-secondary" : "text-text-primary")}
                >
                  {step.label}
                </Typography>
                {step.detail ? (
                  <Typography variant="caption" component="span" className="text-text-secondary">
                    {step.detail}
                  </Typography>
                ) : null}
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}

      {footer || actions ? (
        <Box className="flex flex-row flex-wrap items-center gap-2.5 pt-1">
          {footer ? (
            <Typography variant="caption" component="div" className="text-text-secondary min-w-0 flex-1">
              {footer}
            </Typography>
          ) : null}
          {actions}
        </Box>
      ) : null}
    </Box>
  );
}
