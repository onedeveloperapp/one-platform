import "server-only";

import { supabaseVaultStore } from "@/lib/connections/vault-store";
import { createServiceClient } from "@flyee/auth/service";
import { parseKeyring } from "@flyee/connectors/crypto";
import { Vault } from "@flyee/connectors/vault";

/**
 * The vault of the firms' vendor tokens, for the backend: jobs and webhooks
 * that act on a firm's account at a vendor (sending a WhatsApp message,
 * creating a signature envelope). A page never opens a token.
 *
 * The keys come from `VAULT_KEYS` (never from the database), and the store is
 * the service role behind the vault functions. Without either, there is no
 * vault and the caller says so: a connection is never sealed with a missing
 * or half-read key.
 */
export type VaultAccess =
  | { ok: true; vault: Vault }
  | { ok: false; problem: "keys_not_configured" | "keys_malformed" | "backend_not_configured" };

export function getVault(): VaultAccess {
  const parsed = parseKeyring(process.env.VAULT_KEYS);
  if (!parsed.ok)
    return { ok: false, problem: parsed.problem === "malformed" ? "keys_malformed" : "keys_not_configured" };
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, problem: "backend_not_configured" };
  }
  return { ok: true, vault: new Vault(supabaseVaultStore(service), parsed.keyring) };
}
