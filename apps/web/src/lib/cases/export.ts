import { caseLabel, type CaseStatus } from "@/lib/cases/cases";
import { type JourneyStepId, stepOf } from "@/lib/cases/journey";
import type { CaseListRow } from "@/lib/cases/list";
import type { XlsxCell, XlsxColumn } from "@/lib/export/xlsx-write";
import { type FirmFunction, type OrgRole, overseesFirm } from "@/lib/firm/roles";
import type { TableCell, TableColumn } from "@flyee/documents/table-pdf";
import { formatCnj } from "@flyee/rules/cnj";
import { formatDayBr } from "@flyee/rules/person";

/**
 * The list of cases as a spreadsheet (phase 1, migration 0110) or a PDF (0115). Pure: who is offered it, what the
 * database answered of beginning one, and each case as a line of the file, by the same words and the same step the
 * list shows.
 */

/** What the list is taken to: a workbook holds it all, a PDF is to read or to print and holds fewer lines. */
export type ExportFormat = "xlsx" | "pdf";

/** Who is offered "Exportar": a partner, the controladoria, or who manages the firm (`may_export_cases` decides). */
export const canExportCases = (role: OrgRole, firmFunction: FirmFunction): boolean => overseesFirm(role, firmFunction);

export type ExportRefusal = "not_allowed" | "support_visit" | "daily_limit" | "too_many" | "empty" | "failed";

export type ExportBegun =
  | { ok: true; pageSize: number; left: number }
  | { ok: false; code: ExportRefusal; limit?: number };

/** What `begin_case_export` answered; anything else is a failure, never an export. */
export function exportBegunOf(raw: unknown): ExportBegun {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const number = (item: unknown) => (typeof item === "number" && Number.isFinite(item) ? item : null);
  const pageSize = number(value.page);
  if (value.ok === true && pageSize !== null && pageSize > 0) {
    return { ok: true, pageSize, left: Math.max(number(value.left) ?? 0, 0) };
  }
  const code = value.code;
  const known: ExportRefusal[] = ["not_allowed", "support_visit", "daily_limit", "too_many", "empty"];
  const limit = number(value.limit);
  return {
    ok: false,
    code: known.includes(code as ExportRefusal) ? (code as ExportRefusal) : "failed",
    ...(limit === null ? {} : { limit }),
  };
}

/** The words of the sheet: its titles and how each thing of a case is named on screen. */
export type ExportWords = {
  titles: Record<ExportColumnKey, string>;
  moduleName: (key: string) => string;
  kindName: (key: string) => string;
  airlineName: (iata: string) => string;
  statusName: (status: CaseStatus) => string;
  stepName: (step: JourneyStepId) => string;
  /** Who has the case, and why, in the list's words. */
  holderName: (holder: string | null) => string;
  reasonName: (holder: string | null, why: string | null) => string | null;
  /** The word of a column that says yes (a case stagnated). */
  yes: string;
  /** The PDF's own: the title of the flight's column, and how long a case is at its step. */
  flightTitle: string;
  daysName: (days: number) => string;
};

export type ExportColumnKey =
  | "case"
  | "client"
  | "test"
  | "module"
  | "kind"
  | "agency"
  | "airline"
  | "flightDate"
  | "status"
  | "step"
  | "lawsuits"
  | "movedAt"
  | "updatedAt"
  | "holder"
  | "why"
  | "stepDays"
  | "stagnant";

const COLUMNS: { key: ExportColumnKey; kind?: XlsxColumn["kind"]; width: number }[] = [
  { key: "case", kind: "number", width: 8 },
  { key: "client", width: 32 },
  { key: "module", width: 24 },
  { key: "kind", width: 22 },
  { key: "agency", width: 22 },
  { key: "airline", width: 18 },
  { key: "flightDate", kind: "date", width: 12 },
  { key: "status", width: 18 },
  { key: "step", width: 14 },
  { key: "stepDays", kind: "number", width: 10 },
  { key: "stagnant", width: 11 },
  { key: "holder", width: 18 },
  { key: "why", width: 30 },
  { key: "lawsuits", width: 28 },
  { key: "movedAt", kind: "moment", width: 17 },
  { key: "updatedAt", kind: "moment", width: 17 },
  { key: "test", width: 8 },
];

const BRASILIA = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** A moment on the clock of Brasília, as the database counts its days ("YYYY-MM-DD HH:MM"); null when it is none. */
export function brasiliaMoment(iso: string | null): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? BRASILIA.format(at) : null;
}

/** The columns of the sheet: the module's only when the firm has more than one. */
export function exportColumns(words: ExportWords, namesModule: boolean): XlsxColumn[] {
  return COLUMNS.filter((column) => namesModule || column.key !== "module").map((column) => ({
    title: words.titles[column.key],
    kind: column.kind,
    width: column.width,
  }));
}

