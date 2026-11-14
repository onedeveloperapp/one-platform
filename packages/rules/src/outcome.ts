/**
 * What a lawsuit came to, read by rule (phase 6 of the plan of the controladoria and the finance, `resultado-v1`): from
 * the title of a court's movement, whether it says the judgment became final (trânsito em julgado), an appeal, a
 * judicial deposit, a release of money (alvará, a transfer, an RPV, a precatório), a settlement or the definitive
 * archiving; and from the words of a judgment, whether it granted the claim, in part, or denied it, and the value it
 * set (per claimant when it says so). Only what the words say clearly: a provisional archiving or a suspension never
 * ends a lawsuit, an order to pay costs is never a release, and a value is read only beside the condemnation. Pure.
 */

export const OUTCOME_RULE = "resultado-v1";

/** Where a judgment's operative part begins: the last of these marks ("Ante o exposto", "Isto posto" and their kin). */

export const OPERATIVE_MARK =
  /(?:ante|diante|em face|face|pelo|por|ao teor|na confluencia)(?: de)?(?: todo)?(?: d?o| ao)? exposto|isto posto|isso posto|posto isso/g;

const ACCENTS: Record<string, string> = {
  acute: "\u0301",
  grave: "\u0300",
  circ: "\u0302",
  tilde: "\u0303",
  uml: "\u0308",
  cedil: "\u0327",
  ring: "\u030a",
};
const NAMED: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  ordm: "º",
  ordf: "ª",
  sect: "§",
  deg: "°",
  ndash: "-",
  mdash: "-",
  ldquo: '"',
  rdquo: '"',
  lsquo: "'",
  rsquo: "'",
  hellip: "...",
  bull: "·",
  rarr: "->",
  euro: "€",
  sup1: "¹",
  sup2: "²",
  sup3: "³",
  laquo: "«",
  raquo: "»",
  shy: "",
};

/**
 * A court's text with its HTML entities decoded and each letter joined to its accent: the DJEN hands every text
 * escaped ("ju&iacute;za", "&nbsp;", "a&#771;"), which no rule read (a hand check of 60 real judgments, 2026-11-14,
 * found the judge, the clauses and the reasons of extinction lost to it). Decoding a decoded text changes nothing.
 */
export function decodeEntities(text: string): string {
  return String(text ?? "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code = /^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code === 8239 || code === 160 ? 32 : code)
          : whole;
      }
      if (Object.hasOwn(NAMED, name)) return NAMED[name];
      const accent = /^([a-z])(acute|grave|circ|tilde|uml|cedil|ring)$/i.exec(name);
      return accent ? accent[1] + ACCENTS[accent[2].toLowerCase()] : whole;
    })
    .normalize("NFC");
}

export type FactKind =
  | "sentenca"
  | "acordao"
  | "acordo"
  | "transito"
  | "recurso"
  | "deposito"
  | "alvara"
  | "arquivamento";
export type JudgmentResult = "procedente" | "parcial" | "improcedente";
export type ReleaseKind = "alvara" | "transferencia" | "rpv" | "precatorio";

export type MovementFact =
  | { kind: "transito" }
  | { kind: "arquivamento" }
  | { kind: "deposito" }
  | { kind: "alvara"; release: ReleaseKind }
  | { kind: "recurso"; by: "autor" | "re" | null }
  | { kind: "acordo" }
  | { kind: "sentenca"; result: JudgmentResult };

/** A text as the rule compares it: no accent, lower case, single spaces. */
const plain = (text: string) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * The fact a movement's title (and detail) says, or null. A provisional archiving, a suspension, a sending to another
 * court and a lawsuit sent back are no end; an order to pay costs or a deposit of costs is no release.
 */
