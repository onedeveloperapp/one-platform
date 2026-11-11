/**
 * Whether a decision the court published is the lawsuit's judgment (`sentenca-v1`): a person triages a
 * publication as a decision (0028), and the court publishes many before its judgment (an injunction, an order on
 * the free justice or on costs, an order to amend the petition). The case's way marks the judgment only by a
 * decision said to be one (0096). The owner's rule of 2026-11-05: the person is asked only when the publication
 * does not say it clearly.
 *
 * It reads first the type the DJEN gave the communication (`tipoDocumento`: "Sentença", "Acórdão", "Decisão",
 * "Despacho"), then the words of the text: the forms a judgment is written in ("julgo procedente", "resolvo o
 * mérito", "art. 487", "homologo o projeto de sentença", the report the small-claims court dispenses with) and
 * the forms of a decision before it ("tutela de urgência", "liminar", "designo audiência", "emende a inicial").
 * Only one side found says it; both, or neither, is unclear, and the person answers. An acórdão (the appeal's
 * judgment) is past the judgment too, so it marks it. Pure: no I/O, no clock.
 */

export const JUDGMENT_RULE_VERSION = "sentenca-v1";

/** The answer: the judgment, not the judgment, or not clear (the person is asked). */
export type JudgmentReading = true | false | null;

