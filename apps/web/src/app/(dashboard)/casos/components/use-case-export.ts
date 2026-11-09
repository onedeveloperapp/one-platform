"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import {
  brasiliaMoment,
  type ExportBegun,
  exportColumns,
  type ExportFormat,
  exportLine,
  type ExportRefusal,
  type ExportWords,
  pdfColumns,
  pdfLine,
} from "@/lib/cases/export";
import { beginCaseExport, readCaseExport } from "@/lib/cases/export-actions";
import type { CaseListQuery, CaseListRow } from "@/lib/cases/list";
import { writeXlsx, XLSX_TYPE, type XlsxCell } from "@/lib/export/xlsx-write";
import { savedFileName, saveFile } from "@/lib/files/save-file";
import type { TableCell } from "@flyee/documents/table-pdf";
import { formatDayBr } from "@flyee/rules/person";

/** What the person is told of a refusal, by the database's reason. */
const REFUSED: Record<ExportRefusal, string> = {
  not_allowed: "cases-export-not-allowed",
  support_visit: "cases-export-support-visit",
  daily_limit: "cases-export-daily-limit",
  too_many: "cases-export-too-many",
  empty: "cases-export-empty",
  failed: "cases-export-failed",
};

/** A refusal said in the format's own words: a PDF's limit is not the sheet's, and the sheet is the way out of it. */
const REFUSED_PDF: Partial<Record<ExportRefusal, string>> = {
  too_many: "cases-export-too-many-pdf",
  failed: "cases-export-failed-pdf",
};

const FAILED: Record<ExportFormat, string> = { xlsx: "cases-export-failed", pdf: "cases-export-failed-pdf" };

/** The words while the file is being prepared, by its format. */
export const EXPORT_PROGRESS: Record<ExportFormat, string> = {
  xlsx: "cases-export-progress",
  pdf: "cases-export-progress-pdf",
};

const DONE: Record<ExportFormat, string> = { xlsx: "cases-export-done", pdf: "cases-export-done-pdf" };

const PDF_TYPE = "application/pdf";

export type ExportNote = { severity: "success" | "warning" | "error"; text: string };

/**
 * "Exportar" of the list of cases (phase 1, migrations 0110 and 0115): begun on the record by the database, read a page
 * at a time under the list's own view, search, filters and order, and written in the browser, as an Excel workbook or
 * a PDF. Nothing is saved of a list that could not be read whole: half a list read as the whole of it is worse than
 * none. The PDF's writer loads only when somebody asks for one.
 */
export function useCaseExport(input: {
  query: () => CaseListQuery;
  total: number;
  words: ExportWords;
  namesModule: boolean;
  /** The name of the file: which list it is. */
  fileName: () => string;
  /** What a PDF says of the list above its table. */
  pdf: {
    title: () => string;
    author: string;
    facts: (count: number, made: { day: string; time: string }) => string[];
  };
}) {
  const t = useTranslations("product");
  const [progress, setProgress] = useState<{ done: number; total: number; format: ExportFormat } | null>(null);
  const [note, setNote] = useState<ExportNote | null>(null);
  const running = useRef(false);

  const run = async (format: ExportFormat) => {
    if (running.current) return;
    running.current = true;
    const query = input.query();
    const failed = t(FAILED[format]);
    setNote(null);
    setProgress({ done: 0, total: input.total, format });
    try {
      let begun: ExportBegun;
      try {
        begun = await beginCaseExport(query, input.total, format);
      } catch {
        begun = { ok: false, code: "failed" };
      }
      if (!begun.ok) {
        const key = (format === "pdf" ? REFUSED_PDF[begun.code] : undefined) ?? REFUSED[begun.code];
        setNote({ severity: begun.code === "failed" ? "error" : "warning", text: t(key, { limit: begun.limit ?? 0 }) });
        return;
      }
      const lines: (XlsxCell[] | TableCell[])[] = [];
      const lineOf = (row: CaseListRow) =>
        format === "pdf"
          ? pdfLine(row, input.words, input.namesModule)
          : exportLine(row, input.words, input.namesModule);
      for (let offset = 0; ; offset += begun.pageSize) {
        let answer: Awaited<ReturnType<typeof readCaseExport>>;
        try {
          answer = await readCaseExport(query, offset);
        } catch {
          answer = { ok: false };
        }
        if (!answer.ok) {
          setNote({ severity: "error", text: failed });
          return;
        }
        for (const row of answer.page.rows) lines.push(lineOf(row));
        setProgress({ done: lines.length, total: answer.page.total, format });
        if (offset + begun.pageSize >= answer.page.total) break;
      }
      // A breath for the screen to say the file is being written: writing it holds the page for a moment.
      await new Promise((resolve) => window.setTimeout(resolve, 30));
      try {
        if (format === "pdf") {
          const { writeTablePdf } = await import("@flyee/documents/table-pdf");
          const madeAt = new Date();
          const moment = brasiliaMoment(madeAt.toISOString()) ?? "";
          const bytes = await writeTablePdf({
            title: input.pdf.title(),
            author: input.pdf.author,
            facts: input.pdf.facts(lines.length, {
              day: formatDayBr(moment.slice(0, 10)) ?? "",
              time: moment.slice(11, 16),
            }),
            columns: pdfColumns(input.words, input.namesModule),
            rows: lines as TableCell[][],
            madeAt,
          });
          saveFile(bytes, savedFileName(input.fileName(), "pdf", t("cases-export-sheet")), PDF_TYPE);
        } else {
          const bytes = writeXlsx({
            sheet: t("cases-export-sheet"),
            columns: exportColumns(input.words, input.namesModule),
            rows: lines as XlsxCell[][],
          });
          saveFile(bytes, savedFileName(input.fileName(), "xlsx", t("cases-export-sheet")), XLSX_TYPE);
        }
      } catch {
        // The browser could not write the file (memory, a chunk that did not load): nothing was saved, and it is said.
        setNote({ severity: "error", text: failed });
        return;
      }
      setNote({ severity: "success", text: t(DONE[format], { count: lines.length, left: begun.left }) });
    } finally {
      running.current = false;
      setProgress(null);
    }
  };

  return { run, progress, note, clearNote: () => setNote(null) };
}
