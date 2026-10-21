"use client";

import { useLocale, useTranslations } from "next-intl";

import { Box, Typography, useTheme } from "@mui/material";
import { SparkLineChart } from "@mui/x-charts";

import useHighlightedSparkline from "@/hooks/use-highlighted-sparkline";
import NiTriangleDown from "@/icons/nexture/ni-triangle-down";
import NiTriangleUp from "@/icons/nexture/ni-triangle-up";

/**
 * The template's stat-with-sparkline (dashboards/default/sections/
 * dashboard-default-stats.tsx): the highlighted point's value in `h5`, its
 * change against the previous point, and the series drawn underneath. Hovering
 * moves the highlight, so every point is readable without a table.
 *
 * Use it when the payload already carries a SERIES. A trend answers "is this
 * going up or down", which a single number cannot — but only when there are
 * real points behind it; never synthesize one to decorate a screen.
 *
 * The text is the accessible reading: the value, then the change spelled out
 * for screen readers ("Queda de 8,3% sobre o ponto anterior") while the eye
 * gets the triangle. The drawing is a pointer aid, hidden from assistive
 * technology with the chart's keyboard layer turned off, because that layer
 * announces an unnamed image until a point is focused.
 *
 * Only the triangle carries the hue; the change figure stays in the secondary
 * text colour, because the accent tones are icon and fill colours and fall
 * under the contrast floor as small text. A decline takes accent-3 rather than
 * red: red belongs to risk and failure, and a falling count is a signal to
 * act, not a failure.
 */
export default function TrendSparkline({
  label,
  data,
  plotType = "bar",
  /** Formats the highlighted value, e.g. minutes or currency. */
  formatValue,
  caption,
  tone = "primary",
}: {
  label: string;
  /** At least one point. An empty series must not reach this component. */
  data: number[];
  plotType?: "line" | "bar";
  formatValue?: (value: number) => string;
  caption?: string;
  tone?: "primary" | "secondary";
}) {
  const { palette } = useTheme();
  const locale = useLocale();
  const t = useTranslations("product");
  // The hook derives its y-axis from the data, so a defensive floor keeps an
  // accidental empty series from producing -Infinity instead of a chart.
  const series = data.length > 0 ? data : [0];
  const sparkline = useHighlightedSparkline({
    data: series,
    plotType,
    color: tone === "secondary" ? palette.secondary.main : palette.primary.main,
  });

  const change = Number(sparkline.item.change);
  const rising = change > 0;
  const falling = change < 0;
  const changeText = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(
    Math.abs(change) / 100,
  );

  return (
    <Box className="flex flex-col gap-2">
      <Box className="flex flex-col">
        <Typography variant="body1" className="text-text-secondary leading-5">
          {label}
        </Typography>
        <Box className="flex flex-row items-center gap-2">
          <Typography variant="h5" component="p" className="text-text-primary tabular-nums">
            {formatValue ? formatValue(sparkline.item.value) : sparkline.item.value}
          </Typography>
          {(rising || falling) && (
            <Box className="flex flex-row items-center">
              {rising ? (
                <NiTriangleUp className="text-success" size="medium" />
              ) : (
                <NiTriangleDown className="text-accent-3" size="medium" />
              )}
              <Typography variant="body2" className="text-text-secondary tabular-nums">
                <span className="sr-only">{t(rising ? "trend-rising" : "trend-falling", { value: changeText })}</span>
                <span aria-hidden="true">{changeText}</span>
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
      <Box aria-hidden="true">
        <SparkLineChart {...sparkline.props} disableKeyboardNavigation />
      </Box>
      {caption && (
        <Typography variant="body2" className="text-text-secondary">
          {caption}
        </Typography>
      )}
    </Box>
  );
}
