/**
 * What a piece cites, read from its text.
 *
 * A petition a model helped to write may name a precedent that does not
 * exist. So every norm and every decision a draft names is read here, given
 * the key it would have in the firm's verified library, and the database
 * refuses to approve a draft while one of them is not there. This file only
 * reads and names: whether a source is verified is the library's to say.
 *
 * The reader fails closed. The forms it reads are the ones lawyers write,
 * listed in the tests as tables: in any case (a heading or an ementa in
 * capitals), in the plural ("Súmulas 37 e 387 do STJ"), with the class of a
 * decision in full ("Recurso Especial nº 1.584.465/MG") or as a legal
 * database prints it ("STJ - REsp: 1584465 MG"). What looks like a citation
 * and is read into no source blocks all the same, as a citation nobody can
 * check as it is written (`citationGap`): an article with no norm beside
 * it, a súmula of nobody, a decree with no year, a numbered norm of a kind
 * this reader has no key for, a decision with its reporter and no number.
 * What a text names with nothing of that shape is not seen: the reader reads
 * forms, never meaning.
 *
 * Pure: no I/O, no clock.
 */

export type SourceKind =
  | "lei"
  | "lei_complementar"
  | "constituicao"
  | "decreto"
  | "resolucao"
  | "sumula"
  | "sumula_vinculante"
  | "tema"
  | "precedente"
  | "processo"
  | "enunciado"
  /** Another numbered norm of the Union or of one of its bodies: a provisional measure, an amendment, an ordinance. */
  | "norma"
  /** An article with no norm beside it: a citation that cannot be checked as written. */
  | "artigo"
  /** What is written as a citation and read into no source: it blocks until it is written in a form that is read, or taken out. */
  | "ilegivel";

/** The kinds a library entry may be: every kind that names a source. */
export const LIBRARY_KINDS = [
  "lei",
  "lei_complementar",
  "constituicao",
  "decreto",
  "resolucao",
  "sumula",
  "sumula_vinculante",
  "tema",
  "precedente",
  "processo",
  "enunciado",
  "norma",
] as const satisfies readonly SourceKind[];

/** What identifies a source: what a lawyer types to add one to the library, and what a citation is read into. */
export type SourceRef = {
  kind: SourceKind;
  /** Who issued it, as an acronym ("STJ", "ANAC", "FONAJE"); empty for a law of the Union. */
  issuer: string;
  /**
   * Its number, canonical: digits for a law, a súmula or a theme, "5910/2006" for a decree, "RESP 1584465" for a
   * decision, "MP 925/2020" for another norm. For what was read into no source, its words.
   */
  number: string;
  /** The article, when the citation is of one: digits, with a letter when the article has one ("26", "1036A"). */
  article: string | null;
};

export type Citation = SourceRef & {
  /** The key the library is searched by. */
  key: string;
  /** The words as written, and where they start. */
  raw: string;
  index: number;
};

/**
 * The key of a source. The database builds the same one from the fields of a
 * library entry (`legal_source_key`, migration 0029), so the two meet without
 * either trusting the other's text.
 */
export function sourceKey(ref: SourceRef): string {
  return `${ref.kind}:${ref.issuer.toUpperCase()}:${ref.number}${ref.article ? `#${ref.article}` : ""}`;
}

const chars = (...codes: number[]): string => codes.map((code) => String.fromCodePoint(code)).join("");
/** The hyphens and dashes a text may carry besides "-": the hyphen, the one that does not break, the en and em dashes, the minus. */
const DASHES = chars(0x2010, 0x2011, 0x2013, 0x2014, 0x2212);
/** Curly and angle quotes. */
const QUOTES = chars(0x201c, 0x201d, 0x2018, 0x2019, 0x00ab, 0x00bb);

const digits = (value: string): string => value.replace(/\D/g, "");
/** The number of a decision, with no zeros before it: "IRDR 0012345" and "IRDR 12345" are one. */
const plainNumber = (value: string): string => digits(value).replace(/^0+(?=\d)/, "");
const unaccent = (value: string): string => value.normalize("NFD").replace(/\p{M}/gu, "");
/** The words of what was read into no source, as its key keeps them. */
const plain = (value: string): string => value.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 100);

/** A year as four digits: "90" is 1990, "15" is 2015. Null when it is not a year. */
function fullYear(value: string | undefined): string | null {
  const year = digits(value ?? "");
  if (year.length === 4) return year;
  if (year.length === 2) return Number(year) >= 30 ? `19${year}` : `20${year}`;
  return null;
}

/** An article's number as the key writes it: "6º" is 6, "1.036-A" is 1036A. */
function articleNumber(value: string): string {
  const letter = /-([A-Za-z])$/.exec(value.trim())?.[1]?.toUpperCase() ?? "";
  return `${Number(digits(value))}${letter}`;
}

// ---------- The norms people name without a number ----------

type Norm = Omit<SourceRef, "article">;
type Named = { pattern: RegExp; ref: Norm; refOf?: (match: RegExpMatchArray) => Norm };

const lei = (number: string): Norm => ({ kind: "lei", issuer: "", number });
const CONSTITUICAO: Norm = { kind: "constituicao", issuer: "", number: "1988" };
const MONTREAL: Norm = { kind: "decreto", issuer: "", number: "5910/2006" };
const VARSOVIA: Norm = { kind: "decreto", issuer: "", number: "20704/1931" };

/**
 * The codes and statutes people name by their name. Each is the law that
 * name stands for, so "art. 14 do CDC" and "art. 14 da Lei 8.078/90" are the
 * same citation. A name is read in any case ("CÓDIGO DE DEFESA DO
 * CONSUMIDOR" in a heading, "código civil" in running text); an acronym only
 * as it is written, in capitals ("cc" and "eca" are other things). A code
 * that was replaced is its own law: "CPC/73" and "Código Civil de 1916" are
 * not the codes in force. "CC" is the Civil Code unless a number follows on
 * the same line: "CC 148.519" is a conflict of competence, a decision.
 */
const NAMED: Named[] = [
  { pattern: /C[óo]digo\s+de\s+(?:Prote[çc][ãa]o\s+e\s+)?Defesa\s+do\s+Consumidor/gi, ref: lei("8078") },
  { pattern: /\bCDC\b/g, ref: lei("8078") },
  { pattern: /C[óo]digo\s+de\s+Processo\s+Civil\s+de\s+1973/gi, ref: lei("5869") },
  { pattern: /\bCPC(?:\s*\/\s*(?:19)?73|\s+de\s+1973)\b/g, ref: lei("5869") },
  { pattern: /C[óo]digo\s+de\s+Processo\s+Civil(?:\s+de\s+2015)?(?!\s+de\s+1973)/gi, ref: lei("13105") },
  { pattern: /\bN?CPC(?:\/(?:20)?15)?\b(?!\s*\/\s*(?:19)?73\b|\s+de\s+1973\b)/g, ref: lei("13105") },
  { pattern: /C[óo]digo\s+Civil\s+de\s+1916/gi, ref: lei("3071") },
  { pattern: /\bCC(?:\s*\/\s*(?:19)?16|\s+de\s+1916)\b/g, ref: lei("3071") },
  { pattern: /C[óo]digo\s+Civil(?:\s+de\s+2002)?(?!\s+de\s+1916)/gi, ref: lei("10406") },
  {
    pattern:
      /\bCC(?:\/(?:20)?02)?\b(?!\s*\/\s*(?:19)?16\b|\s+de\s+1916\b)(?![^\S\n]+(?:[nN][º°o.]{0,2}[^\S\n]*)?\d|\s+(?:[nN][º°o.]{0,2}\s*)?(?:\d{1,3}\.\d{3}|\d{4}))/g,
    ref: lei("10406"),
  },
  { pattern: /C[óo]digo\s+Brasileiro\s+de\s+Aeron[áa]utica/gi, ref: lei("7565") },
  { pattern: /\bCBA\b/g, ref: lei("7565") },
  { pattern: /Lei\s+dos\s+Juizados\s+Especiais(?:\s+C[íi]veis)?/gi, ref: lei("9099") },
  { pattern: /Estatuto\s+da\s+Crian[çc]a\s+e\s+do\s+Adolescente/gi, ref: lei("8069") },
  { pattern: /\bECA\b/g, ref: lei("8069") },
  { pattern: /Estatuto\s+d[ao]\s+(?:Pessoa\s+)?Idos[ao]/gi, ref: lei("10741") },
  { pattern: /Lei\s+Geral\s+de\s+Prote[çc][ãa]o\s+de\s+Dados(?:\s+Pessoais)?/gi, ref: lei("13709") },
  { pattern: /\bLGPD\b/g, ref: lei("13709") },
  // "A Constituição Federal de 1967" is another: read under its year, which no library holds.
  {
    pattern: /Constitui[çc][ãa]o\s+(?:da\s+Rep[úu]blica(?:\s+Federativa\s+do\s+Brasil)?|Federal)(?:\s+de\s+(1[89]\d{2}))?/gi,
    ref: CONSTITUICAO,
    refOf: (match) => (match[1] && match[1] !== "1988" ? { ...CONSTITUICAO, number: match[1] } : CONSTITUICAO),
  },
  { pattern: /Constitui[çc][ãa]o\s+de\s+1988/gi, ref: CONSTITUICAO },
  { pattern: /\bCF(?:\/(?:19)?88)?\b|\bCRFB(?:\/(?:19)?88)?\b/g, ref: CONSTITUICAO },
  // The Constitution by the names people give it. Alone, only with its capital and nothing that makes it another.
  { pattern: /\b(?:Carta\s+Magna|Magna\s+Carta|Lei\s+Maior|Carta\s+da\s+Rep[úu]blica)\b/g, ref: CONSTITUICAO },
  {
    pattern: /\bConstitui[çc][ãa]o(?![\p{L}])(?!\s+(?:Federal|Estadual|d[aeo]s?\s|em\s|[a-zà-ÿ]+(?:ana|esa|ina|ica)\b))/gu,
    ref: CONSTITUICAO,
  },
  // "As Convenções de Varsóvia e Montreal" names both.
  { pattern: /Conven[çc](?:[ãa]o|[õo]es)\s+de\s+(?:Vars[óo]via\s+e\s+(?:de\s+)?)?Montreal/gi, ref: MONTREAL },
  { pattern: /Conven[çc](?:[ãa]o|[õo]es)\s+de\s+(?:Montreal\s+e\s+(?:de\s+)?)?Vars[óo]via/gi, ref: VARSOVIA },
];

