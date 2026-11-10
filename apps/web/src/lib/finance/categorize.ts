/**
 * What the AI is handed to say the category of a statement's lines (phase 4, migration 0128): the firm's chart,
 * numbered, and the lines no rule decided, numbered, each memo with what identifies a person or an account taken out
 * (a CPF, a CNPJ, an e-mail, a telephone, a run of digits as an account's or a document's number). The answer is the
 * database's to read and decide on; nothing here decides anything. Pure.
 */
import { maskIdentifiers } from "@/lib/cases/drafts";
import { formatCents } from "@flyee/rules/finance";

export const CATEGORIZE_TASK = "financeiro.extrato.categorizacao";

export type CategorizeCategory = { n: number; kind: string; name: string };
export type CategorizeLine = { n: number; postedOn: string; cents: number; memo: string };
export type CategorizeInput = {
  orgId: string;
  statementId: string;
  claim: number;
  categories: CategorizeCategory[];
  lines: CategorizeLine[];
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const whole = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

/** The database's answer (`finance_lines_to_categorize`), read; null when the claim is gone or it is no answer. */
export function categorizeInputOf(raw: unknown): CategorizeInput | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const answer = raw as Record<string, unknown>;
  const orgId = text(answer.org_id);
  const statementId = text(answer.statement_id);
  if (!orgId || !statementId) return null;
  const rows = (value: unknown) =>
    (Array.isArray(value) ? value : []).map((item) => (item ?? {}) as Record<string, unknown>);
  return {
    orgId,
    statementId,
    claim: whole(answer.claim),
    categories: rows(answer.categories).map((row) => ({ n: whole(row.n), kind: text(row.kind), name: text(row.name) })),
    lines: rows(answer.lines).map((row) => ({
      n: whole(row.n),
      postedOn: text(row.posted_on),
      cents: whole(row.cents),
      memo: text(row.memo),
    })),
  };
}

/**
 * A memo as the model reads it: what `maskIdentifiers` takes out, a CNPJ, and any other run of six digits or more (an
 * account's, an agency's or a document's number), which says nothing of what the line is.
 */
export function maskMemo(memo: string): string {
  return maskIdentifiers(memo)
    .replace(/(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g, "[CNPJ]")
    .replace(/\d[\d./-]{4,}\d/g, (run) => (run.replace(/\D/g, "").length >= 6 ? "[número]" : run));
}

const KIND_WORDS: Record<string, string> = {
  income: "receita",
  expense: "despesa",
  client_money: "dinheiro de cliente",
  partner_in: "dinheiro de sócio que entra",
  partner_out: "dinheiro de sócio que sai",
};

/** The briefing the model reads: the chart and the lines, each numbered, the values in reais with their sign. */
export function categorizeBriefing(input: Pick<CategorizeInput, "categories" | "lines">): string {
  const chart = input.categories
    .map((category) => `${category.n}. ${KIND_WORDS[category.kind] ?? category.kind}: ${category.name}`)
    .join("\n");
  const lines = input.lines
    .map(
      (line) =>
        `${line.n}. ${line.postedOn} · ${formatCents(line.cents)} · ${maskMemo(line.memo) || "(sem histórico)"}`,
    )
    .join("\n");
  return `Categorias do plano de contas:\n${chart}\n\nLinhas do extrato:\n${lines}`;
}

/** A failure of a run, said as what it says of the lines: the model answered badly (a try), or nothing was learned. */
export const categorizeFailure = (code: string): "retry" | "released" =>
  code.startsWith("output_") || code === "provider_blocked" ? "retry" : "released";
