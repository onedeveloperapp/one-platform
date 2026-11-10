import type { TextBlock } from "@flyee/documents/text-pdf";

/**
 * The receipt ONE issues to a client when a bill of theirs is received (migration 0152, the plan of the finance,
 * phase 5): a document of the firm with its public code, shown on the client's link. Pure: the value written out, what
 * the receipt says, and the receipts as the database answers them. ONE receives no money: the receipt says what the
 * firm received, as the firm recorded it.
 */

const UNITS = [
  "zero",
  "um",
  "dois",
  "três",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove",
  "dez",
  "onze",
  "doze",
  "treze",
  "quatorze",
  "quinze",
  "dezesseis",
  "dezessete",
  "dezoito",
  "dezenove",
];
const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const HUNDREDS = [
  "",
  "cento",
  "duzentos",
  "trezentos",
  "quatrocentos",
  "quinhentos",
  "seiscentos",
  "setecentos",
  "oitocentos",
  "novecentos",
];
const SCALES: [string, string][] = [
  ["", ""],
  ["mil", "mil"],
  ["milhão", "milhões"],
  ["bilhão", "bilhões"],
];

/** 1 to 999 in words. */
function belowThousand(value: number): string {
  if (value === 100) return "cem";
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds) parts.push(HUNDREDS[hundreds]);
  if (rest) {
    if (rest < 20) parts.push(UNITS[rest]);
    else {
      const tens = Math.floor(rest / 10);
      const units = rest % 10;
      parts.push(units ? `${TENS[tens]} e ${UNITS[units]}` : TENS[tens]);
    }
  }
  return parts.join(" e ");
}

/**
 * A whole number in words, as a check writes it: "mil e quinhentos", "mil duzentos e cinquenta", "um milhão e
 * quinhentos mil". The last group is joined by "e" when it is below a hundred or a round hundred.
 */
export function numberInWords(whole: number): string {
  let value = Math.floor(Math.abs(whole));
  if (value === 0) return UNITS[0];
  const groups: { value: number; scale: number }[] = [];
  for (let scale = 0; value > 0 && scale < SCALES.length; scale += 1) {
    groups.push({ value: value % 1000, scale });
    value = Math.floor(value / 1000);
  }
  const named = groups
    .filter((group) => group.value > 0)
    .reverse()
    .map((group) => {
      if (group.scale === 0) return { group, words: belowThousand(group.value) };
      if (group.scale === 1) return { group, words: group.value === 1 ? "mil" : `${belowThousand(group.value)} mil` };
      const [one, many] = SCALES[group.scale];
      return { group, words: `${belowThousand(group.value)} ${group.value === 1 ? one : many}` };
    });
  return named
    .map((part, index) => {
      if (index === 0) return part.words;
      const last = index === named.length - 1;
      const joined = last && (part.group.value < 100 || part.group.value % 100 === 0);
      return `${joined ? " e " : " "}${part.words}`;
    })
    .join("");
}

/** An amount of money in words: "mil e quinhentos reais", "um real e cinquenta centavos", "um milhão de reais". */
export function moneyInWords(cents: number): string {
  const total = Math.round(Math.abs(cents));
  const reais = Math.floor(total / 100);
  const centavos = total % 100;
  const parts: string[] = [];
  if (reais > 0) {
    const round = reais >= 1_000_000 && reais % 1_000_000 === 0;
    parts.push(reais === 1 ? "um real" : `${numberInWords(reais)} ${round ? "de reais" : "reais"}`);
  }
  if (centavos > 0) parts.push(centavos === 1 ? "um centavo" : `${belowThousand(centavos)} centavos`);
  return parts.length > 0 ? parts.join(" e ") : "zero real";
}

const moneyText = (cents: number): string =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");

const dayText = (iso: string): string => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

const shortDay = (iso: string): string => iso.split("-").reverse().join("/");

/** A CPF or a CNPJ, by its digits, written as people write it; anything else as it came. */
export function documentText(digits: string | null | undefined): string | null {
  const plain = (digits ?? "").replace(/\D/g, "");
  if (plain.length === 11) return plain.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  if (plain.length === 14) return plain.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  return null;
}

