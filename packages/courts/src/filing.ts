/**
 * The filing package of a lawsuit: the files a lawyer attaches in the court's
 * system, in the order and under the names that make the filing quick to do
 * and easy to read by who judges it. ONE builds the package; the lawyer files
 * it in the court's own system, with their own login.
 *
 * This file is pure: it decides the order, the names and what has to be
 * split, from what each file is and from the limits of the court's system
 * (data of `court_systems`, never a constant here). Cutting the bytes is the
 * caller's (`@flyee/documents/normalize`).
 */

/** What a file of the package is. The petition leads; the rest follows in this order. */
export const FILING_ORDER = [
  "petition",
  "power_of_attorney",
  "identity",
  "address_proof",
  "residence_declaration",
  "free_justice_declaration",
  "income_proof",
  "ticket",
  "boarding_pass",
  "baggage_report",
  "receipt",
  "evidence",
  "contract",
  // The airline's defence and an intermediate piece (0189): documents of a lawsuit the court has, never of a package
  // the person did not choose them for.
  "defense",
  "intermediate_petition",
  "other",
] as const;
export type FilingKind = (typeof FILING_ORDER)[number];

export interface FilingSource {
  /** The caller's own key for the file (a document id). */
  key: string;
  kind: string;
  /** What the file is, in the words a person reads: "Procuração", "Bilhete". */
  label: string;
  /** Whose it is, when it is somebody's: named in the file so two people's documents do not look the same. */
  person?: string | null;
  mime: string | null;
  bytes: number;
  /** How many pages it has, as the backend counted them; null when it could not be opened (protected, or damaged). */
  pages: number | null;
}

export interface FilingLimits {
  /** The largest file the system takes; null when nobody knows it yet (nothing is split then). */
  maxFileBytes: number | null;
  /**
   * The largest petition the system takes, when it takes the petition apart from the documents and
   * under a limit of its own (the PJe of a court takes the petition as one PDF of up to 1.5 MB, its
   * attachments under another): a petition is one file and is never cut, so one larger than this is
   * named as a problem. Null when the petition is a file like the others.
   */
  maxPetitionBytes?: number | null;
  /** The longest name the package gives a file, extension included. */
  nameMaxLength?: number;
}

export type FilingProblemCode =
  /** The system takes PDFs: a photo is made a PDF before it enters a package. */
  | "not_a_pdf"
  /**
   * A page that alone is larger than the limit, even with its images compressed again: cutting pages
   * cannot make it fit. Said by who cuts the file, after trying; never assumed from its size here.
   */
  | "page_too_large"
  /** Empty, of unknown size, or a PDF that could not be opened (protected by a password, or damaged). */
  | "unreadable"
  /** A petition larger than the limit the system gives a petition: it is never cut, so it is made smaller or typed in the system. */
  | "petition_too_large";

export interface FilingProblem {
  key: string;
  code: FilingProblemCode;
}

export interface FilingItem {
  key: string;
  /** Its place among the documents of the package, from 1: the order the lawyer attaches them in. */
  position: number;
  kind: FilingKind;
  /** The name without what a split adds: `02-procuracao-maria-souza`. */
  stem: string;
  /**
   * True when the file is larger than the limit: the caller cuts it and names the parts with
   * `partName`. A file of one page is marked too: the caller compresses its images again, and names
   * it as a problem only if that does not make it fit.
   */
  split: boolean;
}

export type FilingBlock = "no_petition" | "two_petitions" | "problems";

export interface FilingPlan {
  items: FilingItem[];
  problems: FilingProblem[];
  /** True when the package may be built: one petition leads it and nothing in it has a problem. */
  ready: boolean;
  /** Why not, when it is not. */
  blockedBy: FilingBlock | null;
}

const DEFAULT_NAME_LENGTH = 80;
/** What a split and the extension may add to a stem: "-parte-10-de-12.pdf". */
const NAME_TAIL = 20;

/** A piece of a file name: lower case, no accents (an ordinal sign becomes its letter), words joined by hyphens. */
export function nameSlug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const filingKindOf = (kind: string): FilingKind =>
  (FILING_ORDER as readonly string[]).includes(kind) ? (kind as FilingKind) : "other";

