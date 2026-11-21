import { isModelDocument, isPieceDocument, maskIdentifiers, type ModelDocument } from "@/lib/cases/drafts";
import { isValidCnpj, isValidCpf } from "@flyee/fields";

/**
 * A model of the library made from a document the firm already uses
 * (migrations 0067 and 0079): the pure rules. Pure: no I/O, no clock.
 *
 * The backend reads the document's text paragraph by paragraph, and the
 * marking (the task `biblioteca.modelo.marcacao`) first says what the
 * document is, what it lacks and what only the firm knows, then which
 * paragraphs change: the database refuses a document that cannot be a model,
 * asks the firm its questions, and keeps the changes only when every change
 * names paragraphs that exist, in order and apart. The model is then written
 * from the paragraphs and the changes, so every paragraph the marking did not
 * name is the firm's own word for word; what changed is shown against what
 * was there; and what still looks like the original case (a name the marking
 * listed, a CPF, a registration at the bar) is pointed out. Where nothing is
 * left to look at, ONE saves the model by itself (`saveGate`), as the firm
 * lets it; otherwise a lawyer saves it or not. The marking reads the firm's
 * record beside the document (0244), and what the record writes is never the
 * original case's (`firmRecordTexts`).
 */

export const TRANSCRIBE_TASK = "biblioteca.modelo.transcricao";
export const MARK_TASK = "biblioteca.modelo.marcacao";

