"use client";

import type { ReactNode } from "react";

import { Box, Chip, Typography } from "@mui/material";

import { cn } from "@/lib/utils";

/**
 * Tones shared with `UsageMeter` so a bar means the same thing wherever it
 * appears. `attention` is terracotta, never red: red stays reserved for
 * clinical risk and failure (docs/DESIGN.md), and a queue that grew is
 * neither.
 */
export type MetricBarTone = "primary" | "secondary" | "attention" | "empty";

export type MetricBarItem = {
  key: string;
  label: string;
  value: number;
  tone?: MetricBarTone;
  /** Optional one-line note under the label (whose side the queue is on). */
  hint?: string;
  /**
   * Optional control that acts on this part, under its bar (e.g. "send now" to
   * the people a count has not reached). One per row at most: a row is a
   * counter first.
   */
  action?: ReactNode;
};

const BAR_TONE: Record<MetricBarTone, string> = {
  primary: "bg-primary",
  secondary: "bg-secondary",
  attention: "bg-accent-3",
  empty: "bg-grey-100",
};

/**
 * The template's Application Status block (dashboards/analytics/sections/
 * dashboard-analytics-app-status.tsx): one row per part, each with its count
 * and a 2px bar whose width is that part's share of the whole.
 *
 * Use it wherever a handful of counters describe one population. A run-on
 * sentence — "12 finalizados · 3 rascunhos · 8 esperando revisão" — makes the
 * reader hold five numbers and divide them in their head; the bars answer
 * "which part is big" before a single number is read. Two to six parts is the
 * range where this beats a donut; past that, the bars get too thin to compare.
 *
 * No chart library: it is two boxes and a width, exactly as the template does.
 */
export default function MetricBars({
  items,
  /** Denominator for the share. Defaults to the sum of the items. */
  total,
  /** Template rhythm by default; `dense` for stacked groups inside a dialog. */
  spacing = "normal",
  /**
   * False for counters that share no whole (what a dossier holds: people, acceptances, signatures). Each
   * row is then its label and its count: no bar and no share, which would compare things that are not
   * parts of one thing.
   */
  whole = true,
}: {
  items: MetricBarItem[];
  total?: number;
  spacing?: "normal" | "dense";
  whole?: boolean;
}) {
  const sum = total ?? items.reduce((acc, item) => acc + Math.max(0, item.value), 0);

  return (
    <Box className={cn("flex flex-col", spacing === "dense" ? "gap-3" : "gap-5")}>
      {items.map((item) => {
        // A part that exists must stay visible: a 1-in-400 share still gets a
        // sliver, so "small" never renders as "none".
        const share = sum > 0 ? (Math.max(0, item.value) / sum) * 100 : 0;
        return (
          <Box key={item.key} className="flex flex-col gap-2">
            <Box className="flex flex-row items-center justify-between gap-2">
              <Box className="min-w-0">
                <Typography variant="subtitle2" className="text-text-primary">
                  {item.label}
                </Typography>
                {item.hint && (
                  <Typography variant="body2" className="text-text-secondary">
                    {item.hint}
                  </Typography>
                )}
              </Box>
              <Chip
                label={whole && sum > 0 ? `${item.value}/${sum}` : String(item.value)}
                variant="outlined"
                size="small"
                className="flex-none tabular-nums"
              />
            </Box>
            {whole ? (
              <Box className="bg-grey-50 h-0.5 w-full">
                <Box
                  className={cn("h-0.5", BAR_TONE[item.tone ?? "primary"])}
                  style={{ width: `${item.value > 0 ? Math.max(1, share) : 0}%` }}
                />
              </Box>
            ) : null}
            {item.action ? <Box className="flex flex-row flex-wrap items-center gap-2">{item.action}</Box> : null}
          </Box>
        );
      })}
    </Box>
  );
}
