"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Box, Typography } from "@mui/material";

import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import NiCheck from "@/icons/nexture/ni-check";
import NiClock from "@/icons/nexture/ni-clock";
import NiCross from "@/icons/nexture/ni-cross";
import NiLoader from "@/icons/nexture/ni-loader";
import { cn } from "@/lib/utils";

export type ProgressStepState = "done" | "current" | "next" | "stopped";

export type ProgressStep = {
  key: string;
  /** The step in a word or two ("Assinatura"). */
  label: string;
  state: ProgressStepState;
  /** When it happened (done, stopped) or began (current), already in words; nothing when it is not known. */
  when?: string | null;
  /** What the step is, as an icon of the app's set. */
  icon: ReactNode;
};

// Under way is the palette's amber (the e-mail provider's "pending"), never its red, which the app keeps for risk
// and failure; done is the primary's tint; still to come is an outline.
const NODE: Record<ProgressStepState, string> = {
  done: "border-primary/25 bg-primary-light/10 text-primary",
  current: "border-accent-4/60 bg-accent-4-light/15 text-accent-4 ring-4 ring-accent-4-light/15",
  next: "border-grey-200 text-text-disabled",
  stopped: "border-grey-200 bg-grey-25 text-text-secondary",
};

const CHIP: Record<ProgressStepState, StatusTone> = {
  done: "neutral",
  current: "info",
  next: "neutral",
  stopped: "neutral",
};

/**
 * Where something stands along its way, at a glance: its steps in order, each with what it is, whether it is
 * done, under way or still to come, and when it happened (the owner, 2026-11-03, after the domain events of the
 * e-mail provider). Across the card from a tablet on, the steps joined by a line that fills as far as the way went;
 * on a phone, one under the other. A step that ended the way short of its end (a case that did not go on) is
 * `stopped`.
 *
 * Closest to `StatusChip` (each step's word is one) and to the timeline of a case (what happened, in order): the
 * timeline tells every event, this tells the few that mark the way. Pair it with `ProgressNow`, which says in a
 * sentence what happens at the step under way.
 */