/** Lower case, with no accents and one space between words: the form every list below is written in. */
export function plainWords(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The forms a judgment is written in. */
const JUDGMENT_FORMS: readonly RegExp[] = [
  /\bjulgo (totalmente |parcialmente )?(im)?procedente/,
  /\bjulgo (o processo |o feito )?extint[oa]/,
  /\bextingo o (processo|feito)/,
  /\bjulgo (o processo |o feito )?(com|sem) resolucao do merito/,
  /\b(com|sem) (resolucao|julgamento) do merito/,
  /\bresolvo o merito/,
  /\b(art\.?|artigo) ?48[57]\b/,
  /\bhomologo (o |a )?(projeto de sentenca|decisao do juiz leigo|parecer do juiz leigo)/,
  /\bhomologo (o |por sentenca )?(o )?acordo/,
  /\bdispensad[oa] o relatorio/,
  /\bpublique-se\.? registre-se\.? intimem-se/,
  /\bp\.? ?r\.? ?i\.?\b/,
  /\bnego provimento ao recurso\b/,
  /\bdou (parcial )?provimento ao recurso\b/,
  /\bconheco do recurso\b/,
];

/** The forms of a decision before the judgment, or of an order of the course of the lawsuit. */
const BEFORE_FORMS: readonly RegExp[] = [
  /\btutela (de urgencia|antecipada|provisoria|de evidencia)/,
  /\bliminar/,
  /\bdecisao interlocutoria/,
  /\bdesigno (a |nova )?audiencia/,
  /\bredesigno/,
  /\bcite-se\b/,
  /\bemende a (peticao )?inicial/,
  /\b(defiro|indefiro) (o pedido de |a )?(gratuidade|justica gratuita|assistencia judiciaria)/,
  /\bconverto o julgamento em diligencia/,
  /\bintime-se a parte (autora|re|requerida|requerente) para/,
  /\bespecifiquem as provas/,
  /\bsaneamento\b|\bsaneador\b/,
];

/** What the DJEN's type of document says of itself; null when it says nothing either way. */
function byType(documentType: string | null | undefined): JudgmentReading {
  const type = plainWords(documentType ?? "");
  if (!type) return null;
  if (/\bsentenca\b|\bacordao\b/.test(type)) return true;
  if (/\bdecisao\b|\bdespacho\b|\bato ordinatorio\b|\bcertidao\b/.test(type)) return false;
  return null;
}

/** Whether a publication triaged as a decision is the lawsuit's judgment, by its type and its words. */
export function judgmentOf(input: { documentType?: string | null; text: string }): JudgmentReading {
  const words = plainWords(input.text);
  const judgment = JUDGMENT_FORMS.some((form) => form.test(words));
  const before = BEFORE_FORMS.some((form) => form.test(words));
  const type = byType(input.documentType);
  // The type and the words agree, or only one of them says anything.
  if (type === true) return before && !judgment ? null : true;
  if (type === false) return judgment ? null : false;
  if (judgment && !before) return true;
  if (before && !judgment) return false;
  return null;
}

/**
 * Whether a judgment homologates the parties' settlement (`acordo-v1`): none of them appeals it, since the
 * small-claims court gives no recurso against it (Lei 9.099/1995, art. 41) and whoever settled accepted the decision
 * (CPC, art. 1.000); the embargos de declaração stay, for a material error. Read in its words: "homologo" and the
 * settlement before the sentence ends (a "projeto de sentença" of the juiz leigo is no settlement), or the settlement
 * said homologated. The database reads the same forms (`reading_homologates_settlement`, 0213).
 */
export const SETTLEMENT_RULE_VERSION = "acordo-v1";

const SETTLEMENT_NOUN = /\b(?:o acordo|a transacao|a conciliacao|a composicao|o termo de acordo)\b/;
const NOT_SETTLEMENT = /\b(?:projeto de sentenca|juiz leigo)\b/;
const SETTLEMENT_FORMS: readonly RegExp[] = [
  /\bhomologad[oa],? (?:por sentenca,? )?(?:o |a )?(?:acordo|transacao|conciliacao|composicao)\b/,
  /\b(?:acordo|transacao|conciliacao|composicao) (?:celebrad[oa] |firmad[oa] |entabulad[oa] )?(?:entre as partes )?(?:fica |foi )?homologad[oa]\b/,
];

export function homologatesSettlement(text: string): boolean {
  const words = plainWords(text);
  for (const match of words.matchAll(/\bhomologo\b([^.;]{0,160})/g)) {
    const rest = match[1] ?? "";
    if (SETTLEMENT_NOUN.test(rest) && !NOT_SETTLEMENT.test(rest)) return true;
  }
  return SETTLEMENT_FORMS.some((form) => form.test(words));
}

/**
 * Whether a decision rules on embargos de declaração (`embargos-v1`): it interrupts the term to appeal, which runs
 * whole again from it (Lei 9.099/1995, art. 50; CPC, art. 1.026). Read in its words: the embargos received and
 * decided ("acolho", "rejeito", "conheço", "não conheço", "dou provimento", "nego provimento", "julgo procedentes"
 * or "improcedentes" them), or said decided ("embargos de declaração rejeitados"); never an order on their course
 * ("intime-se a parte embargada"). Which judgment they were of is the database's to know (0213), which reads the same
 * forms (`reading_decides_embargos`).
 */
export const EMBARGOS_RULE_VERSION = "embargos-v1";

const EMBARGOS_DECISION_FORMS: readonly RegExp[] = [
  /\b(?:acolho|rejeito|desacolho|conheco|nao conheco|deixo de conhecer|deixo de acolher|dou (?:parcial )?provimento|nego provimento|julgo (?:im)?procedentes)(?: em parte| parcialmente)?,? (?:os |aos |dos )?(?:presentes |referidos )?embargos\b/,
  /\bembargos (?:de declaracao|declaratorios)\b[^.;]{0,80}\b(?:acolhidos|rejeitados|conhecidos|providos|improvidos|desprovidos)\b/,
  /\bembargos (?:de declaracao|declaratorios)\b[\s\S]{0,200}(?:\brejeito-os\b|\bacolho-os\b|\bos rejeito\b|\bos acolho\b|\bnego-lhes provimento\b|\bdou-lhes (?:parcial )?provimento\b)/,
];

export function decidesEmbargos(text: string): boolean {
  const words = plainWords(text);
  return EMBARGOS_DECISION_FORMS.some((form) => form.test(words));
}
