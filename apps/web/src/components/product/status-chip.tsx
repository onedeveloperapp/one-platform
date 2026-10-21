"use client";

import { Button } from "@mui/material";

import { cn } from "@/lib/utils";

/**
 * What a lifecycle state means, not which colour it is. `attention` is the
 * accent the meters already use for "look at this" (never red); `danger` is
 * red and stays reserved for a failure or something taken away.
 */
export type StatusTone = "neutral" | "primary" | "positive" | "attention" | "info" | "danger";

const TONE_COLOR: Record<StatusTone, "grey" | "primary" | "success" | "accent-3" | "accent-4" | "error"> = {
  neutral: "grey",
  primary: "primary",
  positive: "success",
  attention: "accent-3",
  info: "accent-4",
  danger: "error",
};

/**
 * A lifecycle state as a NAMED badge: a module version (rascunho, publicada,
 * retirada), a meeting, a roadmap item, a subscription. The template's own
 * badge idiom, a tiny pastel button rendered as a span: it is a label, not a
 * control, so it takes no focus and reads as plain text.
 *
 * Closest template section: the pastel status badge of the inherited agenda
 * (`git show ab2e84d:apps/web/src/components/product/consultation-status-chip.tsx`),
 * generalised to any state and any label.
 *
 * The tone lives in the tint; the word is always `text-primary`. The pastel
 * variant paints its label in the tone itself, which this palette cannot carry
 * as text (measured 2.4:1 for the primary on its own tint), and a state must
 * never depend on colour alone anyway.
 */
export default function StatusChip({
  label,
  tone = "neutral",
  className,
}: {
  /** The state, in words. */
  label: string;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <Button
      component="span"
      role="presentation"
      tabIndex={-1}
      size="tiny"
      variant="pastel"
      color={TONE_COLOR[tone]}
      className={cn("text-text-primary! pointer-events-none flex-none whitespace-nowrap", className)}
    >
      {label}
    </Button>
  );
}