// ---------- Who issued it ----------

/** The courts and bodies a citation names, by the words people use for them, and the acronym each is kept under. */
const BODIES: [string, string][] = [
  [String.raw`Supremo\s+Tribunal\s+Federal|Pret[óo]rio\s+Excelso|STF`, "STF"],
  [String.raw`Superior\s+Tribunal\s+de\s+Justi[çc]a|STJ`, "STJ"],
  [String.raw`Tribunal\s+Superior\s+do\s+Trabalho|TST`, "TST"],
  [String.raw`Ag[êe]ncia\s+Nacional\s+de\s+Avia[çc][ãa]o\s+Civil|ANAC`, "ANAC"],
  [String.raw`Conselho\s+Nacional\s+de\s+Justi[çc]a|CNJ`, "CNJ"],
  [String.raw`F[óo]rum\s+Nacional\s+d[eo]s?\s+Juizados\s+Especiais|FONAJE`, "FONAJE"],
  [String.raw`Turma\s+Nacional\s+de\s+Uniformiza[çc][ãa]o|TNU`, "TNU"],
  [String.raw`Conselho\s+da\s+Justi[çc]a\s+Federal|CJF`, "CJF"],
  [String.raw`TJDFT`, "TJDFT"],
  [String.raw`TJ[-/]?[A-Z]{2}`, ""],
  // A federal court of a region is of its region: "TRF-4", "TRF da 4ª Região", "Tribunal Regional Federal da 4ª Região".
  [
    String.raw`(?:Tribunal\s+Regional\s+Federal|TRF)\s+da\s+[1-6][ªa.]{0,2}\s+Regi[ãa]o|TRF[-\s]?[1-6]`,
    "",
  ],
];
const HONORIFIC = String.raw`(?:(?:E|Eg|Egr|Col|C|Exc)\.\s*|Egr[ée]gio\s+|Colendo\s+|Excelso\s+)?`;
const acronymOf = (acronym: string, written: string): string => {
  if (acronym) return acronym;
  const region = /(?:Regional\s+Federal|TRF)\D*([1-6])/i.exec(written);
  return region ? `TRF${region[1]}` : unaccent(written).toUpperCase().replace(/[^A-Z0-9]/g, "");
};

/** An acronym this reader has no name for: capitals and digits, as bodies are written. */
const ACRONYM = /^[A-Z][A-Z0-9]{1,11}$/;
/** Capitals that are no body: the codes, and the words a heading in capitals puts where a body would be. */
const NO_BODY = new Set([
  ...["CDC", "CC", "CPC", "NCPC", "CF", "CRFB", "CBA", "ECA", "LGPD", "RG", "DE", "DA", "DO", "EM", "NO", "NA"],
  // Courts of a region or of a state, which are nobody's without it.
  ...["TRF", "TRT", "TRE", "TJ"],
]);

/**
 * A body this reader knows, named right after a number: "do STJ", "/STJ",
 * "(STF)", ", da Agência Nacional de Aviação Civil", "ambas do STJ", in any
 * case ("DO STJ" in a heading, "do c. STJ", "do Fonaje"). Only what follows
 * at once counts: a court named later in the sentence is another subject.
 */
function bodyAfter(stretch: string): { issuer: string; length: number } {
  for (const [words, acronym] of BODIES) {
    const found = new RegExp(
      String.raw`^\s*(?:[/,(${DASHES}-]\s*)?(?:(?:amb[oa]s|tod[oa]s)\s+)?(?:d[oa]s?\s+)?${HONORIFIC}(${words})(?![\p{L}\p{N}])\)?`,
      "iu",
    ).exec(stretch);
    if (found) return { issuer: acronymOf(acronym, found[1]), length: found[0].length };
  }
  return { issuer: "", length: 0 };
}

/**
 * Who a citation says issued it, read right after its number: a body this
 * reader knows, or any other written as bodies are, in capitals after "do"
 * or "da" in small letters ("Súmula 45 do TRU", "Resolução nº 632 da
 * ANATEL"). In a heading all in capitals a word and an acronym cannot be
 * told apart, so only the bodies this reader knows are read there.
 */
function issuerAfter(stretch: string): { issuer: string; length: number } {
  const known = bodyAfter(stretch);
  if (known.issuer) return known;
  const other = /^\s*(?:(?:ambos|ambas|todos|todas)\s+)?d[oa]s?\s+([A-Z][A-Z0-9]{1,11})(?![\p{L}\p{N}])/u.exec(stretch);
  if (other && !NO_BODY.has(other[1])) return { issuer: other[1], length: other[0].length };
  return { issuer: "", length: 0 };
}

