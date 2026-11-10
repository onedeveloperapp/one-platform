/**
 * The bills still open that a firm brings from the system it used before (the plan of the finance, phase 5): a CSV or
 * an Excel workbook of its "contas a pagar" and "contas a receber", read in the person's browser by the reader the
 * portfolio's import already uses, never uploaded. Which column is which is found by the names systems give them
 * ("Favorecido", "Cliente", "Descrição", "Valor", "Vencimento", "Competência", "Categoria", "Processo", "Linha
 * digitável", "Tipo"); a file with no column of the way (a list of payables only) takes the way the person says.
 * Each line is shown as what it would do before anything is written: open a bill, or left out and why. Pure.
 *
 * A line's key (its way, who, its value, its due day and what for) and how many times that key came before it in the
 * file tell it apart, so the same file brought twice opens nothing twice, while two equal installments are two bills.
 */
import { parseDateValue, resolveDateOrder } from "@/lib/import/dates";
import type { HeaderScore, ParsedTable } from "@/lib/import/table";
import { parseCnj } from "@flyee/rules/cnj";
import { parseCents, plainMemo } from "@flyee/rules/finance";

export type LegacyDirection = "pay" | "receive";

export type LegacyColumns = {
  direction: number | null;
  counterparty: number | null;
  description: number | null;
  value: number;
  due: number;
  competence: number | null;
  category: number | null;
  lawsuit: number | null;
  typedLine: number | null;
};

type Role = keyof LegacyColumns;

const plain = (cell: string) =>
  plainMemo(cell)
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ROLE_WORDS: readonly (readonly [Role, RegExp])[] = [
  ["typedLine", /^(linha digitavel|codigo de barras|cod barras|codigo do boleto)( |$)/],
  ["due", /^(vencimento|data de vencimento|data vencimento|dt vencimento|venc|vcto|data do vencimento)( |$)/],
  ["competence", /^(competencia|mes de competencia|mes referencia|referencia|mes)( |$)/],
  ["lawsuit", /^(processo|numero do processo|n do processo|no do processo|cnj|caso|numero cnj)( |$)/],
  ["category", /^(categoria|plano de contas|conta contabil|classificacao|centro de custo)( |$)/],
  ["direction", /^(tipo|natureza|operacao|pagar receber|a pagar a receber)( |$)/],
  [
    "counterparty",
    /^(favorecido|fornecedor|cliente|pagador|beneficiario|sacado|cedente|credor|devedor|nome|pessoa|razao social|contato)( |$)/,
  ],
  ["value", /^(valor|valor original|valor em aberto|valor a pagar|valor a receber|saldo|saldo em aberto|total)( |$)/],
  ["description", /^(descricao|historico|referente|observacao|observacoes|detalhe|detalhes|documento)( |$)/],
];

const roleOf = (header: string): Role | null => {
  const words = plain(header);
  if (!words) return null;
  return ROLE_WORDS.find(([, pattern]) => pattern.test(words))?.[0] ?? null;
};

/** How much a line looks like the header of a list of bills: how many roles its cells name. */
export const legacyHeaderScore: HeaderScore = (row) =>
  new Set(row.map(roleOf).filter((role): role is Role => role !== null)).size;

/** Which column is which, by its header; null when a value or a due day cannot be told. */
export function legacyColumns(headers: readonly string[]): LegacyColumns | null {
  const found = new Map<Role, number>();
  headers.forEach((header, index) => {
    const role = roleOf(header);
    if (role && !found.has(role)) found.set(role, index);
  });
  const value = found.get("value");
  const due = found.get("due");
  if (value === undefined || due === undefined) return null;
  return {
    direction: found.get("direction") ?? null,
    counterparty: found.get("counterparty") ?? null,
    description: found.get("description") ?? null,
    value,
    due,
    competence: found.get("competence") ?? null,
    category: found.get("category") ?? null,
    lawsuit: found.get("lawsuit") ?? null,
    typedLine: found.get("typedLine") ?? null,
  };
}

/** The way a cell says: "Pagar", "Despesa", "Débito", "D" are bills to pay; "Receber", "Receita", "Crédito", "C" to receive. */
export function directionOf(cell: string): LegacyDirection | null {
  const words = plain(cell);
  if (/^(a )?pagar$|^(conta a )?pagar|^despesas?$|^debitos?$|^d$|^saidas?$|^pagamento/.test(words)) return "pay";
  if (/^(a )?receber$|^(conta a )?receber|^receitas?$|^creditos?$|^c$|^entradas?$|^recebimento/.test(words)) {
    return "receive";
  }
  return null;
}

export type LegacyProblem =
  | "no_value"
  | "value_not_positive"
  | "no_due"
  | "due_not_understood"
  | "no_direction"
  | "no_counterparty";

