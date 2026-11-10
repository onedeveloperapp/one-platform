import { readBoleto } from "@flyee/rules/boleto";

/**
 * A document of the books read by ONE into a form (migration 0140): a bill to pay or to receive (the boleto, the
 * utility bill, the invoice, a court's guide, the DAS, the DARF, the ISS, the payslip, the FGTS guide) or the receipt
 * of an entry. The task only says what the document says; this rule keeps what passes the form's own checks, so a
 * value, a day or a typed line that is not one never reaches a field, and says what it left out. A typed line that
 * checks has the last word on the value and the due day, as the panel's own reading of a line has. Pure.
 */

export const FINANCE_DOCUMENT_TASK = "financeiro.documento.leitura";

export const FINANCE_DOCUMENT_KINDS = [
  "boleto",
  "conta_consumo",
  "nota_fiscal",
  "recibo",
  "guia_custas",
  "das",
  "darf",
  "iss",
  "holerite",
  "guia_fgts",
  "comprovante_pagamento",
  "outro",
] as const;
export type FinanceDocumentKind = (typeof FINANCE_DOCUMENT_KINDS)[number];

/** The words of each kind, as a sentence says it ("O ONE leu a conta de consumo"). */
export const FINANCE_DOCUMENT_KIND_KEY: Record<FinanceDocumentKind, string> = {
  boleto: "finance-doc-kind-boleto",
  conta_consumo: "finance-doc-kind-utility",
  nota_fiscal: "finance-doc-kind-invoice",
  recibo: "finance-doc-kind-receipt",
  guia_custas: "finance-doc-kind-court-guide",
  das: "finance-doc-kind-das",
  darf: "finance-doc-kind-darf",
  iss: "finance-doc-kind-iss",
  holerite: "finance-doc-kind-payslip",
  guia_fgts: "finance-doc-kind-fgts",
  comprovante_pagamento: "finance-doc-kind-proof",
  outro: "finance-doc-kind-other",
};

export type DocumentCategory = { id: string; name: string };

/** What the model is told: the way of the money, what the document is for, and the chart's categories by number. */
export function financeDocumentBriefing(input: {
  direction: "pay" | "receive";
  target: "bill" | "entry";
  categories: readonly DocumentCategory[];
}): string {
  const way =
    input.target === "entry"
      ? "É o comprovante de um lançamento já feito"
      : input.direction === "pay"
        ? "É uma conta a pagar"
        : "É uma conta a receber";
  const chart = input.categories.map((category, at) => `${at + 1}. ${category.name}`).join("\n");
  return `${way}, ${input.direction === "pay" ? "dinheiro que sai do escritório" : "dinheiro que entra no escritório"}.\n\nCategorias do plano de contas que servem:\n${chart || "(nenhuma)"}`;
}

export type FinanceDocumentRead = {
  kind: FinanceDocumentKind;
  legible: boolean;
  counterparty: string | null;
  cents: number | null;
  dueOn: string | null;
  competence: string | null;
  paidOn: string | null;
  /** The digits of a typed line or barcode that checks, and its barcode; null when there is none or it does not check. */
  typedLine: string | null;
  barcode: string | null;
  /** The document had a line, and it did not check: the person types it, or leaves it out. */
  lineFailed: boolean;
  /** The value the model read differs from the one the line says (the line's is kept). */
  valueFromLine: boolean;
  description: string | null;
  categoryId: string | null;
  notes: string | null;
  /** What the model said and failed the form's checks, left out: `cents`, `dueOn`, `competence`, `paidOn`. */
  dropped: string[];
};

const text = (value: unknown, most: number): string | null => {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, most) : null;
};

/** The model's own sentence in the words a screen of ONE writes: no dash, no exclamation. */
const plain = (value: string | null): string | null =>
  value
    ? value
        .replace(/\s*[—–]\s*/g, ", ")
        .replace(/!+/g, ".")
        .replace(/\s+/g, " ")
        .trim() || null
    : null;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;

/** A day of the calendar within five years of today, else null. */
function dayOf(value: unknown, today: string): string | null {
  if (typeof value !== "string") return null;
  const match = DAY.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const todayYear = Number(today.slice(0, 4));
  return Math.abs(year - todayYear) <= 5 ? match[0] : null;
}

function monthOf(value: unknown, today: string): string | null {
  if (typeof value !== "string") return null;
  const match = MONTH.exec(value.trim());
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return Math.abs(Number(match[1]) - Number(today.slice(0, 4))) <= 5 ? match[0] : null;
}

export function readFinanceDocumentOutput(
  output: Record<string, unknown>,
  context: { categories: readonly DocumentCategory[]; today: string },
): FinanceDocumentRead {
  const dropped: string[] = [];
  const kind = FINANCE_DOCUMENT_KINDS.find((known) => known === output.tipo) ?? "outro";

  let cents: number | null = null;
  const said = output.valor_centavos;
  if (typeof said === "number" && Number.isInteger(said) && said > 0 && said < 1_000_000_000_000) cents = said;
  else if (said !== 0 && said !== undefined && said !== null) dropped.push("cents");

  let dueOn = dayOf(output.vencimento, context.today);
  if (!dueOn && text(output.vencimento, 20)) dropped.push("dueOn");
  const competence = monthOf(output.competencia, context.today);
  if (!competence && text(output.competencia, 20)) dropped.push("competence");
  const paidOn = dayOf(output.data_pagamento, context.today);
  if (!paidOn && text(output.data_pagamento, 20)) dropped.push("paidOn");

  let typedLine: string | null = null;
  let barcode: string | null = null;
  let lineFailed = false;
  let valueFromLine = false;
  const digits = typeof output.linha_digitavel === "string" ? output.linha_digitavel.replace(/\D/g, "") : "";
  if (digits.length > 0) {
    const read = digits.length >= 44 ? readBoleto(digits, context.today) : null;
    if (read?.ok) {
      typedLine = digits.length === 47 || digits.length === 48 ? digits : null;
      barcode = read.boleto.barcode;
      if (read.boleto.cents) {
        valueFromLine = cents !== null && cents !== read.boleto.cents;
        cents = read.boleto.cents;
      }
      if (read.boleto.dueOn) dueOn = read.boleto.dueOn;
    } else lineFailed = true;
  }

  const position = output.categoria;
  const category =
    typeof position === "number" && Number.isInteger(position) && position >= 1
      ? (context.categories[position - 1] ?? null)
      : null;

  return {
    kind,
    legible: output.legivel !== false,
    counterparty: text(output.favorecido, 120),
    cents,
    dueOn,
    competence,
    paidOn,
    typedLine,
    barcode,
    lineFailed,
    valueFromLine,
    description: plain(text(output.descricao, 300)),
    categoryId: category?.id ?? null,
    notes: plain(text(output.observacoes, 300)),
    dropped,
  };
}
