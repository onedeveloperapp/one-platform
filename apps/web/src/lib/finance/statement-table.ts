/**
 * A bank statement exported as a spreadsheet (phase 4, migration 0127): a CSV or an Excel workbook, read in the
 * person's browser by the reader the portfolio's import already uses, never uploaded. Which column is the day, the
 * description and the value is found by the names banks give them ("Data", "Histórico", "Lançamento", "Valor",
 * "Débito", "Crédito", "Saldo"); a column of a debit and one of a credit make one value; a value written with a "D" or a
 * "C" beside it, or beside a column saying which, takes its way from it. The lines a bank writes of a balance ("SALDO
 * ANTERIOR", "SALDO DO DIA") are no movement: the latest one, or the latest cell of a column of balances, is the
 * statement's balance. Pure.
 *
 * A spreadsheet seldom has an id of its own for a line, as an OFX does: each line's key (its day, value and memo) and
 * how many times that key came before it in the file make its id, so the same export twice adds nothing, while two
 * payments of one value on one day in one file are two lines, never one dropped in silence.
 */
import { parseDateValue, resolveDateOrder } from "@/lib/import/dates";
import type { HeaderScore, ParsedTable } from "@/lib/import/table";
import { lineKey, type OfxLine, parseCents, plainMemo } from "@flyee/rules/finance";

export type StatementColumns = {
  day: number;
  memo: number[];
  amount: number | null;
  debit: number | null;
  credit: number | null;
  /** A column that says the way of the value: "D" or "C", "Débito" or "Crédito". */
  way: number | null;
  balance: number | null;
  /** A column of the bank's own id of each line (Nubank's "Identificador"), when the export has one. */
  id: number | null;
};

export type TableStatement = {
  lines: OfxLine[];
  startsOn: string | null;
  endsOn: string | null;
  balance: { cents: number; on: string } | null;
};

export type TableStatementRead =
  | { ok: true; statement: TableStatement; columns: StatementColumns }
  | { ok: false; code: "columns_unknown" | "no_lines" };

const plain = (cell: string) =>
  plainMemo(cell)
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

type Role = "day" | "memo" | "amount" | "debit" | "credit" | "way" | "balance" | "id";

const ROLE_WORDS: readonly (readonly [Role, RegExp])[] = [
  ["day", /^(data|dt|dia|date)( |$)/],
  ["balance", /(^| )saldos?( |$)|^balance( |$)/],
  ["id", /^(identificador|id|id da transacao|id transacao|transaction id)$/],
  ["debit", /^(debito|debitos|saida|saidas)( |$)|^valor (de )?(debito|saida)( |$)/],
  ["credit", /^(credito|creditos|entrada|entradas)( |$)|^valor (de )?(credito|entrada)( |$)/],
  ["way", /^(tipo|natureza|d c|c d|dc|cd|sinal)( |$)/],
  ["amount", /^(valor|valores|montante|quantia|importancia|amount)( |$)/],
  [
    "memo",
    /^(historico|descricao|lancamento|lancamentos|detalhe|detalhes|memo|complemento|transacao|movimentacao|estabelecimento|description|title)( |$)/,
  ],
];

/** What a header names, by its words: the first role whose words it holds. */
function roleOf(header: string): Role | null {
  const words = plain(header);
  if (!words) return null;
  return ROLE_WORDS.find(([, pattern]) => pattern.test(words))?.[0] ?? null;
}

/** A cell of a value as whole cents, with its way when it says one ("189,90 D", "C 1.000,00"); null when it is none. */
function cellCents(cell: string): { cents: number; way: "in" | "out" | null } | null {
  const raw = String(cell ?? "").trim();
  if (!raw) return null;
  let body = raw;
  let way: "in" | "out" | null = null;
  const after = /^(.*?)\s*([DC])$/i.exec(raw);
  const before = /^([DC])\s+(.*)$/i.exec(raw);
  if (after) {
    body = after[1];
    way = after[2].toUpperCase() === "D" ? "out" : "in";
  } else if (before) {
    body = before[2];
    way = before[1].toUpperCase() === "D" ? "out" : "in";
  }
  const cents = parseCents(body);
  return cents === null ? null : { cents, way };
}

/**
 * How much a line reads as a statement's headers: how many roles its cells name; a line with a day and a value in its
 * cells is a line of data, above which the headers are.
 */
export const statementHeaderScore: HeaderScore = (row) => {
  const hasDay = row.some((cell) => parseDateValue(cell) !== null);
  const hasValue = row.some((cell) => !parseDateValue(cell) && /[0-9]/.test(cell) && cellCents(cell) !== null);
  if (hasDay && hasValue) return -1;
  return new Set(row.map(roleOf).filter((role): role is Role => role !== null)).size;
};