export type LegacyBill = {
  /** The line of the file, counted from 1 under the header. */
  line: number;
  direction: LegacyDirection;
  counterparty: string | null;
  description: string | null;
  cents: number;
  dueOn: string;
  competenceOn: string;
  category: string | null;
  /** A lawsuit's number that checks, by its digits, for the bill to be of that case. */
  cnj: string | null;
  /** A typed line of 47 or 48 digits, kept only as digits. */
  typedLine: string | null;
  /** What tells it apart in the file: its key and how many times that key came before it. */
  key: string;
};

export type LegacyRead = {
  bills: LegacyBill[];
  refused: { line: number; problem: LegacyProblem }[];
};

const cellOf = (row: readonly string[], index: number | null): string =>
  index === null ? "" : String(row[index] ?? "").trim();

/** A month written as "10/2026", "2026-10" or a whole day, as the first day of that month. */
function competenceOf(cell: string, order: ReturnType<typeof resolveDateOrder>): string | null {
  const text = cell.trim();
  const monthYear = /^(\d{1,2})[/.-](\d{4})$/.exec(text);
  if (monthYear) {
    const month = Number(monthYear[1]);
    return month >= 1 && month <= 12 ? `${monthYear[2]}-${String(month).padStart(2, "0")}-01` : null;
  }
  const yearMonth = /^(\d{4})-(\d{1,2})$/.exec(text);
  if (yearMonth) {
    const month = Number(yearMonth[2]);
    return month >= 1 && month <= 12 ? `${yearMonth[1]}-${String(month).padStart(2, "0")}-01` : null;
  }
  const day = parseDateValue(text, order);
  return day ? `${day.slice(0, 7)}-01` : null;
}

/**
 * The bills of a table: each line that reads, with its key; each that does not, with why. `fallback` is the way the
 * person said the whole file is, read only where the file has no column of the way or a cell says none.
 */
export function legacyBillsFromTable(
  table: Pick<ParsedTable, "headers" | "rows">,
  columns: LegacyColumns,
  fallback: LegacyDirection | null,
): LegacyRead {
  const order = resolveDateOrder(table.rows.map((row) => cellOf(row, columns.due)).filter(Boolean));
  const bills: LegacyBill[] = [];
  const refused: LegacyRead["refused"] = [];
  const seen = new Map<string, number>();
  table.rows.forEach((row, index) => {
    const line = index + 1;
    if (row.every((cell) => !String(cell ?? "").trim())) return;
    const valueCell = cellOf(row, columns.value);
    const cents = valueCell ? parseCents(valueCell) : null;
    if (cents === null) return void refused.push({ line, problem: "no_value" });
    const dueCell = cellOf(row, columns.due);
    if (!dueCell) return void refused.push({ line, problem: "no_due" });
    const dueOn = parseDateValue(dueCell, order);
    if (!dueOn) return void refused.push({ line, problem: "due_not_understood" });
    // A signed value says the way where no column does: negative is to pay.
    const signed = columns.direction === null && fallback === null ? (cents < 0 ? "pay" : null) : null;
    const direction = directionOf(cellOf(row, columns.direction)) ?? signed ?? fallback;
    if (!direction) return void refused.push({ line, problem: "no_direction" });
    if (Math.abs(cents) === 0) return void refused.push({ line, problem: "value_not_positive" });
    const counterparty = cellOf(row, columns.counterparty).slice(0, 120) || null;
    const description = cellOf(row, columns.description).slice(0, 300) || null;
    if (!counterparty && !description) return void refused.push({ line, problem: "no_counterparty" });
    const lawsuit = parseCnj(cellOf(row, columns.lawsuit));
    const lineDigits = cellOf(row, columns.typedLine).replace(/\D/g, "");
    const competenceOn = competenceOf(cellOf(row, columns.competence), order) ?? `${dueOn.slice(0, 7)}-01`;
    const base = [direction, plain(counterparty ?? ""), Math.abs(cents), dueOn, plain(description ?? "")].join("|");
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    bills.push({
      line,
      direction,
      counterparty,
      description,
      cents: Math.abs(cents),
      dueOn,
      competenceOn,
      category: cellOf(row, columns.category).slice(0, 120) || null,
      cnj: lawsuit?.digits ?? null,
      typedLine: /^\d{47,48}$/.test(lineDigits) ? lineDigits : null,
      key: `${base}#${count}`,
    });
  });
  return { bills, refused };
}

/** What a file brings on a day, for the screen to say before anything is written. */
export function legacyNumbers(
  read: LegacyRead,
  today: string,
): {
  pay: { count: number; cents: number };
  receive: { count: number; cents: number };
  withCase: number;
  late: number;
  refused: number;
} {
  const sum = (way: LegacyDirection) => {
    const mine = read.bills.filter((bill) => bill.direction === way);
    return { count: mine.length, cents: mine.reduce((total, bill) => total + bill.cents, 0) };
  };
  return {
    pay: sum("pay"),
    receive: sum("receive"),
    withCase: read.bills.filter((bill) => bill.cnj).length,
    late: read.bills.filter((bill) => bill.dueOn < today).length,
    refused: read.refused.length,
  };
}
