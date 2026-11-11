import type { OfxLine } from "@flyee/rules/finance";

/**
 * A statement or a card bill in PDF, read by ONE (migration 0169, task `financeiro.extrato.pdf`). The model reads the
 * lines and the balances; this rule keeps them only when they add up to what the document prints: a statement's
 * opening balance plus its lines is its closing balance, and a card bill's lines, their sign turned, are its total.
 * One cent off and nothing goes: a line misread is never entered in the books. What it keeps then goes to the books as
 * an OFX's lines do.
 */

export const STATEMENT_PDF_TASK = "financeiro.extrato.pdf";

/** The most lines one PDF gives: a month of a busy account is far fewer. */
export const MAX_PDF_LINES = 600;

export type StatementPdfRead =
  | {
      ok: true;
      kind: "bank" | "card";
      startsOn: string | null;
      endsOn: string | null;
      /** A statement's closing balance on its last day; a card bill says none (its total is no balance). */
      balance: { cents: number; on: string } | null;
      lines: OfxLine[];
      note: string;
    }
  | {
      ok: false;
      code: "not_statement" | "no_lines" | "no_balances" | "too_many" | "unbalanced";
      differenceCents?: number;
    };

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown, most: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, most) : "";
const whole = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && Math.abs(value) < 10_000_000_000_000 ? value : null;

function dayOf(value: unknown): string | null {
  const day = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day && day >= "2000-01-01" ? day : null;
}

/** The answer of the reading, kept only when it adds up. */
export function readStatementPdfOutput(raw: unknown): StatementPdfRead {
  const answer = record(raw);
  const kind = answer.tipo === "extrato" ? "bank" : answer.tipo === "fatura" ? "card" : null;
  if (!kind) return { ok: false, code: "not_statement" };
  const raws = Array.isArray(answer.linhas) ? answer.linhas : [];
  if (raws.length > MAX_PDF_LINES) return { ok: false, code: "too_many" };
  const lines: OfxLine[] = [];
  for (const item of raws) {
    const row = record(item);
    const postedOn = dayOf(row.data);
    const cents = whole(row.valor_centavos);
    const memo = text(row.descricao, 200);
    // A line not read whole fails the reading: the sum would hold a line that cannot go in.
    if (!postedOn || cents === null || cents === 0 || !memo) return { ok: false, code: "unbalanced" };
    lines.push({ bankId: null, postedOn, cents, memo });
  }
  if (lines.length === 0) return { ok: false, code: "no_lines" };
  const opening = whole(answer.saldo_inicial_centavos);
  const closing = whole(answer.saldo_final_centavos);
  if (answer.tem_saldos !== true || closing === null || (kind === "bank" && opening === null)) {
    return { ok: false, code: "no_balances" };
  }
  const sum = lines.reduce((acc, line) => acc + line.cents, 0);
  const difference = kind === "bank" ? (opening as number) + sum - closing : -sum - closing;
  if (difference !== 0) return { ok: false, code: "unbalanced", differenceCents: difference };
  const days = lines.map((line) => line.postedOn).sort();
  const startsOn = dayOf(answer.inicio) ?? days[0] ?? null;
  const endsOn = dayOf(answer.fim) ?? days[days.length - 1] ?? null;
  return {
    ok: true,
    kind,
    startsOn,
    endsOn,
    balance: kind === "bank" && endsOn ? { cents: closing, on: endsOn } : null,
    lines,
    note: text(answer.observacoes, 300)
      .replace(/\s*[\u2013\u2014]\s*/g, ", ")
      .replace(/!/g, "."),
  };
}
