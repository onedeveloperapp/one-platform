/**
 * The invoice the firm issued, read by ONE (migration 0165, task `financeiro.nota.leitura`): its number, the day it was
 * issued, its value, its taker and its verification code, kept only as far as the form's checks hold. The reading
 * decides nothing: who operates the books records the invoice against the fee it is of.
 */

export const INVOICE_TASK = "financeiro.nota.leitura";

export type InvoiceRead = {
  /** It is an invoice of services, by the model's word. */
  isInvoice: boolean;
  number: string;
  /** The day it was issued, never one still to come. */
  issuedOn: string;
  /** The value of the services, in cents; 0 when nothing was read. */
  cents: number;
  taker: string;
  code: string;
  /** Whether the value read is the fee's: null when no value was read. */
  matches: boolean | null;
  note: string;
};

/** What the model reads beside the file: the fee the invoice is of, never anybody's data. */
export const invoiceBriefing = (cents: number): string =>
  `A nota é de um honorário recebido pelo escritório no valor de ${(cents / 100).toFixed(2).replace(".", ",")} reais.`;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown, most: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, most) : "";

/** A day of the calendar, not after `today`, or "". */
function dayOf(value: unknown, today: string): string {
  const day = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) return "";
  return day >= "2000-01-01" && day <= today ? day : "";
}

/** The answer of the reading, as the form takes it. */
export function readInvoiceOutput(raw: unknown, input: { today: string; entryCents: number }): InvoiceRead {
  const answer = record(raw);
  const cents = typeof answer.valor_centavos === "number" ? Math.trunc(answer.valor_centavos) : 0;
  const value = cents > 0 && cents <= 999_999_999_999 ? cents : 0;
  // An invoice's number is its figures and letters as printed; a dot or a space between them stays out.
  const number = text(answer.numero, 60)
    .replace(/[^0-9A-Za-z/-]/g, "")
    .slice(0, 40);
  return {
    isInvoice: answer.e_nota_de_servico === true,
    number,
    issuedOn: dayOf(answer.data_emissao, input.today),
    cents: value,
    taker: text(answer.tomador, 120),
    code: text(answer.codigo_verificacao, 80),
    matches: value > 0 ? value === input.entryCents : null,
    note: text(answer.observacoes, 300)
      .replace(/\s*[\u2013\u2014]\s*/g, ", ")
      .replace(/!/g, "."),
  };
}
