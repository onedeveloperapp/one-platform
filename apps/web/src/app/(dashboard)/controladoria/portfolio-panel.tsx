"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Alert, Box, Button, LinearProgress, Typography } from "@mui/material";

import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import NiArrowInDown from "@/icons/nexture/ni-arrow-in-down";
import { brasiliaMoment } from "@/lib/cases/export";
import {
  PORTFOLIO_SHEETS,
  portfolioAbout,
  type PortfolioBegun,
  type PortfolioCounts,
  portfolioLine,
  type PortfolioRefusal,
  type PortfolioSheet,
  portfolioSheetName,
  portfolioWorkbook,
} from "@/lib/controladoria/portfolio";
import { beginPortfolioExport, readPortfolioPage } from "@/lib/controladoria/portfolio-actions";
import { writeWorkbook, XLSX_TYPE, type XlsxCell } from "@/lib/export/xlsx-write";
import { savedFileName, saveFile } from "@/lib/files/save-file";
import { countText } from "@/lib/numbers/compare";
import { formatDayBr } from "@flyee/rules/person";

/** What the person is told of a refusal, by the database's reason. The second factor is asked in place instead. */
const REFUSED: Record<Exclude<PortfolioRefusal, "second_factor">, string> = {
  not_allowed: "portfolio-refused-not-allowed",
  support_visit: "portfolio-refused-support-visit",
  daily_limit: "portfolio-refused-daily-limit",
  too_many: "portfolio-refused-too-many",
  empty: "portfolio-refused-empty",
  failed: "portfolio-failed",
};

/** What goes in each sheet, in the person's words. */
const GOES: Record<PortfolioSheet, string> = {
  clientes: "portfolio-goes-clientes",
  casos: "portfolio-goes-casos",
  acoes: "portfolio-goes-acoes",
  prazos: "portfolio-goes-prazos",
  documentos: "portfolio-goes-documentos",
};

type Progress = { sheet: PortfolioSheet; done: number; total: number; read: number; all: number };
type Done = { counts: PortfolioCounts; file: string; left: number };

/**
 * "Levar a carteira inteira" (migration 0117): says what the file holds and that it holds every client's personal data,
 * asks the second factor where the session has not confirmed it, then reads every sheet a page at a time and writes the
 * workbook in the person's browser. Nothing is saved of a portfolio that could not be read whole, and the panel does
 * not close while it reads.
 */
