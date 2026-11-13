"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Box, Tooltip, Typography } from "@mui/material";

import InfoHint from "@/components/product/info-hint";
import NiSparkle from "@/icons/nexture/ni-sparkle";
import { cn } from "@/lib/utils";

/** One fact of a record: its name, its value, and whether ONE read it from a document. */
export type Fact = {
  key: string;
  label: string;
  /** The value as a person reads it; a fact with no value and nothing `owed` is not drawn. */
  value?: ReactNode;
  /** ONE wrote it from a document and nobody of the firm said it agrees yet: marked beside the value. */
  read?: boolean;
  /** What stands where the value will be, when it is missing: who answers it (a StatusChip). */
  owed?: ReactNode;
  /** A long value (an address) takes two columns where there are three. */
  wide?: boolean;
  /** How the value came to be (what ONE read or decided it from, that it may err), behind the "i" beside the name. */
  hint?: string;
};

/**
 * The facts of a record, each under its name, in a grid that reads its own width (the owner, 2026-11-12: "não tem
 * clareza nas informações deste card"): one column in a narrow card, two, then three. What ONE read from a document
 * carries ONE's mark beside it; what is missing stands in its place, saying who answers it; an empty fact with
 * nothing owed is not drawn.
 *
 * Closest catalog entries: `StateLine`, which says where one thing stands in a sentence, and `MetricBars`, which
 * compares counts; neither names several values of different kinds. A run of values joined by "·" made the reader
 * guess which was the CPF and which the phone, and hid what had no room on the line.
 */
export default function FactGrid({
  facts,
  className,
  pairs = false,
}: {
  facts: Fact[];
  className?: string;
  /** Short facts two by two even on a phone (a case's head), four across where there is room; a wide fact a row. */
  pairs?: boolean;
}) {
  const t = useTranslations("product");
  const shown = facts.filter(
    (fact) => (fact.value !== undefined && fact.value !== null && fact.value !== "") || fact.owed,
  );
  if (shown.length === 0) return null;
  return (
    <Box className={cn("@container", className)}>
      <Box
        component="dl"
        className={cn(
          "m-0 grid gap-x-6 gap-y-3",
          pairs ? "grid-cols-2 @3xl:grid-cols-4" : "grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-3",
        )}
      >
        {shown.map((fact) => (
          <Box
            key={fact.key}
            className={cn("flex min-w-0 flex-col gap-0.5", fact.wide && (pairs ? "col-span-2" : "@3xl:col-span-2"))}
          >
            <Box component="dt" className="flex min-w-0 items-center gap-0.5">
              <Typography variant="caption" component="span" className="text-text-secondary leading-4">
                {fact.label}
              </Typography>
              {fact.hint ? <InfoHint label={fact.hint} placement="bottom-start" className="-my-1 self-center" /> : null}
            </Box>
            <Typography variant="body2" component="dd" className="m-0 flex min-w-0 items-start gap-1.5 break-words">
              {fact.owed && !fact.value ? (
                fact.owed
              ) : (
                <>
                  <span className="min-w-0">{fact.value}</span>
                  {fact.read ? (
                    <Tooltip title={t("fact-read-by-one")}>
                      <span
                        role="img"
                        aria-label={t("fact-read-by-one")}
                        tabIndex={0}
                        className="text-primary dark:text-primary-light mt-0.5 flex flex-none rounded-sm outline-hidden focus-visible:ring-2"
                      >
                        <NiSparkle size="small" />
                      </span>
                    </Tooltip>
                  ) : null}
                </>
              )}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
