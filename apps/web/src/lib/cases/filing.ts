import { FILING_STEPS, type FilingKind, type FilingStep } from "@flyee/courts/filing";

/**
 * The filing package of a lawsuit and its receipt (migration 0027): the pure
 * side the worker, the case, the filing queue and the tests share. The order
 * and the names of a package are the rule of `@flyee/courts/filing`; here
 * are the words of each stored value (`product` namespace) and what a screen
 * derives from them.
 */

export const PACKAGE_STATUSES = ["requested", "ready", "failed", "filed", "cancelled"] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

export const isPackageStatus = (value: unknown): value is PackageStatus =>
  PACKAGE_STATUSES.includes(value as PackageStatus);

export const PACKAGE_STATUS_KEY: Record<PackageStatus, string> = {
  requested: "filing-status-requested",
  ready: "filing-status-ready",
  failed: "filing-status-failed",
  filed: "filing-status-filed",
  cancelled: "filing-status-cancelled",
};

/** Why a document cannot go as it is, or why the package could not be built. */
export const FILING_PROBLEM_KEY: Record<string, string> = {
  not_a_pdf: "filing-problem-not-a-pdf",
  page_too_large: "filing-problem-page-too-large",
  unreadable: "filing-problem-unreadable",
  missing: "filing-problem-missing",
  petition_too_large: "filing-problem-petition-too-large",
};

export const filingProblemKey = (code: string): string => FILING_PROBLEM_KEY[code] ?? "filing-problem-unreadable";

/** Why the whole package failed, when no document is to blame. */
export const FILING_ERROR_KEY: Record<string, string> = {
  no_petition: "filing-error-no-petition",
  two_petitions: "filing-error-no-petition",
  problems: "filing-error-problems",
  abandoned: "filing-error-abandoned",
};

export const filingErrorKey = (code: string | null): string => FILING_ERROR_KEY[code ?? ""] ?? "filing-error-abandoned";

export const FILING_STEP_KEY: Record<FilingStep, string> = {
  access: "filing-step-access",
  forum: "filing-step-forum",
  parties: "filing-step-parties",
  value: "filing-step-value",
  files: "filing-step-files",
  sign: "filing-step-sign",
  receipt: "filing-step-receipt",
};

export { FILING_STEPS };

/**
 * What a court's system calls its own steps, where it differs from the
 * plain words of a step: how a person gets in (its login and its second
 * factor), how the files go (the type of each in eproc, the type and the
 * description of each in PJe) and how the filing is signed (the login of
 * eproc, the certificate through the PJe's signer). Read in the manuals of
 * the courts (TJSP's eproc for lawyers, 2025; TJMG's and TJCE's PJe) and in
 * the matrix of the plan for Projudi; closed, court by court, by the test of
 * the filing station.
 */
const SYSTEM_STEP_KEY: Partial<Record<string, Partial<Record<FilingStep, string>>>> = {
  projudi: { access: "filing-step-access-projudi" },
  eproc: {
    access: "filing-step-access-eproc",
    forum: "filing-step-forum-eproc",
    files: "filing-step-files-eproc",
    sign: "filing-step-sign-eproc",
  },
  pje: {
    access: "filing-step-access-pje",
    forum: "filing-step-forum-pje",
    files: "filing-step-files-pje",
    sign: "filing-step-sign-pje",
  },
};

/** The steps a system's own screens fold into another: eproc and the PJe ask the parties and the value with the lawsuit's information. */
const FOLDED_STEPS: Partial<Record<string, readonly FilingStep[]>> = {
  eproc: ["parties", "value"],
  pje: ["parties", "value"],
};

/** The words of a step in a court's system: its own where it has them, the plain ones otherwise. */
export const filingStepKey = (system: string | null, step: FilingStep): string =>
  (system ? SYSTEM_STEP_KEY[system]?.[step] : undefined) ?? FILING_STEP_KEY[step];

/**
 * How the files go to the court's system: signed on its own screens
 * (`court`); already signed by ONE with the cloud certificate of the lawyer
 * who files (`signed`, migration 0042); or signed by the lawyer before they
 * go, in a system that takes each file already signed and where the person
 * holds no `.p7s` of their own (`sign_first`: the Projudi of TJGO takes a
 * `.p7s` per file, made with the signer the lawyer uses there).
 */
export type FilingFiles = "court" | "signed" | "sign_first";

/** The words of the files and of the signature when each file goes already signed. */
const SIGNED_STEP_KEY: Record<Exclude<FilingFiles, "court">, Partial<Record<FilingStep, string>>> = {
  signed: { files: "filing-step-files-signed", sign: "filing-step-sign-signed" },
  sign_first: { files: "filing-step-files-sign-first", sign: "filing-step-sign-sign-first" },
};