export default function PortfolioPanel({
  open,
  onClose,
  firm,
  tests,
  testsLeftOut,
  factor,
}: {
  open: boolean;
  onClose: () => void;
  firm: string;
  /** Whether the test cases go, as the page counts them (0114). */
  tests: boolean;
  /** How many test cases stay out of the file. */
  testsLeftOut: number;
  /** Where the session's second factor stands. */
  factor: "ok" | "challenge" | "missing";
}) {
  const t = useTranslations("product");
  const [factorNow, setFactorNow] = useState(factor);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [writing, setWriting] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  // `again`: whether trying again can help. A limit, a right or an empty firm answers the same next time.
  const [problem, setProblem] = useState<{ severity: "warning" | "error"; text: string; again: boolean } | null>(null);
  const running = useRef(false);
  const busy = progress !== null || writing;
  const say = (key: string, values?: Record<string, string | number>) => t(key, values);

  const close = () => {
    if (busy) return;
    setDone(null);
    setProblem(null);
    onClose();
  };

  const refuse = (begun: Extract<PortfolioBegun, { ok: false }>) => {
    if (begun.code === "second_factor") {
      setFactorNow("challenge");
      return;
    }
    setProblem({
      severity: begun.code === "failed" ? "error" : "warning",
      again: begun.code === "failed",
      text: t(REFUSED[begun.code], {
        limit: begun.limit === undefined ? "" : countText(begun.limit),
        sheet: begun.sheet ? portfolioSheetName(begun.sheet, say) : "",
      }),
    });
  };

  const run = async () => {
    if (running.current) return;
    running.current = true;
    setProblem(null);
    setDone(null);
    try {
      let begun: PortfolioBegun;
      try {
        begun = await beginPortfolioExport(tests);
      } catch {
        begun = { ok: false, code: "failed" };
      }
      if (!begun.ok) {
        refuse(begun);
        return;
      }
      const all = PORTFOLIO_SHEETS.reduce((sum, sheet) => sum + begun.counts[sheet], 0);
      const lines = Object.fromEntries(PORTFOLIO_SHEETS.map((sheet) => [sheet, [] as XlsxCell[][]])) as Record<
        PortfolioSheet,
        XlsxCell[][]
      >;
      let read = 0;
      for (const sheet of PORTFOLIO_SHEETS) {
        setProgress({ sheet, done: 0, total: begun.counts[sheet], read, all });
        if (begun.counts[sheet] === 0) continue;
        for (let offset = 0; ; offset += begun.pageSize) {
          let answer: Awaited<ReturnType<typeof readPortfolioPage>>;
          try {
            answer = await readPortfolioPage(sheet, offset, tests);
          } catch {
            answer = { ok: false };
          }
          if (!answer.ok) {
            // Half a portfolio read as the whole of it is worse than none.
            setProblem({ severity: "error", text: t("portfolio-failed"), again: true });
            return;
          }
          for (const row of answer.rows) lines[sheet].push(portfolioLine(sheet, row, say));
          read += answer.rows.length;
          setProgress({ sheet, done: lines[sheet].length, total: begun.counts[sheet], read, all });
          if (answer.rows.length < begun.pageSize) break;
        }
      }
      setProgress(null);
      setWriting(true);
      // A breath for the screen to say the file is being written: writing it holds the page for a moment.
      await new Promise((resolve) => window.setTimeout(resolve, 30));
      const moment = brasiliaMoment(new Date().toISOString()) ?? "";
      const day = formatDayBr(moment.slice(0, 10)) ?? "";
      const counts = Object.fromEntries(
        PORTFOLIO_SHEETS.map((sheet) => [sheet, lines[sheet].length]),
      ) as PortfolioCounts;
      const bytes = writeWorkbook(
        portfolioWorkbook({
          about: portfolioAbout({
            firm,
            made: { day, time: moment.slice(11, 16) },
            counts,
            testsLeftOut: testsLeftOut > 0,
            say,
            countText,
          }),
          lines,
          say,
        }),
      );
      const file = savedFileName(
        t("portfolio-file", { firm, day: moment.slice(0, 10) }),
        "xlsx",
        t("portfolio-sheet-clientes"),
      );
      saveFile(bytes, file, XLSX_TYPE);
      setDone({ counts, file, left: begun.left });
    } catch {
      setProblem({ severity: "error", text: t("portfolio-failed"), again: true });
    } finally {
      running.current = false;
      setProgress(null);
      setWriting(false);
    }
  };

  const percent = progress && progress.all > 0 ? Math.round((progress.read / progress.all) * 100) : 0;
  const askFactor = factorNow !== "ok" && !done;

  return (
    <SidePanel
      open={open}
      onClose={close}
      closeLabel={t("close")}
      title={t("portfolio-title")}
      description={t("portfolio-description")}
      icon={<NiArrowInDown size="medium" />}
      busy={busy}
      actions={
        done || (problem && !problem.again) ? (
          <Button variant="contained" onClick={close}>
            {t("close")}
          </Button>
        ) : (
          <>
            <Button
              variant="contained"
              disabled={busy || askFactor}
              startIcon={<NiArrowInDown size="small" />}
              onClick={() => void run()}
            >
              {problem ? t("portfolio-again") : t("portfolio-generate")}
            </Button>
            <Button variant="outlined" color="grey" disabled={busy} onClick={close}>
              {t("cancel")}
            </Button>
          </>
        )
      }
    >
      <Box className="flex flex-col gap-5">
        {done ? (
          <Box className="flex flex-col gap-3">
            <StateLine tone="done">{t("portfolio-done-title")}</StateLine>
            <Typography variant="body2" className="text-text-secondary break-words">
              {t("portfolio-done-body", { file: done.file })}
            </Typography>
            <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
              {PORTFOLIO_SHEETS.map((sheet) => (
                <Box component="li" key={sheet} className="flex items-center justify-between gap-3">
                  <Typography variant="body2" component="span">
                    {portfolioSheetName(sheet, say)}
                  </Typography>
                  <Typography variant="body2" component="span" className="font-semibold tabular-nums">
                    {countText(done.counts[sheet])}
                  </Typography>
                </Box>
              ))}
            </Box>
            <Typography variant="body2" className="text-text-secondary">
              {t("portfolio-done-left", { left: done.left })}
            </Typography>
            <StateLine tone="info">{t("portfolio-care")}</StateLine>
          </Box>
        ) : (
          <>
            <Box className="flex flex-col gap-2">
              <Typography variant="subtitle2" component="h3" className="mb-0">
                {t("portfolio-goes-title")}
              </Typography>
              <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
                {PORTFOLIO_SHEETS.map((sheet) => (
                  <Box component="li" key={sheet} className="flex flex-col">
                    <Typography variant="body2" component="span" className="font-semibold">
                      {portfolioSheetName(sheet, say)}
                    </Typography>
                    <Typography variant="body2" component="span" className="text-text-secondary">
                      {t(GOES[sheet])}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
            <Box className="flex flex-col gap-2">
              <StateLine tone="attention">{t("portfolio-care")}</StateLine>
              <StateLine tone="info">{t("portfolio-record")}</StateLine>
              {testsLeftOut > 0 ? (
                <StateLine tone="info">{t("portfolio-tests-out", { count: testsLeftOut })}</StateLine>
              ) : null}
            </Box>
            {askFactor ? (
              <SecondFactorPrompt
                state={factorNow === "missing" ? "missing" : "challenge"}
                reason={t("portfolio-factor-reason")}
                onConfirmed={() => {
                  setFactorNow("ok");
                  setProblem(null);
                }}
              />
            ) : null}
            {progress ? (
              <Box className="flex flex-col gap-2" role="status">
                <LinearProgress variant="determinate" value={percent} aria-label={t("portfolio-title")} />
                <Typography variant="body2" className="text-text-secondary">
                  {t("portfolio-progress", {
                    sheet: portfolioSheetName(progress.sheet, say),
                    done: countText(progress.done),
                    total: countText(progress.total),
                  })}
                </Typography>
              </Box>
            ) : null}
            {writing ? (
              <Box className="flex flex-col gap-2" role="status">
                <LinearProgress aria-label={t("portfolio-title")} />
                <Typography variant="body2" className="text-text-secondary">
                  {t("portfolio-writing")}
                </Typography>
              </Box>
            ) : null}
            {problem ? (
              <Alert severity={problem.severity} className="neutral bg-background-paper/60!">
                {problem.text}
              </Alert>
            ) : null}
          </>
        )}
      </Box>
    </SidePanel>
  );
}