export function movementFact(title: string, detail: string | null = null): MovementFact | null {
  const words = plain(`${title} ${detail ?? ""}`);
  if (!words) return null;
  if (/transit\w* em julgado/.test(words)) return { kind: "transito" };
  if (/arquiv\w*/.test(words)) {
    if (/provisori|sobrestad|suspens|temporari/.test(words)) return null;
    if (/definitiv|baixa|arquivad[oa]s? os autos|arquivamento/.test(words)) return { kind: "arquivamento" };
    return null;
  }
  if (/custas|preparo|honorarios periciais/.test(words) && !/alvara/.test(words)) return null;
  if (/precatorio/.test(words) && /expedi|requisi/.test(words)) return { kind: "alvara", release: "precatorio" };
  if (/\brpv\b|requisicao de pequeno valor/.test(words) && /expedi|pag|requisi/.test(words)) {
    return { kind: "alvara", release: "rpv" };
  }
  if (/alvara/.test(words) && /expedi|levantamento|liberad/.test(words)) return { kind: "alvara", release: "alvara" };
  if (/transferencia eletronica|ted judicial/.test(words) && /expedi|deferid|realizad/.test(words)) {
    return { kind: "alvara", release: "transferencia" };
  }
  if (/deposito judicial|comprovante de deposito|deposito do valor|guia de deposito/.test(words)) {
    return { kind: "deposito" };
  }
  if (/acordo/.test(words) && /homolog/.test(words)) return { kind: "acordo" };
  if (/recurso inominado|apelacao|recurso de apelacao|interp\w* recurso|recurso interposto/.test(words)) {
    const by = /\b(da|pela) (parte )?re\b|\bdo reu\b|\bda requerida\b|\bda demandada\b/.test(words)
      ? "re"
      : /\b(da|pela) parte autora\b|\bdo autor\b|\bda autora\b|\bdo requerente\b/.test(words)
        ? "autor"
        : null;
    return { kind: "recurso", by };
  }
  if (/procedente/.test(words) || /improcedente/.test(words)) {
    const result = judgmentResultOf(words);
    return result ? { kind: "sentenca", result } : null;
  }
  return null;
}

/**
 * Whether a publication's words certify that the judgment became final: the court's certificate, published apart from
 * the judgment and triaged as anything but the judgment ("Certifico que a sentença transitou em julgado em ..."). A
 * certification or the past tense only: never the order of what follows it ("após o trânsito em julgado, arquivem-se"),
 * which every judgment writes, nor a denial ("ainda não transitou em julgado").
 */
export function certifiesFinal(text: string): boolean {
  const words = plain(text);
  if (!words) return false;
  if (/\bnao(?: \w+){0,3} transit(?:ou|ad[oa]s?)\b/.test(words)) return false;
  return (
    /certific\w*[^.;]{0,240}transit(?:ou|ad[oa]s?) em julgado/.test(words) ||
    /certidao de transito em julgado/.test(words) ||
    /\btransitou em julgado\b/.test(words) ||
    /\btransitad[oa]s? em julgado (?:em|no dia|desde) \d/.test(words)
  );
}

/** The result a judgment's words say: denied, granted in part, or granted. */
function judgmentResultOf(words: string): JudgmentResult | null {
  if (/\bimprocedent/.test(words)) return "improcedente";
  if (
    /parcia(?:l)?mente procedente|procedentes?,? em parte|procedentes? parcia(?:l)?mente|parcial procedencia/.test(
      words,
    )
  )
    return "parcial";
  if (/\bprocedent/.test(words)) return "procedente";
  return null;
}

export type JudgmentReading = {
  result: JudgmentResult | "acordo";
  /** The value set, in cents, when the words set one beside the condemnation (or the settlement). */
  cents: number | null;
  /** The value is each claimant's ("por autor", "para cada autor"). */
  perClaimant: boolean;
  /** The words of the court the reading comes from, at most 400 characters. */
  words: string;
  /** What the operative part decided of each claim it names (`pedidos-v1`); none for a settlement. */
  claims: ClaimReading[];
};

/**
 * The result of each claim of a lawsuit (`pedidos-v1`): what the operative part of a judgment decided of each request
 * of the petition it names (moral damages, material damages, lost profits, the refund of the ticket), granted with
 * the value set beside it or denied. Only what a clause of the operative part says: a claim it does not name is not
 * read, and a clause that names a claim with no decision in it decides nothing.
 */
export const CLAIMS_RULE = "pedidos-v1";

export type ClaimKind = "danos_morais" | "danos_materiais" | "lucros_cessantes" | "restituicao";
export const CLAIM_KINDS: readonly ClaimKind[] = ["danos_morais", "danos_materiais", "lucros_cessantes", "restituicao"];