/** A body this reader knows, named right before a decision: "(STJ, HC 123.456/SP", "TJGO - IRDR 5". */
const BODY_BEFORE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(${BODIES.map(([words]) => words).join("|")})\s*[,:;(${DASHES}-]?\s*$`,
  "iu",
);
function bodyBefore(stretch: string): string {
  const found = BODY_BEFORE.exec(stretch);
  if (!found) return "";
  for (const [words, acronym] of BODIES) {
    if (new RegExp(`^(?:${words})$`, "iu").test(found[1])) return acronymOf(acronym, found[1]);
  }
  return "";
}

// ---------- The norms and decisions people name by number ----------

/**
 * The classes of a decision of a higher court, as their acronyms are
 * written: as lawyers write them ("REsp"), in capitals ("RESP", which is how
 * the key keeps them) and with one capital ("Resp"); never in small letters,
 * where "re", "ai" or "ms" are parts of other things. "Ag" is read only as
 * what an appeal was taken in ("AgRg no Ag"), never alone.
 */
const CLASS_NAMES = [
  "AgInt",
  "AgRg",
  "EAREsp",
  "AREsp",
  "EREsp",
  "EDcl",
  "REsp",
  "RMS",
  "RHC",
  "ARE",
  "ADPF",
  "ADI",
  "ADC",
  "IRDR",
  "IAC",
  "PUIL",
  "Rcl",
  "RE",
  "HC",
  "MS",
  "AI",
  "CC",
  "Ag",
];
const CLASS = CLASS_NAMES.flatMap((name) =>
  name === name.toUpperCase() ? [name] : [name, name.toUpperCase(), name[0] + name.slice(1).toLowerCase()],
)
  .filter((name, at, all) => all.indexOf(name) === at)
  .join("|");
/**
 * The classes more than one court has: a decision of one is of its court,
 * so "HC 123.456" of the STF and of the STJ, or the fifth IRDR of two
 * courts, are never one source. The others are of one court by their name.
 */
export const SHARED_CLASSES: readonly string[] = [
  "HC",
  "MS",
  "RHC",
  "RMS",
  "RCL",
  "AI",
  "CC",
  "IRDR",
  "IAC",
  "PUIL",
  "AG",
  "AGINT",
  "AGRG",
  "EDCL",
];
/** The classes written in full, the longest first, and the acronym each is kept under. */
const SPELLED: [RegExp, string][] = [
  [/^Embargos\s+de\s+Diverg[êe]ncia\s+em\s+Agravo\s+em\s+Recurso\s+Especial/i, "EARESP"],
  [/^Embargos\s+de\s+Diverg[êe]ncia\s+em\s+Recurso\s+Especial/i, "ERESP"],
  [/^Agravo\s+em\s+Recurso\s+Especial/i, "ARESP"],
  [/^Recurso\s+Extraordin[áa]rio\s+com\s+Agravo/i, "ARE"],
  [/^Recurso\s+Especial/i, "RESP"],
  [/^Recurso\s+Extraordin[áa]rio/i, "RE"],
  [/^Conflito\s+de\s+Compet[êe]ncia/i, "CC"],
];
const SPELLED_ANY = [
  String.raw`Embargos\s+de\s+Diverg[êe]ncia\s+em\s+(?:Agravo\s+em\s+)?Recurso\s+Especial`,
  String.raw`Agravo\s+em\s+Recurso\s+Especial`,
  String.raw`Recurso\s+Extraordin[áa]rio(?:\s+com\s+Agravo)?`,
  String.raw`Recurso\s+Especial`,
  String.raw`Conflito\s+de\s+Compet[êe]ncia`,
].join("|");

const NUMBER = String.raw`\d{1,3}(?:\.\d{3})+|\d{1,9}`;
/** "nº", "n.", "Nº", "N.", "de nº". */
const ORDINAL = String.raw`(?:(?:de\s+)?[nN][º°o.]{0,2}\s*)?`;
/**
 * The year of a norm: "/2006", ", de 27 de setembro de 2006", " de 2006",
 * ", de 27.9.2006", ", de 27/09/2006". The comma is looked for once, so a
 * run of white space is walked once.
 */
const YEAR = String.raw`(?:\s*/\s*(\d{2,4})\b|(?:\s*,)?\s+de\s+(?:(?:\d{1,2}[º°]?\s+de\s+[a-zç]+\s+de\s+)?(\d{4})|\d{1,2}[./]\d{1,2}[./](\d{4}|\d{2}))\b)?`;
/** A chain of appeals has an end: "EDcl nos EDcl no AgInt nos EDcl no AREsp" is four. */
const CHAIN = String.raw`(?:(?:${CLASS})\s+n[oa]s?\s+){0,6}`;
const WORD_START = String.raw`(?<![\p{L}\p{N}])`;
/**
 * Between a class and its number: white space of one line, or a line break
 * when what follows is a number no heading has ("REsp" and "1.584.465"
 * broken at the margin; "do CC." and "2. Do dano" are the Civil Code and a
 * heading).
 */
const SAME_LINE = String.raw`(?:[^\S\n]+|\s+(?=(?:[nN][º°o.]{0,2}\s*)?(?:\d{1,3}\.\d{3}|\d{4})))`;
/** The number of a decision ends where it ends: never the head of a longer number or of a case number of a court. */
const NUMBER_END = String.raw`(?!\d|[-.${DASHES}]\d{2}\.\d{4}\.\d|-\d{3}\b)`;
/** A word that may be who issued it, named before the number: never "de" nor "nº". */
const BEFORE = String.raw`(?:(?:d[ao]\s+)?(?!(?:de|d[ao]s?|n[oº°.]?|nº|n\.º)\s)([\p{L}][\p{L}\p{N}/-]{1,11})\s+)?`;

/** A norm or a decision named in the text. `norm` says an article may be of it. */
type Mention = { ref: Norm; index: number; end: number; raw: string; norm: boolean };

function numberedMentions(text: string): Mention[] {
  const found: Mention[] = [];
  const push = (index: number, end: number, ref: Norm, norm: boolean) =>
    found.push({ ref, index, end, raw: text.slice(index, end), norm });
  /** `tail` is how much of what follows the match is still the citation: the body that issued it. */
  const add = (match: RegExpMatchArray, ref: Norm, norm: boolean, tail = 0) => {
    const index = match.index ?? 0;
    push(index, index + match[0].length + tail, ref, norm);
  };
  const endOf = (match: RegExpMatchArray) => (match.index ?? 0) + match[0].length;
  const after = (position: number) => text.slice(position, position + 90);
  /**
   * Who issued it: the body named right before the number, or the one named
   * right after it. `null` when the word before the number is no body and no
   * acronym: an ordinary word ("resolução em 30 dias", "publicação da súmula
   * em 10/02/2020"), and the match is no citation.
   */
  const issued = (head: string, named: string | undefined, position: number): { issuer: string; length: number } | null => {
    if (named) {
      const before = bodyAfter(named);
      if (before.issuer && before.length === named.length) return { issuer: before.issuer, length: 0 };
      if (named !== named.toUpperCase()) return null;
      // An acronym beside a head that is not in capitals: "Súmula TRU 5", "Resolução CONTRAN nº 400".
      if (ACRONYM.test(named) && !NO_BODY.has(named) && head !== head.toUpperCase()) return { issuer: named, length: 0 };
    }
    return issuerAfter(after(position));
  };
  /**
   * The other numbers of a list: "Súmulas 37, 54 e 387", "Leis nº 8.078/1990
   * e nº 9.099/1995". Each with its year, when it has one.
   */
  const more = (listed: boolean, position: number): { items: { number: string; year: string | null }[]; length: number } => {
    const items: { number: string; year: string | null }[] = [];
    if (!listed) return { items, length: 0 };
    const next = new RegExp(String.raw`\s*(?:,|\be)\s*${ORDINAL}(${NUMBER})(?!\d)${YEAR}`, "iy");
    let at = position;
    for (;;) {
      next.lastIndex = at;
      const match = next.exec(text);
      if (!match) break;
      items.push({ number: digits(match[1]), year: fullYear(match[2] ?? match[3] ?? match[4]) });
      at = next.lastIndex;
    }
    return { items, length: at - position };
  };
  const plural = (word: string) => /(?:s|es|ões)$/i.test(word) && !/^res\.$/i.test(word);
  /**
   * A list under a head in the singular ("Súmula 54 e 362 do STJ") is one
   * only when the body that issued them follows it: "Súmula 7 e 5 anos" is
   * one súmula.
   */
  const list = (head: string, position: number) => {
    if (plural(head)) return more(true, position);
    const loose = more(true, position);
    return loose.items.length > 0 && issuerAfter(after(position + loose.length)).issuer ? loose : more(false, position);
  };

  // Lei [Complementar] [Federal] nº 8.078[/1990]: laws are numbered in one sequence, so the number alone names one.
  // Not the "Lei" of "Decreto-Lei". A law of a state or of a city is of who issued it, and this reader has no
  // key for one: it is read, and blocks.
  for (const match of text.matchAll(
    new RegExp(
      String.raw`${WORD_START}(?<!Decreto[-\s])(Leis?)(\s+Complementar(?:es)?)?(?:\s+(?:Federal|Federais|Ordin[áa]rias?)|\s+(Estadual|Estaduais|Municipal|Municipais|Distrital|Distritais))?\s+${ORDINAL}(${NUMBER})(?!\d)${YEAR}`,
      "giu",
    ),
  )) {
    const rest = more(plural(match[1]), endOf(match));
    const index = match.index ?? 0;
    const end = endOf(match) + rest.length;
    if (match[3]) {
      push(index, end, { kind: "ilegivel", issuer: "", number: plain(text.slice(index, end)) }, true);
      continue;
    }
    const kind = match[2] ? "lei_complementar" : "lei";
    for (const number of [digits(match[4]), ...rest.items.map((item) => item.number)])
      push(index, end, { kind, issuer: "", number }, true);
  }
  // LC 123/2006.
  for (const match of text.matchAll(new RegExp(String.raw`\bLC\s+${ORDINAL}(${NUMBER})(?!\d)${YEAR}`, "g"))) {
    add(match, { kind: "lei_complementar", issuer: "", number: digits(match[1]) }, true);
  }
  // Decreto nº 5.910/2006: the numbering of decrees started again more than once, so the year is part of the number.
  for (const match of text.matchAll(
    new RegExp(
      String.raw`${WORD_START}(Decretos?)(?:[-\s]Lei)?(?:\s+(?:Federal|Presidencial))?\s+${ORDINAL}(${NUMBER})(?!\d)${YEAR}`,
      "giu",
    ),
  )) {
    const rest = more(plural(match[1]), endOf(match));
    const index = match.index ?? 0;
    const end = endOf(match) + rest.length;
    for (const item of [{ number: digits(match[2]), year: fullYear(match[3] ?? match[4] ?? match[5]) }, ...rest.items])
      push(index, end, { kind: "decreto", issuer: "", number: item.year ? `${item.number}/${item.year}` : item.number }, true);
  }
  // The other norms of the Union this reader has a key for, each under the acronym of what it is and its year.
  const other = (slug: string, match: RegExpMatchArray, number: string, year: string | null, issuer = "", tail = 0) =>
    add(match, { kind: "norma", issuer, number: `${slug} ${digits(number)}${year ? `/${year}` : ""}` }, true, tail);
  // Medida Provisória nº 925/2020, MP 925/2020 (the acronym only with "nº" or a year: "o MP" is also a body).
  for (const match of text.matchAll(
    new RegExp(String.raw`${WORD_START}Medidas?\s+Provis[óo]rias?\s+${ORDINAL}(${NUMBER})(?!\d)${YEAR}`, "giu"),
  )) {
    other("MP", match, match[1], fullYear(match[2] ?? match[3] ?? match[4]));
  }
  for (const match of text.matchAll(
    new RegExp(String.raw`${WORD_START}MP\s+(?:[nN][º°o.]{1,2}\s*(${NUMBER})(?!\d)${YEAR}|(${NUMBER})\s*/\s*(\d{2,4})\b)`, "gu"),
  )) {
    other("MP", match, match[1] ?? match[5], fullYear(match[2] ?? match[3] ?? match[4] ?? match[6]));
  }
  // Emenda Constitucional nº 45/2004, EC 45/2004: numbered in one sequence, so the number alone names one.
  for (const match of text.matchAll(
    new RegExp(String.raw`${WORD_START}Emendas?\s+Constitucion(?:al|ais)\s+${ORDINAL}(${NUMBER})(?!\d)${YEAR}`, "giu"),
  )) {
    other("EC", match, match[1], null);
  }
  for (const match of text.matchAll(
    new RegExp(String.raw`${WORD_START}EC\s+(?:[nN][º°o.]{1,2}\s*(${NUMBER})(?!\d)${YEAR}|(${NUMBER})\s*/\s*\d{2,4}\b)`, "gu"),
  )) {
    other("EC", match, match[1] ?? match[5], null);
  }
  // Decreto Legislativo nº 59, de 18 de abril de 2006.
  for (const match of text.matchAll(
    new RegExp(String.raw`${WORD_START}Decretos?\s+Legislativos?\s+${ORDINAL}(${NUMBER})(?!\d)${YEAR}`, "giu"),
  )) {
    other("DLG", match, match[1], fullYear(match[2] ?? match[3] ?? match[4]));
  }
  // Regulamento (CE) nº 261/2004, Regulamento (UE) 2016/679: of the European Union, read where a flight left from it.
  for (const match of text.matchAll(
    new RegExp(String.raw`${WORD_START}Regulamento\s+\(?(CE|UE)\)?\s+${ORDINAL}(\d{1,4})\s*/\s*(\d{2,4})\b`, "giu"),
  )) {
    other(`REG${match[1].toUpperCase()}`, match, match[2], fullYear(match[3]));
  }
  // Portaria [ANAC] nº 676/2000 [da ANAC], Instrução Normativa [RFB] nº 1.234/2020 [da RFB]: of the body that issued it.
  for (const [slug, head] of [
    ["PORTARIA", String.raw`Portarias?`],
    ["IN", String.raw`Instru[çc](?:[ãa]o|[õo]es)\s+Normativas?`],
  ] as const) {
    for (const match of text.matchAll(
      new RegExp(String.raw`${WORD_START}(${head})\s+${BEFORE}${ORDINAL}(${NUMBER})(?!\d)${YEAR}`, "giu"),
    )) {
      const by = issued(match[1], match[2], endOf(match));
      if (!by) continue;
      other(slug, match, match[3], fullYear(match[4] ?? match[5] ?? match[6]), by.issuer, by.length);
    }
  }
  // Resolução [ANAC] nº 400[/2016] [da ANAC]: who issued it is named before or after the number.
  for (const match of text.matchAll(
    new RegExp(
      String.raw`${WORD_START}(Resolu[çc](?:[ãa]o|[õo]es)|Res\.)\s+(?:Normativas?\s+)?${BEFORE}${ORDINAL}(${NUMBER})(?!\d)${YEAR}`,
      "giu",
    ),
  )) {
    const rest = more(plural(match[1]), endOf(match));
    const by = issued(match[1], match[2], endOf(match) + rest.length);
    if (!by) continue;
    const index = match.index ?? 0;
    const end = endOf(match) + rest.length + by.length;
    for (const number of [digits(match[3]), ...rest.items.map((item) => item.number)])
      push(index, end, { kind: "resolucao", issuer: by.issuer, number }, true);
  }
  // Súmula [Vinculante] nº 387 [do STJ | /STJ], or Súmula STJ 387, in any case and in the plural.
  for (const match of text.matchAll(
    new RegExp(
      String.raw`${WORD_START}(S[úu]mulas?)(\s+Vinculantes?)?\s+${BEFORE}${ORDINAL}(${NUMBER})(?!\d|\s*[/.]\s*\d{1,2}\s*[/.]\s*\d)`,
      "giu",
    ),
  )) {
    const rest = list(match[1], endOf(match));
    const numbers = [digits(match[4]), ...rest.items.map((item) => item.number)];
    const index = match.index ?? 0;
    if (match[2]) {
      for (const number of numbers)
        push(index, endOf(match) + rest.length, { kind: "sumula_vinculante", issuer: "STF", number }, false);
      continue;
    }
    const by = issued(match[1], match[3], endOf(match) + rest.length);
    if (!by) continue;
    for (const number of numbers)
      push(index, endOf(match) + rest.length + by.length, { kind: "sumula", issuer: by.issuer, number }, false);
  }
  // A súmula as the courts' own style names it: "enunciado n. 7 da Súmula do STJ", "verbete sumular 362 do STJ".
  for (const match of text.matchAll(
    new RegExp(
      String.raw`${WORD_START}(?:verbete|enunciado)\s+sumular\s+${ORDINAL}(${NUMBER})(?!\d)|${WORD_START}(?:verbete|enunciado)\s+${ORDINAL}(${NUMBER})\s+da\s+S[úu]mula(?![\p{L}])`,
      "giu",
    ),
  )) {
    const by = issuerAfter(after(endOf(match)));
    add(match, { kind: "sumula", issuer: by.issuer, number: digits(match[1] ?? match[2]) }, false, by.length);
  }
  // Tema [Repetitivo] nº 1.417 [do STF | /STF | da repercussão geral | dos recursos repetitivos].
  for (const match of text.matchAll(
    new RegExp(
      String.raw`${WORD_START}(Temas?)(\s+Repetitivos?|\s+de\s+Repercuss[ãa]o\s+Geral)?\s+${ORDINAL}(${NUMBER})(?!\d)`,
      "giu",
    ),
  )) {
    const tail = list(match[1], endOf(match));
    const rest = after(endOf(match) + tail.length);
    const said = (match[2] ?? "").toLowerCase();
    // A body it knows first, then what the theme is of, then any other body: "dos recursos repetitivos" is no acronym.
    const known = bodyAfter(rest);
    const system =
      said.includes("repetitiv") ||
      /^\s*[,(]?\s*(?:d[oa]s?\s+|sob\s+o\s+)?(?:(?:rito|sistem[áa]tica)\s+d[oa]s?\s+)?(?:recursos?\s+(?:especiais\s+)?)?repetitiv/i.test(rest)
        ? "STJ"
        : said.includes("repercuss") ||
            /^\s*[,(/-]?\s*(?:d[ae]\s+)?(?:sistem[áa]tica\s+da\s+)?(?:repercuss[ãa]o\s+geral|RG\b)/i.test(rest)
          ? "STF"
          : "";
    const by = known.issuer || system ? known : issuerAfter(rest);
    const index = match.index ?? 0;
    for (const number of [digits(match[3]), ...tail.items.map((item) => item.number)])
      push(index, endOf(match) + tail.length + by.length, { kind: "tema", issuer: by.issuer || system, number }, false);
  }
  // Enunciado nº 161 do FONAJE, Enunciado Cível 161 do FONAJE, Enunciado FONAJE 161.
  for (const match of text.matchAll(
    new RegExp(String.raw`${WORD_START}(Enunciados?)(?:\s+C[íi]ve(?:l|is))?\s+${BEFORE}${ORDINAL}(${NUMBER})(?!\d)`, "giu"),
  )) {
    // The courts' name for a súmula, read above.
    if (/^\s+da\s+S[úu]mula(?![\p{L}])/iu.test(after(endOf(match)))) continue;
    const rest = list(match[1], endOf(match));
    const by = issued(match[1], match[2], endOf(match) + rest.length);
    if (!by) continue;
    const index = match.index ?? 0;
    for (const number of [digits(match[3]), ...rest.items.map((item) => item.number)])
      push(index, endOf(match) + rest.length + by.length, { kind: "enunciado", issuer: by.issuer, number }, false);
  }

  /**
   * A decision by its class and number. Of a class more than one court has,
   * the court is part of what it is: the one named right after it ("HC
   * 123.456/SP, STJ", "IRDR nº 5 do TJGO") or right before ("(STJ, HC
   * 123.456", "STF - HC: 123.456"), or nobody's.
   */
  const decision = (match: RegExpMatchArray, name: string, number: string, courtBefore = "") => {
    const index = match.index ?? 0;
    const end = endOf(match);
    if (!SHARED_CLASSES.includes(name)) {
      push(index, end, { kind: "precedente", issuer: "", number: `${name} ${plainNumber(number)}` }, false);
      return;
    }
    const next = bodyAfter(after(end));
    const issuer = next.issuer || courtBefore || bodyBefore(text.slice(Math.max(0, index - 60), index));
    push(index, end + next.length, { kind: "precedente", issuer, number: `${name} ${plainNumber(number)}` }, false);
  };
  // REsp 1.584.465/MG, AgInt no AREsp 1.234.567, RE 636.331: the class that carries the number is the decision.
  for (const match of text.matchAll(
    new RegExp(
      // A period only after a class that ends in a small letter ("REsp.", "Resp."): "do CC. 2. Do dano" ends a sentence.
      String.raw`${WORD_START}${CHAIN}(${CLASS})(?:(?<=[a-z])\.)?${SAME_LINE}(?:repetitivo\s+)?${ORDINAL}(${NUMBER})${NUMBER_END}(?:\s*/\s*[A-Z]{2}\b)?`,
      "gu",
    ),
  )) {
    // "Ag" alone is not a decision.
    if (/^ag$/i.test(match[1]) && /^ag\b/i.test(match[0])) continue;
    const lead = text.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
    // "MS" after a slash, a hyphen or "OAB" is a state: "OAB/MS 12.345", "Campo Grande/MS".
    if (match[0].startsWith("MS") && /(?:[/-]\s?|\bOAB\s)$/.test(lead)) continue;
    // A flight is named by its airline's code and a number, and some codes are the acronyms of classes: "voo AI 123".
    if (/(?:\bv[oô]os?|\bflight|\bport[ãa]o)\s+(?:[nN][º°o.]{0,2}\s*)?$/i.test(lead)) continue;
    // So is a bank account: "Banco X, Ag 1234-5, CC 12345-6".
    if (/^CC\b/.test(match[0]) && /\b(?:Ag(?:[êe]ncia)?\.?|Banco|conta)\b/i.test(lead)) continue;
    decision(match, match[1].toUpperCase(), match[2]);
  }
  // As a legal database prints a decision: "(STJ - AgInt no AREsp: 1234567 SP 2018/0012345-6, Relator: ...)".
  for (const match of text.matchAll(
    new RegExp(String.raw`\b(STF|STJ)\s+[-${DASHES}]\s+${CHAIN}(${CLASS}):\s*${ORDINAL}(${NUMBER})${NUMBER_END}`, "gu"),
  )) {
    decision(match, match[2].toUpperCase(), match[3], match[1]);
  }
  // The class written in full: "Recurso Especial nº 1.584.465/MG", "RECURSO ESPECIAL Nº 1.584.465 - MG".
  for (const match of text.matchAll(
    new RegExp(
      // With "nº" before it, or a number no count of days has: "interpôs Recurso Especial 3 dias depois" names none.
      String.raw`${WORD_START}(${SPELLED_ANY})(?:\s+Repetitivo)?\s+(?:(?:de\s+)?[nN][º°o.]{0,2}\s*(${NUMBER})|(\d{1,3}(?:\.\d{3})+|\d{4,9}))${NUMBER_END}(?:\s*/\s*[A-Z]{2}\b)?`,
      "giu",
    ),
  )) {
    const name = SPELLED.find(([pattern]) => pattern.test(match[1]))?.[1];
    if (name) decision(match, name, match[2] ?? match[3]);
  }
  // A case number of a court, in the CNJ's format: a decision of a court below. Also with a dot or another dash after the sequence.
  for (const match of text.matchAll(new RegExp(String.raw`\b\d{7}[-.${DASHES}]?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}\b`, "g"))) {
    add(match, { kind: "processo", issuer: "", number: digits(match[0]) }, false);
  }
  return found;
}

function namedMentions(text: string): Mention[] {
  const found: Mention[] = [];
  for (const { pattern, ref, refOf } of NAMED) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      const index = match.index ?? 0;
      found.push({ ref: refOf ? refOf(match) : ref, index, end: index + match[0].length, raw: match[0], norm: true });
    }
  }
  return found;
}

// ---------- Articles ----------

/** "6º", "6°", "6.º", "1.036-A". */
const ONE_ARTICLE = String.raw`\d{1,4}(?:\.\d{3})?(?:-[A-Za-z]\b)?(?:\.?[º°])?`;
/** In any case ("ART. 14" in a heading or an ementa), and after a mark of emphasis ("_art. 14 do CDC_"). */
const ARTICLE = new RegExp(
  String.raw`${WORD_START}art(?:igos?|s)?\.?\s*(${ONE_ARTICLE}(?:\s*(?:,|e|a|ao)\s*${ONE_ARTICLE})*)`,
  "giu",
);

/** The words that may stand between an article and the norm it is of. */
const BETWEEN_WORDS = new Set([
  "e",
  "c/c",
  "caput",
  "ambos",
  "ambas",
  "todos",
  "todas",
  "também",
  "tambem",
  "inciso",
  "incisos",
  "inc",
  "incs",
  "alínea",
  "alíneas",
  "alinea",
  "alineas",
  "único",
  "unico",
  "seguintes",
  "ss",
  "segs",
  "et",
  "seq",
]);
/** What says the number after it is of the article before it, not another article. One, or several. */
const PART_ONE = new Set(["§", "parágrafo", "paragrafo", "par", "p", "item", "n", "nº", "número", "numero"]);
const PART_MANY = new Set(["§§", "parágrafos", "paragrafos", "itens"]);
const NUMBER_TOKEN = /^(\d{1,4}(?:\.\d{3})?(?:-[A-Za-z])?)(?:\.?[º°]|o)?$/;
const GAP_SPLIT = new RegExp(`[\\s()"'${QUOTES}]+`);

/**
 * What stands between an article and a norm: null when it is not only what
 * belongs to articles; otherwise the other articles it names. A number
 * after "§" or "parágrafo" is of the article before it; a number that
 * follows a comma, "e" or "c/c" by itself is one more article ("arts. 6º,
 * VI e VIII, e 14 do CDC": 14). A gap that ends in "e" joins two things, it
 * does not tie the article to the norm.
 */
function readGap(gap: string): string[] | null {
  const tokens = gap
    // "art. 22(2)": a number between parentheses is an item of the article.
    .replace(/\(\s*\d{1,2}\s*\)/g, " ")
    .replace(/§+/g, " $& ")
    .replace(/[,;]/g, " , ")
    .split(GAP_SPLIT)
    .filter(Boolean);
  const words = tokens.filter((token) => token !== ",");
  if (words.length > 0 && ["e", "c/c"].includes(words[words.length - 1].toLowerCase())) return null;
  const articles: string[] = [];
  // 0: no part is being named; 1: one ("§ 1º", and what "e" adds to it); 2: several ("§§ 1º, 2º e 3º").
  let part = 0;
  for (const token of tokens) {
    const word = token.toLowerCase().replace(/\.$/, "");
    if (token === ",") {
      if (part === 1) part = 0;
      continue;
    }
    if (PART_ONE.has(word) || PART_MANY.has(word)) {
      part = PART_MANY.has(word) ? 2 : 1;
      continue;
    }
    const number = NUMBER_TOKEN.exec(token);
    if (number) {
      if (part === 0) articles.push(articleNumber(number[1]));
      continue;
    }
    if (part > 0 && ["e", "a", "ao"].includes(word)) continue;
    part = 0;
    if (BETWEEN_WORDS.has(word) || /^[IVXLCDM]{1,7}$/.test(token) || /^[A-Za-z]$/.test(token)) continue;
    return null;
  }
  return articles;
}

type ArticleMention = { numbers: string[]; index: number; end: number; raw: string; many: boolean; heading: boolean };

const HEADING_START = new RegExp(String.raw`^\.?\s+(?:[-${DASHES}]\s+)?["${QUOTES}]?[A-ZÀ-Ý]`);

function articleMentions(text: string): ArticleMention[] {
  const found: ArticleMention[] = [];
  for (const match of text.matchAll(new RegExp(ARTICLE.source, ARTICLE.flags))) {
    const numbers = [...match[1].matchAll(new RegExp(ONE_ARTICLE, "g"))].map((one) =>
      articleNumber(one[0].replace(/\.?[º°]$/, "")),
    );
    const index = match.index ?? 0;
    const end = index + match[0].length;
    found.push({
      numbers,
      index,
      end,
      raw: match[0],
      many: /^art(?:igo)?s/i.test(match[0]),
      // The article's own words, transcribed: "Art. 14. O fornecedor...", "Art. 6º São direitos...".
      heading: /^Art\./.test(match[0]) && HEADING_START.test(text.slice(end, end + 6)),
    });
  }
  return found;
}

/** How far after an article its norm may be named, and how far before it. */
const REACH_AFTER = 90;
const REACH_BEFORE = 40;
/** How far back an article transcribed under its own citation looks for it. */
const REACH_QUOTE = 400;
/** No mention is longer than this: what bounds a walk back through the mentions. */
const LONGEST_MENTION = 400;

/** The first place of a sorted list whose `index` is not before `position`. */
function firstFrom(mentions: readonly { index: number }[], position: number): number {
  let low = 0;
  let high = mentions.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (mentions[middle].index < position) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The norm named right before an article: "CDC, art. 14", "o CDC prevê em seu art. 14", "Código Civil (arts. 186 e 927)". */
const NORM_BEFORE = new RegExp(
  String.raw`^\)?[\s,(:;${DASHES}-]*(?:(?:disp[õo]e|prev[êe]|estabelece|determina|preceitua|prescreve|assegura|garante|consagra)\s*,?\s*)?(?:conforme\s+|especialmente\s+|notadamente\s+|especificamente\s+|(?:mais\s+)?precisamente\s+)?(?:em\s+|n[oa]s?\s+|os?\s+)?(?:se[ue]s?\s+)?$`,
  "i",
);
/** With no word between them, an article and its norm on one line: "(art. 14, CDC)", "art. 14 CDC". */
const NORM_MARK = new RegExp(String.raw`(?:^|[,(/${DASHES}-])[^\S\n]*$`);
/** What goes on after a norm: "arts. 186 e 927 do CC e 14 do CDC" names an article of the next norm with no "art." before it. */
const NEXT_ARTICLES = String.raw`\s*(?:[,;]\s*(?:e\s+)?|e\s+)(${ONE_ARTICLE}(?:\s*(?:,|e|a|ao)\s*${ONE_ARTICLE})*)`;

// ---------- What looks like a citation and was read into no source ----------

/** The numbered instruments of the law: one of these with a number that no form above read is a citation nobody can check. */
const INSTRUMENT_HEADS = [
  String.raw`Leis?`,
  String.raw`Decretos?(?:[-\s]Lei)?`,
  String.raw`Medidas?\s+Provis[óo]rias?`,
  String.raw`Emendas?\s+Constitucion(?:al|ais)`,
  String.raw`Portarias?`,
  String.raw`Instru[çc](?:[ãa]o|[õo]es)\s+Normativas?`,
  String.raw`Resolu[çc](?:[ãa]o|[õo]es)`,
  String.raw`S[úu]mulas?`,
  String.raw`Enunciados?`,
  String.raw`Temas?`,
  String.raw`Provimentos?`,
  String.raw`Regulamentos?`,
  String.raw`Delibera[çc](?:[ãa]o|[õo]es)`,
  String.raw`Circular(?:es)?`,
  String.raw`Informativos?`,
  String.raw`Orienta[çc](?:[ãa]o|[õo]es)\s+Jurisprudencia(?:l|is)`,
].join("|");
const INSTRUMENT = new RegExp(
  String.raw`${WORD_START}(${INSTRUMENT_HEADS})((?:\s+(?!(?:[nN][º°o]\.?|[nN]\.)\s*\d)\(?[\p{L}][\p{L}\p{N}./-]{0,20}\)?){0,4})\s+((?:[nN][º°o]\.?|[nN]\.)\s*)?\d[\d.]*(?!\d)(?!\s*[/.]\s*\d{1,2}\s*[/.]\s*\d)(?:\s*/\s*[\p{L}\p{N}-]{1,8})?`,
  "giu",
);
const SMALL_WORDS = new Set(["de", "do", "da", "dos", "das", "e"]);
/** The words that are no name, also in a heading in capitals: "SÚMULA EM 10/02/2020" is a day, not a súmula. */
const NO_NAME = new Set(["em", "no", "na", "nos", "nas", "a", "o", "as", "os", "ao", "para", "por", "com", "sem", "que", "se"]);
/**
 * What a court or a legal database prints beside a decision. Who reported
 * it and where it was published are said of decisions only; the day it was
 * judged is also how a text tells any day ("o pedido foi julgado em
 * 10/02/2020"), so it counts only with a court named in the same stretch.
 */
const REPORTER = new RegExp(
  String.raw`(Rel\.\s*(?:Min|Des|Ju[ií]z|p\/)|Rel\.?\s*\(a\)|Relator(?:a)?(?:\s*\(a\))?\s*:|Data\s+d[eo]\s+Julgamento|\bDJe?[\s,:]+(?:de\s+)?\d|[ÓO]rg[ãa]o\s+Julgador|Data\s+d[ae]\s+Publica[çc][ãa]o)|julgad[oa]\s+em\s+\d{1,2}(?:[./]\d|\s+de\s+[a-zç]+\s+de\s+\d{4})|julgamento\s+em\s+\d{1,2}[./]\d|\bj\.\s*(?:em\s+)?\d{1,2}[./]\d`,
  "giu",
);
const COURT_WORD = /TJ[-/]?[A-Z]{2}|TJDFT|TRF|TRT|STJ|STF|TST|TNU|Tribunal|Turma|C[âa]mara/u;
/** An appeal of a court below named by its class and a number that is not the case number of the CNJ. */
const APPEAL = new RegExp(
  String.raw`${WORD_START}(?:Apela[çc][ãa]o(?:\s+C[íi]vel)?|Agravo\s+(?:de\s+Instrumento|Interno|Regimental)|Recurso\s+(?:Inominado|C[íi]vel|Ordin[áa]rio)|Embargos\s+(?:de\s+Declara[çc][ãa]o|Infringentes)|Mandado\s+de\s+Seguran[çc]a|Habeas\s+Corpus)\s+(?:C[íi]vel\s+)?(?:\([\p{L}]{2,5}\)\s+)?(?:(?:[nN][º°o]\.?|[nN]\.)\s*)?(\d[\d./-]{5,}\d)`,
  "giu",
);
/** How far around the reporter of a decision its number may stand. */
const REPORTER_REACH = 700;

type Span = { index: number; end: number };

/** The line of a place in a text, looking no further than so many characters each way. */
function lineAround(text: string, position: number, back: number, ahead: number): Span {
  const from = Math.max(0, position - back);
  const before = text.slice(from, position).lastIndexOf("\n");
  const until = Math.min(text.length, position + ahead);
  const after = text.slice(position, until).indexOf("\n");
  return { index: before < 0 ? from : from + before + 1, end: after < 0 ? until : position + after };
}

/**
 * The stretches of a text written as a citation that no form read into a
 * source: a numbered instrument of an unknown kind ("Provimento nº 61 do
 * CNJ", "Resolução Conjunta nº 5"), a decision told by its reporter and its
 * day with no number that was read ("(TJGO, 3ª Câmara Cível, Rel. Des.
 * Fulano, julgado em 10/02/2021)": how a model invents one), an appeal of a
 * court below by a number that is not the CNJ's. Each blocks: what cannot be
 * checked is not approved.
 */
function unreadSpans(text: string, mentions: readonly Mention[]): Span[] {
  const sorted = [...mentions].sort((a, b) => a.index - b.index);
  /** A mention that overlaps the stretch, of the kinds named when some are. */
  const reads = (from: number, to: number, kinds?: readonly SourceKind[]): boolean => {
    for (let at = firstFrom(sorted, Math.max(0, from - LONGEST_MENTION)); at < sorted.length && sorted[at].index < to; at += 1) {
      if (sorted[at].end > from && (!kinds || kinds.includes(sorted[at].ref.kind))) return true;
    }
    return false;
  };
  const spans: Span[] = [];

  for (const match of text.matchAll(new RegExp(INSTRUMENT.source, INSTRUMENT.flags))) {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    if (reads(index, end)) continue;
    // A citation is written with the capital of its name or with "nº": "sem resolução em 10 dias" is neither.
    const capital = /^\p{Lu}/u.test(match[1]);
    if (!capital && !match[3]) continue;
    // Between the name and its number, only what names it further: "Resolução Conjunta nº 5", "Lei Orgânica do Município nº 1".
    const between = match[2].trim().split(/\s+/).filter(Boolean);
    const named = (word: string) => /^\(?\p{Lu}/u.test(word) && !NO_NAME.has(word.toLowerCase());
    if (!between.every((word) => named(word) || SMALL_WORDS.has(word.toLowerCase()))) continue;
    if (between.length > 0 && !named(between[between.length - 1])) continue;
    spans.push({ index, end });
  }

  // The stretches looked at as decisions, in the order of the text: what an appeal named inside one is part of.
  const blocks: Span[] = [];
  let looked = 0;
  for (const match of text.matchAll(new RegExp(REPORTER.source, REPORTER.flags))) {
    const at = match.index ?? 0;
    // Another mark of a stretch already looked at.
    if (at < looked) continue;
    // The parentheses it is said in, when it is; else its line.
    let start = -1;
    for (let depth = 0, position = at - 1; position >= 0 && at - position <= REPORTER_REACH; position -= 1) {
      const char = text[position];
      if (char === ")") depth += 1;
      else if (char === "(") {
        if (depth === 0) {
          start = position;
          break;
        }
        depth -= 1;
      }
    }
    let end = -1;
    if (start >= 0) {
      for (let depth = 0, position = at; position < text.length && position - at <= REPORTER_REACH; position += 1) {
        const char = text[position];
        if (char === "(") depth += 1;
        else if (char === ")") {
          if (depth === 0) {
            end = position + 1;
            break;
          }
          depth -= 1;
        }
      }
    }
    if (start < 0 || end < 0) {
      const line = lineAround(text, at, 300, 200);
      start = line.index;
      end = line.end;
    }
    // A day something was judged, with no court in the same stretch, is a day in a narrative.
    if (!match[1] && !COURT_WORD.test(text.slice(start, end))) continue;
    looked = end;
    blocks.push({ index: start, end });
    // Its number may stand right before the parentheses ("REsp 1.584.465/MG (Rel. Min. ...)") or right after them,
    // on the same line: the decision of the paragraph before or after is another.
    if (reads(lineAround(text, start, 120, 0).index, lineAround(text, end, 0, 60).end, ["precedente", "processo"])) continue;
    spans.push({ index: start, end: Math.min(end, start + 300) });
  }

  for (const match of text.matchAll(new RegExp(APPEAL.source, APPEAL.flags))) {
    const index = match.index ?? 0;
    const end = index + match[0].length;
    if (reads(index, end, ["precedente", "processo"])) continue;
    // Named inside a stretch already looked at as a decision: said once.
    const before = firstFrom(blocks, index + 1) - 1;
    if (before >= 0 && blocks[before].end > index) continue;
    spans.push({ index, end });
  }
  return spans;
}

/**
 * Every source a text cites, in the order it cites them. The same source
 * cited twice is two citations: a screen shows each where it is.
 */
export function extractCitations(text: string): Citation[] {
  // One form for every accent: a text that came decomposed is read like any other.
  const source = String(text ?? "").normalize("NFC");
  const numbered = numberedMentions(source).sort((a, b) => a.index - b.index || b.end - a.end);
  // A name inside a numbered mention is that mention, not one more.
  const named = namedMentions(source).filter((mention) => {
    // Only the numbered mentions that start at or before it can hold it.
    for (let at = firstFrom(numbered, mention.index + 1) - 1; at >= 0; at -= 1) {
      const other = numbered[at];
      if (mention.index - other.index > LONGEST_MENTION) break;
      if (mention.end <= other.end) return false;
    }
    return true;
  });
  const mentions = [...numbered, ...named].sort((a, b) => a.index - b.index || b.end - a.end);
  const norms = mentions.filter((mention) => mention.norm);
  const citations: Citation[] = [];
  const throughArticle = new Set<Mention>();
  /** The articles read with their norm, in the order of the text: what a transcription under one refers to. */
  const read: { number: string; norm: Mention; end: number }[] = [];

  /** The norm named right after `position`, with only what belongs to articles between them, and the other articles the gap names. */
  const normAfter = (position: number, wordOnly: boolean): { norm: Mention; others: string[] } | null => {
    for (let at = firstFrom(norms, position); at < norms.length && norms[at].index - position <= REACH_AFTER; at += 1) {
      const candidate = norms[at];
      const gap = source.slice(position, candidate.index);
      // "do CDC", "da Lei"...
      const word = /(?:^|[\s,;)])(?:d[aeo]s?|n[ao]s?)\s*$/i.exec(gap);
      // ...or nothing but a comma, a parenthesis, a slash or a dash on the same line.
      const mark = word || wordOnly ? null : NORM_MARK.exec(gap);
      if (!word && !mark) continue;
      const others = readGap(word ? gap.slice(0, gap.length - word[0].trimStart().length) : gap.slice(0, mark?.index ?? 0));
      if (others !== null) return { norm: candidate, others };
    }
    return null;
  };
  const cite = (number: string, of: Mention | undefined, index: number, raw: string, end: number) => {
    const ref: SourceRef = of ? { ...of.ref, article: number } : { kind: "artigo", issuer: "", number: "", article: number };
    citations.push({ ...ref, key: sourceKey(ref), raw, index });
    if (of) read.push({ number, norm: of, end });
  };
  const next = new RegExp(NEXT_ARTICLES, "iy");

  for (const article of articleMentions(source)) {
    const numbers = [...article.numbers];
    let end = article.end;
    // The norm named right after the article, with only what belongs to articles between them...
    const start = firstFrom(norms, article.end);
    const after = normAfter(article.end, false);
    let norm: Mention | undefined = after?.norm;
    if (after) numbers.push(...after.others);
    // ...or the one named right before it.
    if (!norm) {
      for (let at = start - 1; at >= 0 && article.index - norms[at].index <= REACH_BEFORE + LONGEST_MENTION; at -= 1) {
        const candidate = norms[at];
        if (candidate.end > article.index || article.index - candidate.end > REACH_BEFORE) continue;
        if (NORM_BEFORE.test(source.slice(candidate.end, article.index))) {
          norm = candidate;
          break;
        }
      }
      // "CDC, arts. 6º, VI, e 14": the other articles of a list in the plural follow it.
      if (norm && article.many) {
        const stretch = /^(?:\s*(?:[,;]|\be\b|[IVXLCDM]{1,7}\b|caput\b|incisos?\b|§+|par[áa]grafos?\b|[úu]nico\b|\d{1,4}(?:\.?[º°])?(?![\d.]))\s*)*/.exec(
          source.slice(article.end, article.end + 60),
        );
        const others = stretch ? readGap(stretch[0].replace(/[\s,;]*(?:\be)?[\s,;]*$/, "")) : null;
        if (others && others.length > 0) {
          numbers.push(...others);
          end = article.end + (stretch?.[0].trimEnd().length ?? 0);
        }
      }
    }
    // ...or the article's own words under its citation: "dispõe o art. 14 do CDC, in verbis: "Art. 14. O fornecedor..."".
    let quoted: Mention | undefined;
    if (!norm && article.heading && numbers.length === 1) {
      for (let at = read.length - 1; at >= 0 && at >= read.length - 60 && !quoted; at -= 1) {
        if (read[at].number === numbers[0] && article.index - read[at].end <= REACH_QUOTE) quoted = read[at].norm;
      }
    }
    const last = after ? after.norm.end : end;
    for (const number of numbers) cite(number, norm ?? quoted, article.index, source.slice(article.index, last), last);
    if (norm) throughArticle.add(norm);
    // ...and, after that norm, the articles of the next one: "arts. 186 e 927 do CC e 14 do CDC".
    for (let from = after ? after.norm.end : -1; from >= 0; ) {
      next.lastIndex = from;
      const listed = next.exec(source);
      const following = listed ? normAfter(next.lastIndex, true) : null;
      if (!listed || !following) break;
      const index = next.lastIndex - listed[1].length;
      const numbersOfNext = [...listed[1].matchAll(new RegExp(ONE_ARTICLE, "g"))].map((one) =>
        articleNumber(one[0].replace(/\.?[º°]$/, "")),
      );
      for (const number of [...numbersOfNext, ...following.others])
        cite(number, following.norm, index, source.slice(index, following.norm.end), following.norm.end);
      throughArticle.add(following.norm);
      from = following.norm.end;
    }
  }

  for (const mention of mentions) {
    // A norm cited through an article of it is that citation, not one more.
    if (throughArticle.has(mention)) continue;
    const ref: SourceRef = { ...mention.ref, article: null };
    citations.push({ ...ref, key: sourceKey(ref), raw: mention.raw, index: mention.index });
  }
  for (const span of unreadSpans(source, mentions)) {
    const raw = source.slice(span.index, span.end);
    const ref: SourceRef = { kind: "ilegivel", issuer: "", number: plain(raw), article: null };
    citations.push({ ...ref, key: sourceKey(ref), raw, index: span.index });
  }
  return citations.sort((a, b) => a.index - b.index || a.key.localeCompare(b.key));
}

/** The distinct sources of a text, each once, in the order they first appear. */
export function distinctCitations(citations: readonly Citation[]): Citation[] {
  const seen = new Set<string>();
  return citations.filter((citation) => (seen.has(citation.key) ? false : (seen.add(citation.key), true)));
}

/** The kinds more than one body issues: who issued one is part of what it is. */
export const ISSUED_KINDS = ["resolucao", "sumula", "tema", "enunciado"] as const satisfies readonly SourceKind[];

/** The acronym another norm is kept under, the first word of its number: "MP", "EC", "DLG", "PORTARIA", "IN". */
const normaOf = (number: string): string => number.split(" ")[0] ?? "";
/** The other norms a body issues, and the ones numbered again every year. */
const NORMA_OF_A_BODY: readonly string[] = ["PORTARIA", "IN"];
const NORMA_WITH_YEAR: readonly string[] = ["MP", "DLG", "PORTARIA", "IN", "REGCE", "REGUE"];

/**
 * Why a citation cannot be checked as it is written, whatever a library
 * holds (a library entry never has one of these: migration 0029). Null when
 * it can.
 *
 *   no_norm     an article with no norm beside it;
 *   no_issuer   a súmula, a theme, a resolution, an enunciado or an ordinance with nobody named as who issued
 *               it, or a decision of a class more than one court has with no court beside it;
 *   no_year     a decree, or another norm numbered again every year, with no year;
 *   unreadable  written as a citation, and read into no source.
 */
export function citationGap(citation: SourceRef): "no_norm" | "no_issuer" | "no_year" | "unreadable" | null {
  if (citation.kind === "artigo") return "no_norm";
  if (citation.kind === "ilegivel") return "unreadable";
  if ((ISSUED_KINDS as readonly string[]).includes(citation.kind) && citation.issuer === "") return "no_issuer";
  if (citation.kind === "precedente" && citation.issuer === "" && SHARED_CLASSES.includes(normaOf(citation.number)))
    return "no_issuer";
  if (citation.kind === "norma") {
    if (NORMA_OF_A_BODY.includes(normaOf(citation.number)) && citation.issuer === "") return "no_issuer";
    if (NORMA_WITH_YEAR.includes(normaOf(citation.number)) && !citation.number.includes("/")) return "no_year";
  }
  if (citation.kind === "decreto" && !citation.number.includes("/")) return "no_year";
  return null;
}

/**
 * What a library verifies. A citation of an article needs an entry of that
 * very article; a citation of a norm with no article is answered by an entry
 * of the norm or of any article of it; everything else by its own key. What
 * nobody can check as written is answered by nothing.
 */
export function isCovered(citation: SourceRef, libraryKeys: ReadonlySet<string>): boolean {
  if (citation.kind === "artigo" || citation.kind === "ilegivel") return false;
  const key = sourceKey(citation);
  if (libraryKeys.has(key)) return true;
  if (citation.article) return false;
  for (const candidate of libraryKeys) if (candidate.startsWith(`${key}#`)) return true;
  return false;
}

// ---------- How a source is written ----------

/** "1584465" as "1.584.465". */
const dotted = (value: string): string => value.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
/** The bodies a sentence names with "da": every other is named with "do". */
const BODIES_WITH_DA: readonly string[] = ["ANAC", "TNU", "ANATEL", "ANEEL", "ANS", "ANTT", "ANVISA", "SUSEP", "CVM", "OAB", "RFB"];
const of = (issuer: string): string => `${BODIES_WITH_DA.includes(issuer) ? "da" : "do"} ${issuer}`;
/** The classes that are not written all in capitals. */
const CLASS_WRITTEN: Record<string, string> = {
  RESP: "REsp",
  ARESP: "AREsp",
  ERESP: "EREsp",
  EARESP: "EAREsp",
  AGINT: "AgInt",
  AGRG: "AgRg",
  EDCL: "EDcl",
  RCL: "Rcl",
  AG: "Ag",
};
const NORMA_WRITTEN: Record<string, string> = {
  MP: "Medida Provisória",
  EC: "Emenda Constitucional",
  DLG: "Decreto Legislativo",
  PORTARIA: "Portaria",
  REGCE: "Regulamento (CE)",
  REGUE: "Regulamento (UE)",
  IN: "Instrução Normativa",
};
/** The other norms a sentence names with "do": every other is named with "da". */
const NORMA_WITH_DO: readonly string[] = ["DLG", "REGCE", "REGUE"];
/** A number with its year, when it has one: "5910/2006" as "5.910/2006". */
const numberWithYear = (value: string): string => {
  const [number, year] = value.split("/");
  return `${dotted(number)}${year ? `/${year}` : ""}`;
};

/**
 * How a source is written in a piece so that this reader reads it back into
 * the same key: what the AI is told to write, what a screen shows of a
 * citation, and what a lawyer may copy. The database writes the same words
 * for a library entry (`legal_source_citation`, migration 0029), and a test
 * of the app holds the two together.
 */
export function canonicalCitation(ref: SourceRef): string {
  const lettered = /^(\d+)([A-Z])$/.exec(ref.article ?? "");
  const article = !ref.article
    ? ""
    : lettered
      ? `art. ${dotted(lettered[1])}-${lettered[2]}`
      : Number(ref.article) < 10
        ? `art. ${ref.article}º`
        : `art. ${dotted(ref.article)}`;
  /** A norm after its article: "art. 14 da Lei nº 8.078". */
  const norm = (alone: string, afterArticle: string) => (article ? `${article} ${afterArticle}` : alone);
  switch (ref.kind) {
    case "lei":
      return norm(`Lei nº ${dotted(ref.number)}`, `da Lei nº ${dotted(ref.number)}`);
    case "lei_complementar":
      return norm(`Lei Complementar nº ${dotted(ref.number)}`, `da Lei Complementar nº ${dotted(ref.number)}`);
    case "constituicao":
      return norm("Constituição Federal", "da Constituição Federal");
    case "decreto":
      return norm(`Decreto nº ${numberWithYear(ref.number)}`, `do Decreto nº ${numberWithYear(ref.number)}`);
    case "resolucao":
      return norm(`Resolução nº ${dotted(ref.number)} ${of(ref.issuer)}`, `da Resolução nº ${dotted(ref.number)} ${of(ref.issuer)}`);
    case "norma": {
      const [slug, number = ""] = ref.number.split(" ");
      const name = NORMA_WRITTEN[slug] ?? slug;
      const whole = `${name} nº ${numberWithYear(number)}${ref.issuer ? ` ${of(ref.issuer)}` : ""}`;
      return norm(whole, `${NORMA_WITH_DO.includes(slug) ? "do" : "da"} ${whole}`);
    }
    case "sumula":
      return `Súmula ${dotted(ref.number)} ${of(ref.issuer)}`;
    case "sumula_vinculante":
      return `Súmula Vinculante ${dotted(ref.number)}`;
    case "tema":
      return `Tema ${dotted(ref.number)} ${of(ref.issuer)}`;
    case "enunciado":
      return `Enunciado ${dotted(ref.number)} ${of(ref.issuer)}`;
    case "precedente": {
      const [name, number = ""] = ref.number.split(" ");
      return `${CLASS_WRITTEN[name] ?? name} ${dotted(number)}${ref.issuer ? ` ${of(ref.issuer)}` : ""}`;
    }
    case "processo":
      return ref.number.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, "$1-$2.$3.$4.$5.$6");
    case "artigo":
      return article;
    default:
      return ref.number;
  }
}
