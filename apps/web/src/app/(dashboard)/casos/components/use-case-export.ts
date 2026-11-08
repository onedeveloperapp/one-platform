"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { type ExportBegun, exportColumns, exportLine, type ExportRefusal, type ExportWords } from "@/lib/cases/export";
import { beginCaseExport, readCaseExport } from "@/lib/cases/export-actions";
import type { CaseListQuery } from "@/lib/cases/list";
import { writeXlsx, XLSX_TYPE, type XlsxCell } from "@/lib/export/xlsx-write";
import { savedFileName, saveFile } from "@/lib/files/save-file";

/** What the person is told of a refusal, by the database's reason. */
const REFUSED: Record<ExportRefusal, string> = {
  not_allowed: "cases-export-not-allowed",
  support_visit: "cases-export-support-visit",
  daily_limit: "cases-export-daily-limit",
  too_many: "cases-export-too-many",
  empty: "cases-export-empty",
  failed: "cases-export-failed",
};

export type ExportNote = { severity: "success" | "warning" | "error"; text: string };

/**
 * "Exportar" of the list of cases (phase 1, migration 0110): begun on the record by the database, read a page at a
 * time under the list's own view, search, filters and order, and written in the browser as an Excel workbook. Nothing
 * is saved of a list that could not be read whole: half a list read as the whole of it is worse than none.
 */
export function useCaseExport(input: {
  query: () => CaseListQuery;
  total: number;
  words: ExportWords;
  namesModule: boolean;
  /** The name of the file: which list it is. */
  fileName: () => string;
}) {
  const t = useTranslations("product");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState<ExportNote | null>(null);
  const running = useRef(false);

  const run = async () => {
    if (running.current) return;
    running.current = true;
    const query = input.query();
    setNote(null);
    setProgress({ done: 0, total: input.total });
    try {
      let begun: ExportBegun;
      try {
        begun = await beginCaseExport(query, input.total);
      } catch {
        begun = { ok: false, code: "failed" };
      }
      if (!begun.ok) {
        setNote({
          severity: begun.code === "failed" ? "error" : "warning",
          text: t(REFUSED[begun.code], { limit: begun.limit ?? 0 }),
        });
        return;
      }
      const lines: XlsxCell[][] = [];
      for (let offset = 0; ; offset += begun.pageSize) {
        let answer: Awaited<ReturnType<typeof readCaseExport>>;
        try {
          answer = await readCaseExport(query, offset);
        } catch {
          answer = { ok: false };
        }
        if (!answer.ok) {
          setNote({ severity: "error", text: t("cases-export-failed") });
          return;
        }
        for (const row of answer.page.rows) lines.push(exportLine(row, input.words, input.namesModule));
        setProgress({ done: lines.length, total: answer.page.total });
        if (offset + begun.pageSize >= answer.page.total) break;
      }
      // A breath for the screen to say the file is being written: writing it holds the page for a moment.
      await new Promise((resolve) => window.setTimeout(resolve, 30));
      const bytes = writeXlsx({
        sheet: t("cases-export-sheet"),
        columns: exportColumns(input.words, input.namesModule),
        rows: lines,
      });
      saveFile(bytes, savedFileName(input.fileName(), "xlsx", t("cases-export-sheet")), XLSX_TYPE);
      setNote({ severity: "success", text: t("cases-export-done", { count: lines.length, left: begun.left }) });
    } finally {
      running.current = false;
      setProgress(null);
    }
  };

  return { run, progress, note, clearNote: () => setNote(null) };
}