export type ClaimReading = {
  claim: ClaimKind;
  result: "concedido" | "negado";
  /** The value set beside a claim granted, in cents. */
  cents: number | null;
  /** The value is each claimant's. */
  perClaimant: boolean;
};

/** Where a text names each claim, on the folded text. A "danos morais e materiais" names both. */
const CLAIM_MENTIONS: readonly (readonly [ClaimKind, RegExp])[] = [
  [
    "danos_morais",
    /\bdanos? mora(?:is|l)\b|\bdanos? extrapatrimonia(?:is|l)\b|\bdanos? imateria(?:is|l)\b|\b(?:reparacao|compensacao|indenizacao) mora(?:is|l)\b|\bdanos? materia(?:is|l) e mora(?:is|l)\b/g,
  ],
  [
    "danos_materiais",
    /\bdanos? materia(?:is|l)\b|\b(?:reparacao|indenizacao) materia(?:is|l)\b|\bdanos? emergentes?\b|\bdanos? mora(?:is|l) e materia(?:is|l)\b/g,
  ],
  ["lucros_cessantes", /\blucros? cessantes?\b/g],
  [
    "restituicao",
    /\brestitu\w*|\breembols\w*|\bdevolucao d[oa]s? (?:valor|valores|quantia|passage\w*|bilhete\w*)|\bdevolver\b/g,
  ],
];

/** A decision in a clause: denied first, so "deixo de condenar" is never read as a condemnation. */
const DECISION =
  /\b(deixo de conden\w*|nao conden\w*|improcedente\w*|rejeit\w*|indefir\w*|indefer\w*|nao acolh\w*|afast\w*|nego)\b|\b(conden\w*|procedentes?|pag(?:ar|amento)|acolh\w*|defir\w*|defer\w*)\b/g;

/** What may stand between a claim's name and the value that follows it ("danos morais de R$", ", arbitrados em R$"). */
const VALUE_GAP =
  /^[\s,:]*(?:no valor de|na quantia de|no importe de|no montante de|o valor de|a quantia de|arbitrad\w* em|fixad\w* em|de|em)?[\s,:]*$/;

const PER_CLAIMANT =
  /^[^;.]{0,80}?(?:por|para cada|a cada|de cada)(?: um[a]? d[oa]s)? (?:autor|parte autora|requerente|reclamante|promovente|demandante|passageir)/;

const PER_CLAIMANT_BEFORE =
  /(?:a|para|em favor de) cada (?:um[a]? d[oa]s )?(?:autor|parte autora|requerente|reclamante|promovente|demandante|passageir)[^;]{0,120}$/;

/** A text folded for the rule with its length kept, so a place in it is the same place in the court's words. */
function foldKeepingPlaces(text: string): string {
  return text
    .split("")
    .map((char) => {
      const folded = char.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      return folded.length === 1 ? folded : char.toLowerCase().slice(0, 1) || " ";
    })
    .join("");
}

