"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { Box, Button, ButtonBase, Card, Typography } from "@mui/material";

import SectionTitle from "@/components/product/section-title";
import StatusChip from "@/components/product/status-chip";
import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import NiArchive from "@/icons/nexture/ni-archive";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiChevronLeftSmall from "@/icons/nexture/ni-chevron-left-small";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiExclamationSquare from "@/icons/nexture/ni-exclamation-square";
import NiFolder from "@/icons/nexture/ni-folder";
import NiMessageDots from "@/icons/nexture/ni-message-dots";
import NiMoney from "@/icons/nexture/ni-money";
import NiPen from "@/icons/nexture/ni-pen";
import NiScale from "@/icons/nexture/ni-scale";
import NiSendRight from "@/icons/nexture/ni-send-right";
import { BOARD_PAGE, type BoardColumn, boardColumns, hiddenOf, withMore } from "@/lib/cases/board";
import type { JourneyStepId } from "@/lib/cases/journey";
import { readFirmCaseBoardColumn } from "@/lib/cases/list-actions";
import { type CaseStock, type Holder, isHolder, reasonKey, STOCK_STEP_KEY } from "@/lib/cases/standing";
import { countText } from "@/lib/numbers/compare";
import { cn } from "@/lib/utils";

/** Who has the case, in a word, as the list says it. */
const HOLDER_WORD: Record<Holder, string> = {
  firm: "standing-holder-firm",
  client: "standing-holder-client",
  one: "standing-holder-one",
  court: "standing-holder-court",
  platform: "standing-holder-platform",
};

/** Each step by the icon the case's own way gives it (`journey-card.tsx`, `cases-progress-card.tsx`). */
const STEP_ICON: Record<JourneyStepId, ReactNode> = {
  intake: <NiMessageDots size="medium" />,
  documents: <NiFolder size="medium" />,
  signature: <NiPen size="medium" />,
  drafting: <NiDocumentFull size="medium" />,
  filing: <NiSendRight size="medium" />,
  hearing: <NiCalendar size="medium" />,
  judgment: <NiScale size="medium" />,
  payment: <NiMoney size="medium" />,
  closed: <NiArchive size="medium" />,
};

/**
 * The parts of the way, each in one colour, named over its columns (the owner, 2026-11-12, who asked the steps told
 * apart by colour): the client's hiring, the filing, the court and the end. Nine steps and five hues that are not red
 * (kept for risk) could not give each step its own; a colour per part says something, and its name says what. The
 * hues are the ones the page's numbers already give the same things: the new cases, the filed ones, the court, the
 * archived ones.
 */
const PHASES: readonly { key: string; label: string; tone: TileTone; steps: readonly JourneyStepId[] }[] = [
  {
    key: "hiring",
    label: "controladoria-board-phase-hiring",
    tone: "accent-1",
    steps: ["intake", "documents", "signature"],
  },
  { key: "filing", label: "controladoria-board-phase-filing", tone: "accent-4", steps: ["drafting", "filing"] },
  { key: "court", label: "controladoria-board-phase-court", tone: "primary", steps: ["hearing", "judgment"] },
  { key: "end", label: "controladoria-board-phase-end", tone: "secondary", steps: ["payment", "closed"] },
];

const toneOf = (step: JourneyStepId): TileTone => PHASES.find((phase) => phase.steps.includes(step))?.tone ?? "primary";

/**
 * The rows every column shares (a subgrid), so a column's parts line up with its neighbours' whatever each holds: the
 * icon, the name, the count, the days, the stagnant ones, the way to the list, the cases and "Mostrar mais". Written
 * out so the classes are found by Tailwind.
 */
const ROW = {
  icon: "row-start-1",
  name: "row-start-2",
  count: "row-start-3",
  days: "row-start-4",
  stagnant: "row-start-5",
  link: "row-start-6",
  /** An empty column says so across the rows of the days, the stagnant ones and the way to the list. */
  none: "row-start-4 row-span-3",
  cases: "row-start-7",
  more: "row-start-8",
} as const;

/**
 * The board of the controladoria by step (0112), only to look at, its columns after the plans of a pricing page (the
 * owner, 2026-11-12): each a card with the icon of its step on the colour of its part of the way, its name, how many
 * cases are there, how long they have been (the stock's median and oldest, 0111), how many stagnated, the way to their
 * list, then its cases, the longest at the step first, each opening its case. The columns share their rows, so the
 * names, the numbers, the buttons and the first cases line up across the board; a column with no case says so where
 * its numbers and its button would be. The parts of the way are named over their columns. Nobody drags a card: ONE
 * carries a case from one step to the next. A column reads its next cases on "Mostrar mais", and opens the list of its
 * cases in `/casos` (0116), with its search, its order and "Exportar"; the board is read again with the page
 * ("Atualizar"). Wider than the page, it scrolls sideways, by hand or with the arrows beside its title.
 */
