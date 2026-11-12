"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, Button, Card, Typography } from "@mui/material";

import { TILE_TONE } from "@/components/product/tile-tone";
import NiRobot from "@/icons/nexture/ni-robot";
import { durationOf, type OneWorkTotals, saysOneWork } from "@/lib/one-work/work";
import { cn } from "@/lib/utils";

/**
 * One line of what ONE did this month (phase 2 of the plan of the controladoria): "Neste mês, o ONE fez N tarefas pelo
 * escritório, cerca de X horas pelas estimativas do escritório", one click from the page that says it whole. The same
 * total the page shows for the month, of the firm or of one module. With nothing done it says nothing; with only test
 * cases done, it says so.
 */
export default function OneWorkLine({
  totals,
  href,
  scope = "firm",
}: {
  totals: OneWorkTotals;
  /** The page of ONE's work, with the same cut (the module). */
  href: string;
  scope?: "firm" | "module";
}) {
  const t = useTranslations("product");
  if (!saysOneWork(totals)) return null;
  const duration = durationOf(totals.minutes);
  const about =
    duration.unit === "hours"
      ? t("one-work-hours", { count: duration.value })
      : t("one-work-minutes", { count: duration.value });
  const style = TILE_TONE.primary;
  const lineKey = scope === "module" ? "one-work-line-module" : "one-work-line";

  return (
    // The card reads its own width (a container query): one line across a whole page, the sentence over its link in
    // a side column (the home's, 2026-11-12).
    <Card component="section" aria-label={t("one-work-title")} className="@container">
      <Box className="flex flex-row items-start gap-3 p-4 @2xl:items-center">
        <Box
          aria-hidden
          className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", style.bg, style.text)}
        >
          <NiRobot size="medium" />
        </Box>
        {/* Narrow, the link sits under the sentence, at its start; wide, at the card's right. */}
        <Box className="flex min-w-0 flex-1 flex-col gap-1 @2xl:flex-row @2xl:items-center @2xl:justify-between @2xl:gap-3">
          <Typography variant="body1" className="min-w-0 @max-2xl:pt-2">
            {totals.tasks > 0
              ? t(lineKey, { count: totals.tasks, about })
              : t("one-work-line-tests", { count: totals.test })}
          </Typography>
          <Button
            variant="text"
            size="small"
            href={href}
            LinkComponent={Link}
            className="-ml-2 shrink-0 self-start @2xl:ml-0 @2xl:self-center"
          >
            {t("one-work-line-action")}
          </Button>
        </Box>
      </Box>
    </Card>
  );
}
