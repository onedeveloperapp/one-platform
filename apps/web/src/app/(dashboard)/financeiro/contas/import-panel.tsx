"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Box, Button, FormControlLabel, Radio, RadioGroup, Typography } from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import NiUploadCloud from "@/icons/nexture/ni-upload-cloud";
import { dayLabel, financeErrorKey, money } from "@/lib/finance/books";
import {
  type FinanceImport,
  finishFinanceImport,
  importFinanceBills,
  type ImportNote,
  readFinanceImports,
  undoFinanceImport,
} from "@/lib/finance/import-actions";
import { type LegacyDirection, legacyNumbers, type LegacyRead } from "@/lib/finance/legacy-bills";
import {
  IMPORT_LINES_PER_CALL,
  type LegacyFile,
  type LegacyLine,
  legacyLines,
  readLegacyFile,
} from "@/lib/finance/legacy-file";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

const NOTE_KEY: Record<string, string> = {
  cents: "finance-legacy-note-cents",
  due_on: "finance-legacy-note-due",
  category: "finance-legacy-note-category",
  category_other: "finance-legacy-note-category-other",
  case: "finance-legacy-note-case",
  text: "finance-legacy-note-text",
  invalid: "finance-legacy-note-invalid",
};
const PROBLEM_KEY: Record<string, string> = {
  no_value: "finance-legacy-problem-value",
  value_not_positive: "finance-legacy-problem-value",
  no_due: "finance-legacy-problem-due",
  due_not_understood: "finance-legacy-problem-due",
  no_direction: "finance-legacy-problem-direction",
  no_counterparty: "finance-legacy-problem-who",
};

type Done = { importId: string; opened: number; existed: number; notes: ImportNote[] };

/**
 * "Importar contas em aberto" (migration 0153): the bills a firm still has to pay and to receive in the system it used
 * before, from its spreadsheet, read here in the browser and never uploaded. The panel says what the file brings before
 * anything is written (how many to pay and to receive, of which cases, past their day, the lines left out and why),
 * asks the way when the file has no column of it, sends the lines in parts, and says what came of it with the way to
 * undo the import while nothing of it was paid. The latest imports are listed under it, each one click from its undoing.
 */
