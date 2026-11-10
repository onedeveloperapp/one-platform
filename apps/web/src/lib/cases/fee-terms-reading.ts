/**
 * The fee terms ONE reads from the firm's own fee contract (migration 0160, task `financeiro.honorarios.leitura`).
 *
 * The model answers each value with the words of the contract it read it from. A value fills the panel of the terms
 * only when those words are in the contract and say that very number: a value read from nowhere, or from words that
 * say another number, is left out and said. The reading decides nothing: who decides for the firm confirms the terms.
 */

export const FEE_TERMS_TASK = "financeiro.honorarios.leitura";

/** How much of a contract's text the model is handed. */
export const CONTRACT_CHARS = 60_000;

export type FeeReadField =
  | "entry"
  | "installments"
  | "monthly"
  | "success"
  | "minimum"
  | "settlement"
  | "hearing"
  | "appeal"
  | "fine"
  | "interest";

export type FeeTermsRead = {
  /** The text is a fee contract, by the model's word. */
  isContract: boolean;
  /** What fills the panel: cents, counts and percents, each only for a field read. */
  values: {
    entryCents?: number;
    installments?: number;
    installmentCents?: number;
    monthlyMonths?: number;
    monthlyCents?: number;
    successPercent?: number;
    successMinCents?: number;
    settlementPercent?: number;
    hearingCents?: number;
    appealCents?: number;
    lateFinePercent?: number;
    lateInterestPercent?: number;
  };
  /** The fields read and checked against the contract. */
  read: FeeReadField[];
  /** The fields the model answered and the contract's words did not say. */
  dropped: FeeReadField[];
  /** What the model asks the person to check, cleaned of marks. */
  note: string | null;
};

/** The text the model reads: the model of the contract, as the firm wrote it, cut to a size. */
export function contractBriefing(name: string, body: string): string {
  return `Modelo de contrato de honorários do escritório, "${name.slice(0, 120)}":\n\n${body.slice(0, CONTRACT_CHARS)}`;
}

