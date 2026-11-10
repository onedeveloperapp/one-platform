import {
  caseLabel,
  type CaseStatus,
  DOCUMENT_KIND_KEY,
  DOCUMENT_STATUS_KEY,
  isCaseStatus,
  MARITAL_KEY,
  PERSON_FIELD_KEY,
  STATUS_KEY as CASE_STATUS_KEY,
} from "@/lib/cases/cases";
import { COUNTING_KEY, STATUS_KEY as DEADLINE_STATUS_KEY } from "@/lib/deadlines/deadlines";
import type { XlsxCell, XlsxColumn, XlsxSheet } from "@/lib/export/xlsx-write";
import { ENTRY_KIND_KEY } from "@/lib/finance/books";
import {
  KIND_KEY as HEARING_KIND_KEY,
  MODE_KEY,
  OUTCOME_KEY,
  STATUS_KEY as HEARING_STATUS_KEY,
  ZONE_KEY,
} from "@/lib/hearings/hearings";
import { caseKindLabelKey } from "@/lib/modules/registry";
import { formatCnj } from "@flyee/rules/cnj";

/**
 * "Levar a carteira inteira" (phase 1 of the plan of the controladoria, migrations 0117 and 0118, which added the
 * hearings): everything of the firm in one workbook, for who decides for it. Pure: what the database answered, and each row as a line of its sheet, by the same
 * words the screens use. The file holds every client's personal data, and only the person's browser ever writes it.
 */

/** The sheets of the file, in the order they are read and written. */
export const PORTFOLIO_SHEETS = [
  "clientes",
  "casos",
  "acoes",
  "prazos",
  "audiencias",
  "documentos",
  "lancamentos",
  "contas",
] as const;
export type PortfolioSheet = (typeof PORTFOLIO_SHEETS)[number];
export const isPortfolioSheet = (value: unknown): value is PortfolioSheet =>
  (PORTFOLIO_SHEETS as readonly unknown[]).includes(value);

/** How many rows each sheet holds. */
export type PortfolioCounts = Record<PortfolioSheet, number>;

export type PortfolioRefusal =
  | "not_allowed"
  | "support_visit"
  | "second_factor"
  | "daily_limit"
  | "too_many"
  | "empty"
  | "failed";

export type PortfolioBegun =
  | { ok: true; pageSize: number; counts: PortfolioCounts; left: number }
  | { ok: false; code: PortfolioRefusal; limit?: number; sheet?: PortfolioSheet };

const REFUSALS: PortfolioRefusal[] = [
  "not_allowed",
  "support_visit",
  "second_factor",
  "daily_limit",
  "too_many",
  "empty",
];

const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;

/** What `begin_portfolio_export` answered; anything else is a failure, never a portfolio. */
export function portfolioBegunOf(raw: unknown): PortfolioBegun {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const pageSize = whole(value.page);
  const counted = (typeof value.counts === "object" && value.counts !== null ? value.counts : null) as Record<
    string,
    unknown
  > | null;
  if (value.ok === true && pageSize && counted && PORTFOLIO_SHEETS.every((sheet) => whole(counted[sheet]) !== null)) {
    return {
      ok: true,
      pageSize,
      counts: Object.fromEntries(PORTFOLIO_SHEETS.map((sheet) => [sheet, whole(counted[sheet])])) as PortfolioCounts,
      left: whole(value.left) ?? 0,
    };
  }
  const limit = whole(value.limit);
  return {
    ok: false,
    code: REFUSALS.includes(value.code as PortfolioRefusal) ? (value.code as PortfolioRefusal) : "failed",
    ...(limit === null ? {} : { limit }),
    ...(isPortfolioSheet(value.sheet) ? { sheet: value.sheet } : {}),
  };
}

/** A row of a sheet, as the database wrote it. */
export type PortfolioRow = Record<string, unknown>;

/** The rows of a page; null when the answer is not one (a read that failed is never a sheet with nothing). */
export function portfolioRowsOf(raw: unknown): PortfolioRow[] | null {
  const rows = (typeof raw === "object" && raw !== null ? (raw as { rows?: unknown }).rows : null) as unknown;
  return Array.isArray(rows) ? (rows as PortfolioRow[]) : null;
}