/** The claims a judgment's operative part decided (`pedidos-v1`): each named claim once, in the order it is named. */
export function readClaims(text: string): ClaimReading[] {
  const raw = decodeEntities(String(text ?? "")).replace(/\s+/g, " ");
  const folded = foldKeepingPlaces(raw);
  const marks = [...folded.matchAll(OPERATIVE_MARK)];
  const from = marks.length ? (marks[marks.length - 1].index ?? 0) : 0;
  const claims = new Map<ClaimKind, ClaimReading>();
  const leads = [...folded.slice(from).matchAll(DECISION)].map((match) => ({
    at: from + (match.index ?? 0),
    granted: match[1] === undefined,
  }));
  // Each clause of the operative part on its own: a sentence, a part after a semicolon, an item of a list.
  const clauseBreak = /[.;](?=\s)|\s[a-z]\)\s|\s[ivx]+\s?[-)]\s/g;
  const cuts = [
    from,
    ...[...folded.slice(from).matchAll(clauseBreak)].map((match) => from + (match.index ?? 0) + 1),
    folded.length,
  ];
  for (let index = 0; index + 1 < cuts.length; index += 1) {
    const start = cuts[index];
    const clause = folded.slice(start, cuts[index + 1]);
    const clauseRaw = raw.slice(start, cuts[index + 1]);
    const mentions = CLAIM_MENTIONS.flatMap(([claim, pattern]) =>
      [...clause.matchAll(pattern)].map((match) => ({
        claim,
        at: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
        word: match[0],
      })),
    ).sort((x, y) => x.at - y.at);
    if (mentions.length === 0) continue;
    const decisions = [...clause.matchAll(DECISION)].map((match) => ({
      at: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      granted: match[1] === undefined,
    }));
    // A value with "R$", or written alone with its words after it ("4.000,00 (quatro mil reais)").
    const values = [
      ...clauseRaw.matchAll(
        /r\$\s*(?:[0-9]{1,3}(?:\.[0-9]{3})*|[0-9]+),[0-9]{2}|(?:[0-9]{1,3}(?:\.[0-9]{3})*|[0-9]+),[0-9]{2}(?=\s*\([^)]{0,80}\breais\))/gi,
      ),
    ].map((match) => ({
      at: match.index ?? 0,
      end: (match.index ?? 0) + match[0].length,
      cents: centsOf(/^r\$/i.test(match[0]) ? match[0] : `R$ ${match[0]}`),
    }));
    const mentionBetween = (low: number, high: number, self: number) =>
      mentions.some((other, place) => place !== self && other.at >= low && other.at < high);
    mentions.forEach((mention, place) => {
      if (claims.has(mention.claim)) return;
      const before = decisions.filter((decision) => decision.end <= mention.at).pop();
      const after = decisions.find((decision) => decision.at >= mention.end);
      const verb = mention.claim === "restituicao" && /^(?:restituir|reembolsar|devolver)$/.test(mention.word);
      const item = /^\s*\(?(?:[a-z](?:\.\d+)?|[ivx]+)\)\s|^\s*[ivx]+\s?-\s/.test(clause);
      const lead = item ? leads.filter((decision) => decision.at < start).pop() : undefined;
      const granted = before ? before.granted : after ? after.granted : verb ? true : lead ? lead.granted : null;
      if (granted === null) return;
      let cents: number | null = null;
      let valueEnd = -1;
      let perHint = false;
      let valueStart = -1;
      if (granted) {
        const next = values.find((value) => value.at >= mention.end);
        const prev = [...values].reverse().find((value) => value.end <= mention.at);
        const nextFits = (most: number) =>
          next && next.at - mention.end <= most && !mentionBetween(mention.end, next.at, place) ? next : null;
        const prevFits =
          prev && mention.at - prev.end <= 200 && !mentionBetween(prev.end, mention.at, place) ? prev : null;
        const chosen =
          mention.claim === "restituicao"
            ? (nextFits(120) ?? prevFits)
            : next && VALUE_GAP.test(clause.slice(mention.end, next.at)) && !mentionBetween(mention.end, next.at, place)
              ? next
              : (prevFits ?? nextFits(160));
        let picked = chosen;
        if (chosen) {
          const earlier = [...values].reverse().find((value) => value.end <= chosen.at);
          if (
            earlier &&
            /^[^;.]{0,40}?(?:para cada|por|a cada|de cada)[^;.]{0,40}?(?:totaliz|perfaz|no total|ao todo)/.test(
              clause.slice(earlier.end, chosen.at),
            )
          ) {
            picked = earlier;
            perHint = true;
          }
        }
        if (picked) {
          cents = picked.cents;
          valueEnd = picked.end;
          valueStart = picked.at;
        }
      }
      claims.set(mention.claim, {
        claim: mention.claim,
        result: granted ? "concedido" : "negado",
        cents,
        perClaimant:
          cents !== null &&
          (perHint ||
            PER_CLAIMANT.test(clause.slice(valueEnd)) ||
            PER_CLAIMANT_BEFORE.test(clause.slice(Math.max(0, valueStart - 160), valueStart))),
      });
    });
  }
  return [...claims.values()];
}