export default function ProgressSteps({
  steps,
  label,
  stateWords,
  working = true,
  href,
}: {
  steps: ProgressStep[];
  /** What the steps are of, for assistive technology ("Andamento do caso"). */
  label: string;
  /** Each state in words, said to assistive technology beside each step. */
  stateWords: Record<ProgressStepState, string>;
  /**
   * Something is at work on the step under way now: its mark turns. A step that waits for somebody keeps its own
   * icon, in the colour of under way, so a turning mark never says work that is not happening.
   */
  working?: boolean;
  /** Where each step is done, for the steps that lead somewhere (a card of the screen). */
  href?: (step: ProgressStep) => string | null;
}) {
  const reached = Math.max(
    0,
    steps.reduce((last, step, index) => (step.state === "next" ? last : index), 0),
  );
  const filled = steps.length > 1 ? (reached / (steps.length - 1)) * 100 : 0;

  // The mark sits on the paper's own colour, its tint over it, so the line behind never shows through.
  const node = (step: ProgressStep) => (
    <span aria-hidden className="bg-background-paper relative z-10 flex h-10 w-10 flex-none rounded-xl">
      <span className={cn("flex h-full w-full items-center justify-center rounded-xl border", NODE[step.state])}>
        {step.state === "current" && working ? (
          <NiLoader size="small" className="animate-spin motion-reduce:animate-none" />
        ) : step.state === "stopped" ? (
          <NiCross size="small" />
        ) : step.state === "done" && step.key === steps[steps.length - 1]?.key ? (
          <NiCheck size="small" />
        ) : (
          step.icon
        )}
      </span>
    </span>
  );

  const words = (step: ProgressStep, align: "center" | "start") => (
    <Box className={cn("flex min-w-0 flex-col gap-1", align === "center" ? "items-center text-center" : "items-start")}>
      {step.state === "next" || align === "start" ? (
        // Still to come, and every step of the list a phone reads down: the word alone, the mark saying the state.
        <Typography
          variant="body2"
          className={cn(
            "font-semibold",
            step.state === "next" || step.state === "stopped" ? "text-text-secondary" : "text-text-primary",
          )}
        >
          {step.label}
        </Typography>
      ) : (
        <StatusChip label={step.label} tone={CHIP[step.state]} className="max-w-full" />
      )}
      <span className="sr-only">{stateWords[step.state]}</span>
      {step.when ? (
        <Typography variant="body2" className="text-text-secondary text-xs leading-4">
          {step.when}
        </Typography>
      ) : null}
    </Box>
  );

  return (
    <>
      {/* From a tablet on: across, the line behind the marks filled as far as the way went. */}
      <Box className="relative hidden md:block">
        <Box
          aria-hidden
          className="bg-grey-100 absolute top-5 h-0.5"
          style={{ left: `calc(100% / ${steps.length * 2})`, right: `calc(100% / ${steps.length * 2})` }}
        >
          <Box className="bg-primary/40 h-full" style={{ width: `${filled}%` }} />
        </Box>
        <Box
          component="ol"
          aria-label={label}
          className="relative m-0 grid list-none gap-2 p-0"
          style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
        >
          {steps.map((step) => {
            const to = href?.(step) ?? null;
            return (
              <Box
                component="li"
                key={step.key}
                aria-current={step.state === "current" ? "step" : undefined}
                className="flex flex-col items-center gap-2"
              >
                {to ? (
                  <a
                    href={to}
                    className="focus-visible:ring-primary flex flex-col items-center gap-2 rounded-xl no-underline outline-hidden focus-visible:ring-2"
                  >
                    {node(step)}
                    {words(step, "center")}
                  </a>
                ) : (
                  <>
                    {node(step)}
                    {words(step, "center")}
                  </>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* On a phone: one under the other, the line running down between the marks. */}
      <Box component="ol" aria-label={label} className="m-0 flex list-none flex-col p-0 md:hidden">
        {steps.map((step, index) => (
          <Box
            component="li"
            key={step.key}
            aria-current={step.state === "current" ? "step" : undefined}
            className="flex flex-row gap-3"
          >
            <Box className="flex flex-col items-center">
              {node(step)}
              {index < steps.length - 1 ? (
                <Box
                  aria-hidden
                  className={cn("my-1 min-h-3 w-0.5 flex-1", index < reached ? "bg-primary/40" : "bg-grey-100")}
                />
              ) : null}
            </Box>
            <Box className="pt-2 pb-3">{words(step, "start")}</Box>
          </Box>
        ))}
      </Box>
    </>
  );
}

/**
 * What happens now at the step under way, in a sentence, with who it is with: under `ProgressSteps`, as the
 * provider's banner says "looking for the DNS records". Tinted by how the way stands: under way, arrived, or
 * stopped short. Its `action` is the one thing the reader may do about it.
 */
export function ProgressNow({
  tone,
  lead,
  text,
  extra,
  action,
  working = true,
}: {
  tone: "progress" | "done" | "stopped";
  /** Under way and something is at work now: the mark turns; under way and waiting for somebody, a clock. */
  working?: boolean;
  /** Who it is with now, or the state in two words, said first and in bold. */
  lead: string;
  text: string;
  /** A second line: what ONE waits for, what is missing, the next date. */
  extra?: ReactNode;
  action?: ReactNode;
}) {
  const look = {
    progress: { box: "border-accent-4/40 bg-accent-4-light/15", icon: "text-accent-4" },
    done: { box: "border-success/30 bg-success/5", icon: "text-success" },
    stopped: { box: "border-grey-200 bg-grey-25", icon: "text-text-secondary" },
  }[tone];
  return (
    <Box
      role="status"
      className={cn("flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center", look.box)}
    >
      <Box className="flex min-w-0 flex-1 flex-row gap-3">
        <span aria-hidden className={cn("flex-none pt-0.5", look.icon)}>
          {tone === "progress" && working ? (
            <NiLoader size="medium" className="animate-spin motion-reduce:animate-none" />
          ) : tone === "progress" ? (
            <NiClock size="medium" />
          ) : tone === "done" ? (
            <NiCheck size="medium" />
          ) : (
            <NiCross size="medium" />
          )}
        </span>
        <Box className="flex min-w-0 flex-col gap-1">
          <Typography variant="body1">
            <strong>{lead}</strong> {text}
          </Typography>
          {extra}
        </Box>
      </Box>
      {action ? <Box className="flex-none self-start sm:self-auto">{action}</Box> : null}
    </Box>
  );
}

/**
 * The way in small, for a row of a list: one short bar per step, filled as far as the way went, the step under way
 * in amber and one where the way stopped in grey. Read by assistive technology as its `label`.
 */
export function ProgressBar({
  steps,
  reached,
  state,
  label,
}: {
  steps: number;
  /** The step the way is at (or stopped at, or the last once it arrived), from 0. */
  reached: number;
  state: "progress" | "done" | "stopped";
  label: string;
}) {
  return (
    <Box role="img" aria-label={label} className="flex flex-row gap-0.5">
      {Array.from({ length: steps }, (_, index) => (
        <span
          key={index}
          className={cn(
            "h-1 w-3 rounded-full",
            index < reached || (state === "done" && index === reached)
              ? "bg-primary/60"
              : index === reached
                ? state === "stopped"
                  ? "bg-grey-300"
                  : "bg-accent-4"
                : "bg-grey-100",
          )}
        />
      ))}
    </Box>
  );
}

export type ProgressCount = {
  key: string;
  label: string;
  icon: ReactNode;
  count: number;
  /** Where the things of the step are listed. */
  href: string;
  /** The step and its count in words, for assistive technology ("Documentos, 4 casos"). */
  countLabel: string;
};

/**
 * How many things are at each step of a way, at a glance: the same steps and marks as `ProgressSteps`, each with
 * its count instead of a day, a link to where they are listed. A step with something in it is tinted, an empty
 * one outlined; across from a tablet on, one under the other on a phone. What the home shows of the firm's cases
 * (the owner, 2026-11-03), beside what each case shows of itself.
 */
export function ProgressCounts({ steps, label }: { steps: ProgressCount[]; label: string }) {
  const mark = (step: ProgressCount) => (
    <span aria-hidden className="bg-background-paper relative z-10 flex h-10 w-10 flex-none rounded-xl">
      <span
        className={cn(
          "flex h-full w-full items-center justify-center rounded-xl border",
          step.count > 0 ? "border-primary/25 bg-primary-light/10 text-primary" : "border-grey-200 text-text-disabled",
        )}
      >
        {step.icon}
      </span>
    </span>
  );
  const link = "rounded-xl no-underline outline-offset-2 transition-colors hover:bg-grey-25 focus-visible:outline-2";
  return (
    <>
      <Box className="relative hidden md:block">
        <Box
          aria-hidden
          className="bg-grey-100 absolute top-7 h-0.5"
          style={{ left: `calc(100% / ${steps.length * 2})`, right: `calc(100% / ${steps.length * 2})` }}
        />
        <Box
          component="ol"
          aria-label={label}
          className="relative m-0 grid list-none gap-1 p-0"
          style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
        >
          {steps.map((step) => (
            <Box component="li" key={step.key} className="flex">
              <Box
                component={Link}
                href={step.href}
                aria-label={step.countLabel}
                className={cn("flex w-full flex-col items-center gap-1.5 px-1 py-2 text-center", link)}
              >
                {mark(step)}
                <Typography variant="h5" component="span" className="text-text-primary mb-0 leading-6">
                  {step.count}
                </Typography>
                <Typography variant="body2" component="span" className="text-text-secondary leading-4">
                  {step.label}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      <Box component="ol" aria-label={label} className="m-0 flex list-none flex-col p-0 md:hidden">
        {steps.map((step, index) => (
          <Box component="li" key={step.key} className="flex flex-row gap-3">
            <Box className="flex flex-col items-center">
              {mark(step)}
              {index < steps.length - 1 ? <Box aria-hidden className="bg-grey-100 my-1 min-h-3 w-0.5 flex-1" /> : null}
            </Box>
            <Box
              component={Link}
              href={step.href}
              aria-label={step.countLabel}
              className={cn("mb-2 flex flex-1 flex-row items-center justify-between gap-3 px-2 py-2", link)}
            >
              <Typography variant="body2" component="span" className="text-text-primary font-semibold">
                {step.label}
              </Typography>
              <Typography variant="h6" component="span" className="text-text-primary mb-0">
                {step.count}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </>
  );
}

export type ProgressListRow = {
  key: string;
  href: string;
  /** What the row is: a case's number and client, a passenger's name. */
  title: string;
  /** Under it, in small: what kind of thing it is, since when. */
  detail?: string | null;
  /** The step it is at, in a word or two. */
  step: string;
  /** Its way in small (`ProgressBar`): how many steps, the one it is at, and how it stands. */
  steps: number;
  reached: number;
  state: "progress" | "done" | "stopped";
  /** The way in words, for assistive technology ("Peça, etapa 4 de 9"). */
  label: string;
};

/**
 * A few things along their way, one line each (the owner, 2026-11-03): what it is with a word under it, and on the
 * right the step it is at with its way in small; the whole line leads to it. The latest few of a list on a home,
 * where `ProgressSteps` would take a card for each and a table would be too much; the list itself is one click
 * further, under it.
 *
 * Closest catalog entries: `ProgressBar`, which it carries on each line, and the rows of the case list, which show
 * the same bar under a case's stage; this is their short form, for a home.
 */
export function ProgressList({ rows, label }: { rows: ProgressListRow[]; label: string }) {
  return (
    <Box component="ul" aria-label={label} className="divide-grey-100 m-0 flex list-none flex-col divide-y p-0">
      {rows.map((row) => (
        <Box component="li" key={row.key}>
          <Box
            component={Link}
            href={row.href}
            className="hover:bg-grey-25 -mx-2 flex flex-row items-center gap-3 rounded-xl px-2 py-2.5 no-underline outline-offset-2 transition-colors focus-visible:outline-2"
          >
            <Box className="flex min-w-0 flex-1 flex-col">
              <Typography variant="body2" component="span" className="text-text-primary truncate font-semibold">
                {row.title}
              </Typography>
              {row.detail ? (
                <Typography variant="caption" component="span" className="text-text-secondary truncate">
                  {row.detail}
                </Typography>
              ) : null}
            </Box>
            <Box className="flex flex-none flex-col items-end gap-1">
              <Typography variant="body2" component="span" className="text-text-primary">
                {row.step}
              </Typography>
              <ProgressBar steps={row.steps} reached={row.reached} state={row.state} label={row.label} />
            </Box>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