/** Lower case, no accents, one space, the quotes and dashes of a word processor made plain. */
export function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/** The words of an excerpt are the contract's: every piece of it between ellipses, in order, at least a few words. */
export function excerptIn(excerpt: string, text: string): boolean {
  const pieces = plain(excerpt)
    .split(/\.\.\.|\u2026/)
    .map((piece) => piece.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  if (pieces.length === 0 || pieces.join(" ").length < 6) return false;
  const whole = plain(text);
  let from = 0;
  for (const piece of pieces) {
    const at = whole.indexOf(piece, from);
    if (at < 0) return false;
    from = at + piece.length;
  }
  return true;
}

/** Every amount of money an excerpt writes, in cents: "R$ 1.500,00", "1.500,00", "R$ 500". */
export function moneyIn(excerpt: string): number[] {
  const found: number[] = [];
  const text = excerpt.replace(/\s+/g, " ");
  for (const match of text.matchAll(/R\$ ?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?(?!\d)/gi)) {
    found.push(Number(match[1].replace(/\./g, "")) * 100 + Number(match[2] ?? 0));
  }
  for (const match of text.matchAll(/(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(?!\d)/g)) {
    found.push(Number(match[1].replace(/\./g, "")) * 100 + Number(match[2]));
  }
  return found;
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  quinze: 15,
  dezoito: 18,
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
};

/** Every percent an excerpt writes: "30%", "30 %", "2,5%", "trinta por cento", "30 (trinta) por cento". */
export function percentsIn(excerpt: string): number[] {
  const found: number[] = [];
  const text = plain(excerpt);
  for (const match of text.matchAll(/(\d{1,3}(?:,\d{1,2})?)\s*(?:\([a-z ]+\)\s*)?(?:%|por cento)/g)) {
    found.push(Number(match[1].replace(",", ".")));
  }
  for (const match of text.matchAll(/\b([a-z]+(?: e [a-z]+)?)\s+por cento/g)) {
    const words = match[1].split(" e ");
    if (words.every((word) => word in NUMBER_WORDS))
      found.push(words.reduce((sum, word) => sum + NUMBER_WORDS[word], 0));
  }
  return found;
}

/** Every whole count an excerpt writes, in figures or in words. */
export function countsIn(excerpt: string): number[] {
  const text = plain(excerpt);
  const found = [...text.matchAll(/(?<![\d.,])(\d{1,3})(?![\d.,]\d)/g)].map((match) => Number(match[1]));
  for (const word of text.split(/[^a-z]+/)) if (word in NUMBER_WORDS) found.push(NUMBER_WORDS[word]);
  return found;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const whole = (value: unknown): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};
const words = (value: unknown): string => (typeof value === "string" ? value.slice(0, 600) : "");
const cleanNote = (value: unknown): string | null => {
  const text = words(value)
    .replace(/\[\[[^\]]*\]\]/g, "")
    .replace(/\s*[\u2013\u2014]\s*/g, ", ")
    .replace(/!/g, ".")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text.slice(0, 400) : null;
};

/** What the model answered, checked against the contract's text. */
export function readFeeTermsOutput(output: unknown, text: string): FeeTermsRead {
  const answer = record(output);
  const values: FeeTermsRead["values"] = {};
  const read: FeeReadField[] = [];
  const dropped: FeeReadField[] = [];
  const isContract = answer.e_contrato_de_honorarios === true;
  if (!isContract) return { isContract, values, read, dropped, note: cleanNote(answer.observacoes) };

  const said = (field: FeeReadField, ok: boolean, write: () => void) => {
    if (ok) {
      write();
      read.push(field);
    } else {
      dropped.push(field);
    }
  };
  const inText = (key: string) => {
    const excerpt = words(answer[key]);
    return excerpt.length > 0 && excerptIn(excerpt, text) ? excerpt : null;
  };
  const money = (cents: number, excerpt: string | null) => !!excerpt && moneyIn(excerpt).includes(cents);
  const percent = (value: number, excerpt: string | null) =>
    !!excerpt && percentsIn(excerpt).some((found) => Math.abs(found - value) < 0.005);
  const count = (value: number, excerpt: string | null) => !!excerpt && countsIn(excerpt).includes(value);

  const entry = Math.trunc(whole(answer.entrada_centavos));
  if (entry > 0) said("entry", money(entry, inText("entrada_trecho")), () => (values.entryCents = entry));

  const installments = Math.trunc(whole(answer.parcelas));
  const installment = Math.trunc(whole(answer.parcela_centavos));
  if (installments > 0 || installment > 0) {
    const excerpt = inText("parcelas_trecho");
    said(
      "installments",
      installments > 0 &&
        installments <= 60 &&
        installment > 0 &&
        count(installments, excerpt) &&
        money(installment, excerpt),
      () => {
        values.installments = installments;
        values.installmentCents = installment;
      },
    );
  }

  const months = Math.trunc(whole(answer.mensalidades));
  const monthly = Math.trunc(whole(answer.mensalidade_centavos));
  if (months > 0 || monthly > 0) {
    const excerpt = inText("mensalidade_trecho");
    said(
      "monthly",
      months > 0 && months <= 120 && monthly > 0 && count(months, excerpt) && money(monthly, excerpt),
      () => {
        values.monthlyMonths = months;
        values.monthlyCents = monthly;
      },
    );
  }

  const success = whole(answer.exito_percentual);
  const successExcerpt = inText("exito_trecho");
  if (success > 0) {
    said("success", success <= 100 && percent(success, successExcerpt), () => (values.successPercent = success));
  }
  const minimum = Math.trunc(whole(answer.exito_minimo_centavos));
  if (minimum > 0) said("minimum", money(minimum, successExcerpt), () => (values.successMinCents = minimum));

  const settlement = whole(answer.acordo_percentual);
  if (settlement > 0) {
    said("settlement", settlement <= 100 && percent(settlement, inText("acordo_trecho")), () => {
      values.settlementPercent = settlement;
    });
  }

  const hearing = Math.trunc(whole(answer.audiencia_centavos));
  if (hearing > 0) said("hearing", money(hearing, inText("audiencia_trecho")), () => (values.hearingCents = hearing));
  const appeal = Math.trunc(whole(answer.recurso_centavos));
  if (appeal > 0) said("appeal", money(appeal, inText("recurso_trecho")), () => (values.appealCents = appeal));

  const lateExcerpt = inText("atraso_trecho");
  const fine = whole(answer.multa_percentual);
  if (fine > 0) said("fine", fine <= 20 && percent(fine, lateExcerpt), () => (values.lateFinePercent = fine));
  const interest = whole(answer.juros_percentual_mes);
  if (interest > 0) {
    said("interest", interest <= 10 && percent(interest, lateExcerpt), () => (values.lateInterestPercent = interest));
  }

  return { isContract, values, read, dropped, note: cleanNote(answer.observacoes) };
}
