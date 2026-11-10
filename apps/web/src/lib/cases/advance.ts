import type { AccountState } from "@/lib/cases/account";
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
  "residence_relation_missing",
  "residence_address_conflict",
  "residence_declaration_unsigned",
  "free_justice_unanswered",
  "free_justice_unsigned",
  "client_confirmation",
  "account_missing",
  "account_preparing",
  "account_proposed",
  "account_incomplete",
  "account_contested",
  "account_failed",
  "unavailable",
  "step_failed",
  "stuck",
] as const;
export type AdvanceWaiting = (typeof ADVANCE_WAITING)[number];

/**
 * Who a wait of ONE is with (the owner's audit of the case screen, 2026-11-05): the client (on their link or in
 * the conversation), the firm (and who of it acts: anybody, a lawyer, who decides for the firm, or who approves the
 * court's system), ONE itself (its own work, or a try again it makes by itself) or the platform (a fact only the
 * operator of ONE puts right, and the firm cannot). The case screen, the center of what waits and the home read
 * this one table, so a wait is never the client's in one place and the firm's in another.
 */
export type WaitOwner = "client" | "firm" | "one" | "platform";
export type WaitActor = "anyone" | "lawyer" | "partner" | "deciders";
export type WaitPlace = {
  owner: WaitOwner;
  /** Who of the firm acts on it; null for a wait that is not the firm's. */
  actor: WaitActor | null;
  /** The card of the case where it is put right (`CaseSection`), or null for a place out of the case. */
  section: string | null;
};

const CLIENT = (section: string): WaitPlace => ({ owner: "client", actor: null, section });
const FIRM = (actor: WaitActor, section: string | null): WaitPlace => ({ owner: "firm", actor, section });
const ONE = (section: string | null): WaitPlace => ({ owner: "one", actor: null, section });
const PLATFORM = (section: string): WaitPlace => ({ owner: "platform", actor: null, section });

export const WAIT_PLACE: Record<AdvanceWaiting, WaitPlace> = {
  case_incomplete: CLIENT("people"),
  claims_missing: FIRM("partner", "rules"),
  ceiling_unknown: PLATFORM("rules"),
  domicile_unknown: FIRM("anyone", "people"),
  no_claimants: FIRM("anyone", "people"),
  court_unknown: FIRM("lawyer", "proceedings"),
  no_signer: FIRM("partner", null),
  signers_removed: FIRM("lawyer", "proceedings"),
  no_model: FIRM("lawyer", null),
  documents_waiting: FIRM("anyone", "documents"),
  system_unknown: PLATFORM("proceedings"),
  system_unapproved: FIRM("deciders", "proceedings"),
  system_refused: PLATFORM("proceedings"),
  held: FIRM("lawyer", "rules"),
  suspension_pending: FIRM("lawyer", "rules"),
  family_split_unchosen: FIRM("lawyer", "rules"),
  civil_court_unanswered: CLIENT("rules"),
  too_many_documents: FIRM("anyone", "documents"),
  paper_incomplete: FIRM("anyone", "people"),
  paper_unwritable: FIRM("anyone", "signatures"),
  power_of_attorney_unsigned: CLIENT("signatures"),
  // A bill in somebody else's name (0123): the client says who the holder is and signs; an address of another city
  // waits for a person of the firm, since it decides the forum.
  residence_relation_missing: CLIENT("documents"),
  residence_address_conflict: FIRM("anyone", "people"),
  residence_declaration_unsigned: CLIENT("signatures"),
  // Free justice in the civil court (0125): the client answers on the link, then signs the declaration.
  free_justice_unanswered: CLIENT("rules"),
  free_justice_unsigned: CLIENT("signatures"),
  client_confirmation: CLIENT("link"),
  account_missing: CLIENT("statements"),
  account_preparing: ONE("statements"),
  account_proposed: FIRM("anyone", "statements"),
  account_incomplete: CLIENT("statements"),
  account_contested: ONE("statements"),
  account_failed: FIRM("lawyer", "statements"),
  unavailable: ONE(null),
  step_failed: ONE(null),
  stuck: FIRM("anyone", null),
};

/** Where a wait is put right, and by whom; a refusal the screen has no words of its own for is the firm's. */
export function waitPlaceOf(code: string): WaitPlace {
  return isAdvanceWaiting(code) ? WAIT_PLACE[code] : FIRM("anyone", null);
}