export const IMPORT_STATUSES = [
  "reading",
  "marking",
  "asking",
  "saving",
  "ready",
  "saved",
  "refused",
  "failed",
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export type ImportSource = "docx" | "pdf";

/** The states ONE works in by itself: the screens look again while a request is in one. */
export const IMPORT_WORKING: readonly ImportStatus[] = ["reading", "marking", "saving"];

/** What ONE asks the firm of a document: the question, and why the model needs its answer. */
export type ImportQuestion = { question: string; why: string };

/** A round asked and answered, as the marking reads it again. */
export type ImportExchange = { questions: ImportQuestion[]; answers: string[] };

/** What a document of its kind must hold and did not (`template_import_essentials`). */
export const MISSING_CODES = [
  "outorgante",
  "outorgados",
  "poderes",
  "contratante",
  "contratado",
  "objeto",
  "honorarios",
  "pedidos",
  "fundamentos",
] as const;
export type MissingCode = (typeof MISSING_CODES)[number];

/** Why ONE refused a document, as the database kept it. */
export type ImportRefusal = {
  code: "other_document" | "wrong_kind" | "missing";
  /** What the document is: a model ONE uses, or another thing. */
  found: ModelDocument | "outro" | null;
  /** What the marking said the document is, in a few words. */
  what: string | null;
  missing: MissingCode[];
};

/** Why what ONE prepared waits for a person instead of being saved by ONE. */
export const HELD_REASONS = ["checks", "notes", "autonomy", "name_in_use", "library_full", "not_saved"] as const;
export type HeldReason = (typeof HELD_REASONS)[number];

/** Some words of a paragraph a change takes out (`before`, as the document writes them) and what goes there. */
export type ModelPiece = { before: string; after: string };

/**
 * A change of the marking: the paragraphs it takes the place of (counted from one) and what goes there, or, with
 * `pieces`, only some words of its one paragraph, the rest of it staying as the document writes it (0093).
 */
export type ModelChange = { from: number; to: number; text: string; reason: string; pieces: ModelPiece[] };

/** What the marking answered, as the database kept it. */
export type ImportProposal = {
  name: string;
  documentKind: ModelDocument;
  proceedingKind: "juizado" | "comum" | null;
  /** Of a petition, the problem it was written for, when it serves only that one (0244). */
  problem: string | null;
  /** Of a piece of the process, its kind of piece (0244, `piece_kinds`). */
  pieceKind: string | null;
  changes: ModelChange[];
  /** The people of the original case the document names, as it writes them. */
  people: string[];
  /** What the marking asks a lawyer to check. */
  notes: string[];
  /** The paragraphs that hold the firm's own data, kept as the firm wrote them (0093). */
  firmParagraphs: number[];
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");
/** A key as the database writes a problem or a kind of piece: it checked which ones exist (0244). */
const slugOf = (value: unknown): string | null =>
  typeof value === "string" && /^[a-z][a-z_]{2,40}$/.test(value) ? value : null;
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** The paragraphs as the database keeps them, or none. */
export const paragraphsOf = (value: unknown): string[] => strings(value);

/** The marking's answer as the database kept it (`template_import_proposal`), or null when it holds none. */
export function proposalOf(value: unknown): ImportProposal | null {
  if (typeof value !== "object" || value === null) return null;
  const kept = value as Record<string, unknown>;
  if (!isModelDocument(kept.document_kind)) return null;
  const kind = kept.proceeding_kind === "juizado" || kept.proceeding_kind === "comum" ? kept.proceeding_kind : null;
  const changes = (Array.isArray(kept.changes) ? kept.changes : []).flatMap((item): ModelChange[] => {
    const change = (item ?? {}) as Record<string, unknown>;
    const from = Number(change.from);
    const to = Number(change.to);
    const pieces = (Array.isArray(change.pieces) ? change.pieces : []).flatMap((piece): ModelPiece[] => {
      const row = (piece ?? {}) as Record<string, unknown>;
      const before = text(row.before);
      return before ? [{ before, after: text(row.after) }] : [];
    });
    return Number.isInteger(from) && Number.isInteger(to)
      ? [{ from, to, text: text(change.text), reason: text(change.reason), pieces }]
      : [];
  });
  return {
    name: text(kept.name),
    documentKind: kept.document_kind,
    proceedingKind: isPieceDocument(kept.document_kind) ? kind : null,
    problem: kept.document_kind === "piece" ? slugOf(kept.problem) : null,
    pieceKind: kept.document_kind === "peca_processo" ? slugOf(kept.piece_kind) : null,
    changes,
    people: strings(kept.people),
    notes: strings(kept.notes),
    firmParagraphs: (Array.isArray(kept.firm_paragraphs) ? kept.firm_paragraphs : []).filter(
      (value): value is number => Number.isInteger(value) && (value as number) > 0,
    ),
  };
}

/**
 * The original texts of the paragraphs that hold the firm's own data, for the check of a model to tell the firm's
 * own CNPJ, registrations at the bar, address, telephone and e-mail from the original case's: only once the firm
 * answered a round of questions, where the marking asks whether they are its own in every case, or once the marking
 * took them as the firm's own by its record (0271) (what `template_import_to_work` of the database answers from the
 * same request).
 */
export function firmTextsOf(
  paragraphs: readonly string[],
  proposal: Pick<ImportProposal, "firmParagraphs"> | null,
  exchanges: readonly ImportExchange[],
  /** The marking took the firm's data of the document as the firm's own (`firm_read`, 0271). */
  firmRead = false,
): string[] {
  const answered = exchanges.some((round) => round.answers.some((answer) => answer.trim() !== ""));
  if ((!answered && !firmRead) || !proposal) return [];
  return [...new Set(proposal.firmParagraphs)]
    .filter((at) => at >= 1 && at <= paragraphs.length)
    .sort((a, b) => a - b)
    .map((at) => paragraphs[at - 1]);
}

const isMissingCode = (value: unknown): value is MissingCode => (MISSING_CODES as readonly unknown[]).includes(value);

/** The questions as the database kept them, or none. */
export function questionsOf(value: unknown): ImportQuestion[] {
  return (Array.isArray(value) ? value : []).flatMap((item): ImportQuestion[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    const question = text(row.question).trim();
    return question ? [{ question, why: text(row.why).trim() }] : [];
  });
}

/** The rounds asked and answered as the database hands them to the marking, or none. */
export function exchangesOf(value: unknown): ImportExchange[] {
  return (Array.isArray(value) ? value : []).flatMap((item): ImportExchange[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    const questions = questionsOf(row.questions);
    return questions.length > 0 ? [{ questions, answers: strings(row.answers) }] : [];
  });
}

/** Why ONE refused a document, as the database kept it, or null. */
export function refusalOf(value: unknown): ImportRefusal | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (row.code !== "other_document" && row.code !== "wrong_kind" && row.code !== "missing") return null;
  const found = row.found === "outro" || isModelDocument(row.found) ? row.found : null;
  const what = text(row.what).trim();
  return {
    code: row.code,
    found,
    what: what || null,
    missing: (Array.isArray(row.missing) ? row.missing : []).filter(isMissingCode),
  };
}

export const heldReasonOf = (value: unknown): HeldReason | null =>
  (HELD_REASONS as readonly unknown[]).includes(value) ? (value as HeldReason) : null;

/** What the firm sent a document as, in the words the marking reads (every one of them since 0244). */
const SENT_AS: Record<ModelDocument, string> = {
  piece: "a petição inicial que o escritório usa",
  peca_processo: "uma peça que o escritório apresenta num processo em curso",
  procuracao: "a procuração que o escritório usa",
  contrato: "o contrato de honorários que o escritório usa",
  declaracao_residencia: "a declaração de residência que o escritório usa",
  declaracao_hipossuficiencia: "a declaração de hipossuficiência que o escritório usa",
};

/**
 * What the firm gave of itself (its setup, 0217, and its team's registrations at the bar), as the marking reads it
 * beside the document and the check of a model takes it as the firm's own (0244).
 */
export type FirmRecord = {
  name: string;
  /** Digits only. */
  cnpj: string | null;
  /** The society's registration at the bar, as "OAB/GO 1234". */
  society: string | null;
  /** The firm's lawyers, each registration at the bar as "OAB/GO 12345", with the name when it was read. */
  lawyers: { name: string | null; oab: string }[];
  /** Where the firm is: the street, the number, the complement, the district, the city and the state. */
  address: string | null;
  /** Digits only. */
  postalCode: string | null;
  email: string | null;
  /** Digits only. */
  phone: string | null;
};

const cnpjWritten = (digits: string): string =>
  digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

/**
 * The firm's own identifiers as the check of a model reads them (`firmTexts`): its CNPJ, its registrations at the
 * bar, its CEP, its e-mail and its telephone, which a model of the firm writes in every case. Never a CPF.
 */
export function firmRecordTexts(record: FirmRecord | null | undefined): string[] {
  if (!record) return [];
  const phone = record.phone?.replace(/\D/g, "") ?? "";
  const postal = record.postalCode?.replace(/\D/g, "") ?? "";
  return [
    record.cnpj && /^\d{14}$/.test(record.cnpj) ? `CNPJ ${cnpjWritten(record.cnpj)}` : null,
    record.society,
    ...record.lawyers.map((lawyer) => lawyer.oab),
    postal.length === 8 ? `${postal.slice(0, 5)}-${postal.slice(5)}` : null,
    record.email,
    phone.length >= 10 ? `(${phone.slice(0, 2)}) ${phone.slice(2, -4)}-${phone.slice(-4)}` : null,
  ].filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

/**
 * The firm's record as the marking reads it before the document (0244): what the document writes of the firm and
 * matches it is the firm's in every case, kept as written and never asked. The e-mail, the telephone and the CEP
 * are taken out of the document before it reads it, so they are not said here either.
 */
export function firmRecordLines(record: FirmRecord | null | undefined): string[] {
  if (!record) return [];
  const lines = [
    record.name.trim() ? `Nome: ${record.name.trim()}` : null,
    record.cnpj && /^\d{14}$/.test(record.cnpj) ? `CNPJ: ${cnpjWritten(record.cnpj)}` : null,
    record.society ? `Registro da sociedade na OAB: ${record.society}` : null,
    ...record.lawyers.map((lawyer) => `Advogado: ${lawyer.name ? `${lawyer.name}, ` : ""}${lawyer.oab}`),
    record.address ? `Endereço: ${record.address}` : null,
  ].filter((line): line is string => line !== null);
  return lines.length > 0 ? lines.map(maskIdentifiers) : [];
}

/** What the marking is told of a request besides its text. */
export type MarkingContext = {
  /** What the firm sent the document as; null when it did not say. */
  expected?: ModelDocument | null;
  /** The rounds asked and answered before this one. */
  exchanges?: readonly ImportExchange[];
  /** No question may be asked any more. */
  lastRound?: boolean;
  /** What the firm gave of itself, compared with the document (0244). */
  firmRecord?: FirmRecord | null;
};

/**
 * What the marking reads: what the firm sent the document as, each paragraph
 * after its number, and the questions asked before with the firm's answers,
 * what is written as an e-mail, a CPF, a CEP or a telephone taken out of all
 * of it. The name of the file is never in it: a lawyer names a petition after
 * its client.
 */
export function markingBriefing(paragraphs: readonly string[], context: MarkingContext = {}): string {
  const purpose = context.expected
    ? `O escritório mandou este documento como ${SENT_AS[context.expected]}.`
    : "O escritório mandou este documento para virar um modelo, sem dizer qual.";
  const rounds = (context.exchanges ?? []).map((round, index) =>
    [
      `Rodada ${index + 1}:`,
      ...round.questions.map((asked, at) => {
        const answer = (round.answers[at] ?? "").trim();
        return `Pergunta: ${maskIdentifiers(asked.question)}\nResposta: ${answer ? maskIdentifiers(answer) : "(sem resposta)"}`;
      }),
    ].join("\n"),
  );
  const record = firmRecordLines(context.firmRecord);
  return [
    purpose,
    ...(record.length > 0 ? [["Os dados do escritório no cadastro:", ...record].join("\n")] : []),
    `Documento com ${paragraphs.length} parágrafos, cada um depois do seu número.`,
    ...paragraphs.map((paragraph, index) => `§${index + 1}\n${maskIdentifiers(paragraph)}`),
    ...(rounds.length > 0 ? ["Perguntas que você já fez e o que o escritório respondeu.", ...rounds] : []),
    ...(context.lastRound ? ["Esta é a última rodada: não faça perguntas."] : []),
  ].join("\n\n");
}

/** The changes that can be used, in the order of the text: never over a paragraph twice, never past the last one. */
function usable(paragraphs: readonly string[], changes: readonly ModelChange[]): ModelChange[] {
  const ordered = [...changes].sort((a, b) => a.from - b.from);
  const kept: ModelChange[] = [];
  let reached = 0;
  for (const change of ordered) {
    if (change.from <= reached || change.to < change.from || change.to > paragraphs.length) continue;
    kept.push(change);
    reached = change.to;
  }
  return kept;
}

/**
 * What a change writes: its text in the place of its paragraphs, or, with pieces, its one paragraph with only those
 * words replaced, in their order (what `template_import_body` of the database writes from the same answer).
 */
function changeText(paragraphs: readonly string[], change: ModelChange): string {
  if (change.pieces.length === 0) return change.text.trim();
  let written = paragraphs[change.from - 1] ?? "";
  for (const piece of change.pieces) {
    if (piece.before) written = written.split(piece.before).join(piece.after);
  }
  return written.trim();
}

/** The model: the document's paragraphs, each change in the place of the ones it names, apart by a blank line. */
export function composeModel(paragraphs: readonly string[], changes: readonly ModelChange[]): string {
  const written: string[] = [];
  let next = 1;
  for (const change of usable(paragraphs, changes)) {
    written.push(...paragraphs.slice(next - 1, change.from - 1));
    const goes = changeText(paragraphs, change);
    if (goes !== "") written.push(goes);
    next = change.to + 1;
  }
  written.push(...paragraphs.slice(next - 1));
  return written.join("\n\n");
}

/** A change as the screen shows it: why, where, what was there and what goes there. */
export type ChangeShown = { from: number; to: number; reason: string; before: string; after: string };

export function changesShown(paragraphs: readonly string[], changes: readonly ModelChange[]): ChangeShown[] {
  return usable(paragraphs, changes).map((change) => ({
    from: change.from,
    to: change.to,
    reason: change.reason,
    before: paragraphs.slice(change.from - 1, change.to).join("\n\n"),
    after: changeText(paragraphs, change),
  }));
}

// ---------- What still looks like the original case ----------

export const IDENTIFIERS = ["cpf", "cnpj", "cep", "telefone", "email", "oab"] as const;
export type Identifier = (typeof IDENTIFIERS)[number];

export type ModelCheck =
  /** A person of the original case the marking listed, still written in the model. */
  | { kind: "person"; name: string; count: number }
  /** What is written as an identifier: a CPF or a CNPJ that checks, a CEP, a telephone, an e-mail, a registration at the bar. */
  | { kind: "identifier"; identifier: Identifier; count: number }
  /** Something left to complete in a paper a client signs: ONE never sends one so. */
  | { kind: "to_complete"; count: number }
  /** Characters the PDF of a piece cannot write: a piece with one is never approved. */
  | { kind: "unwritable"; characters: string[] };

/** A text as names are compared: no accent, no capital, one kind of space. */
const plain = (value: string): string =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every place a name is written as a whole: never inside a longer word. */
const wholeWord = (name: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${escaped(name)}(?![\\p{L}\\p{N}])`, "gu");

/**
 * The people of the original case still written in a text, each with how
 * many times: the longer names first, so a first name is counted only where
 * it is not part of a whole name already counted.
 */
function peopleLeft(body: string, people: readonly string[]): ModelCheck[] {
  const names = [...new Map(people.map((name) => [plain(name), name.trim()])).entries()]
    .filter(([key]) => key.replace(/[^\p{L}]/gu, "").length >= 3)
    .sort((a, b) => b[0].length - a[0].length);
  let left = plain(body);
  const found: ModelCheck[] = [];
  for (const [key, name] of names) {
    const pattern = wholeWord(key);
    const count = left.match(pattern)?.length ?? 0;
    if (count === 0) continue;
    found.push({ kind: "person", name, count });
    left = left.replace(pattern, (match) => " ".repeat(match.length));
  }
  return found;
}

/** How each kind of identifier is written, in the order they are read: what one kind took, another never reads. */
const IDENTIFIER_PATTERNS: readonly [Identifier, RegExp, (match: string) => boolean][] = [
  ["email", /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu, () => true],
  ["cnpj", /(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g, isValidCnpj],
  ["cpf", /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g, isValidCpf],
  ["cep", /(?<!\d)\d{5}-\d{3}(?!\d)/g, () => true],
  ["oab", /\bOAB\s*[/-]?\s*[A-Z]{2}\s*(?:n[º°o.]*\s*)?\d[\d.]*/g, () => true],
  ["telefone", /(?:\+?55[\s.-]?)?\(?(?<![\p{L}\p{N}])\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}(?![\p{L}\p{N}])/gu, () => true],
];

/** Each identifier a text writes, with its kind and as it is written. */
export function identifiersIn(text: string): { identifier: Identifier; match: string }[] {
  let left = text;
  const found: { identifier: Identifier; match: string }[] = [];
  for (const [identifier, pattern, keep] of IDENTIFIER_PATTERNS) {
    left = left.replace(pattern, (match) => {
      if (!keep(match)) return match;
      found.push({ identifier, match });
      return " ".repeat(match.length);
    });
  }
  return found;
}

/**
 * One identifier however it is written: the digits of a number (a telephone without the country's code), the state
 * and the number of a registration at the bar without its dots and zeros before it, an e-mail in small letters.
 */
function identifierKey(identifier: Identifier, match: string): string {
  if (identifier === "email") return `email:${match.toLowerCase()}`;
  if (identifier === "oab") {
    const parts = /OAB\s*[/-]?\s*([A-Z]{2})\s*(?:n[º°o.]*\s*)?([\d.]+)/i.exec(match);
    return parts ? `oab:${parts[1].toUpperCase()}${parts[2].replace(/\D/g, "").replace(/^0+/, "")}` : `oab:${match}`;
  }
  const digits = match.replace(/\D/g, "");
  return `${identifier}:${identifier === "telefone" ? digits.replace(/^55(?=\d{10,11}$)/, "") : digits}`;
}

/**
 * The identifiers of a text, each kind with how many, but the firm's own: what the paragraphs of the firm's own
 * data write (`firmTextsOf`) and what its record says (`firmRecordTexts`), however each is written, never a CPF,
 * which is a person's.
 */
function identifiersLeft(body: string, firmTexts: readonly string[] = []): ModelCheck[] {
  const own = new Set(
    firmTexts
      .flatMap(identifiersIn)
      .filter((item) => item.identifier !== "cpf")
      .map((item) => identifierKey(item.identifier, item.match)),
  );
  const counts = new Map<Identifier, number>();
  for (const { identifier, match } of identifiersIn(body)) {
    if (own.has(identifierKey(identifier, match))) continue;
    counts.set(identifier, (counts.get(identifier) ?? 0) + 1);
  }
  return IDENTIFIERS.flatMap((identifier): ModelCheck[] => {
    const count = counts.get(identifier) ?? 0;
    return count > 0 ? [{ kind: "identifier", identifier, count }] : [];
  });
}

/**
 * What a lawyer should look at in a model ONE prepared before saving it: the
 * people of the original case still named, what is written as an identifier
 * (but the firm's own data, once the firm said they are its own: `firmTexts`),
 * and, in a paper a client signs, anything left to complete. What the PDF
 * cannot write is the server's to add (`unwritable`), where the writer of the
 * PDF is.
 */
export function modelChecks(
  body: string,
  people: readonly string[],
  document: ModelDocument,
  firmTexts: readonly string[] = [],
): ModelCheck[] {
  const toComplete = isPieceDocument(document) ? 0 : (body.match(/\[\s*COMPLETAR/gi)?.length ?? 0);
  return [
    ...peopleLeft(body, people),
    ...identifiersLeft(body, firmTexts),
    ...(toComplete > 0 ? [{ kind: "to_complete" as const, count: toComplete }] : []),
  ];
}

/**
 * Whether ONE saves a model it prepared by itself (0079): only a text with
 * nothing a lawyer should look at, neither what still looks like the original
 * case (`modelChecks`), nor a character the PDF of a piece cannot write
 * (`unwritable`, which the caller reads where the writer of the PDF is), nor
 * anything the marking itself asked a lawyer to check (`notes`, a question
 * left open among them). Otherwise the model waits for a person, with why.
 */
export function saveGate(input: {
  body: string;
  people: readonly string[];
  document: ModelDocument;
  notes: readonly string[];
  unwritable: readonly string[];
  /** The paragraphs of the firm's own data, once the firm said they are its own (`firmTextsOf`). */
  firmTexts?: readonly string[];
}): { save: true } | { save: false; reason: "checks" | "notes" } {
  if (modelChecks(input.body, input.people, input.document, input.firmTexts ?? []).length > 0) {
    return { save: false, reason: "checks" };
  }
  if (isPieceDocument(input.document) && input.unwritable.length > 0) return { save: false, reason: "checks" };
  if (input.notes.some((note) => note.trim() !== "")) return { save: false, reason: "notes" };
  return { save: true };
}

// ---------- The screen's words ----------

/** The failures the database records, each with the words the screen says it in. */
export const IMPORT_FAILURES = [
  "unreadable",
  "empty",
  "too_long",
  "not_a_model",
  "no_provider",
  "answer_unusable",
  "gave_up",
] as const;
export type ImportFailure = (typeof IMPORT_FAILURES)[number];

const FAILURE_KEY: Record<ImportFailure, string> = {
  unreadable: "library-import-failed-unreadable",
  empty: "library-import-failed-empty",
  too_long: "library-import-failed-too-long",
  not_a_model: "library-import-failed-not-a-model",
  no_provider: "library-import-failed-no-provider",
  answer_unusable: "library-import-failed-answer-unusable",
  gave_up: "library-import-failed-gave-up",
};

export const importFailureKey = (failure: string | null): string =>
  FAILURE_KEY[failure as ImportFailure] ?? FAILURE_KEY.gave_up;

/** The documents a firm keeps one model of per use: a paper a client signs, or a declaration. */
const ONE_PER_USE: readonly ModelDocument[] = [
  "procuracao",
  "contrato",
  "declaracao_residencia",
  "declaracao_hipossuficiencia",
];

/**
 * Whether a request that failed or was refused is behind the firm already: it was sent as a paper of which the firm
 * saved a model after it was sent (from a later document, or written by hand). Nothing is owed of it, and neither
 * the setup nor the library says it any more. A saved request goes with what it saved (0067), so without this the
 * setup fell back to an older failure of the same paper right after the firm's model was saved (2026-11-20).
 */
export function requestSettled(
  request: { status: string; expected: string | null; sentAt: string | Date },
  savedAt: Partial<Record<ModelDocument, number>>,
): boolean {
  if (request.status !== "failed" && request.status !== "refused") return false;
  const paper = ONE_PER_USE.find((kind) => kind === request.expected);
  const saved = paper ? savedAt[paper] : undefined;
  const sent = momentOf(request.sentAt);
  return saved !== undefined && Number.isFinite(sent) && saved >= sent;
}

/** A moment as the database hands it (an ISO text, or a Date where a driver makes one), to the millisecond. */
const momentOf = (value: string | Date | null | undefined): number =>
  value instanceof Date ? value.getTime() : typeof value === "string" ? new Date(value).getTime() : Number.NaN;

/** The latest moment the firm saved a model of each paper, from its rows of `draft_templates`, in milliseconds. */
export function papersSavedAt(
  rows: readonly { document_kind: string | null; updated_at: string | Date | null }[],
): Partial<Record<ModelDocument, number>> {
  const latest: Partial<Record<ModelDocument, number>> = {};
  for (const row of rows) {
    const kind = ONE_PER_USE.find((paper) => paper === row.document_kind);
    const at = momentOf(row.updated_at);
    if (!kind || !Number.isFinite(at)) continue;
    if (latest[kind] === undefined || at > (latest[kind] as number)) latest[kind] = at;
  }
  return latest;
}

/** What a refusal to send or to ask says: the codes of the upload and of the request. */
const REFUSAL_KEY: Record<string, string> = {
  type_not_allowed: "library-import-refused-type",
  too_large: "library-import-refused-too-large",
  unreadable: "library-import-refused-unreadable",
  too_many_pages: "library-import-refused-pages",
  too_many_today: "library-import-refused-today",
  not_allowed: "library-import-refused-not-allowed",
  not_allowed_in_support_session: "library-import-refused-support",
  not_uploaded: "library-import-refused-not-uploaded",
  rejected: "library-import-refused-rejected",
};

export const importRefusalKey = (code: string): string => REFUSAL_KEY[code] ?? "library-import-refused-failed";

/** What the library says of a request in each state. */
export const IMPORT_STATUS_KEY: Record<ImportStatus, string> = {
  reading: "library-import-status-reading",
  marking: "library-import-status-marking",
  asking: "library-import-status-asking",
  saving: "library-import-status-saving",
  ready: "library-import-status-ready",
  saved: "library-import-status-saved",
  refused: "library-import-status-refused",
  failed: "library-import-status-failed",
};

/** What ONE's refusal of a document says, by why ONE refused it. */
export const REFUSED_KEY: Record<ImportRefusal["code"], string> = {
  other_document: "library-import-refusal-other",
  wrong_kind: "library-import-refusal-wrong-kind",
  missing: "library-import-refusal-missing",
};

/** Each thing a document lacked, as the refusal names it. */
export const MISSING_KEY: Record<MissingCode, string> = {
  outorgante: "library-import-missing-outorgante",
  outorgados: "library-import-missing-outorgados",
  poderes: "library-import-missing-poderes",
  contratante: "library-import-missing-contratante",
  contratado: "library-import-missing-contratado",
  objeto: "library-import-missing-objeto",
  honorarios: "library-import-missing-honorarios",
  pedidos: "library-import-missing-pedidos",
  fundamentos: "library-import-missing-fundamentos",
};

/** A model ONE uses, as a refusal names it inside a sentence ("é ... e não ..."). */
export const DOCUMENT_NAMED_KEY: Record<ModelDocument, string> = {
  piece: "library-import-named-piece",
  peca_processo: "library-import-named-peca-processo",
  procuracao: "library-import-named-procuracao",
  contrato: "library-import-named-contrato",
  declaracao_residencia: "library-import-named-declaracao-residencia",
  declaracao_hipossuficiencia: "library-import-named-declaracao-hipossuficiencia",
};

/** Why what ONE prepared waits for a person, said over the model. */
export const HELD_KEY: Record<HeldReason, string> = {
  checks: "library-import-held-checks",
  notes: "library-import-held-notes",
  autonomy: "library-import-held-autonomy",
  name_in_use: "library-import-held-name",
  library_full: "library-import-held-full",
  not_saved: "library-import-held-not-saved",
};

/** What each kind of identifier is called on the screen. */
export const IDENTIFIER_KEY: Record<Identifier, string> = {
  cpf: "library-import-identifier-cpf",
  cnpj: "library-import-identifier-cnpj",
  cep: "library-import-identifier-cep",
  telefone: "library-import-identifier-telefone",
  email: "library-import-identifier-email",
  oab: "library-import-identifier-oab",
};

/** The type a browser gives a Word file, which the reservation takes. */
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** What the file chooser offers: a Word file or a PDF. */
export const IMPORT_ACCEPT = `application/pdf,${DOCX_MIME},.pdf,.docx`;

/**
 * A text in a format ONE does not read (an old Word file, RTF, OpenDocument, Pages): said before anything is
 * sent, with how to save it as a Word file or a PDF.
 */
export const isOtherTextFormat = (name: string): boolean => /\.(doc|rtf|odt|pages|wpd)$/i.test(name.trim());