/** What a receipt is written from, as the database hands it (`finance_receipt_to_issue`). */
export type ReceiptFacts = {
  firm: string;
  /** The firm's CNPJ, or the lawyer's CPF of a firm of one, by its digits; none when not on record. */
  firmDocument: string | null;
  payer: string;
  payerCpf: string | null;
  cents: number;
  /** The day the firm recorded the money as received, YYYY-MM-DD. */
  paidOn: string;
  /** What it was for, as the bill says it ("Entrada dos honorários"). */
  about: string;
  caseSeq: number | null;
  /** The day it is issued, YYYY-MM-DD, in Brasília. */
  issuedOn: string;
};

/** The receipt's own words: the title and the blocks of its PDF. */
export function receiptDocument(facts: ReceiptFacts): { title: string; blocks: TextBlock[] } {
  const value = moneyText(facts.cents);
  const payerCpf = documentText(facts.payerCpf);
  const firmDocument = documentText(facts.firmDocument);
  const about = facts.about.trim().replace(/[.;:,]+$/, "") || "Serviços advocatícios";
  const aboutCase = facts.caseSeq ? `${about}, do caso nº ${facts.caseSeq}` : about;
  const firmLine = firmDocument
    ? `${facts.firm}, ${firmDocument.length > 14 ? "CNPJ" : "CPF"} nº ${firmDocument}`
    : facts.firm;
  const title = facts.caseSeq ? `Recibo do caso nº ${facts.caseSeq}` : "Recibo";
  return {
    title,
    blocks: [
      { kind: "title", text: "Recibo" },
      {
        kind: "fields",
        rows: [
          { label: "Valor", value },
          { label: "Recebido em", value: shortDay(facts.paidOn) },
        ],
      },
      { kind: "space", points: 6 },
      {
        kind: "paragraph",
        text:
          `${firmLine} recebeu de ${facts.payer}` +
          (payerCpf ? `, CPF nº ${payerCpf},` : "") +
          ` a quantia de ${value} (${moneyInWords(facts.cents)}), referente a ${aboutCase}.`,
      },
      {
        kind: "paragraph",
        text: "Pelo que dá plena quitação do valor acima, sem prejuízo de outros valores ainda devidos.",
      },
      { kind: "space", points: 12 },
      { kind: "paragraph", text: `Emitido em ${dayText(facts.issuedOn)}.` },
      { kind: "space", points: 24 },
      { kind: "paragraph", text: firmLine },
    ],
  };
}

/** Where a receipt stands, as the firm and the client read it. */
export type ReceiptStatus = "owed" | "waiting" | "issued" | "failed" | "void";

export type FinanceReceipt = {
  id: string;
  billId: string;
  status: ReceiptStatus;
  cents: number;
  paidOn: string;
  issuedAt: string | null;
  verifyCode: string | null;
  fileId: string | null;
  error: string | null;
};

const STATUSES: ReceiptStatus[] = ["owed", "waiting", "issued", "failed", "void"];

/** The receipts as the database answers them; anything unreadable is left out. */
export function readReceipts(raw: unknown): FinanceReceipt[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row): FinanceReceipt[] => {
    if (typeof row !== "object" || row === null) return [];
    const value = row as Record<string, unknown>;
    const status = STATUSES.find((item) => item === value.status);
    if (typeof value.id !== "string" || typeof value.bill_id !== "string" || !status) return [];
    const issued = Array.isArray(value.issued_documents) ? value.issued_documents[0] : value.issued_documents;
    const document = (issued ?? null) as Record<string, unknown> | null;
    return [
      {
        id: value.id,
        billId: value.bill_id,
        status,
        cents: Number(value.cents ?? 0),
        paidOn: typeof value.paid_on === "string" ? value.paid_on : "",
        issuedAt: typeof value.issued_at === "string" ? value.issued_at : null,
        verifyCode: typeof document?.verify_code === "string" ? document.verify_code : null,
        fileId: typeof document?.file_id === "string" ? document.file_id : null,
        error: typeof value.error === "string" ? value.error : null,
      },
    ];
  });
}

/** The receipt a bill shows: the latest that was not voided, else the latest of all. */
export function receiptOfBill(receipts: readonly FinanceReceipt[], billId: string): FinanceReceipt | null {
  const mine = receipts.filter((receipt) => receipt.billId === billId);
  return mine.find((receipt) => receipt.status !== "void") ?? mine[0] ?? null;
}
