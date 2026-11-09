"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, ButtonBase, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import { BOARD_PAGE, type BoardColumn, boardColumns, hiddenOf, withMore } from "@/lib/cases/board";
import { JOURNEY_STEP_KEY, type JourneyStepId } from "@/lib/cases/journey";
import { readFirmCaseBoardColumn } from "@/lib/cases/list-actions";
import { type Holder, isHolder, reasonKey } from "@/lib/cases/standing";
import { countText } from "@/lib/numbers/compare";

/** The words of each column: the way's, but a case paid and not archived yet is at its last one. */
const COLUMN_KEY: Record<JourneyStepId, string> = {
  ...JOURNEY_STEP_KEY,
  closed: "controladoria-stock-step-closing",
};

/** Who has the case, in a word, as the list says it. */
const HOLDER_WORD: Record<Holder, string> = {
  firm: "standing-holder-firm",
  client: "standing-holder-client",
  one: "standing-holder-one",
  court: "standing-holder-court",
  platform: "standing-holder-platform",
};

/**
 * The board of the controladoria by step (0112), only to look at: a column per step of the way, its cases the longest
 * at the step first, each opening its case. Nobody drags a card: ONE carries a case from one step to the next. A column
 * reads its next cases on "Mostrar mais"; the board is read again with the page ("Atualizar").
 */
export default function CaseBoard({
  columns,
  module,
  tests,
}: {
  columns: BoardColumn[];
  module: string | null;
  /** Whether the test cases count, as the page read them (0114). */
  tests: boolean;
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
                  {t(COLUMN_KEY[column.step])}
                </Typography>
                <Typography variant="body2" component="span" className="font-semibold tabular-nums">
                  {countText(column.cases)}
                </Typography>
              </Box>
              {column.stagnant > 0 ? (
                <Typography variant="caption" className="text-text-secondary">
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

            {hidden > 0 ? (
              <Button
                variant="text"
                size="small"
                color="grey"
                className="self-start"
                disabled={reading === column.step}
                onClick={() => void more(column)}
              >
                {t("controladoria-board-more", { count: Math.min(hidden, BOARD_PAGE) })}
              </Button>
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
