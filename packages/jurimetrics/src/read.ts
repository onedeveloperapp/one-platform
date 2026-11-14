import { createHash } from "node:crypto";

import { decodeEntities, OPERATIVE_MARK, readJudgment } from "@flyee/rules/outcome";
import type { MarketDecision, MarketExtinction, MarketProblem, MarketResult } from "@flyee/jurimetrics/types";

const lastMark = (words: string): number => {
  const all = [...words.matchAll(OPERATIVE_MARK)];
  return all.length ? (all[all.length - 1].index ?? -1) : -1;
};

/**
 * What a public decision says, read by rule (`mercado-v2`): its result (the outcome rule's reading of a judgment's
 * operative part, `resultado-v1`, or the lawsuit extinguished), the moral damages set, the kind of problem, the
 * judge who signed it, whether it is an appeal's, and why the lawsuit was extinguished. A communication that is no
 * decision is none. Nothing of a passenger is kept: the grounds are handed out with identifiers taken out, for a
 * reading at that moment, and never kept.
 *
 * `mercado-v2` (2026-11-14), checked by hand on 60 real judgments of the TJGO before it was used: it decodes the
 * DJEN's HTML entities before any rule ("Ju&iacute;za", "&Iacute;" cut a judge's name, and no reason of extinction
 * matched); it reads the moral damages from their own clause of the operative part (`claims` of the outcome rule;
 * `mercado-v1` took the first value after "condeno", the material damages or a refund in 10 of 29 wins: R$ 314,40
 * where the court set R$ 5.000,00); an enforcement phase ended by payment (CPC, art. 924) is no decision of the
 * claim (57 of 68 "extinctions" were); it reads why a lawsuit was extinguished; and it keys each text so the same
 * decision published twice is counted once.
 */
export const MARKET_RULE = "mercado-v2";

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

/**
 * The key of a decision's text: the court, the unit, the day and the words, folded. The DJEN publishes some decisions
 * twice under two keys of its own (12 of 365 read on 2026-11-14); this counts each once.
 */
export function contentKeyOf(court: string, unit: string | null, day: string, words: string): string {
  return createHash("sha256")
    .update([court.trim().toUpperCase(), plain(unit ?? ""), day, words.replace(/[^a-z0-9]+/g, " ").trim()].join("|"))
    .digest("hex")
    .slice(0, 40);
}

/** Why a lawsuit was extinguished, by the words of its operative part first, then of the whole text. */
export function extinctionOf(text: string): MarketExtinction {
  const words = plain(decodeEntities(text));
  const at = lastMark(words);
  const reasons: [MarketExtinction, RegExp][] = [
    [
      "ausencia_autor",
      /ausencia (injustificada )?d[ao] (parte )?(autor|autora|requerente|promovente)|nao compareceu|nao comparecimento d[ao] (parte )?(autor|autora|requerente|promovente)|deixou de comparecer|art\.? 51,? (inciso )?i\b|artigo 51,? (inciso )?i\b/,
    ],
    ["desistencia", /desistencia|desistiu/],
    ["reclamacao_previa", /pretensao resistida|reclamacao (previa|administrativa)|consumidor\.gov/],
    [
      "incompetencia",
      /incompetencia|complexidade|prova pericial|pericia tecnica|art\.? 51,? (inciso )?ii\b|artigo 51,? (inciso )?ii\b/,
    ],
    ["abandono", /abandono|inercia d[ao] (parte )?(autor|autora)|art\.? 485,? (inciso )?iii\b/],
  ];
  for (const part of at >= 0 ? [words.slice(at), words.slice(Math.max(0, at - 800), at)] : [words.slice(-2000)]) {
    const found = reasons.find(([, pattern]) => pattern.test(part));
    if (found) return found[0];
  }
  return "outro";
}

