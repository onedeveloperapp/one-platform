/**
 * The lawyer's signature in the cloud, as the screens read it (migration
 * 0041, `@flyee/psc`): how long an authorization may last, what each answer
 * of the PSC's return and of a use means to the lawyer, and how an
 * authorization stands. Pure: no rule here decides anything the database
 * does not decide again.
 */

/**
 * How long the lawyer may authorize ONE for, in hours: the choices SerproID
 * offers a person (1 hour to 7 days; the norm's ceiling for a natural person
 * is 7 days). The PSC may give less, and its answer is what counts.
 */
export const SIGNATURE_HOURS = [1, 8, 24, 72, 168] as const;
export type SignatureHours = (typeof SIGNATURE_HOURS)[number];
export const DEFAULT_SIGNATURE_HOURS: SignatureHours = 168;

export const isSignatureHours = (value: unknown): value is SignatureHours =>
  typeof value === "number" && (SIGNATURE_HOURS as readonly number[]).includes(value);

/** The words of each choice (`product` namespace). */
export const SIGNATURE_HOURS_KEY: Record<SignatureHours, string> = {
  1: "psc-hours-1",
  8: "psc-hours-8",
  24: "psc-hours-24",
  72: "psc-hours-72",
  168: "psc-hours-168",
};

/** What the PSC's return said, carried in the address back to the team's screen. */
export const SIGNATURE_OUTCOMES = [
  "autorizada",
  "recusada",
  "expirada",
  "sem-certificado",
  "certificado-vencido",
  "nao-pessoal",
  "outro-titular",
  "sem-sessao",
  "teste-falhou",
  "teste-pendente",
  "erro",
] as const;
export type SignatureOutcome = (typeof SIGNATURE_OUTCOMES)[number];

export const isSignatureOutcome = (value: unknown): value is SignatureOutcome =>
  typeof value === "string" && (SIGNATURE_OUTCOMES as readonly string[]).includes(value);

export const SIGNATURE_OUTCOME_KEY: Record<SignatureOutcome, string> = {
  autorizada: "psc-outcome-authorized",
  recusada: "psc-outcome-denied",
  expirada: "psc-outcome-expired",
  "sem-certificado": "psc-outcome-no-certificate",
  "certificado-vencido": "psc-outcome-certificate-expired",
  "nao-pessoal": "psc-outcome-not-personal",
  "outro-titular": "psc-outcome-other-holder",
  "sem-sessao": "psc-outcome-no-session",
  "teste-falhou": "psc-outcome-check-failed",
  "teste-pendente": "psc-outcome-check-pending",
  erro: "psc-outcome-error",
};

/** What a use was for, in the lawyer's words. */
export const USE_PURPOSE_KEY: Record<string, string> = {
  "authorization.check": "psc-use-check",
  "filing.package": "psc-use-filing",
};

/**
 * Why a use or an authorization failed, by the code the backend records
 * (never the PSC's words), in the lawyer's words; anything else is said as a
 * failure with no more detail.
 */
const ERROR_KEY: Record<string, string> = {
  session_ended: "psc-error-session-ended",
  token_used: "psc-error-session-ended",
  denied: "psc-error-denied",
  psc_refused: "psc-error-refused",
  psc_unavailable: "psc-error-unavailable",
  platform_not_authorized: "psc-error-platform",
  psc_not_configured: "psc-error-platform",
  no_certificate: "psc-error-no-certificate",
  certificate_expired: "psc-error-certificate-expired",
  certificate_changed: "psc-error-certificate-changed",
  signature_invalid: "psc-error-signature-invalid",
  psc_moved: "psc-error-psc-moved",
  ended_meanwhile: "psc-error-ended-meanwhile",
};

export const signatureErrorKey = (code: string | null): string => (code && ERROR_KEY[code]) || "psc-error-failed";

/** Whether a code has words of its own: one that has none is said as a failure, and only once. */
export const signatureErrorSaid = (code: string | null): boolean => Boolean(code && ERROR_KEY[code]);

/** How an authorization stands, for its chip. */
export type AuthorizationState = "active" | "failing" | "pending" | "ended";

export function authorizationState(status: string, expiresAt: string | null, now: number): AuthorizationState {
  if (status === "pending") return "pending";
  if ((status === "connected" || status === "error") && expiresAt && Date.parse(expiresAt) > now) {
    return status === "error" ? "failing" : "active";
  }
  return "ended";
}

/**
 * The CPF shown only by its middle, as the dossier shows one
 * (***.456.789-**), from the six middle digits the authorization keeps.
 */
export const cpfMiddleLabel = (middle: unknown): string | null =>
  typeof middle === "string" && /^[0-9]{6}$/.test(middle) ? `***.${middle.slice(0, 3)}.${middle.slice(3)}-**` : null;

/** What an action of the card answered, in the lawyer's words (`product` namespace). */
const ACTION_ERROR_KEY: Record<string, string> = {
  second_factor_required: "team-error-second-factor",
  not_allowed_in_support_session: "psc-action-support-session",
  not_authorized: "team-error-not-authorized",
  not_a_lawyer: "psc-action-not-lawyer",
  unknown_psc: "psc-action-unavailable",
  psc_not_configured: "psc-action-unavailable",
  vault_not_configured: "psc-action-vault",
  not_found: "psc-action-not-found",
  cpf_required: "psc-action-cpf-required",
  invalid_cpf: "psc-action-invalid-cpf",
  cpf_taken: "psc-action-cpf-taken",
  end_first: "psc-action-end-first",
};

export const signatureActionErrorKey = (code: string): string => ACTION_ERROR_KEY[code] ?? "psc-action-failed";
