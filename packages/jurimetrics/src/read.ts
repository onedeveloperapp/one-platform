import { readJudgment } from "@flyee/rules/outcome";
import type { MarketDecision, MarketProblem, MarketResult } from "@flyee/jurimetrics/types";

/**
 * What a public decision says, read by rule (`mercado-v1`): its result (the outcome rule's reading of a judgment's
 * operative part, `resultado-v1`, or the lawsuit extinguished), the moral damages set, the kind of problem, the
 * judge who signed it, whether it is an appeal's, and whether the lawsuit was extinguished for want of a prior
 * complaint. A communication that is no decision is none. Nothing of a passenger is kept: the grounds are handed out
 * with identifiers taken out, for a reading at that moment, and never kept.
 */
export const MARKET_RULE = "mercado-v1";

const plain = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ");

/** What is written as a CPF, a CNPJ, an e-mail, a telephone or a CEP, taken out. */
export function withoutIdentifiers(text: string): string {
  return text
    .replace(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g, "[documento]")
    .replace(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g, "[documento]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[e-mail]")
    .replace(/\(?\d{2}\)?\s?9?\d{4}-?\d{4}/g, "[telefone]")
    .replace(/\d{5}-\d{3}/g, "[cep]");
}

/** The kind of problem the decision is about, by its words. */
export function problemOf(text: string): MarketProblem {
  const words = plain(text);
  if (/bagage[mn]|extravi|mala /.test(words)) return "baggage";
  if (/preteri[cç]ao|overbooking|embarque negado|impedid[oa] de embarcar/.test(words)) return "overbooking";
  if (/cancelamento|cancelad[oa]/.test(words)) return "cancellation";
  if (/atras[oa]|horas de espera|chegou .{0,40} horas depois/.test(words)) return "delay";
  return "other";
}

/** The judge who signed it, as written, from the signature's line; null when it is not there. */
export function judgeOf(text: string): string | null {
  const raw = text.replace(/\s+/g, " ");
  const before = [
    ...raw.matchAll(
      /([A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+(?: (?:d[aeo]s?|[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+)){1,7})\s*[,-]?\s*Ju[ií]z(?:a)? (?:de Direito|Substitut[oa]|Titular)/g,
    ),
  ];
  const after = [
    ...raw.matchAll(
      /Ju[ií]z(?:a)? (?:de Direito|Substitut[oa]|Titular)\s*[:,-]?\s*([A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+(?: (?:d[aeo]s?|[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+)){1,7})/g,
    ),
  ];
  const found = (before.length ? before[before.length - 1][1] : after.length ? after[after.length - 1][1] : "").trim();
  const name = found.replace(/\b(?:Assinado|Documento|Data|Processo|Autos)\b.*$/, "").trim();
  return name.split(" ").length >= 2 && name.length <= 80 ? name : null;
}

/**
 * A communication of the source as a decision, or null when it is none: the result read from its operative part, or
 * the lawsuit extinguished.
 */
export function readMarketDecision(item: {
  key: string;
  court: string;
  unit: string | null;
  party: string;
  day: string;
  text: string;
}): MarketDecision | null {
  const raw = String(item.text ?? "");
  if (!item.key || !raw.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(item.day)) return null;
  const words = plain(raw);
  const judgment = readJudgment(raw);
  let result: MarketResult | null = judgment ? judgment.result : null;
  if (!result && /julgo extint|extingo o processo|extincao do processo|sem resolucao do merito/.test(words)) {
    result = "extinto";
  }
  if (!result) return null;
  const operativeAt = Math.max(
    words.lastIndexOf("ante o exposto"),
    words.lastIndexOf("isto posto"),
    words.lastIndexOf("diante do exposto"),
    words.lastIndexOf("pelo exposto"),
  );
  const operative = operativeAt >= 0 ? words.slice(operativeAt) : words.slice(-1500);
  const moral =
    judgment && judgment.cents !== null && (result === "procedente" || result === "parcial") && /mora(l|is)/.test(operative)
      ? judgment.cents
      : null;
  const unit = item.unit?.trim() || null;
  return {
    key: item.key,
    court: item.court.trim().toUpperCase(),
    unit,
    judge: judgeOf(raw),
    party: item.party,
    day: item.day,
    instance: unit && /turma recursal|camara|câmara|colegiad/i.test(unit) ? "appeal" : "first",
    result,
    moralCents: moral,
    perClaimant: moral !== null && Boolean(judgment?.perClaimant),
    problem: problemOf(raw),
    priorComplaint:
      result === "extinto" &&
      /pretensao resistida|reclamacao (previa|administrativa)|consumidor\.gov|interesse de agir|interesse processual/.test(
        words,
      ),
    grounds: withoutIdentifiers(raw.replace(/\s+/g, " ").slice(-6000)),
  };
}
