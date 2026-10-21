import type { Missing } from "@/lib/cases/cases";

/**
 * What ONE does by itself to carry a case on (migration 0039), where the
 * firm lets it: it creates the lawsuits the rules plan once the case has
 * what they need, asks the AI for the first text of each piece, and asks for
 * the filing package once the piece became the petition. Pure: whether a
 * case has what its lawsuits need, and what ONE waits for, in the screen's
 * words (`product` namespace).
 */

/** What ONE may wait for to go on, as the worker records it (`case_advances.waiting`). */
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
  "held",
  "suspension_pending",
  "family_split_unchosen",
  "civil_court_unanswered",
  "too_many_documents",
  "unavailable",
  "step_failed",
  "stuck",
] as const;
export type AdvanceWaiting = (typeof ADVANCE_WAITING)[number];

export const isAdvanceWaiting = (value: unknown): value is AdvanceWaiting =>
  (ADVANCE_WAITING as readonly unknown[]).includes(value);

/**
 * What ONE waits for before it creates a case's lawsuits, or null when the
 * case has what they need: nothing the case screen lists as missing (each
 * person's data, the documents the setting names, a leg of the trip), and
 * what each claimant asks, which the value of the cause is made of.
 */
export function lawsuitsWaiting(input: { missing: Missing[]; claims: (number | null)[] }): AdvanceWaiting | null {
  if (input.missing.length > 0) return "case_incomplete";
  if (input.claims.length === 0) return "no_claimants";
  if (input.claims.some((cents) => cents === null || !(cents > 0))) return "claims_missing";
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
  held: "advance-waiting-held",
  suspension_pending: "advance-waiting-suspension-pending",
  family_split_unchosen: "advance-waiting-family-split",
  civil_court_unanswered: "advance-waiting-civil-court",
  too_many_documents: "advance-waiting-too-many-documents",
  unavailable: "advance-waiting-unavailable",
  step_failed: "advance-waiting-step-failed",
  stuck: "advance-waiting-stuck",
};

/** The words of what ONE waits for; a refusal the screen has no words of its own for is said as one. */
export function waitingKey(code: string): string {
  return isAdvanceWaiting(code) ? WAITING_KEY[code] : "advance-waiting-refused";
}

/** Where the firm puts right what ONE waits for, when it is not on the case itself. */
export function waitingFix(code: string): { href: string; key: string } | null {
  if (code === "no_signer") return { href: "/settings/autonomia#quem-assina", key: "advance-fix-signer" };
  if (code === "no_model") return { href: "/biblioteca", key: "advance-fix-model" };
  return null;
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