/** A case as a line of the sheet, in the order of `exportColumns`. */
export function exportLine(row: CaseListRow, words: ExportWords, namesModule: boolean): XlsxCell[] {
  const step = stepOf(row.status, row.court ?? { held: false, decided: false, paid: false });
  const cells: Record<ExportColumnKey, XlsxCell> = {
    case: row.seq,
    client: row.client,
    test: row.isTest ? words.yes : null,
    module: words.moduleName(row.module),
    kind: row.incident ? words.kindName(row.incident) : null,
    agency: row.agency,
    airline: row.airline ? words.airlineName(row.airline) : null,
    flightDate: row.flightDate,
    status: words.statusName(row.status),
    step: step ? words.stepName(step) : null,
    stepDays: row.stepDays,
    stagnant: row.stagnant ? words.yes : null,
    holder: words.holderName(row.holder),
    why: words.reasonName(row.holder, row.why),
    lawsuits: row.cnjs.map((cnj) => formatCnj(cnj) ?? cnj).join(", ") || null,
    movedAt: brasiliaMoment(row.movedAt),
    updatedAt: brasiliaMoment(row.updatedAt),
  };
  return COLUMNS.filter((column) => namesModule || column.key !== "module").map((column) => cells[column.key]);
}

type PdfColumnKey =
  | "case"
  | "client"
  | "module"
  | "kind"
  | "flight"
  | "step"
  | "stepDays"
  | "holder"
  | "lawsuits"
  | "movedAt";

/**
 * The PDF's columns: what the list shows, since a page holds fewer than a sheet. The shares keep a case's label and a
 * lawsuit's number on one line, also beside the module's column.
 */
const PDF_COLUMNS: { key: PdfColumnKey; share: number }[] = [
  { key: "case", share: 6 },
  { key: "client", share: 16 },
  { key: "module", share: 10 },
  { key: "kind", share: 10 },
  { key: "flight", share: 10 },
  { key: "step", share: 11 },
  { key: "stepDays", share: 8 },
  { key: "holder", share: 17 },
  { key: "lawsuits", share: 16 },
  { key: "movedAt", share: 8 },
];

/** The day of a moment on the clock of Brasília, as the screens write a day. */
const brasiliaDay = (iso: string | null): string | null => {
  const moment = brasiliaMoment(iso);
  return moment ? formatDayBr(moment.slice(0, 10)) : null;
};

/** The columns of the PDF: the module's only when the firm has more than one. */
export function pdfColumns(words: ExportWords, namesModule: boolean): TableColumn[] {
  return PDF_COLUMNS.filter((column) => namesModule || column.key !== "module").map((column) => ({
    title: column.key === "flight" ? words.flightTitle : words.titles[column.key],
    share: column.share,
  }));
}

/** A case as a line of the PDF, in the order of `pdfColumns`: what it is above, its detail under it. */
export function pdfLine(row: CaseListRow, words: ExportWords, namesModule: boolean): TableCell[] {
  const step = stepOf(row.status, row.court ?? { held: false, decided: false, paid: false });
  const reason = words.reasonName(row.holder, row.why);
  const flightDay = row.flightDate ? formatDayBr(row.flightDate) : null;
  const cells: Record<PdfColumnKey, TableCell> = {
    case: caseLabel(row.seq),
    client: [{ text: row.client }, ...(row.isTest ? [{ text: words.titles.test, soft: true }] : [])],
    module: words.moduleName(row.module),
    kind: [
      ...(row.incident ? [{ text: words.kindName(row.incident) }] : []),
      ...(row.agency ? [{ text: row.agency, soft: true }] : []),
    ],
    flight: [
      ...(row.airline ? [{ text: words.airlineName(row.airline) }] : []),
      ...(flightDay ? [{ text: flightDay, soft: true }] : []),
    ],
    step: [{ text: words.statusName(row.status) }, ...(step ? [{ text: words.stepName(step), soft: true }] : [])],
    stepDays: [
      ...(row.stepDays !== null ? [{ text: words.daysName(row.stepDays) }] : []),
      ...(row.stagnant ? [{ text: words.titles.stagnant, strong: true }] : []),
    ],
    holder: [{ text: words.holderName(row.holder), strong: true }, ...(reason ? [{ text: reason, soft: true }] : [])],
    lawsuits: row.cnjs.map((cnj) => ({ text: formatCnj(cnj) ?? cnj })),
    movedAt: brasiliaDay(row.movedAt),
  };
  return PDF_COLUMNS.filter((column) => namesModule || column.key !== "module").map((column) => cells[column.key]);
}
