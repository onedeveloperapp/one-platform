import type { XlsxCell, XlsxColumn, XlsxSheet } from "@/lib/export/xlsx-write";

/**
 * O trabalho do ONE (phase 2 of the plan of the controladoria, migrations 0120 and 0121): what ONE did for the firm each month,
 * by kind of task, and how many hours a person would have taken by the firm's own estimates. Pure: what the database
 * answered (`firm_one_work`), the totals, the hours and the money, the words of each kind, and the lines of the
 * spreadsheet. The count is the database's; nothing here counts an act.
 */

/** The families of ONE's work, in the order the page shows them. */
export const ONE_WORK_FAMILIES = [
  "atendimento",
  "documentos",
  "relato",
  "acoes",
  "pecas",
  "protocolo",
  "tribunal",
  "prazos",
  "avisos",
  "biblioteca",
] as const;
export type OneWorkFamily = (typeof ONE_WORK_FAMILIES)[number];
const isFamily = (value: unknown): value is OneWorkFamily => (ONE_WORK_FAMILIES as readonly unknown[]).includes(value);

/** The kind whose acts are a lawyer's own act that ONE took (item 3.1 of the OAB's Recomendação 001/2024). */
export const PIECE_APPROVED = "peca_aprovada";

/** A kind of ONE's work, as the catalog has it. */
export type OneWorkKind = {
  key: string;
  family: OneWorkFamily;
  /** ONE's own estimate, in minutes. */
  defaultMinutes: number;
  /** The firm's estimate in force (its own or ONE's): only to who decides for the firm. */
  minutes: number | null;
  /** Whether the firm set its own estimate: only to who decides for the firm. */
  own: boolean;
};

/** What ONE did of one kind in one month. */
export type OneWorkRow = {
  month: string;
  kind: string;
  /** Done by ONE alone. */
  alone: number;
  /** Prepared by ONE and approved by a person after reading it. */
  assisted: number;
  /** Done in test cases, which no total counts. */
  test: number;
  /** What a person would have taken for `alone` and `assisted`, by the firm's estimates. */
  minutes: number;
  testMinutes: number;
};

export type OneWork = {
  /** The first and the last month read, "YYYY-MM". */
  from: string;
  to: string;
  rows: OneWorkRow[];
  kinds: OneWorkKind[];
  /** Whether the person decides for the firm, and so reads its estimates and the money. */
  decides: boolean;
  /** The average cost of an hour of the firm's people, in centavos; only to who decides, when the firm said it. */
  hourCents: number | null;
};

const whole = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** What `firm_one_work` answered; null when it is not a reading (a read that failed is never a month with nothing). */
export function oneWorkOf(raw: unknown): OneWork | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.from !== "string" ||
    !MONTH.test(value.from) ||
    typeof value.to !== "string" ||
    !MONTH.test(value.to)
  )
    return null;
  if (!Array.isArray(value.rows) || !Array.isArray(value.kinds)) return null;
  const kinds: OneWorkKind[] = [];
  for (const entry of value.kinds as Record<string, unknown>[]) {
    if (typeof entry?.key !== "string" || !isFamily(entry.family)) continue;
    kinds.push({
      key: entry.key,
      family: entry.family,
      defaultMinutes: whole(entry.default_minutes),
      minutes: typeof entry.minutes === "number" ? whole(entry.minutes) : null,
      own: entry.own === true,
    });
  }
  const known = new Set(kinds.map((kind) => kind.key));
  const rows: OneWorkRow[] = [];
  for (const entry of value.rows as Record<string, unknown>[]) {
    if (typeof entry?.month !== "string" || !MONTH.test(entry.month)) continue;
    if (typeof entry.kind !== "string" || !known.has(entry.kind)) continue;
    rows.push({
      month: entry.month,
      kind: entry.kind,
      alone: whole(entry.alone),
      assisted: whole(entry.assisted),
      test: whole(entry.test),
      minutes: whole(entry.minutes),
      testMinutes: whole(entry.test_minutes),
    });
  }
  return {
    from: value.from,
    to: value.to,
    rows,
    kinds,
    decides: value.decides === true,
    hourCents: typeof value.hour_cents === "number" && value.hour_cents > 0 ? Math.floor(value.hour_cents) : null,
  };
}