/** What ONE waits for that is the client's to do, not the firm's: the firm is asked to follow it up only once it waited too long. */
export const CLIENT_WAITS: readonly AdvanceWaiting[] = ADVANCE_WAITING.filter(
  (code) => WAIT_PLACE[code].owner === "client",
);
export const isClientWait = (code: string): boolean => waitPlaceOf(code).owner === "client";

/** What ONE waits for that is its own work under way, or a try again it makes by itself: nobody of the firm is asked. */
export const ONE_WORKS: readonly AdvanceWaiting[] = ADVANCE_WAITING.filter((code) => WAIT_PLACE[code].owner === "one");
export const isOneWork = (code: string): boolean => waitPlaceOf(code).owner === "one";

/** What ONE waits for of the client's account (0090): nothing once it is ready. */
const ACCOUNT_WAITING: Record<Exclude<AccountState, "ready">, AdvanceWaiting> = {
  missing: "account_missing",
  preparing: "account_preparing",
  proposed: "account_proposed",
  incomplete: "account_incomplete",
  contested: "account_contested",
  failed: "account_failed",
};

export const accountWaiting = (state: AccountState | null | undefined): AdvanceWaiting | null =>
  !state || state === "ready" ? null : ACCOUNT_WAITING[state];

export const isAdvanceWaiting = (value: unknown): value is AdvanceWaiting =>
  (ADVANCE_WAITING as readonly unknown[]).includes(value);

/**
 * What ONE waits for before it creates a case's lawsuits, or null when the
 * case has what they need: nothing the case screen lists as missing (each
 * person's data, the documents the setting names, a leg of the trip), and
 * somebody who claims, and the client's account of what happened, ordered
 * with nothing the piece needs missing (0090: the piece ONE asks for right
 * after is written from it, and a case with no account had its piece come
 * back full of [COMPLETAR]). The Valor da Causa Pedido of each claimant is
 * never waited for (0064): with none, the lawsuit goes with no value and the
 * judge defines it.
 */
export function lawsuitsWaiting(input: {
  missing: Missing[];
  claims: (number | null)[];
  /** Where the client's account stands (`case_account_state`); not given, it is not waited for. */
  account?: AccountState | null;
  /** A case an agency handed over (0071) whose client has not said on their link that they finished. */
  unconfirmedHandoff?: boolean;
}): AdvanceWaiting | null {
  if (input.missing.length > 0) return "case_incomplete";
  if (input.claims.length === 0) return "no_claimants";
  const account = accountWaiting(input.account);
  if (account) return account;
  // The data came from the agency, not from the client: ONE files nothing the client has not seen.
  if (input.unconfirmedHandoff) return "client_confirmation";
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
  residence_relation_missing: "advance-waiting-residence-relation",
  residence_address_conflict: "advance-waiting-residence-conflict",
  residence_declaration_unsigned: "advance-waiting-residence-unsigned",
  free_justice_unanswered: "advance-waiting-free-justice-unanswered",
  free_justice_unsigned: "advance-waiting-free-justice-unsigned",
  client_confirmation: "advance-waiting-client-confirmation",
  account_missing: "advance-waiting-account-missing",
  account_preparing: "advance-waiting-account-preparing",
  account_proposed: "advance-waiting-account-proposed",
  account_incomplete: "advance-waiting-account-incomplete",
  account_contested: "advance-waiting-account-contested",
  account_failed: "advance-waiting-account-failed",
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
  residence_relation_missing: "advance-tag-documents",
  residence_address_conflict: "advance-tag-documents",
  residence_declaration_unsigned: "advance-tag-paper",
  free_justice_unanswered: "advance-tag-civil",
  free_justice_unsigned: "advance-tag-paper",
  client_confirmation: "advance-tag-client-confirmation",
  account_missing: "advance-tag-account",
  account_preparing: "advance-tag-account",
  account_proposed: "advance-tag-account",
  account_incomplete: "advance-tag-account",
  account_contested: "advance-tag-account",
  account_failed: "advance-tag-account",
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
  // The client's account, its order of the facts and what was asked of it are in "O que aconteceu" (0090).
  if (code.startsWith("account_")) return `/casos/${caseId}#case-statements`;
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
