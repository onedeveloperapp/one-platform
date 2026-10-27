import { isModelDocument, maskIdentifiers, type ModelDocument } from "@/lib/cases/drafts";
import { isValidCnpj, isValidCpf } from "@flyee/fields";

/**
 * A model of the library made from a document the firm already uses
 * (migration 0067): the pure rules. Pure: no I/O, no clock.
 *
 * The backend reads the document's text paragraph by paragraph, and the
 * marking (the task `biblioteca.modelo.marcacao`) answers which paragraphs
 * change: the database keeps that answer only when every change names
 * paragraphs that exist, in order and apart. The model is then written here,
 * from the paragraphs and the changes, so every paragraph the marking did not
 * name is the firm's own word for word; what changed is shown against what
 * was there; and what still looks like the original case (a name the marking
 * listed, a CPF, a registration at the bar) is pointed out to the lawyer, who
 * saves the model or not. Nothing here decides anything.
 */

export const TRANSCRIBE_TASK = "biblioteca.modelo.transcricao";
export const MARK_TASK = "biblioteca.modelo.marcacao";

export const IMPORT_STATUSES = ["reading", "marking", "ready", "failed"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
export type ImportSource = "docx" | "pdf";

/** A change of the marking: the paragraphs it takes the place of (counted from one) and what goes there. */
export type ModelChange = { from: number; to: number; text: string; reason: string };

/** What the marking answered, as the database kept it. */
export type ImportProposal = {
  name: string;
  documentKind: ModelDocument;
  proceedingKind: "juizado" | "comum" | null;
  changes: ModelChange[];
  /** The people of the original case the document names, as it writes them. */
  people: string[];
  /** What the marking asks a lawyer to check. */
  notes: string[];
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");
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
    return Number.isInteger(from) && Number.isInteger(to)
      ? [{ from, to, text: text(change.text), reason: text(change.reason) }]
      : [];
  });
  return {
    name: text(kept.name),
    documentKind: kept.document_kind,
    proceedingKind: kept.document_kind === "piece" ? kind : null,
    changes,
    people: strings(kept.people),
    notes: strings(kept.notes),
  };
}

/**
 * What the marking reads: each paragraph after its number, what is written as
 * an e-mail, a CPF, a CEP or a telephone taken out. The name of the file is
 * never in it: a lawyer names a petition after its client.
 */
export function markingBriefing(paragraphs: readonly string[]): string {
  return [
    `Documento com ${paragraphs.length} parágrafos, cada um depois do seu número.`,
    ...paragraphs.map((paragraph, index) => `§${index + 1}\n${maskIdentifiers(paragraph)}`),
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

/** The model: the document's paragraphs, each change in the place of the ones it names, apart by a blank line. */
export function composeModel(paragraphs: readonly string[], changes: readonly ModelChange[]): string {
  const written: string[] = [];
  let next = 1;
  for (const change of usable(paragraphs, changes)) {
    written.push(...paragraphs.slice(next - 1, change.from - 1));
    if (change.text.trim() !== "") written.push(change.text.trim());
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
    after: change.text.trim(),
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

/** The identifiers of a text, each kind with how many: what is counted as one kind is not counted as another. */
function identifiersLeft(body: string): ModelCheck[] {
  let left = body;
  const counts = new Map<Identifier, number>();
  const take = (identifier: Identifier, pattern: RegExp, keep: (match: string) => boolean = () => true) => {
    left = left.replace(pattern, (match) => {
      if (!keep(match)) return match;
      counts.set(identifier, (counts.get(identifier) ?? 0) + 1);
      return " ".repeat(match.length);
    });
  };
  take("email", /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu);
  take("cnpj", /(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g, isValidCnpj);
  take("cpf", /(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/g, isValidCpf);
  take("cep", /(?<!\d)\d{5}-\d{3}(?!\d)/g);
  take("oab", /\bOAB\s*[/-]?\s*[A-Z]{2}\s*(?:n[º°o.]*\s*)?\d/g);
  take("telefone", /(?:\+?55[\s.-]?)?\(?(?<![\p{L}\p{N}])\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}(?![\p{L}\p{N}])/gu);
  return IDENTIFIERS.flatMap((identifier): ModelCheck[] => {
    const count = counts.get(identifier) ?? 0;
    return count > 0 ? [{ kind: "identifier", identifier, count }] : [];
  });
}

/**
 * What a lawyer should look at in a model ONE prepared before saving it: the
 * people of the original case still named, what is written as an identifier,
 * and, in a paper a client signs, anything left to complete. What the PDF
 * cannot write is the server's to add (`unwritable`), where the writer of the
 * PDF is.
 */
export function modelChecks(body: string, people: readonly string[], document: ModelDocument): ModelCheck[] {
  const toComplete = document === "piece" ? 0 : (body.match(/\[\s*COMPLETAR/gi)?.length ?? 0);
  return [
    ...peopleLeft(body, people),
    ...identifiersLeft(body),
    ...(toComplete > 0 ? [{ kind: "to_complete" as const, count: toComplete }] : []),
  ];
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
  ready: "library-import-status-ready",
  failed: "library-import-status-failed",
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
