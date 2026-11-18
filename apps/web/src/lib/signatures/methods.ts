/**
 * How a document is signed (migration 0023, D4Sign since 0253). Plain, so a client screen, the server and a test read
 * the same words:
 * - `zapsign` and `d4sign`: through the firm's own signature account at that provider. The provider says when it is
 *   signed; nobody of the firm confirms it by hand. A firm keeps one account connected at a time.
 * - `govbr`: the client signs the PDF at gov.br and sends it back on the link; a person of the firm confirms it.
 * - `enotariado`: the act is made at a notary; the firm confirms the signed file.
 */

export const ACCOUNT_METHODS = ["zapsign", "d4sign"] as const;

/** A provider whose account the firm connects. */
export type AccountMethod = (typeof ACCOUNT_METHODS)[number];

export type SignatureMethod = AccountMethod | "govbr" | "enotariado";

/** Whether a method signs through the firm's own account at a provider. */
export const isAccountMethod = (method: unknown): method is AccountMethod =>
  method === "zapsign" || method === "d4sign";

/** The firm's connected signature account, as the case screen shows it. */
export type SignatureAccount = { method: AccountMethod; environment: "production" | "sandbox" };

/** The firm's signature account as `firm_signature_account` answers it (0253), or null when it has none. */
export function signatureAccountOf(value: unknown): SignatureAccount | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { provider?: unknown; environment?: unknown };
  if (!isAccountMethod(row.provider)) return null;
  return { method: row.provider, environment: row.environment === "sandbox" ? "sandbox" : "production" };
}

/** The provider's name as people read it. Never translated: it is the name of a company. */
export const ACCOUNT_NAME: Record<AccountMethod, string> = { zapsign: "ZapSign", d4sign: "D4Sign" };

/** Where a person of the firm opens the provider's own panel, by the environment the account was connected in. */
export function accountPanelUrl(method: AccountMethod, environment: "production" | "sandbox"): string {
  if (method === "d4sign") {
    return environment === "sandbox" ? "https://sandbox.d4sign.com.br" : "https://secure.d4sign.com.br";
  }
  return environment === "sandbox" ? "https://sandbox.app.zapsign.com.br" : "https://app.zapsign.com.br";
}