export default function CaseBoard({
  headingId,
  title,
  description,
  columns,
  stock,
  module,
  tests,
  listOf,
}: {
  /** The section's heading, which the board carries with its arrows. */
  headingId: string;
  title: string;
  description?: string;
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

  // Whether there is more of the board to either side, for the arrows beside the title.
  const lane = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ back: false, on: false });
  const measure = useCallback(() => {
    const element = lane.current;
    if (!element) return;
    const back = element.scrollLeft > 4;
    const on = element.scrollLeft + element.clientWidth < element.scrollWidth - 4;
    setEdges((current) => (current.back === back && current.on === on ? current : { back, on }));
  }, []);
  useEffect(() => {
    const element = lane.current;
    if (!element) return;
    measure();
    // The lane keeps its width while its columns take theirs (the page's styles, its fonts): both are watched.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const column = element.querySelector("[data-board-column]");
    if (column) observer.observe(column);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [measure]);
  const slide = (direction: 1 | -1) => {
    const element = lane.current;
    if (!element) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Two columns at a time, or the width shown when it is narrower.
    const column = element.querySelector<HTMLElement>("[data-board-column]")?.offsetWidth ?? 240;
    element.scrollBy({
      left: direction * Math.min(element.clientWidth, (column + 12) * 2),
      behavior: still ? "auto" : "smooth",
    });
  };

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

  // Each part of the way over the columns it holds, in the order of the way.
  const phases = PHASES.flatMap((phase) => {
    const at = shown.findIndex((column) => phase.steps.includes(column.step));
    const span = shown.filter((column) => phase.steps.includes(column.step)).length;
    return at < 0 || span === 0 ? [] : [{ ...phase, start: at + 1, span }];
  });

  return (
    <Box className="flex flex-col gap-3">
      <SectionTitle
        id={headingId}
        title={title}
        description={description}
        action={
          edges.back || edges.on ? (
            <Box className="flex items-center gap-1">
              <Button
                className="icon-only"
                size="small"
                variant="outlined"
                color="grey"
                disabled={!edges.back}
                aria-label={t("controladoria-board-back")}
                onClick={() => slide(-1)}
              >
                <NiChevronLeftSmall size="medium" />
              </Button>
              <Button
                className="icon-only"
                size="small"
                variant="outlined"
                color="grey"
                disabled={!edges.on}
                aria-label={t("controladoria-board-on")}
                onClick={() => slide(1)}
              >
                <NiChevronRightSmall size="medium" />
              </Button>
            </Box>
          ) : null
        }
      />
      <Box ref={lane} className="-mx-1 snap-x scroll-px-1 overflow-x-auto px-1 pt-0 pb-2">
        <Box
          // A column is 13rem wide at least (eight fit across a page of 1920 pixels), wider on a phone, where one
          // shows with the edge of the next.
          className="grid gap-x-3 gap-y-0 [--board-column:15rem] lg:[--board-column:13rem]"
          style={{
            gridTemplateColumns: `repeat(${shown.length}, minmax(var(--board-column), 1fr))`,
            gridTemplateRows: "auto repeat(8, auto)",
          }}
        >
          {phases.map((phase) => {
            const style = TILE_TONE[phase.tone];
            return (
              <Box
                key={phase.key}
                className={cn("mb-3 flex flex-row items-center gap-2 rounded-xl px-3 py-1.5", style.bg)}
                style={{ gridColumn: `${phase.start} / span ${phase.span}`, gridRow: 1 }}
              >
                <span aria-hidden className={cn("h-2 w-2 flex-none rounded-full bg-current", style.text)} />
                <Typography variant="subtitle2" component="p" className="text-text-primary mb-0 truncate">
                  {t(phase.label)}
                </Typography>
              </Box>
            );
          })}

          {shown.map((column, index) => {
            const id = `controladoria-board-${column.step}`;
            const hidden = hiddenOf(column);
            const days = stock?.steps.find((item) => item.step === column.step);
            const style = TILE_TONE[toneOf(column.step)];
            const name = t(STOCK_STEP_KEY[column.step]);
            return (
              <Card
                key={column.step}
                data-board-column
                role="group"
                aria-labelledby={id}
                className="grid snap-start grid-rows-subgrid gap-y-2 px-4! py-5!"
                style={{ gridColumn: index + 1, gridRow: "2 / span 8" }}
              >
                <Box className={cn(ROW.icon, "flex justify-center")}>
                  <span
                    aria-hidden
                    className={cn("flex h-11 w-11 items-center justify-center rounded-xl", style.bg, style.text)}
                  >
                    {STEP_ICON[column.step]}
                  </span>
                </Box>
                <Typography
                  id={id}
                  variant="subtitle1"
                  component="h3"
                  className={cn(ROW.name, "mb-0 self-start text-center leading-5 font-semibold")}
                >
                  {name}
                </Typography>
                <Box className={cn(ROW.count, "flex items-baseline justify-center gap-1.5")}>
                  <Typography variant="h4" component="p" className="mb-0 tabular-nums">
                    {countText(column.cases)}
                  </Typography>
                  <Typography variant="body2" component="span" className="text-text-secondary">
                    {t("controladoria-board-cases-unit", { count: column.cases })}
                  </Typography>
                </Box>

                {column.cases > 0 ? (
                  <>
                    {/* How long the cases have been at the step: the median and the oldest, side by side. */}
                    <Box className={ROW.days}>
                      {days ? (
                        <Box className="bg-grey-25 grid grid-cols-2 rounded-xl py-1.5">
                          {[
                            { key: "median", label: t("controladoria-board-median"), value: days.medianDays },
                            { key: "oldest", label: t("controladoria-board-oldest"), value: days.oldestDays },
                          ].map((item) => (
                            <Box
                              key={item.key}
                              className="border-grey-100 flex flex-col items-center px-1 text-center first:border-r"
                            >
                              <Typography variant="caption" className="text-text-secondary leading-4">
                                {item.label}
                              </Typography>
                              <Typography variant="body2" component="span" className="font-semibold tabular-nums">
                                {t("cases-step-days", { count: item.value })}
                              </Typography>
                            </Box>
                          ))}
                        </Box>
                      ) : null}
                    </Box>
                    <Box className={cn(ROW.stagnant, "flex items-start justify-center gap-1")}>
                      {column.stagnant > 0 ? (
                        <>
                          <NiExclamationSquare size="small" className="text-accent-3 mt-px flex-none" />
                          <Typography
                            variant="caption"
                            className="text-text-primary text-center leading-4 font-semibold"
                          >
                            {t("controladoria-stock-step-stagnant", {
                              count: column.stagnant,
                              limit: column.limit ?? 0,
                            })}
                          </Typography>
                        </>
                      ) : null}
                    </Box>
                    <Box className={ROW.link}>
                      <Button
                        component={Link}
                        href={listOf(column.step)}
                        variant="outlined"
                        size="small"
                        color="grey"
                        fullWidth
                        endIcon={<NiChevronRightSmall size="small" />}
                        aria-label={t("controladoria-board-list-label", { count: column.cases, step: name })}
                      >
                        {t("controladoria-board-list")}
                      </Button>
                    </Box>
                  </>
                ) : (
                  // Nothing at the step: said where the column's numbers and its way to the list would be, so the
                  // column keeps its shape beside the others.
                  <Box className={cn(ROW.none, "bg-grey-25 flex items-center justify-center rounded-xl px-3 py-3")}>
                    <Typography variant="body2" className="text-text-secondary text-center">
                      {t("controladoria-board-empty")}
                    </Typography>
                  </Box>
                )}

                <Box className={cn(ROW.cases, "pt-1")}>
                  {column.items.length > 0 ? (
                    <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
                      {column.items.map((item) => {
                        const reason = reasonKey(item.holder, item.why);
                        return (
                          <Box component="li" key={item.id} className="flex">
                            <ButtonBase
                              component={Link}
                              href={`/casos/${item.id}`}
                              className="border-grey-100 hover:border-grey-200 hover:bg-grey-25 focus-visible:bg-grey-25 flex w-full flex-col items-stretch gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors"
                            >
                              <Box className="flex items-center justify-between gap-2">
                                <Typography
                                  variant="caption"
                                  component="span"
                                  className="text-text-secondary tabular-nums"
                                >
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
                              <Typography
                                variant="caption"
                                component="span"
                                className="text-text-secondary line-clamp-2"
                              >
                                {isHolder(item.holder) ? t(HOLDER_WORD[item.holder]) : t("cases-holder-ended")}
                                {reason ? ` · ${t(reason)}` : ""}
                              </Typography>
                              {item.stagnant || item.isTest ? (
                                <Box className="flex flex-wrap gap-1 pt-1">
                                  {item.stagnant ? <StatusChip tone="attention" label={t("cases-stagnant")} /> : null}
                                  {item.isTest ? <StatusChip tone="neutral" label={t("cases-test-mark")} /> : null}
                                </Box>
                              ) : null}
                            </ButtonBase>
                          </Box>
                        );
                      })}
                    </Box>
                  ) : null}
                </Box>

                <Box className={cn(ROW.more, "flex flex-col items-stretch gap-0.5")}>
                  {hidden > 0 ? (
                    <Button
                      variant="text"
                      size="small"
                      color="grey"
                      className="px-2! whitespace-nowrap"
                      disabled={reading === column.step}
                      onClick={() => void more(column)}
                    >
                      {t("controladoria-board-more", { count: Math.min(hidden, BOARD_PAGE) })}
                    </Button>
                  ) : null}
                  {failed === column.step ? (
                    <Typography variant="caption" role="status" className="text-text-secondary text-center">
                      {t("controladoria-board-more-failed")}
                    </Typography>
                  ) : null}
                </Box>
              </Card>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
