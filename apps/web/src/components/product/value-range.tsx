"use client";

import { Box, Typography } from "@mui/material";

import { cn } from "@/lib/utils";

/**
 * Where a value usually falls (the forecast of a case, 0250): a grey track from zero to the scale's end, the band where
 * the middle half of the values lie (the first to the third quartile), the median as a tick and, when given, a marker
 * for one value placed among them (an airline's offer at a hearing). Closest to `UsageMeter` (a bar of the same height
 * and tones); nothing in the catalog drew a spread with a point inside it. The words under it say the numbers, so the
 * bar is never read by colour alone.
 */
export default function ValueRange({
  low,
  median,
  high,
  max,
  marker,
  format,
  caption,
  ariaLabel,
  className,
}: {
  /** The first quartile, in cents. */
  low: number;
  /** The median, in cents. */
  median: number;
  /** The third quartile, in cents. */
  high: number;
  /** The scale's end, in cents; by default a quarter past the highest value drawn. */
  max?: number;
  /** One value placed among them, with its words above it. */
  marker?: { cents: number; label: string } | null;
  format: (cents: number) => string;
  /** The words under the bar, between the quartiles (what the band is). */
  caption: string;
  ariaLabel: string;
  className?: string;
}) {
  const end = Math.max(max ?? Math.max(high, marker?.cents ?? 0) * 1.25, 1);
  const at = (cents: number) => `${Math.min(Math.max((cents / end) * 100, 0), 100)}%`;
  return (
    <Box className={cn("flex flex-col gap-1", className)}>
      <Box role="img" aria-label={ariaLabel} className={cn("relative w-full", marker ? "h-12" : "h-6")}>
        {marker ? (
          <Box
            className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
            style={{ left: at(marker.cents) }}
          >
            <Typography
              component="span"
              variant="caption"
              className="bg-accent-3 text-text-contrast rounded-md px-2 py-0.5 font-semibold whitespace-nowrap"
            >
              {marker.label}
            </Typography>
            <Box aria-hidden className="border-t-accent-3 h-0 w-0 border-x-[6px] border-t-[7px] border-x-transparent" />
          </Box>
        ) : null}
        <Box aria-hidden className="bg-grey-100 absolute bottom-2 h-2.5 w-full rounded-full" />
        <Box
          aria-hidden
          className="bg-primary/35 absolute bottom-2 h-2.5 rounded-full"
          style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }}
        />
        <Box
          aria-hidden
          className="bg-primary absolute bottom-0.5 h-5 w-1 -translate-x-1/2 rounded-full"
          style={{ left: at(median) }}
        />
      </Box>
      <Box className="flex flex-row items-baseline justify-between gap-2">
        <Typography variant="caption" className="text-text-secondary tabular-nums">
          {format(low)}
        </Typography>
        <Typography variant="caption" className="text-text-secondary text-center">
          {caption}
        </Typography>
        <Typography variant="caption" className="text-text-secondary tabular-nums">
          {format(high)}
        </Typography>
      </Box>
    </Box>
  );
}