/** A value written "R$ 5.000,00" as cents. */
function centsOf(text: string): number | null {
  const match = /r\$\s*([0-9]{1,3}(?:\.[0-9]{3})*|[0-9]+),([0-9]{2})/i.exec(text);
  if (!match) return null;
  const cents = Number(match[1].replace(/\./g, "")) * 100 + Number(match[2]);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

/**
 * What a judgment's words say, from its operative part ("Ante o exposto", "Isto posto", "Diante do exposto", or the
 * verb itself): the result, the value beside the condemnation and whether it is each claimant's; a settlement the court
 * approved with its value. Null when the words say nothing clear.
 */
export function readJudgment(text: string): JudgmentReading | null {
  const raw = decodeEntities(String(text ?? "")).replace(/\s+/g, " ");
  const lowered = plain(raw);
  if (!lowered) return null;
  // The operative part: from the last "ante o exposto" (or its kin), else the whole text.
  const marks = [...lowered.matchAll(OPERATIVE_MARK)];
  const from = marks.length ? (marks[marks.length - 1].index ?? 0) : 0;
  const operative = lowered.slice(from);
  const operativeRaw = raw.slice(from);
  // A settlement approved, in part or "o livre acordo de vontades", the agreement named in the same sentence.
  // Never a condition ("havendo a homologação de acordo, cancele-se a penhora").
  const approval = /homolog\w*(?: parcialmente)?[^.;]{0,80}?\bacordo\b/.exec(operative);
  if (
    approval &&
    !/(?:havendo|em caso de|se houver|caso haja|apos)(?: a)?\s*$/.test(
      operative.slice(Math.max(0, approval.index - 24), approval.index),
    )
  ) {
    const cents = centsOf(operativeRaw);
    return { result: "acordo", cents, perClaimant: false, words: operativeRaw.slice(0, 400).trim(), claims: [] };
  }
  // The judge's verb, or a lay judge's project ("sugiro julgar procedentes", "opino em julgar", "hei por bem julgá-los").
  const verb =
    /(?:julgo|(?:sugiro|opino|proponho|hei por bem)[^.;]{0,80}?julga(?:r|-l[oa]s?)) (?:totalmente |parcialmente |parciamente )?(im)?procedentes?(?:,? em parte|,? parcialmente)?|julgo procedente em parte|(?:sugiro|opino|proponho)[^.;]{0,20}?(?:pela|a|por) (?:parcial |total )?(?:im)?procedencia/.exec(
      operative,
    );
  // A ruling on the airline's challenge to the amount or on embargos is no judgment of the claim.
  if (
    verb &&
    /^ (?:[ao]s? )?(?:impugnacao|embargos|excecao de pre-?executividade)/.test(
      operative.slice((verb.index ?? 0) + verb[0].length),
    )
  )
    return null;
  const impliedWin =
    !verb &&
    /(?:extingo|julgo extint\w*) (?:o processo|o feito) com resolucao do merito/.test(operative) &&
    /\bconden(?:o|ar)\b/.test(operative) &&
    !/\b92[45]\b|execuc|cumprimento de sentenca/.test(operative);
  if (!verb && !impliedWin) return null;
  const result = verb ? judgmentResultOf(verb[0]) : "procedente";
  if (!result) return null;
  let cents: number | null = null;
  let perClaimant = false;
  if (result !== "improcedente") {
    const condemnation = operative.search(/conden(o|ar)/);
    if (condemnation >= 0) {
      const after = operativeRaw.slice(condemnation, condemnation + 400);
      cents = centsOf(after);
      perClaimant =
        cents !== null &&
        (/(por|para cada|a cada|de cada)( um[a]? d[oa]s)? (autor|parte autora|requerente|reclamante|promovente)/i.test(
          plain(after),
        ) ||
          /^r\$\s*[\d.,]+\s*(\([^)]*\))?,? totaliz/.test(plain(after.slice(after.search(/R\$/i)))));
    }
  }
  const start = Math.max((verb?.index ?? 0) - 40, 0);
  return { result, cents, perClaimant, words: operativeRaw.slice(start, start + 400).trim(), claims: readClaims(raw) };
}

/**
 * The value of a release a court ordered ("Expeça-se alvará ... no valor de R$ 5.000,00"), in cents, with its kind; null
 * when the words order no release (an order to pay costs never is one) or say no value.
 */
