"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, ButtonBase, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import { BOARD_PAGE, type BoardColumn, boardColumns, hiddenOf, withMore } from "@/lib/cases/board";
import type { JourneyStepId } from "@/lib/cases/journey";
import { readFirmCaseBoardColumn } from "@/lib/cases/list-actions";
import { type CaseStock, type Holder, isHolder, reasonKey, STOCK_STEP_KEY } from "@/lib/cases/standing";
import { countText } from "@/lib/numbers/compare";

/** Who has the case, in a word, as the list says it. */
const HOLDER_WORD: Record<Holder, string> = {
  firm: "standing-holder-firm",
  client: "standing-holder-client",
  one: "standing-holder-one",
  court: "standing-holder-court",
  platform: "standing-holder-platform",
};

/**
 * The board of the controladoria by step (0112), only to look at: a column per step of the way, its head saying how
 * many cases are there, how long they have been (the stock's median and oldest, 0111) and how many stagnated, its
 * cases the longest at the step first, each opening its case. Nobody drags a card: ONE carries a case from one step to
 * the next. A column reads its next cases on "Mostrar mais", and opens the list of its cases in `/casos` (0116), with
 * its search, its order and "Exportar"; the board is read again with the page ("Atualizar").
 */
export default function CaseBoard({
  columns,
  stock,
  module,
  tests,
  listOf,
}: {
  columns: BoardColumn[];
  /** Each step's days (its median and oldest); null when the stock could not be read, and the heads say no days. */
  stock: CaseStock | null;
  module: string | null;
  /** Whether the test cases count, as the page read them (0114). */
  tests: boolean;
  /** The list of a step's cases, with the page's cut. */
  listOf: (step: JourneyStepId) => string;
}) {
  const t = useTranslations("product");
  const [shown, setShown] = useState(() => boardColumns(columns));
  // The page read the board again ("Atualizar"): the columns start over from what it read.
  const [source, setSource] = useState(columns);
  if (source !== columns) {
    setSource(columns);
    setShown(boardColumns(columns));
  }
  const [reading, setReading] = useState<JourneyStepId | null>(null);
  const [failed, setFailed] = useState<JourneyStepId | null>(null);

  const more = async (column: BoardColumn) => {
    setReading(column.step);
    setFailed(null);
    let answer: Awaited<ReturnType<typeof readFirmCaseBoardColumn>>;
    try {
      answer = await readFirmCaseBoardColumn({ module, step: column.step, offset: column.items.length, tests });
    } catch {
      answer = { ok: false };
    }
    setReading(null);
    if (!answer.ok) {
      setFailed(column.step);
      return;
    }
    const next = answer.column;
    setShown((current) =>
      current.map((item) =>
        item.step !== column.step ? item : next ? withMore(item, next) : { ...item, cases: item.items.length },
      ),
    );
  };

  return (
    <Box component="ul" className="m-0 -mx-1 flex snap-x snap-mandatory list-none gap-3 overflow-x-auto px-1 pt-0 pb-2">
      {shown.map((column) => {
        const id = `controladoria-board-${column.step}`;
        const hidden = hiddenOf(column);
        const days = stock?.steps.find((item) => item.step === column.step);
        return (
          <Box
            key={column.step}
            component="li"
            aria-labelledby={id}
            className="border-grey-100 bg-background-paper flex w-72 flex-none snap-start flex-col gap-3 rounded-2xl border p-3"
          >
            <Box className="flex flex-col gap-0.5">
              <Box className="flex items-center justify-between gap-2">
                <Typography id={id} variant="subtitle2" component="h3" className="mb-0">
                  {t(STOCK_STEP_KEY[column.step])}
                </Typography>
                <Typography variant="body2" component="span" className="font-semibold tabular-nums">
                  {countText(column.cases)}
                </Typography>
              </Box>
              {column.cases > 0 && days ? (
                <Typography variant="caption" className="text-text-secondary">
                  {t("controladoria-stock-step-days", { median: days.medianDays, oldest: days.oldestDays })}
                </Typography>
              ) : null}
              {column.stagnant > 0 ? (
                <Typography variant="caption" className="text-text-primary font-semibold">
                  {t("controladoria-stock-step-stagnant", { count: column.stagnant, limit: column.limit ?? 0 })}
                </Typography>
              ) : null}
            </Box>

            {column.items.length > 0 ? (
              <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
                {column.items.map((item) => {
                  const reason = reasonKey(item.holder, item.why);
                  return (
                    <Box component="li" key={item.id} className="flex">
                      <ButtonBase
                        component={Link}
                        href={`/casos/${item.id}`}
                        className="border-grey-100 hover:bg-grey-25 focus-visible:bg-grey-25 flex w-full flex-col items-stretch gap-1 rounded-xl border px-3 py-2.5 text-left"
                      >
                        <Box className="flex items-center justify-between gap-2">
                          <Typography variant="caption" component="span" className="text-text-secondary tabular-nums">
                            #{item.seq}
                          </Typography>
                          <Typography variant="caption" component="span" className="text-text-secondary">
                            {t("cases-step-days", { count: item.days })}
                          </Typography>
                        </Box>
                        <Typography
                          variant="body2"
                          component="span"
                          className="text-text-primary truncate font-semibold"
                        >
                          {item.client || t("cases-no-client")}
                        </Typography>
                        <Typography variant="caption" component="span" className="text-text-secondary line-clamp-2">
                          {isHolder(item.holder) ? t(HOLDER_WORD[item.holder]) : t("cases-holder-ended")}
                          {reason ? ` · ${t(reason)}` : ""}
                        </Typography>
                        {item.stagnant || item.isTest ? (
                          <Box className="flex flex-wrap gap-1 pt-0.5">
                            {item.stagnant ? <StatusChip tone="attention" label={t("cases-stagnant")} /> : null}
                            {item.isTest ? <StatusChip tone="neutral" label={t("cases-test-mark")} /> : null}
                          </Box>
                        ) : null}
                      </ButtonBase>
                    </Box>
                  );
                })}
              </Box>
            ) : (
              <Typography variant="body2" className="text-text-secondary">
                {t("controladoria-board-empty")}
              </Typography>
            )}

            {hidden > 0 || column.cases > 0 ? (
              <Box className="mt-auto flex flex-col items-start gap-0.5">
                {hidden > 0 ? (
                  <Button
                    variant="text"
                    size="small"
                    color="grey"
                    disabled={reading === column.step}
                    onClick={() => void more(column)}
                  >
                    {t("controladoria-board-more", { count: Math.min(hidden, BOARD_PAGE) })}
                  </Button>
                ) : null}
                {column.cases > 0 ? (
                  <Button
                    component={Link}
                    href={listOf(column.step)}
                    variant="text"
                    size="small"
                    color="primary"
                    aria-label={t("controladoria-board-list-label", {
                      count: column.cases,
                      step: t(STOCK_STEP_KEY[column.step]),
                    })}
                  >
                    {t("controladoria-board-list")}
                  </Button>
                ) : null}
              </Box>
            ) : null}
            {failed === column.step ? (
              <Typography variant="caption" role="status" className="text-text-secondary">
                {t("controladoria-board-more-failed")}
              </Typography>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}