/** The words of each step of a filing in a court's system, in order, none said twice. */
export const filingStepsOf = (system: string | null, files: FilingFiles = "court"): string[] =>
  FILING_STEPS.filter((step) => !(system && FOLDED_STEPS[system]?.includes(step))).map(
    (step) => (files === "court" ? undefined : SIGNED_STEP_KEY[files][step]) ?? filingStepKey(system, step),
  );

/** Every word a step may take, for the test that the catalog has them all. */
export const FILING_STEP_KEYS: readonly string[] = [
  ...Object.values(FILING_STEP_KEY),
  ...Object.values(SYSTEM_STEP_KEY).flatMap((steps) => Object.values(steps ?? {})),
  ...Object.values(SIGNED_STEP_KEY).flatMap((steps) => Object.values(steps)),
];

/** The systems whose every file is described in a field of its own when it is attached: what to type there is given. */
export const DESCRIBES_FILES: ReadonlySet<string> = new Set(["pje"]);

/** What a file is, as the field of a system that asks for it reads best: "Procuração de Maria Souza". */
export const fileDescription = (label: string, person: string | null): string =>
  person ? `${label} de ${person}` : label;

/** How many packages the filing queue reads at once, the oldest first. */
export const QUEUE_SHOWN = 200;

/**
 * What each kind of document is called in the name of its file. Plain words,
 * the same for every firm: a file name is read by the court, not by the
 * client, and never carries more than what the document is and whose it is.
 */
export const FILING_LABEL: Record<FilingKind, string> = {
  petition: "Petição inicial",
  power_of_attorney: "Procuração",
  identity: "Documento de identidade",
  address_proof: "Comprovante de endereço",
  residence_declaration: "Declaração de residência",
  residence_link: "Comprovante de vínculo",
  free_justice_declaration: "Declaração de hipossuficiência",
  income_proof: "Comprovante de renda",
  ticket: "Bilhete",
  boarding_pass: "Cartão de embarque",
  baggage_report: "Registro de irregularidade de bagagem",
  receipt: "Comprovante de despesa",
  evidence: "Prova",
  contract: "Contrato",
  defense: "Contestação",
  intermediate_petition: "Petição",
  other: "Documento",
};

/**
 * The documents a package takes by default: every accepted document of the
 * case but the petitions (one is chosen apart) and the contract between the
 * client and the firm, which is theirs and is filed only when a person says so.
 */
export function defaultFilingDocuments(documents: readonly { id: string; kind: string; status: string }[]): string[] {
  return documents
    .filter(
      (document) =>
        document.status === "accepted" &&
        !["petition", "contract", "defense", "intermediate_petition"].includes(document.kind),
    )
    .map((document) => document.id);
}

/**
 * The package of a lawsuit that means something now, of the ones not given
 * up (newest first): for a lawsuit not filed yet, the one in course; for a
 * lawsuit filed, the one filed with its receipt. A package filed once for a
 * lawsuit that went back to planned (the receipt was attached to the wrong
 * lawsuit) is history, and does not stand in the way of another.
 */
export function currentFiling<T extends { proceedingId: string; status: PackageStatus }>(
  filings: readonly T[],
  proceeding: { id: string; status: string },
): T | null {
  const own = filings.filter((filing) => filing.proceedingId === proceeding.id);
  if (proceeding.status === "planned") {
    return own.find((filing) => filing.status !== "filed" && filing.status !== "cancelled") ?? null;
  }
  return own.find((filing) => filing.status === "filed") ?? null;
}

/**
 * True when a package no longer says what its lawsuit is (the database
 * refuses its receipt for the same reasons, `filing_package_outdated`): the
 * lawsuit moved to another court, system or kind since, or one of the
 * documents in it is no longer an accepted document of the case.
 */
export function filingOutdated(
  filing: { court: string; system: string; kind: string; petitionDocumentId: string; documentIds: readonly string[] },
  proceeding: { court: string | null; system: string | null; kind: string },
  documents: readonly { id: string; status: string }[],
): boolean {
  if (proceeding.court !== filing.court || proceeding.system !== filing.system || proceeding.kind !== filing.kind) {
    return true;
  }
  const accepted = new Set(
    documents.filter((document) => document.status === "accepted").map((document) => document.id),
  );
  return [filing.petitionDocumentId, ...filing.documentIds].some((id) => !accepted.has(id));
}

/** A size as a person reads it: "850 KB", "5,2 MB". */
export function sizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

/** A case number as it is typed or pasted, brought to its twenty digits; null when it has another length. */
export function cnjDigits(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  return digits.length === 20 ? digits : null;
}
