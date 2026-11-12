"use client";

import { Box, CircularProgress, Typography } from "@mui/material";

import { type TileTone } from "@/components/product/tile-tone";
import { cn } from "@/lib/utils";

/** The ring's colour by the tone of what it measures (the hues go on the ring, the words keep text colours). */
const RING: Record<TileTone, string> = {
  primary: "text-primary",
  secondary: "text-secondary",
  "accent-1": "text-accent-1",
  "accent-2": "text-accent-2",
  "accent-3": "text-accent-3",
  "accent-4": "text-accent-4",
};

/**
 * One ratio at a glance beside its x/y (the catalog's "Medidor circular", ported for the people's funnel, the owner,
 * 2026-11-12): a ring on a grey track, filled by the share, with the percentage in its centre. No chart library: MUI's
 * determinate CircularProgress over a full one in grey. A share of nothing (`total` 0) draws no ring.
 *
 * Closest catalog entries: `UsageMeter`, a bar of used against remaining, and `MetricBars`, shares of one whole in
 * rows; neither reads as one number at a glance in the corner of a card.
 */
export default function RatioGauge({
  value,
  total,
  tone = "primary",
  size = 56,
  label,
  className,
}: {
  value: number;
  total: number;
  tone?: TileTone;
  size?: number;
  /** What the ring says to assistive technology ("1 de 3 pessoas, 33%"). */
  label: string;
  className?: string;
}) {
  if (total <= 0) return null;
  const share = Math.min(100, Math.max(0, Math.round((value / total) * 100)));
  return (
    <Box
      role="img"
      aria-label={label}
      className={cn("relative inline-flex flex-none items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <CircularProgress
        aria-hidden
        variant="determinate"
        value={100}
        size={size}
        thickness={3}
        className="text-grey-100 absolute inset-0"
      />
      <CircularProgress
        aria-hidden
        variant="determinate"
        // A part that exists keeps a sliver, so "small" never reads as "none".
        value={value > 0 ? Math.max(share, 3) : 0}
        size={size}
        thickness={3}
        className={cn("absolute inset-0", RING[tone])}
        sx={{ "& .MuiCircularProgress-circle": { strokeLinecap: "round" } }}
      />
      <Typography aria-hidden variant="caption" component="span" className="text-text-secondary tabular-nums">
        {share}%
      </Typography>
    </Box>
  );
}
