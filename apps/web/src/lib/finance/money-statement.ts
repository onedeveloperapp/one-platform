import { documentText } from "@/lib/finance/receipts";
import type { TextBlock } from "@flyee/documents/text-pdf";

/**
 * The accountability statement ONE issues to a client once their part of a release is passed on, or the court paid it
 * to them (migration 0156, the plan of the finance, phase 10): a document of the firm with its public code that says
 * what the court released, the client's part, what the firm kept and on what basis, what was held and why, and what
 * was passed on, when and to which account. Pure. Nothing in it names the platform: it is the firm's.
 */

export type StatementFacts = {
  firm: string;
  firmDocument: string | null;
  person: string;
  personCpf: string | null;
  minor: boolean;
  caseSeq: number | null;
  cnj: string | null;
  court: string | null;
  /** `firm`: the money fell in the firm's account and was passed on; `direct`: the court paid the client. */
  path: "firm" | "direct";
  releasedCents: number;
  releasedOn: string;
  grossCents: number;
  feesCents: number;
  feesPercent: number | null;
  costsCents: number;
  heldCents: number;
  held: { reason: string; cents: number }[];
  payableCents: number;
  paidOn: string | null;
  account: { kind: "pix" | "conta"; ends: string } | null;
  issuedOn: string;
};

const moneyText = (cents: number): string =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");

const shortDay = (iso: string | null): string => (iso ? iso.split("-").reverse().join("/") : "");

const longDay = (iso: string): string => {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
};

const cnjText = (digits: string | null): string | null =>
  digits && /^\d{20}$/.test(digits)
    ? digits.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, "$1-$2.$3.$4.$5.$6")
    : null;

/** Why a part of the money was held, in the client's words. */
const HELD_WORDS: Record<string, string> = {
  no_clause: "honorários sem autorização assinada para retenção, em análise pelo escritório",
  cap_art50: "valor acima do limite dos honorários, em análise pelo escritório",
  minor: "parte de menor de idade, paga como o juiz determinar",
};

/** The statement's own words: the title and the blocks of its PDF. */
export function moneyStatementDocument(facts: StatementFacts): { title: string; blocks: TextBlock[] } {
  const title = facts.caseSeq ? `Prestação de contas do caso nº ${facts.caseSeq}` : "Prestação de contas";
  const firmDocument = documentText(facts.firmDocument);
  const personCpf = documentText(facts.personCpf);
  const lawsuit = cnjText(facts.cnj);
  const firmLine = firmDocument
    ? `${facts.firm}, ${firmDocument.length > 14 ? "CNPJ" : "CPF"} nº ${firmDocument}`
    : facts.firm;
  const rows: { label: string; value: string }[] = [
    { label: "Cliente", value: personCpf ? `${facts.person}, CPF nº ${personCpf}` : facts.person },
    ...(lawsuit ? [{ label: "Processo", value: facts.court ? `${lawsuit} (${facts.court})` : lawsuit }] : []),
    { label: "Valor liberado pelo juízo", value: `${moneyText(facts.releasedCents)} em ${shortDay(facts.releasedOn)}` },
    { label: "Sua parte", value: moneyText(facts.grossCents) },
  ];
  if (facts.feesCents > 0) {
    rows.push({
      label: "Honorários retidos",
      value: facts.feesPercent
        ? `${moneyText(facts.feesCents)} (${facts.feesPercent}% conforme o contrato de honorários)`
        : `${moneyText(facts.feesCents)} (conforme o contrato de honorários)`,
    });
  }
  if (facts.costsCents > 0) {
    rows.push({ label: "Custos reembolsados ao escritório", value: moneyText(facts.costsCents) });
  }
  for (const held of facts.held.filter((item) => item.cents > 0)) {
    rows.push({ label: "Valor retido", value: `${moneyText(held.cents)}, ${HELD_WORDS[held.reason] ?? "em análise"}` });
  }
  rows.push({
    label: facts.path === "direct" ? "Pago pelo juízo diretamente a você" : "Repassado a você",
    value: facts.paidOn
      ? `${moneyText(facts.payableCents)} em ${shortDay(facts.paidOn)}`
      : moneyText(facts.payableCents),
  });
  if (facts.account && facts.path === "firm") {
    rows.push({
      label: "Conta de destino",
      value:
        facts.account.kind === "pix"
          ? `Pix na chave do seu CPF, final ${facts.account.ends}`
          : `Conta final ${facts.account.ends}`,
    });
  }
  return {
    title,
    blocks: [
      { kind: "title", text: "Prestação de contas" },
      {
        kind: "paragraph",
        text: facts.minor
          ? `${firmLine} presta contas do valor que coube a ${facts.person}, menor de idade, no processo abaixo.`
          : `${firmLine} presta contas do valor que coube a ${facts.person} no processo abaixo.`,
      },
      { kind: "fields", rows },
      { kind: "space", points: 8 },
      {
        kind: "paragraph",
        text: "O escritório nunca pede pagamento para liberar um valor. Se alguém pedir em nome do escritório, não pague e fale com o escritório pelos canais de sempre.",
      },
      { kind: "space", points: 12 },
      { kind: "paragraph", text: `Emitido em ${longDay(facts.issuedOn)}.` },
      { kind: "space", points: 24 },
      { kind: "paragraph", text: firmLine },
    ],
  };
}