export function readRelease(text: string): { release: ReleaseKind; cents: number } | null {
  const raw = decodeEntities(String(text ?? "")).replace(/\s+/g, " ");
  const lowered = plain(raw);
  if (/custas|preparo/.test(lowered) && !/alvara|levantamento/.test(lowered)) return null;
  const release: ReleaseKind | null = /precatorio/.test(lowered)
    ? "precatorio"
    : /\brpv\b|requisicao de pequeno valor/.test(lowered)
      ? "rpv"
      : /alvara|levantamento/.test(lowered)
        ? "alvara"
        : /transferencia eletronica/.test(lowered)
          ? "transferencia"
          : null;
  if (!release) return null;
  const order = lowered.search(/expeca|expeca-se|expedi|defiro o levantamento|libere-se|transfira-se/);
  if (order < 0) return null;
  const cents = centsOf(raw.slice(order, order + 400));
  return cents ? { release, cents } : null;
}

/** Whether a lawsuit's facts end it: archived definitively. A provisional archiving was never read as one. */
export const endsLawsuit = (facts: readonly { kind: FactKind }[]): boolean =>
  facts.some((fact) => fact.kind === "arquivamento");

/** Whether a result is against the client: the claim denied. */
export const againstClient = (result: JudgmentResult | "acordo" | null): boolean => result === "improcedente";

/**
 * The acórdão of an appeal (`acordao-v1`, migration 0225): whether a court's document is one, by its type or by the
 * words a panel judges with ("acórdão", "acordam os juízes", "vistos, relatados e discutidos"), never a judgment that
 * only names one; and what it decided of the appeal it judged: granted, in part, denied, or not heard. Only what the
 * words say clearly: an acórdão that grants one appeal and denies another says nothing a rule can tell, and is read by
 * a person. Pure.
 */
export const ACORDAO_RULE = "acordao-v1";

export type AcordaoResult = "provido" | "parcial" | "desprovido" | "nao_conhecido";

export function isAcordao(documentType: string | null | undefined, text: string): boolean {
  if (/ac[oó]rd[aã]o/i.test(String(documentType ?? ""))) return true;
  const words = plain(text);
  return (
    /^\W*acordao\b/.test(words) ||
    /\bacordam (os|as) (juizes|juizas|desembargador|membros|integrantes)/.test(words) ||
    /vistos,? relatados e discutidos/.test(words)
  );
}

export function readAcordao(text: string): { result: AcordaoResult; words: string } | null {
  const words = plain(text);
  if (!words) return null;
  const found: { result: AcordaoResult; at: number }[] = [];
  const look = (result: AcordaoResult, pattern: RegExp) => {
    const match = pattern.exec(words);
    if (match) found.push({ result, at: match.index });
  };
  look(
    "parcial",
    /\b(dar|deram|da|dou|dando|dado)(-lhe| lhe)? parcial provimento|provimento parcial|parcialmente provido/,
  );
  look(
    "desprovido",
    /\b(negar|negaram|nega|nego|negando|negado)(-lhe| lhe)? provimento|\b(desprovido|improvido|nao provido)\b/,
  );
  look("nao_conhecido", /\bnao conhec\w*|\bnao (foi|ser) conhecido/);
  const granted = /\b(dar|deram|da|dou|dando|dado)(-lhe| lhe)? provimento|\brecurso (conhecido e )?provido\b/.exec(
    words,
  );
  if (granted && !found.some((item) => item.result === "parcial")) found.push({ result: "provido", at: granted.index });
  // One decision only: an acórdão that names two results (one appeal granted, another denied) is a person's to read.
  const results = [...new Set(found.map((item) => item.result))];
  if (results.length !== 1) return null;
  const at = found[0]!.at;
  return { result: results[0]!, words: words.slice(Math.max(0, at - 160), at + 240).trim() };
}

/**
 * What an acórdão is to the client, by who appealed: the client's appeal granted, or the airline's denied or not
 * heard, is in the client's favour; granted in part, in part; the other way round, against. Null when who appealed is
 * not known (or both did): a person says it.
 */
export function acordaoForClient(result: AcordaoResult, appellant: "autor" | "re" | null): JudgmentResult | null {
  if (appellant === null) return null;
  if (result === "parcial") return "parcial";
  const appealWon = result === "provido";
  if (appellant === "autor") return appealWon ? "procedente" : "improcedente";
  return appealWon ? "improcedente" : "procedente";
}
