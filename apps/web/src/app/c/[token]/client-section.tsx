"use client";

import { createContext, type ReactNode, type Ref, useContext } from "react";

import { Box, Card, CardContent, Typography } from "@mui/material";

import InfoHint from "@/components/product/info-hint";
import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import { cn } from "@/lib/utils";

/**
 * The frame every section of the client's page is drawn in (the owner, 2026-11-13, who approved the proposal for the
 * page: three ways of heading a card, six weights of button and texts in sight that belonged behind an "i"). One head
 * for every card: what leads it (the step's number, or the icon of what it is), its title, the "i" with what it is
 * for, and one chip. A section alone is its own card; inside a step or a line of "Já feito" it draws its content
 * alone, with its title as a sub-heading where the step holds several sections ("Suas respostas").
 *
 * Closest catalog entries: `CardTitle` (an icon tile, a title, a chip) and `CollapsibleCard` (one state per head);
 * neither numbers a step nor lets a section give up its own card inside another.
 */

type Frame = { bare: boolean; titles: boolean };
const FrameContext = createContext<Frame>({ bare: false, titles: false });

/** Inside it, a section draws its content alone; with `titles`, its title as a sub-heading. */
export function SectionFrame({ titles = false, children }: { titles?: boolean; children: ReactNode }) {
  return <FrameContext.Provider value={{ bare: true, titles }}>{children}</FrameContext.Provider>;
}

/** The head of a card: what leads it, the title, the "i", the chip. */
export function CardHead({
  id,
  lead,
  title,
  hint,
  chip,
  as = "h2",
}: {
  id: string;
  lead?: ReactNode;
  title: string;
  hint?: string;
  chip?: ReactNode;
  as?: "h2" | "h3";
}) {
  return (
    <Box className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      {lead}
      <Box className="flex min-w-0 flex-1 items-center gap-1">
        <Typography
          id={id}
          variant={as === "h2" ? "h6" : "subtitle1"}
          component={as}
          className="mb-0 min-w-0 font-semibold break-words"
        >
          {title}
        </Typography>
        {hint ? <InfoHint label={hint} placement="bottom-start" className="self-center" /> : null}
      </Box>
      {chip ? <Box className="flex-none">{chip}</Box> : null}
    </Box>
  );
}

/** The icon of what a card is, on its tint. */
export function IconLead({ icon, tone = "primary" }: { icon: ReactNode; tone?: TileTone | "grey" | "done" }) {
  const look =
    tone === "grey"
      ? "bg-grey-50 text-text-primary"
      : tone === "done"
        ? "bg-success/10 text-success"
        : cn(TILE_TONE[tone].bg, TILE_TONE[tone].text);
  return (
    <Box aria-hidden className={cn("flex h-9 w-9 flex-none items-center justify-center rounded-lg", look)}>
      {icon}
    </Box>
  );
}

/** A step's number, in a circle. */
export function NumberLead({ number }: { number: number }) {
  return (
    <Box
      aria-hidden
      className="bg-primary text-text-contrast flex h-7 w-7 flex-none items-center justify-center rounded-full text-sm font-bold"
    >
      {number}
    </Box>
  );
}

/**
 * A section of the client's page: its own card, or its content alone inside a step. `hint` is what it is for (behind
 * the "i"); `lead` what must be read before answering (the civil court, free justice), in sight under the title.
 */
export function ClientSection({
  id,
  title,
  hint,
  lead,
  chip,
  icon,
  tone,
  gap = 4,
  cardRef,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  lead?: ReactNode;
  chip?: ReactNode;
  icon?: ReactNode;
  tone?: TileTone;
  gap?: 3 | 4;
  cardRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const frame = useContext(FrameContext);
  const leadText = lead ? (
    <Typography variant="body2" component="div" className="text-text-primary">
      {lead}
    </Typography>
  ) : null;
  if (frame.bare) {
    return (
      <Box
        ref={cardRef}
        component="section"
        aria-labelledby={frame.titles ? id : undefined}
        className={cn(
          "flex flex-col",
          gap === 3 ? "gap-3" : "gap-4",
          frame.titles && "border-grey-100 border-t pt-4 first:border-t-0 first:pt-0",
        )}
      >
        {frame.titles ? <CardHead id={id} title={title} hint={hint} chip={chip} as="h3" /> : null}
        {leadText}
        {children}
      </Box>
    );
  }
  return (
    <Card ref={cardRef} component="section" aria-labelledby={id}>
      <CardContent className={cn("flex flex-col", gap === 3 ? "gap-3" : "gap-4")}>
        <CardHead
          id={id}
          lead={icon ? <IconLead icon={icon} tone={tone} /> : undefined}
          title={title}
          hint={hint}
          chip={chip}
        />
        {leadText}
        {children}
      </CardContent>
    </Card>
  );
}

/** A step the client owes, numbered in the order of the case, holding its sections. */
export function StepCard({
  id,
  number,
  title,
  hint,
  chip,
  titles = false,
  children,
}: {
  id: string;
  number: number;
  title: string;
  hint?: string;
  chip?: ReactNode;
  /** The step holds several sections, each under its own sub-heading. */
  titles?: boolean;
  children: ReactNode;
}) {
  return (
    <Card component="section" aria-labelledby={id}>
      <CardContent className="flex flex-col gap-4">
        <CardHead id={id} lead={<NumberLead number={number} />} title={title} hint={hint} chip={chip} />
        <SectionFrame titles={titles}>{children}</SectionFrame>
      </CardContent>
    </Card>
  );
}