export default function ImportPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("product");
  const router = useRouter();
  const input = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<Extract<LegacyFile, { ok: true }> | null>(null);
  const [way, setWay] = useState<LegacyDirection | null>(null);
  const [read, setRead] = useState<{ read: LegacyRead; lines: LegacyLine[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [imports, setImports] = useState<FinanceImport[] | null>(null);
  const [undoing, setUndoing] = useState<FinanceImport | null>(null);

  const reload = () => void readFinanceImports().then(setImports);
  useEffect(() => {
    if (open) reload();
  }, [open]);

  // The lines are read again whenever the file or the way the person said changes.
  useEffect(() => {
    if (!file) return setRead(null);
    let live = true;
    void legacyLines(file, file.columns.direction === null ? way : null, today()).then((answer) => {
      if (live) setRead(answer);
    });
    return () => {
      live = false;
    };
  }, [file, way]);

  const reset = () => {
    setFile(null);
    setWay(null);
    setRead(null);
    setSent(0);
    setProblem(null);
    setDone(null);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const choose = async (chosen: File) => {
    reset();
    const answer = await readLegacyFile(chosen);
    if (!answer.ok) setProblem(t(`finance-legacy-file-${answer.code}`));
    else setFile(answer);
  };

  const send = async () => {
    if (!file || !read || read.lines.length === 0) return;
    setBusy(true);
    setProblem(null);
    setSent(0);
    let importId: string | null = null;
    const total: Done = { importId: "", opened: 0, existed: 0, notes: [] };
    for (let start = 0; start < read.lines.length; start += IMPORT_LINES_PER_CALL) {
      const part = read.lines.slice(start, start + IMPORT_LINES_PER_CALL);
      const answer: Awaited<ReturnType<typeof importFinanceBills>> | null = await importFinanceBills(
        importId,
        file.fileName,
        part,
      ).catch(() => null);
      if (!answer?.ok) {
        const code = answer?.code ?? "failed";
        setProblem(t(financeErrorKey(code)));
        break;
      }
      importId = answer.importId;
      total.importId = answer.importId;
      total.opened += answer.opened;
      total.existed += answer.existed;
      total.notes.push(...answer.notes);
      setSent(start + part.length);
    }
    setBusy(false);
    if (importId) {
      setDone(total);
      await finishFinanceImport();
      router.refresh();
      reload();
    }
  };

  const numbers = read ? legacyNumbers(read.read, today()) : null;
  const needsWay = file !== null && file.columns.direction === null;

  return (
    <>
      <SidePanel
        open={open}
        onClose={close}
        closeLabel={t("finance-cancel")}
        title={t("finance-legacy-title")}
        description={t("finance-legacy-description")}
        icon={<NiUploadCloud size="medium" />}
        busy={busy}
        wide
        actions={
          done ? (
            <Button variant="contained" onClick={close}>
              {t("finance-legacy-close")}
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={busy || !read || read.lines.length === 0 || (needsWay && !way)}
              onClick={() => void send()}
            >
              {busy
                ? t("finance-legacy-sending", { sent, total: read?.lines.length ?? 0 })
                : t("finance-legacy-send", { count: read?.lines.length ?? 0 })}
            </Button>
          )
        }
      >
        <Box className="flex flex-col gap-4">
          {!done ? (
            <Box className="flex flex-wrap items-center gap-3">
              <Button variant="outlined" color="grey" disabled={busy} onClick={() => input.current?.click()}>
                {file ? t("finance-legacy-choose-other") : t("finance-legacy-choose")}
              </Button>
              {file ? (
                <Typography variant="body2" className="text-text-secondary">
                  {file.fileName}
                </Typography>
              ) : null}
              <input
                ref={input}
                type="file"
                accept=".csv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                hidden
                aria-label={t("finance-legacy-choose")}
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  event.target.value = "";
                  if (chosen) void choose(chosen);
                }}
              />
            </Box>
          ) : null}
          {problem ? <StateLine tone="failed">{problem}</StateLine> : null}

          {needsWay && !done ? (
            <Box className="flex flex-col gap-1">
              <Typography variant="subtitle2" component="h3">
                {t("finance-legacy-way-question")}
              </Typography>
              <RadioGroup
                row
                value={way ?? ""}
                onChange={(event) => setWay(event.target.value === "pay" ? "pay" : "receive")}
              >
                <FormControlLabel value="pay" control={<Radio />} label={t("finance-legacy-way-pay")} />
                <FormControlLabel value="receive" control={<Radio />} label={t("finance-legacy-way-receive")} />
              </RadioGroup>
            </Box>
          ) : null}

          {numbers && !done ? (
            <Box className="flex flex-col gap-2">
              <Typography variant="subtitle2" component="h3">
                {t("finance-legacy-brings")}
              </Typography>
              {numbers.pay.count > 0 ? (
                <StateLine tone="info">
                  {t("finance-legacy-pay", { count: numbers.pay.count, value: money(numbers.pay.cents) })}
                </StateLine>
              ) : null}
              {numbers.receive.count > 0 ? (
                <StateLine tone="info">
                  {t("finance-legacy-receive", { count: numbers.receive.count, value: money(numbers.receive.cents) })}
                </StateLine>
              ) : null}
              {numbers.withCase > 0 ? (
                <StateLine tone="info">{t("finance-legacy-with-case", { count: numbers.withCase })}</StateLine>
              ) : null}
              {numbers.late > 0 ? (
                <StateLine tone="attention">{t("finance-legacy-late", { count: numbers.late })}</StateLine>
              ) : null}
              {read && read.read.refused.length > 0 ? (
                <Box className="flex flex-col gap-1">
                  <StateLine tone="attention">
                    {t("finance-legacy-refused", { count: read.read.refused.length })}
                  </StateLine>
                  <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0 pl-7">
                    {read.read.refused.slice(0, 20).map((item) => (
                      <Typography component="li" variant="body2" className="text-text-secondary" key={item.line}>
                        {t("finance-legacy-line", { line: item.line })} · {t(PROBLEM_KEY[item.problem])}
                      </Typography>
                    ))}
                  </Box>
                </Box>
              ) : null}
              {read && read.lines.length > 0 ? (
                <Box component="ul" className="m-0 flex list-none flex-col p-0">
                  {read.read.bills.slice(0, 5).map((bill) => (
                    <Box
                      component="li"
                      key={bill.line}
                      className="border-grey-100 flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0"
                    >
                      <Typography variant="body2" className="min-w-0 truncate">
                        {[bill.counterparty, bill.description].filter(Boolean).join(" · ")}
                      </Typography>
                      <Typography variant="body2" className="shrink-0 tabular-nums">
                        {money(bill.cents)} · {dayLabel(bill.dueOn)}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              ) : null}
            </Box>
          ) : null}

          {done ? (
            <Box className="flex flex-col gap-2">
              <StateLine tone="done">{t("finance-legacy-done", { count: done.opened })}</StateLine>
              {done.existed > 0 ? (
                <StateLine tone="info">{t("finance-legacy-existed", { count: done.existed })}</StateLine>
              ) : null}
              {done.notes.length > 0 ? (
                <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
                  {done.notes.slice(0, 30).map((note) => (
                    <Typography
                      component="li"
                      variant="body2"
                      className="text-text-secondary"
                      key={`${note.line}-${note.code}`}
                    >
                      {t("finance-legacy-line", { line: note.line })} · {t(NOTE_KEY[note.code] ?? NOTE_KEY.invalid)}
                    </Typography>
                  ))}
                </Box>
              ) : null}
            </Box>
          ) : null}

          {imports && imports.length > 0 ? (
            <Box className="flex flex-col gap-2">
              <Typography variant="subtitle2" component="h3">
                {t("finance-legacy-history")}
              </Typography>
              <Box component="ul" className="m-0 flex list-none flex-col p-0">
                {imports.map((item) => (
                  <Box
                    component="li"
                    key={item.id}
                    className="border-grey-100 flex flex-wrap items-center justify-between gap-3 border-b py-2 last:border-b-0"
                  >
                    <Box className="flex min-w-0 flex-col">
                      <Typography variant="body2">{item.fileName ?? t("finance-legacy-no-name")}</Typography>
                      <Typography variant="body2" className="text-text-secondary">
                        {item.undoneAt
                          ? t("finance-legacy-undone-on", { day: dayLabel(item.undoneAt.slice(0, 10)) })
                          : t("finance-legacy-history-line", {
                              day: dayLabel(item.createdAt.slice(0, 10)),
                              count: item.opened,
                            })}
                      </Typography>
                    </Box>
                    {!item.undoneAt && item.opened > 0 ? (
                      <Button size="small" color="grey" disabled={busy} onClick={() => setUndoing(item)}>
                        {t("finance-legacy-undo")}
                      </Button>
                    ) : null}
                  </Box>
                ))}
              </Box>
            </Box>
          ) : null}
        </Box>
      </SidePanel>
      {undoing ? (
        <ConfirmActionDialog
          title={t("finance-legacy-undo-title")}
          intro={t("finance-legacy-undo-intro", { name: undoing.fileName ?? t("finance-legacy-no-name") })}
          consequences={[t("finance-legacy-undo-cancels")]}
          stays={[t("finance-legacy-undo-keeps", { count: undoing.paid })]}
          confirmLabel={t("finance-legacy-undo")}
          cancelLabel={t("finance-cancel")}
          tone="warning"
          onClose={() => setUndoing(null)}
          onConfirm={async () => {
            const answer = await undoFinanceImport(undoing.id);
            if (!answer.ok) return t(financeErrorKey(answer.code));
            setUndoing(null);
            router.refresh();
            reload();
            return null;
          }}
        />
      ) : null}
    </>
  );
}
