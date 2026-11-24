"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Accordion, AccordionDetails, AccordionSummary, Box, Button, Typography } from "@mui/material";

import FactGrid, { type Fact } from "@/components/product/fact-grid";
import SectionTitle from "@/components/product/section-title";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
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

type GuideInput = { sheet: FilingSheetData; files: FilingFiles; today: string };
type Words = ReturnType<typeof useTranslations>;
/** A contact the court's screen asks and the case lacks, and whose it is. */
export type SheetLack = NonNullable<SheetRow["missing"]>;

/** What the court's screen asks and the case lacks, in words: "o e-mail de Maria Souza e o celular de Caio Souza". */
export const lacksWords = (t: Words, lacks: readonly SheetLack[]): string =>
  new Intl.ListFormat("pt-BR", { type: "conjunction" }).format(
    lacks.map((item) => t(MISSING_KEY[item.field], { name: item.whose })),
  );

/** Which of the contacts a step asks and the case lacks: the word of its chip. */
function lackOf(step: GuideStep): "email" | "mobile" | "both" | null {
  const fields = new Set(missingRows([step]).map((item) => item.field));
  if (fields.size === 0) return null;
  return fields.size > 1 ? "both" : fields.has("email") ? "email" : "mobile";
}

/**
 * What the court's screen asks and the case does not have (0269), as one line of what holds the package, with the
 * way to the people's card where it is completed: "Falta no caso o e-mail de Maria Souza". The card says it with
 * what else is owed, above its files (the owner's canvas of 2026-11-24, "Cartões do caso, antes e depois"); nothing
 * shows when nothing is missing.
 */
export function FilingSheetMissing({ sheet, files, today }: GuideInput) {
  const t = useTranslations("product");
  const lacks = missingRows(filingGuideOf(sheet, { files, today }));
  if (lacks.length === 0) return null;
  return (
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
        items: lacksWords(t, lacks),
        count: lacks.length,
      })}
    </StateLine>
  );
}

/**
 * The guide of who files a package by hand (0269): the court's screen step by step, by its own names, with what to
 * do there and each value it asks, read from the case and ready to copy. It opens one step at a time, the first one
 * first (the owner's canvas of 2026-11-24): the lawyer reads it beside the court's screen and opens the next step
 * when they reach it there. A step whose values the case lacks says what in its chip, and the value stands missing
 * in its place; the line that says whose it is, with the way to the people's card, sits here or, with
 * `missingAbove`, among what the card says holds the package (`FilingSheetMissing`). Its last step, the receipt,
 * is left to the card where the receipt is attached right under it (`receiptBelow`). ONE may have read a value
 * wrong, which the "i" says.
 */
export default function FilingGuide({
  sheet,
  files,
  today,
  missingAbove = false,
  receiptBelow = false,
}: GuideInput & {
  /** The card says what is missing above, with what else holds the package: the guide does not say it again. */
  missingAbove?: boolean;
  /** The card asks for the receipt right under the guide: its step would ask it twice. */
  receiptBelow?: boolean;
}) {
  const t = useTranslations("product");
  const words = (said: SheetWords) => t(said.key, said.values);
  const steps = filingGuideOf(sheet, { files, today }).filter((step) => !(receiptBelow && step.id === "receipt"));
  const [open, setOpen] = useState<string | null>(steps[0]?.id ?? null);
  const base = `filing-guide-${sheet.packageId}`;

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
    <Box className="flex flex-col gap-2">
      <SectionTitle
        id={base}
        title={t("filing-guide-title", { count: steps.length })}
        description={t("filing-guide-hint")}
        as="h3"
        variant="subtitle2"
      />
      {missingAbove ? null : <FilingSheetMissing sheet={sheet} files={files} today={today} />}
      <Box
        component="ol"
        aria-labelledby={base}
        className="border-grey-100 m-0 flex list-none flex-col overflow-hidden rounded-xl border p-0"
      >
        {steps.map((step: GuideStep, index) => {
          const lack = lackOf(step);
          const id = `${base}-${step.id}`;
          return (
            <Box component="li" key={step.id} className="border-grey-100 border-t first:border-t-0">
              <Accordion
                expanded={open === step.id}
                onChange={(_event, expanded) => setOpen(expanded ? step.id : null)}
                disableGutters
                elevation={0}
                slotProps={{ heading: { component: "h4" } }}
              >
                <AccordionSummary
                  id={`${id}-head`}
                  aria-controls={`${id}-body`}
                  expandIcon={<NiChevronDownSmall size="medium" />}
                  className="px-4! py-2.5!"
                >
                  <Box className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 pr-2">
                    <Typography
                      component="span"
                      variant="body2"
                      aria-hidden
                      className="bg-primary/10 text-primary flex h-6 w-6 flex-none items-center justify-center rounded-full font-semibold"
                    >
                      {index + 1}
                    </Typography>
                    <Typography component="span" variant="body1" className="min-w-0 flex-1 font-semibold">
                      <span className="sr-only">{t("filing-guide-step-number", { number: index + 1 })}</span>
                      {words(step.title)}
                    </Typography>
                    {lack ? (
                      <StatusChip tone="attention" label={t("filing-guide-step-missing", { fields: lack })} />
                    ) : null}
                  </Box>
                </AccordionSummary>
                <AccordionDetails className="flex flex-col gap-3 pr-4! pb-4! pl-13!">
                  <Typography variant="body2" className="text-text-secondary">
                    {words(step.hint)}
                  </Typography>
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
                </AccordionDetails>
              </Accordion>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
