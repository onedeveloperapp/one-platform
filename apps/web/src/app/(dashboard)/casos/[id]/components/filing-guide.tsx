"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, Button, Typography } from "@mui/material";

import FactGrid, { type Fact } from "@/components/product/fact-grid";
import SectionTitle from "@/components/product/section-title";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import type { FilingFiles } from "@/lib/cases/filing";
import {
  filingGuideOf,
  type FilingSheetData,
  type GuideStep,
  missingRows,
  type SheetRow,
  type SheetWords,
} from "@/lib/cases/filing-sheet";

/** Each contact the screen asks and the case lacks, said by whose it is. */
const MISSING_KEY = {
  email: "filing-sheet-missing-email",
  mobile: "filing-sheet-missing-mobile",
} as const;

/**
 * The guide of who files a package by hand (0269): the court's screen step by step, by its own names, with what to
 * do there and each value it asks, read from the case and ready to copy. What the screen asks and the case does not
 * have is said before the steps, with the way to the people's card where it is completed, and stands missing in its
 * place. The lawyer reads it beside the court's screen; ONE may have read a value wrong, which the "i" says.
 */
export default function FilingGuide({
  sheet,
  files,
  today,
}: {
  sheet: FilingSheetData;
  files: FilingFiles;
  today: string;
}) {
  const t = useTranslations("product");
  const words = (said: SheetWords) => t(said.key, said.values);
  const steps = filingGuideOf(sheet, { files, today });
  // What the screen asks and the case does not have, said by whose it is: "o e-mail de Maria Souza".
  const missing = missingRows(steps).map((item) => t(MISSING_KEY[item.field], { name: item.whose }));

  const factOf = (item: SheetRow): Fact => ({
    key: item.id,
    label: words(item.label),
    value: item.shown === null ? undefined : typeof item.shown === "string" ? item.shown : words(item.shown),
    copy: item.copy ?? undefined,
    note: item.note ? words(item.note) : undefined,
    wide: item.wide,
    // A missing value is said in its place, and has nothing to copy.
    owed: item.missing ? <StatusChip tone="attention" label={t("filing-sheet-missing")} /> : undefined,
  });

  return (
    <Box className="flex flex-col gap-3">
      <SectionTitle
        id={`filing-guide-${sheet.packageId}`}
        title={t("filing-guide-title")}
        description={t("filing-guide-hint")}
        as="h3"
        variant="subtitle2"
      />
      {missing.length > 0 ? (
        <StateLine
          tone="attention"
          action={
            <Button variant="outlined" color="grey" size="small" href="#case-people" LinkComponent={Link}>
              {t("filing-sheet-missing-action")}
            </Button>
          }
        >
          {t("filing-sheet-missing-line", {
            system: sheet.screen?.name ?? sheet.system,
            items: new Intl.ListFormat("pt-BR", { type: "conjunction" }).format(missing),
          })}
        </StateLine>
      ) : null}
      <Box component="ol" className="m-0 flex list-none flex-col gap-4 p-0">
        {steps.map((step: GuideStep, index) => (
          <Box component="li" key={step.id} className="flex gap-3">
            <Typography
              component="span"
              variant="body2"
              aria-hidden
              className="bg-primary/10 text-primary flex h-6 w-6 flex-none items-center justify-center rounded-full font-semibold"
            >
              {index + 1}
            </Typography>
            <Box className="flex min-w-0 flex-1 flex-col gap-2">
              <Box className="flex min-w-0 flex-col gap-0.5">
                <Typography variant="body1" component="h4" className="font-semibold">
                  <span className="sr-only">{t("filing-guide-step-number", { number: index + 1 })}</span>
                  {words(step.title)}
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {words(step.hint)}
                </Typography>
              </Box>
              {step.groups.map((group) => (
                <Box key={group.id} className="flex flex-col gap-1.5">
                  {group.title ? (
                    <Typography variant="body2" component="p" className="font-semibold">
                      {words(group.title)}
                    </Typography>
                  ) : null}
                  <FactGrid facts={group.rows.map(factOf)} />
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