/** The month of Brasília a moment is in, "YYYY-MM". */
export function brasiliaMonth(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}`;
}

/** The month `count` months from `month` (back when negative), "YYYY-MM". */
export function monthShift(month: string, count: number): string {
  const [year, number] = month.split("-").map(Number);
  const index = year * 12 + (number - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The first day of a month, as the database takes it. */
export const monthDay = (month: string): string => `${month}-01`;

/** The months from `from` to `to`, the latest first. */
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = to; month >= from && months.length < 36; month = monthShift(month, -1)) months.push(month);
  return months;
}

/** What ONE did in a month, all kinds together. */
export type OneWorkTotals = {
  /** The tasks that count: ONE alone, and what a person approved after reading. */
  tasks: number;
  alone: number;
  assisted: number;
  minutes: number;
  test: number;
  testMinutes: number;
  /** The lawyer's own acts ONE took: the pieces it approved, and their minutes. */
  piecesApproved: number;
  piecesMinutes: number;
};

export function monthTotals(work: OneWork, month: string): OneWorkTotals {
  const totals: OneWorkTotals = {
    tasks: 0,
    alone: 0,
    assisted: 0,
    minutes: 0,
    test: 0,
    testMinutes: 0,
    piecesApproved: 0,
    piecesMinutes: 0,
  };
  for (const row of work.rows) {
    if (row.month !== month) continue;
    totals.alone += row.alone;
    totals.assisted += row.assisted;
    totals.minutes += row.minutes;
    totals.test += row.test;
    totals.testMinutes += row.testMinutes;
    if (row.kind === PIECE_APPROVED) {
      totals.piecesApproved += row.alone;
      totals.piecesMinutes += row.minutes;
    }
  }
  totals.tasks = totals.alone + totals.assisted;
  return totals;
}

/** A kind's line of a month, zero when ONE did none of it. */
export type KindLine = { kind: OneWorkKind } & Pick<OneWorkRow, "alone" | "assisted" | "test" | "minutes">;

/**
 * Each family of a month with every kind of it, in the catalog's order, and the family's own totals. The pieces ONE
 * approved are left out: they have a line of their own, beside the OAB's recommendation, and a screen says each
 * thing once.
 */
export function familyLines(
  work: OneWork,
  month: string,
): { family: OneWorkFamily; lines: KindLine[]; tasks: number; minutes: number }[] {
  const byKind = new Map(work.rows.filter((row) => row.month === month).map((row) => [row.kind, row]));
  return ONE_WORK_FAMILIES.map((family) => {
    const lines = work.kinds
      .filter((kind) => kind.family === family && kind.key !== PIECE_APPROVED)
      .map((kind): KindLine => {
        const row = byKind.get(kind.key);
        return {
          kind,
          alone: row?.alone ?? 0,
          assisted: row?.assisted ?? 0,
          test: row?.test ?? 0,
          minutes: row?.minutes ?? 0,
        };
      });
    return {
      family,
      lines,
      tasks: lines.reduce((sum, line) => sum + line.alone + line.assisted, 0),
      minutes: lines.reduce((sum, line) => sum + line.minutes, 0),
    };
  }).filter((group) => group.lines.length > 0);
}

/** How a span of minutes is said, rounded as an estimate: under an hour in minutes, else in whole hours. */
export type Duration = { unit: "minutes" | "hours"; value: number };

export function durationOf(minutes: number): Duration {
  if (minutes < 60) return { unit: "minutes", value: Math.max(0, Math.round(minutes)) };
  return { unit: "hours", value: Math.round(minutes / 60) };
}

/** What the minutes are worth at the firm's cost of an hour, in whole reais; null without a cost. */
export function moneyOf(minutes: number, hourCents: number | null): number | null {
  if (hourCents === null || hourCents <= 0) return null;
  return Math.round((minutes * hourCents) / 60 / 100);
}

/** Reais as Brazil writes them, with no centavos: an estimate is never more exact than its minutes. */
export const reaisText = (reais: number): string =>
  reais.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/** The words of a kind and of a family. */
// Prefixes spelled whole, so the check of the message catalog sees every key they make.
export const kindLabelKey = (kind: string): string => "one-work-kind-" + kind.replaceAll("_", "-");
export const familyLabelKey = (family: OneWorkFamily): string => "one-work-family-" + family;

/** A month as a person reads it: "novembro de 2026". */
export function monthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, number - 1, 15)),
  );
}

/** What says a key's words, the app's `t`. */
export type Say = (key: string, values?: Record<string, string | number>) => string;

/**
 * The spreadsheet of ONE's work: a line per month and kind that ONE did, the latest month first, with the minutes by
 * the firm's estimates and, for who decides for the firm with a cost of an hour, what they are worth.
 */
export function oneWorkSheet(work: OneWork, say: Say): XlsxSheet {
  const money = work.decides && work.hourCents !== null;
  const columns: XlsxColumn[] = [
    { title: say("one-work-sheet-month"), width: 18 },
    { title: say("one-work-sheet-family"), width: 22 },
    { title: say("one-work-sheet-kind"), width: 44 },
    { title: say("one-work-sheet-alone"), kind: "number", width: 14 },
    { title: say("one-work-sheet-assisted"), kind: "number", width: 18 },
    { title: say("one-work-sheet-minutes"), kind: "number", width: 14 },
    { title: say("one-work-sheet-test"), kind: "number", width: 16 },
    ...(money ? [{ title: say("one-work-sheet-money"), kind: "number" as const, width: 16 }] : []),
  ];
  const order = new Map(work.kinds.map((kind, at) => [kind.key, at]));
  const family = new Map(work.kinds.map((kind) => [kind.key, kind.family]));
  const rows = [...work.rows]
    .sort((a, b) => b.month.localeCompare(a.month) || (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0))
    .map((row): XlsxCell[] => {
      const familyKey = family.get(row.kind);
      return [
        monthLabel(row.month),
        familyKey ? say(familyLabelKey(familyKey)) : null,
        say(kindLabelKey(row.kind)),
        row.alone,
        row.assisted,
        row.minutes,
        row.test,
        ...(money ? [moneyOf(row.minutes, work.hourCents)] : []),
      ];
    });
  return { sheet: say("one-work-sheet-name"), columns, rows };
}