/** The judge who signed it, as written, from the signature's line; null when it is not there. */
export function judgeOf(text: string): string | null {
  const raw = decodeEntities(text).replace(/\s+/g, " ");
  const word = "[A-ZÀ-Ý][A-Za-zÀ-ÿ']+";
  const name = `(${word}(?: (?:d[aeo]s?|e|${word})){1,8})`;
  const title = "(?:Ju[ií]z|JU[IÍ]Z)(?:a|A)? (?:de Direito|DE DIREITO|Substitut[oa]|SUBSTITUT[OA]|Titular|TITULAR)";
  const found = [...raw.matchAll(new RegExp(`${name}\\s*[,-]?\\s*${title}`, "g"))];
  // A name after the title only where a colon says so ("Juiz de Direito: Name"): a title's own words never are one.
  const after = found.length ? [] : [...raw.matchAll(new RegExp(`${title}\\s*:\\s*${name}`, "g"))];
  const chosen = found.length ? found[found.length - 1][1] : after.length ? after[after.length - 1][1] : "";
  const last = chosen
    .replace(/^(?:e|d[aeo]s?) /, "")
    .replace(/\b(?:Assinado|Documento|Data|Processo|Autos)\b.*$/, "")
    .trim();
  return last.split(" ").length >= 2 && last.length <= 80 ? last : null;
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
  // The DJEN's entities decoded and each letter joined to its accent before any rule reads the text.
  const raw = decodeEntities(String(item.text ?? ""));
  if (!item.key || !raw.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(item.day)) return null;
  const words = plain(raw);
  const judgment = readJudgment(raw);
  let result: MarketResult | null = judgment ? judgment.result : null;
  // An extinction only by a ruling's verb, never by an order's warning ("sob pena de extinção do processo").
  const endings = [
    ...words.matchAll(
      /(?:julgo|declaro|decreto|(?:sugiro|opino|proponho|hei por bem)[^.;]{0,30}?(?:julgar|declarar)) (?:(?:o processo|o feito|a (?:presente )?acao) )?extint\w*|extingo o (?:processo|feito)/g,
    ),
  ].filter(
    (ending) =>
      !/(?:sob pena de|importara|causara|gerara|ensejar|implicara|acarretara|podera)[^.;]{0,40}$/.test(
        words.slice(Math.max(0, (ending.index ?? 0) - 60), ending.index ?? 0),
      ),
  );
  if (!result && endings.length) {
    const at = endings[endings.length - 1].index ?? 0;
    const around = words.slice(Math.max(0, at - 200), at + 250);
    if (
      /\b92[45]\b|\bexecu\w*|\bexequen\w*|cumpri\w* (?:d[ae] |a )sentenca|quitacao|satisf\w* (?:integral )?d[ao] (?:obrigacao|credito|debito)|adimplemento|pagamento do debito/.test(
        around,
      )
    )
      return null;
    result = "extinto";
  }
  if (!result) return null;
  const operativeAt = lastMark(words);
  const operative = operativeAt >= 0 ? words.slice(operativeAt) : words.slice(-1500);
  const won = result === "procedente" || result === "parcial";
  // The moral damages from their own clause; where no clause names them, the condemnation's value only when the
  // operative part names moral damages and no other claim a value could belong to.
  const moralClaim = won
    ? judgment?.claims.find((claim) => claim.claim === "danos_morais" && claim.result === "concedido")
    : undefined;
  const alone =
    won &&
    !moralClaim &&
    judgment?.cents != null &&
    (/mora(l|is)/.test(operative) ||
      ((judgment?.claims.length ?? 0) === 0 &&
        !/obrigacao de fazer|multa diaria|astreinte/.test(operative) &&
        /danos? mora(l|is)/.test(words.slice(Math.max(0, operativeAt - 4000), Math.max(0, operativeAt))))) &&
    !/materia(l|is)|emergente|restitu|reembols|devolu|lucros? cessante/.test(operative);
  const moral = moralClaim?.cents ?? (alone ? (judgment?.cents ?? null) : null);
  const perClaimant = moral !== null && (moralClaim ? moralClaim.perClaimant : Boolean(judgment?.perClaimant));
  const unit = item.unit?.trim() || null;
  const extinction = result === "extinto" ? extinctionOf(raw) : null;
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
    perClaimant,
    problem: problemOf(raw),
    priorComplaint: extinction === "reclamacao_previa",
    extinctionReason: extinction,
    contentKey: contentKeyOf(item.court, unit, item.day, words),
    grounds: withoutIdentifiers(raw.replace(/\s+/g, " ").slice(-6000)),
  };
}