const two = (value: number): string => String(value).padStart(2, "0");

/** The name of a file of the package, or of one of its parts: `03-bilhete-parte-1-de-2.pdf`. */
export function partName(stem: string, part: number, parts: number): string {
  return parts > 1 ? `${stem}-parte-${part}-de-${parts}.pdf` : `${stem}.pdf`;
}

/**
 * Plans the package: the petition first, then each kind in the order above,
 * the files of one kind by the person they belong to and then as they were
 * given. Two files never share a name, and every name is plain: lower case,
 * no accent, no space, so no court system has a reason to refuse it.
 */
export function planFiling(sources: readonly FilingSource[], limits: FilingLimits): FilingPlan {
  const problems: FilingProblem[] = [];
  const usable: (FilingSource & { order: number; given: number })[] = [];
  // A petition under a limit of its own is never cut: it is measured whole against the smaller of its own
  // limit and the system's limit of a file, which every file of a package keeps.
  const ownLimit = limits.maxPetitionBytes ?? null;
  const petitionLimit =
    ownLimit === null ? null : limits.maxFileBytes === null ? ownLimit : Math.min(ownLimit, limits.maxFileBytes);
  sources.forEach((source, given) => {
    const order = FILING_ORDER.indexOf(filingKindOf(source.kind));
    if (!Number.isFinite(source.bytes) || source.bytes <= 0) {
      problems.push({ key: source.key, code: "unreadable" });
    } else if (source.mime !== "application/pdf") {
      problems.push({ key: source.key, code: "not_a_pdf" });
    } else if (source.pages === null || source.pages <= 0) {
      // A PDF whose pages could not be counted was not opened: protected by a password, or damaged.
      // A court's system refuses it, and it cannot be cut: it is named instead of going as it is.
      problems.push({ key: source.key, code: "unreadable" });
    } else if (petitionLimit !== null && order === 0 && source.bytes > petitionLimit) {
      problems.push({ key: source.key, code: "petition_too_large" });
    } else {
      usable.push({ ...source, order, given });
    }
  });

  usable.sort(
    (a, b) =>
      a.order - b.order || nameSlug(a.person ?? "").localeCompare(nameSlug(b.person ?? "")) || a.given - b.given,
  );

  const room = Math.max((limits.nameMaxLength ?? DEFAULT_NAME_LENGTH) - 3 - NAME_TAIL, 12);
  const taken = new Set<string>();
  const items: FilingItem[] = usable.map((source, index) => {
    const position = index + 1;
    const words = [nameSlug(source.label) || nameSlug(source.kind) || "documento", nameSlug(source.person ?? "")]
      .filter(Boolean)
      .join("-")
      .slice(0, room)
      .replace(/-+$/, "");
    let stem = `${two(position)}-${words}`;
    // The position already tells two files apart; this keeps the names apart even if a system drops it.
    for (let again = 2; taken.has(stem); again += 1) stem = `${two(position)}-${words}-${again}`;
    taken.add(stem);
    return {
      key: source.key,
      position,
      kind: filingKindOf(source.kind),
      stem,
      // A petition under a limit of its own goes whole: it was measured against that limit above.
      split:
        limits.maxFileBytes !== null &&
        source.bytes > limits.maxFileBytes &&
        !(petitionLimit !== null && source.order === 0),
    };
  });

  const petitions = sources.filter((source) => filingKindOf(source.kind) === "petition").length;
  const blockedBy: FilingBlock | null =
    petitions === 0 ? "no_petition" : petitions > 1 ? "two_petitions" : problems.length > 0 ? "problems" : null;
  return { items, problems, ready: blockedBy === null, blockedBy };
}

/**
 * What the lawyer has at hand and does, in the order of a filing. The same
 * for every court system: what each one calls its screens is the system's
 * own, and what a system adds (its authenticator, its signer) is the
 * station check of the lawyer who files.
 */
export const FILING_STEPS = ["access", "forum", "parties", "value", "files", "sign", "receipt"] as const;
export type FilingStep = (typeof FILING_STEPS)[number];