/** What says a key's words, the app's `t`. */
export type Say = (key: string, values?: Record<string, string | number>) => string;

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value !== "" && Number.isFinite(Number(value))
      ? Number(value)
      : null;

/** A CPF as people write it; digits that are no CPF stay as they are. */
export const cpfText = (value: unknown): string | null => {
  const digits = text(value);
  return digits && /^\d{11}$/.test(digits)
    ? `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
    : digits;
};

/** A word from a table of keys, the value as it is when the table does not know it (a newer database's). */
const named = (table: Record<string, string>, value: unknown, say: Say): string | null => {
  const key = text(value);
  if (!key) return null;
  return table[key] ? say(table[key]) : key;
};

const LAWSUIT_KIND_KEY: Record<string, string> = {
  juizado: "case-proceeding-kind-juizado",
  comum: "case-proceeding-kind-comum",
};

const LAWSUIT_STATUS_KEY: Record<string, string> = {
  planned: "portfolio-lawsuit-planned",
  filed: "portfolio-lawsuit-filed",
  closed: "portfolio-lawsuit-closed",
};

const SYSTEM_KEY: Record<string, string> = {
  projudi: "case-system-projudi",
  eproc: "case-system-eproc",
  pje: "case-system-pje",
  esaj: "case-system-esaj",
  outro: "case-system-outro",
};

const SOURCE_KEY: Record<string, string> = {
  client: "case-document-source-client",
  firm: "case-document-source-firm",
  whatsapp: "case-document-source-whatsapp",
  partner: "case-document-source-partner",
};

const caseCell = (value: unknown): XlsxCell => number(value);

/** A value of the books in reais, from its cents. */
const money = (name: string) => (row: PortfolioRow) => {
  const cents = number(row[name]);
  return cents === null ? null : cents / 100;
};

const BILL_DIRECTION_KEY: Record<string, string> = {
  pay: "portfolio-bill-pay",
  receive: "portfolio-bill-receive",
};

const BILL_STATUS_KEY: Record<string, string> = {
  open: "portfolio-bill-open",
  paid: "portfolio-bill-paid",
  cancelled: "portfolio-bill-cancelled",
  renegotiated: "portfolio-bill-renegotiated",
  written_off: "portfolio-bill-written-off",
};

/** One column of a sheet: the words of its title, what it holds, and its value in a row. */
type Column = {
  title: string;
  kind?: XlsxColumn["kind"];
  width: number;
  value: (row: PortfolioRow, say: Say) => XlsxCell;
};

const field = (name: string) => (row: PortfolioRow) => text(row[name]);
const yes = (name: string) => (row: PortfolioRow, say: Say) => (row[name] === true ? say("cases-export-yes") : null);

const COLUMNS: Record<PortfolioSheet, Column[]> = {
  clientes: [
    { title: PERSON_FIELD_KEY.full_name, width: 32, value: field("name") },
    { title: PERSON_FIELD_KEY.cpf, width: 16, value: (row) => cpfText(row.cpf) },
    { title: PERSON_FIELD_KEY.birth_date, kind: "date", width: 12, value: field("birth_date") },
    { title: PERSON_FIELD_KEY.nationality, width: 14, value: field("nationality") },
    {
      title: PERSON_FIELD_KEY.marital_status,
      width: 14,
      value: (row, say) => named(MARITAL_KEY, row.marital_status, say),
    },
    { title: PERSON_FIELD_KEY.profession, width: 18, value: field("profession") },
    { title: PERSON_FIELD_KEY.email, width: 28, value: field("email") },
    { title: PERSON_FIELD_KEY.phone, width: 16, value: field("phone") },
    { title: PERSON_FIELD_KEY.postal_code, width: 10, value: field("postal_code") },
    { title: PERSON_FIELD_KEY.street, width: 28, value: field("street") },
    { title: PERSON_FIELD_KEY.address_number, width: 8, value: field("address_number") },
    { title: PERSON_FIELD_KEY.complement, width: 16, value: field("complement") },
    { title: PERSON_FIELD_KEY.district, width: 18, value: field("district") },
    { title: PERSON_FIELD_KEY.city, width: 18, value: field("city") },
    { title: PERSON_FIELD_KEY.uf, width: 6, value: field("uf") },
    {
      title: "portfolio-column-cases",
      width: 16,
      value: (row) =>
        Array.isArray(row.cases) && row.cases.length > 0
          ? row.cases.map((seq) => caseLabel(Number(seq))).join(", ")
          : null,
    },
    { title: "portfolio-column-created", kind: "moment", width: 17, value: field("created_at") },
  ],
  casos: [
    { title: "cases-column-case", kind: "number", width: 8, value: (row) => caseCell(row.seq) },
    { title: "cases-column-client", width: 32, value: field("client") },
    {
      title: "cases-column-module",
      width: 24,
      value: (row) => text(row.module_name) ?? text(row.module),
    },
    {
      title: "cases-export-kind",
      width: 22,
      value: (row, say) => {
        const key = caseKindLabelKey(text(row.incident));
        return key ? say(key) : text(row.incident);
      },
    },
    { title: "cases-export-agency", width: 22, value: field("agency") },
    { title: "cases-export-airline", width: 18, value: field("airline") },
    { title: "cases-export-flight-date", kind: "date", width: 12, value: field("flight_date") },
    {
      title: "cases-export-status",
      width: 18,
      value: (row, say) =>
        isCaseStatus(row.status) ? say(CASE_STATUS_KEY[row.status as CaseStatus]) : text(row.status),
    },
    { title: "portfolio-column-opened", kind: "moment", width: 17, value: field("created_at") },
    { title: "portfolio-column-closed", kind: "moment", width: 17, value: field("closed_at") },
    { title: "cases-test-mark", width: 8, value: yes("is_test") },
  ],
  acoes: [
    { title: "cases-column-case", kind: "number", width: 8, value: (row) => caseCell(row.seq) },
    { title: "portfolio-column-cnj", width: 28, value: (row) => formatCnj(text(row.cnj)) ?? text(row.cnj) },
    { title: "case-proceeding-kind", width: 22, value: (row, say) => named(LAWSUIT_KIND_KEY, row.kind, say) },
    {
      title: "portfolio-column-lawsuit-status",
      width: 14,
      value: (row, say) => named(LAWSUIT_STATUS_KEY, row.status, say),
    },
    { title: "case-proceeding-court", width: 10, value: field("court") },
    { title: "case-proceeding-comarca", width: 18, value: field("comarca") },
    { title: "case-proceeding-unit", width: 24, value: field("unit") },
    { title: "case-proceeding-system", width: 12, value: (row, say) => named(SYSTEM_KEY, row.system, say) },
    { title: "portfolio-column-filed", kind: "date", width: 12, value: field("filed_at") },
    { title: "portfolio-column-forum", width: 18, value: field("forum_city") },
    { title: "portfolio-column-claimants", width: 32, value: field("claimants") },
    {
      title: "portfolio-column-claim",
      kind: "number",
      width: 16,
      value: (row) => {
        const cents = number(row.claim_cents);
        return cents === null ? null : cents / 100;
      },
    },
    { title: "portfolio-column-lawyers", width: 34, value: field("lawyers") },
  ],
  prazos: [
    { title: "cases-column-case", kind: "number", width: 8, value: (row) => caseCell(row.seq) },
    { title: "portfolio-column-cnj", width: 28, value: (row) => formatCnj(text(row.cnj)) ?? text(row.cnj) },
    { title: "case-proceeding-court", width: 10, value: field("court") },
    { title: "portfolio-column-deadline", width: 32, value: field("title") },
    { title: "portfolio-column-from", kind: "date", width: 12, value: field("trigger_on") },
    { title: "portfolio-column-days", kind: "number", width: 8, value: (row) => number(row.days) },
    {
      title: "portfolio-column-counting",
      width: 16,
      value: (row, say) => named(COUNTING_KEY, row.counting, say),
    },
    { title: "portfolio-column-due", kind: "date", width: 12, value: field("due_on") },
    {
      title: "portfolio-column-deadline-status",
      width: 14,
      value: (row, say) => named(DEADLINE_STATUS_KEY, row.status, say),
    },
    { title: "portfolio-column-confirmed", kind: "moment", width: 17, value: field("confirmed_at") },
    { title: "portfolio-column-confirmed-one", width: 10, value: yes("confirmed_auto") },
    { title: "portfolio-column-done", kind: "moment", width: 17, value: field("done_at") },
    { title: "portfolio-column-dismissed", width: 30, value: field("dismiss_reason") },
  ],
  audiencias: [
    { title: "cases-column-case", kind: "number", width: 8, value: (row) => caseCell(row.seq) },
    { title: "portfolio-column-cnj", width: 28, value: (row) => formatCnj(text(row.cnj)) ?? text(row.cnj) },
    { title: "case-proceeding-court", width: 10, value: field("court") },
    { title: "hearing-field-kind", width: 30, value: (row, say) => named(HEARING_KIND_KEY, row.kind, say) },
    // On the clock of the zone the hearing is said in, which the next column names.
    { title: "portfolio-column-hearing-at", kind: "moment", width: 17, value: field("starts_at") },
    { title: "hearing-field-zone", width: 26, value: (row, say) => named(ZONE_KEY, row.time_zone, say) },
    { title: "hearing-field-mode", width: 24, value: (row, say) => named(MODE_KEY, row.mode, say) },
    { title: "hearing-field-place", width: 28, value: field("place") },
    { title: "portfolio-column-link", width: 34, value: field("link") },
    { title: "hearing-field-attendee", width: 24, value: field("attendee") },
    {
      title: "portfolio-column-hearing-status",
      width: 12,
      value: (row, say) => named(HEARING_STATUS_KEY, row.status, say),
    },
    { title: "hearing-field-outcome", width: 16, value: (row, say) => named(OUTCOME_KEY, row.outcome, say) },
    { title: "portfolio-column-outcome-note", width: 32, value: field("outcome_note") },
    { title: "hearing-field-notes", width: 30, value: field("notes") },
    { title: "portfolio-column-registered-one", width: 10, value: yes("created_auto") },
  ],
  documentos: [
    { title: "cases-column-case", kind: "number", width: 8, value: (row) => caseCell(row.seq) },
    { title: "portfolio-column-person", width: 28, value: field("person") },
    {
      title: "portfolio-column-document",
      width: 22,
      value: (row, say) => named(DOCUMENT_KIND_KEY, row.kind, say),
    },
    {
      title: "portfolio-column-document-status",
      width: 12,
      value: (row, say) => named(DOCUMENT_STATUS_KEY, row.status, say),
    },
    { title: "portfolio-column-source", width: 24, value: (row, say) => named(SOURCE_KEY, row.source, say) },
    { title: "portfolio-column-file", width: 32, value: field("name") },
    { title: "portfolio-column-type", width: 18, value: field("mime") },
    { title: "portfolio-column-bytes", kind: "number", width: 12, value: (row) => number(row.bytes) },
    { title: "portfolio-column-pages", kind: "number", width: 8, value: (row) => number(row.pages) },
    { title: "portfolio-column-sent", kind: "moment", width: 17, value: field("sent_at") },
    { title: "portfolio-column-decided", kind: "moment", width: 17, value: field("decided_at") },
    { title: "portfolio-column-refusal", width: 30, value: field("rejected_reason") },
    { title: "portfolio-column-sha", width: 30, value: field("sha256") },
  ],
  // The firm's books (0164): every entry, the cancelled ones with when and why, and every bill.
  lancamentos: [
    { title: "portfolio-column-day", kind: "date", width: 12, value: field("occurred_on") },
    { title: "portfolio-column-competence", kind: "date", width: 12, value: field("competence_on") },
    { title: "portfolio-column-account", width: 22, value: field("account") },
    {
      title: "portfolio-column-entry-kind",
      width: 18,
      value: (row, say) => named(ENTRY_KIND_KEY as Record<string, string>, row.kind, say),
    },
    { title: "portfolio-column-category", width: 28, value: field("category") },
    { title: "portfolio-column-cost-center", width: 20, value: field("center") },
    { title: "portfolio-column-value", kind: "number", width: 14, value: money("cents") },
    { title: "portfolio-column-counterparty", width: 26, value: field("counterparty") },
    { title: "portfolio-column-description", width: 34, value: field("description") },
    { title: "cases-column-case", kind: "number", width: 8, value: (row) => caseCell(row.seq) },
    { title: "portfolio-column-by-one", width: 10, value: yes("by_one") },
    { title: "portfolio-column-cancelled", kind: "moment", width: 17, value: field("cancelled_at") },
    { title: "portfolio-column-cancelled-reason", width: 30, value: field("cancelled_reason") },
  ],
  contas: [
    {
      title: "portfolio-column-direction",
      width: 12,
      value: (row, say) => named(BILL_DIRECTION_KEY, row.direction, say),
    },
    { title: "portfolio-column-bill-status", width: 14, value: (row, say) => named(BILL_STATUS_KEY, row.status, say) },
    { title: "portfolio-column-counterparty", width: 26, value: field("counterparty") },
    { title: "portfolio-column-description", width: 34, value: field("description") },
    { title: "portfolio-column-category", width: 28, value: field("category") },
    { title: "cases-column-case", kind: "number", width: 8, value: (row) => caseCell(row.seq) },
    { title: "portfolio-column-value", kind: "number", width: 14, value: money("cents") },
    { title: "portfolio-column-paid", kind: "number", width: 14, value: money("paid_cents") },
    { title: "portfolio-column-due", kind: "date", width: 12, value: field("due_on") },
    { title: "portfolio-column-competence", kind: "date", width: 12, value: field("competence_on") },
    { title: "portfolio-column-by-one", width: 10, value: yes("by_one") },
    { title: "portfolio-column-closed-reason", width: 30, value: field("closed_reason") },
  ],
};

const SHEET_KEY: Record<PortfolioSheet, string> = {
  clientes: "portfolio-sheet-clientes",
  casos: "portfolio-sheet-casos",
  acoes: "portfolio-sheet-acoes",
  prazos: "portfolio-sheet-prazos",
  audiencias: "portfolio-sheet-audiencias",
  documentos: "portfolio-sheet-documentos",
  lancamentos: "portfolio-sheet-lancamentos",
  contas: "portfolio-sheet-contas",
};

/** The name of a sheet, in the file and on the screen. */
export const portfolioSheetName = (sheet: PortfolioSheet, say: Say): string => say(SHEET_KEY[sheet]);

/** The columns of a sheet. */
export const portfolioColumns = (sheet: PortfolioSheet, say: Say): XlsxColumn[] =>
  COLUMNS[sheet].map((column) => ({ title: say(column.title), kind: column.kind, width: column.width }));

/** A row as a line of its sheet, in the order of `portfolioColumns`. */
export const portfolioLine = (sheet: PortfolioSheet, row: PortfolioRow, say: Say): XlsxCell[] =>
  COLUMNS[sheet].map((column) => column.value(row, say));

/**
 * What the file is, its first sheet (what opens): whose, when, how many rows each sheet holds, that the test cases were
 * left out, that the documents are a list and not the files, and that it holds every client's personal data. A file
 * travels without the screen.
 */
export function portfolioAbout(input: {
  firm: string;
  /** Brasília's day and time it was made. */
  made: { day: string; time: string };
  counts: PortfolioCounts;
  testsLeftOut: boolean;
  say: Say;
  countText: (value: number) => string;
}): XlsxSheet {
  const { say } = input;
  return {
    sheet: say("portfolio-sheet-about"),
    plain: true,
    columns: [
      { title: say("portfolio-about-title"), width: 26 },
      { title: input.firm, width: 80 },
    ],
    rows: [
      [say("portfolio-about-made"), say("portfolio-about-made-at", input.made)],
      ...PORTFOLIO_SHEETS.map((sheet): XlsxCell[] => [
        portfolioSheetName(sheet, say),
        input.countText(input.counts[sheet]),
      ]),
      ...(input.testsLeftOut ? [[say("portfolio-about-tests"), say("portfolio-about-tests-out")] as XlsxCell[]] : []),
      [say("portfolio-about-documents"), say("portfolio-about-documents-body")],
      [say("portfolio-about-care"), say("portfolio-about-care-body")],
    ],
  };
}

/** The sheets of the file, what it is first, each with the lines read for it. */
export function portfolioWorkbook(input: {
  about: XlsxSheet;
  lines: Record<PortfolioSheet, XlsxCell[][]>;
  say: Say;
}): XlsxSheet[] {
  return [
    input.about,
    ...PORTFOLIO_SHEETS.map(
      (sheet): XlsxSheet => ({
        sheet: portfolioSheetName(sheet, input.say),
        columns: portfolioColumns(sheet, input.say),
        rows: input.lines[sheet],
      }),
    ),
  ];
}
