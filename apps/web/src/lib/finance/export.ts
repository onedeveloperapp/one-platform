/**
 * The entries of the books as a spreadsheet or a PDF (phase 4, migration 0127), written in the person's browser from
 * the list as it stands: a line per entry with its day, kind, account, category, who it was of, what was written,
 * the value, who made it and whether it was cancelled. The export is on the record (`begin_finance_export`), never
 * with what was searched. Pure.
 */
import type { FinanceEntryRow } from "@/lib/finance/read";
import { formatCents } from "@flyee/rules/finance";

/** The words each column and value take, from the screen's own catalog. */
export type EntryExportWords = {
  columns: {
    day: string;
    kind: string;
    account: string;
    category: string;
    counterparty: string;
    description: string;
    value: string;
    madeBy: string;
    state: string;
  };
  kind: Record<FinanceEntryRow["kind"], string>;
  byOne: string;
  byPerson: string;
  inForce: string;
  cancelled: (reason: string | null) => string;
};

/** "03/11/2026" from "2026-11-03". */
const brDay = (iso: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso;

/** The columns of the spreadsheet: the value as a number of reais, so a sum in Excel adds them. */
export function entryExportColumns(words: EntryExportWords) {
  return [
    { title: words.columns.day, kind: "date" as const, width: 12 },
    { title: words.columns.kind, width: 18 },
    { title: words.columns.account, width: 22 },
    { title: words.columns.category, width: 28 },
    { title: words.columns.counterparty, width: 26 },
    { title: words.columns.description, width: 36 },
    { title: words.columns.value, kind: "number" as const, width: 14 },
    { title: words.columns.madeBy, width: 14 },
    { title: words.columns.state, width: 28 },
  ];
}

/** An entry as a line of the spreadsheet. */
export function entryExportLine(entry: FinanceEntryRow, words: EntryExportWords): (string | number | null)[] {
  return [
    entry.occurredOn,
    words.kind[entry.kind],
    entry.account || null,
    entry.category,
    entry.counterparty,
    entry.description,
    entry.cents / 100,
    entry.byOne ? words.byOne : words.byPerson,
    entry.cancelled ? words.cancelled(entry.cancelledReason) : words.inForce,
  ];
}

/** The columns of the PDF, with their share of the page. */
export function entryPdfColumns(words: EntryExportWords) {
  return [
    { title: words.columns.day, share: 1 },
    { title: words.columns.kind, share: 1.3 },
    { title: words.columns.account, share: 1.5 },
    { title: words.columns.category, share: 2 },
    { title: words.columns.counterparty, share: 2.4 },
    { title: words.columns.value, share: 1.3 },
    { title: words.columns.state, share: 1.6 },
  ];
}

/** An entry as a line of the PDF: who it was of and what was written in one cell, the value as a person reads it. */
export function entryPdfLine(entry: FinanceEntryRow, words: EntryExportWords) {
  const who = [entry.counterparty, entry.description].filter((text): text is string => Boolean(text));
  return [
    brDay(entry.occurredOn),
    words.kind[entry.kind],
    entry.account || "",
    entry.category ?? "",
    who.length > 0 ? who.map((text, index) => ({ text, soft: index > 0 })) : "",
    formatCents(entry.cents),
    [
      { text: entry.cancelled ? words.cancelled(entry.cancelledReason) : words.inForce },
      { text: entry.byOne ? words.byOne : words.byPerson, soft: true },
    ],
  ];
}
