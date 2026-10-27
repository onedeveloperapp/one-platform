import type { Missing } from "@/lib/cases/cases";

/**
 * What ONE does by itself to carry a case on (migration 0039), where the
 * firm lets it: it creates the lawsuits the rules plan once the case has
 * what they need, asks the AI for the first text of each piece, and asks for
 * the filing package once the piece became the petition. Pure: whether a
 * case has what its lawsuits need, and what ONE waits for, in the screen's
 * words (`product` namespace).
 */

/**
 * What ONE may wait for to go on, as the worker records it (`case_advances.waiting`). `claims_missing` is no
 * longer written (0064: a claimant with no Valor da Causa Pedido goes with no value, for the judge to define);
 * its words stay for a record written before.
 */
export const ADVANCE_WAITING = [
  "case_incomplete",
  "claims_missing",
  "ceiling_unknown",
  "domicile_unknown",
  "no_claimants",
  "court_unknown",
  "no_signer",
  "signers_removed",
  "no_model",
  "documents_waiting",
  "system_unknown",
  "system_unapproved",
  "system_refused",
  "held",
  "suspension_pending",
  "family_split_unchosen",
  "civil_court_unanswered",
  "too_many_documents",
  "paper_incomplete",
  "paper_unwritable",
  "power_of_attorney_unsigned",
  "unavailable",
  "step_failed",
  "stuck",
] as const;
export type AdvanceWaiting = (typeof ADVANCE_WAITING)[number];

/**
 * What ONE waits for that is the client's to do, not the firm's (0054): the firm is asked to act only once it
 * waited longer than the setting's days, to follow the client up.
 */
export const CLIENT_WAITS: readonly AdvanceWaiting[] = ["power_of_attorney_unsigned"];

export const isClientWait = (code: string): boolean => (CLIENT_WAITS as readonly string[]).includes(code);

export const isAdvanceWaiting = (value: unknown): value is AdvanceWaiting =>
  (ADVANCE_WAITING as readonly unknown[]).includes(value);

/**
 * What ONE waits for before it creates a case's lawsuits, or null when the
 * case has what they need: nothing the case screen lists as missing (each
 * person's data, the documents the setting names, a leg of the trip), and
 * somebody who claims. The Valor da Causa Pedido of each claimant is never
 * waited for (0064): with none, the lawsuit goes with no value and the
 * judge defines it.
 */
export function lawsuitsWaiting(input: { missing: Missing[]; claims: (number | null)[] }): AdvanceWaiting | null {
  if (input.missing.length > 0) return "case_incomplete";
  if (input.claims.length === 0) return "no_claimants";
  return null;
}

const WAITING_KEY: Record<AdvanceWaiting, string> = {
  case_incomplete: "advance-waiting-case-incomplete",
  claims_missing: "advance-waiting-claims-missing",
  ceiling_unknown: "advance-waiting-ceiling-unknown",
  domicile_unknown: "advance-waiting-domicile-unknown",
  no_claimants: "advance-waiting-no-claimants",
  court_unknown: "advance-waiting-court-unknown",
  no_signer: "advance-waiting-no-signer",
  signers_removed: "advance-waiting-signers-removed",
  no_model: "advance-waiting-no-model",
  documents_waiting: "advance-waiting-documents-waiting",
  system_unknown: "advance-waiting-system-unknown",
  system_unapproved: "advance-waiting-system-unapproved",
  system_refused: "advance-waiting-system-refused",
  held: "advance-waiting-held",
  suspension_pending: "advance-waiting-suspension-pending",
  family_split_unchosen: "advance-waiting-family-split",
  civil_court_unanswered: "advance-waiting-civil-court",
  too_many_documents: "advance-waiting-too-many-documents",
  paper_incomplete: "advance-waiting-paper-incomplete",
  paper_unwritable: "advance-waiting-paper-unwritable",
  power_of_attorney_unsigned: "advance-waiting-power-of-attorney",
  unavailable: "advance-waiting-unavailable",
  step_failed: "advance-waiting-step-failed",
  stuck: "advance-waiting-stuck",
};

/** What ONE waits for, in a word or two: how a person tells at a glance what a case needs of the firm. */
const WAITING_TAG_KEY: Record<AdvanceWaiting, string> = {
  case_incomplete: "advance-tag-case-incomplete",
  claims_missing: "advance-tag-claims",
  ceiling_unknown: "advance-tag-ceiling",
  domicile_unknown: "advance-tag-domicile",
  no_claimants: "advance-tag-claimants",
  court_unknown: "advance-tag-court",
  no_signer: "advance-tag-signer",
  signers_removed: "advance-tag-signer",
  no_model: "advance-tag-model",
  documents_waiting: "advance-tag-documents",
  system_unknown: "advance-tag-system",
  system_unapproved: "advance-tag-system",
  system_refused: "advance-tag-system",
  held: "advance-tag-held",
  suspension_pending: "advance-tag-suspension",
  family_split_unchosen: "advance-tag-family",
  civil_court_unanswered: "advance-tag-civil",
  too_many_documents: "advance-tag-documents",
  paper_incomplete: "advance-tag-paper",
  paper_unwritable: "advance-tag-paper",
  power_of_attorney_unsigned: "advance-tag-paper",
  unavailable: "advance-tag-error",
  step_failed: "advance-tag-error",
  stuck: "advance-tag-error",
};

/** The tag of what ONE waits for; a refusal the screen has no words of its own for is a step that needs a person. */
export function waitingTagKey(code: string): string {
  return isAdvanceWaiting(code) ? WAITING_TAG_KEY[code] : "advance-tag-error";
}

/** The words of what ONE waits for; a refusal the screen has no words of its own for is said as one. */
export function waitingKey(code: string): string {
  return isAdvanceWaiting(code) ? WAITING_KEY[code] : "advance-waiting-refused";
}

/** Where the firm puts right what ONE waits for, when it is not on the case itself. */
export function waitingFix(code: string): { href: string; key: string } | null {
  if (code === "no_signer") return { href: "/settings/autonomia#quem-assina", key: "advance-fix-signer" };
  if (code === "no_model") return { href: "/biblioteca", key: "advance-fix-model" };
  if (code === "claims_missing") {
    return { href: "/settings/autonomia#valor-da-causa-pedido", key: "advance-fix-claim-default" };
  }
  return null;
}

/**
 * Where a person goes to put right what ONE waits for in a case: the Valor da Causa Pedido of each claimant is
 * written on the case itself (its card of how it goes to court); what is the firm's to say goes to where the firm
 * says it.
 */
export function waitingHref(code: string, caseId: string): string {
  if (code === "claims_missing") return `/casos/${caseId}#como-vai-a-juizo`;
  // The system ONE named for a lawsuit is approved, or not, under that lawsuit (0066).
  if (code === "system_unapproved") return `/casos/${caseId}#case-proceedings`;
  return waitingFix(code)?.href ?? `/casos/${caseId}`;
}

/** The record of a case ONE carries on, as the screen reads it. */
export type CaseAdvance = { waiting: string | null; checkedAt: string | null };

export function caseAdvanceOf(raw: unknown): CaseAdvance | null {
  const row = (raw ?? null) as { waiting?: unknown; checked_at?: unknown } | null;
  if (!row) return null;
  return {
    waiting: typeof row.waiting === "string" && /^[a-z][a-z_]{2,40}$/.test(row.waiting) ? row.waiting : null,
    checkedAt: typeof row.checked_at === "string" ? row.checked_at : null,
  };
}