/** Which column is which, by its header; null when a day, a description or a value cannot be told. */
export function statementColumns(headers: readonly string[]): StatementColumns | null {
  const found: Record<Role, number[]> = {
    day: [],
    memo: [],
    amount: [],
    debit: [],
    credit: [],
    way: [],
    balance: [],
    id: [],
  };
  headers.forEach((header, index) => {
    const role = roleOf(header);
    if (role) found[role].push(index);
  });
  const day = found.day[0];
  if (day === undefined || found.memo.length === 0) return null;
  const amount = found.amount[0] ?? null;
  const debit = found.debit[0] ?? null;
  const credit = found.credit[0] ?? null;
  if (amount === null && (debit === null || credit === null)) return null;
  return {
    day,
    memo: found.memo,
    amount,
    debit,
    credit,
    way: found.way[0] ?? null,
    balance: found.balance[0] ?? null,
    id: found.id[0] ?? null,
  };
}

/** The way a column of a type says: "D", "Débito", "Saída" are out; "C", "Crédito", "Entrada" are in. */
function wayOf(cell: string): "in" | "out" | null {
  const words = plain(cell);
  if (/^(d|deb|debito|saida|s)$/.test(words)) return "out";
  if (/^(c|cred|credito|entrada|e)$/.test(words)) return "in";
  return null;
}

/** A line a bank writes of a balance, which is no movement. */
const BALANCE_LINE = /^(saldo|s a l d o)( |$)/;

/**
 * The lines of a statement from its table: each with its day, its value as signed whole cents and its memo (the
 * description columns joined), the balance lines kept apart. A line with no day or no value that reads (a subtotal, a
 * note) is left out of the movements.
 */
export function statementFromTable(table: Pick<ParsedTable, "headers" | "rows">): TableStatementRead {
  const columns = statementColumns(table.headers);
  if (!columns) return { ok: false, code: "columns_unknown" };
  const order = resolveDateOrder(table.rows.map((row) => row[columns.day] ?? ""));
  const lines: OfxLine[] = [];
  let balance: { cents: number; on: string } | null = null;
  const keepBalance = (cents: number, on: string) => {
    if (!balance || on >= balance.on) balance = { cents, on };
  };
  for (const row of table.rows) {
    const postedOn = parseDateValue(row[columns.day] ?? "", order);
    if (!postedOn) continue;
    const memo = columns.memo
      .map((index) => String(row[index] ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .slice(0, 300);
    let cents: number | null = null;
    if (columns.amount !== null) {
      const read = cellCents(row[columns.amount] ?? "");
      if (read) {
        const way = read.way ?? (columns.way !== null ? wayOf(row[columns.way] ?? "") : null);
        cents = way === "out" ? -Math.abs(read.cents) : way === "in" ? Math.abs(read.cents) : read.cents;
      }
    }
    if (cents === null && columns.debit !== null && columns.credit !== null) {
      const out = cellCents(row[columns.debit] ?? "");
      const into = cellCents(row[columns.credit] ?? "");
      cents = out || into ? (into ? Math.abs(into.cents) : 0) - (out ? Math.abs(out.cents) : 0) : null;
    }
    if (columns.balance !== null) {
      const read = cellCents(row[columns.balance] ?? "");
      if (read) keepBalance(read.way === "out" ? -Math.abs(read.cents) : read.cents, postedOn);
    }
    if (BALANCE_LINE.test(plain(memo))) {
      if (cents !== null && columns.balance === null) keepBalance(cents, postedOn);
      continue;
    }
    if (cents === null || cents === 0) continue;
    const bankId =
      columns.id !== null
        ? String(row[columns.id] ?? "")
            .trim()
            .slice(0, 100) || null
        : null;
    lines.push({ bankId, postedOn, cents, memo });
  }
  if (lines.length === 0) return { ok: false, code: "no_lines" };
  const days = lines.map((line) => line.postedOn).sort();
  return {
    ok: true,
    statement: { lines, startsOn: days[0], endsOn: days[days.length - 1], balance },
    columns,
  };
}

/**
 * What each line of a spreadsheet with no id column is told apart by: its key and how many times that key came before
 * it in the file. The same export twice gives the same keys; two equal payments in one file are told apart. The
 * browser hashes each into the line's id (`statement-file.ts`), to fit the database's 120 characters whatever the memo.
 */
export function occurrenceKeys(lines: readonly OfxLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((line) => {
    const key = lineKey(line);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return `${key}#${count}`;
  });
}
