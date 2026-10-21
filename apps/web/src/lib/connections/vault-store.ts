import "server-only";

import type { Envelope, ReadAnswer, SealedPlace, StoreAnswer, VaultStore } from "@flyee/connectors/types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The vault's store over the database (migration 0017_connections): the vault
 * functions, called with the service role, which cannot read the table of
 * sealed tokens itself. Every read goes through `vault_read_secret`, which
 * records its purpose in the audit trail. The store never sees a token in the
 * clear: it carries sealed envelopes only.
 */

type ReadRow = {
  ok?: boolean;
  code?: string;
  org_id?: string;
  provider?: string;
  external_id?: string | null;
  status?: string;
  expires_at?: string | null;
  envelope?: { key_version?: number; iv?: string; ciphertext?: string; tag?: string };
};

const toEnvelope = (row: ReadRow["envelope"]): Envelope | null =>
  row && typeof row.key_version === "number" && row.iv && row.ciphertext && row.tag
    ? { keyVersion: row.key_version, iv: row.iv, ciphertext: row.ciphertext, tag: row.tag }
    : null;

export function supabaseVaultStore(service: SupabaseClient): VaultStore {
  return {
    async store(input): Promise<StoreAnswer> {
      const { data, error } = await service.rpc("vault_store_secret", {
        target_org: input.place.orgId,
        target_connection: input.place.connectionId,
        target_key_version: input.envelope.keyVersion,
        target_iv: input.envelope.iv,
        target_ciphertext: input.envelope.ciphertext,
        target_tag: input.envelope.tag,
        target_expires_at: input.expiresAt ?? null,
        target_metadata: input.metadata ?? null,
      });
      if (error) throw new Error(`vault_store_secret failed: ${error.message}`);
      const answer = (data ?? {}) as { ok?: boolean; code?: string };
      if (answer.ok && (answer.code === "stored" || answer.code === "replaced")) return { ok: true, code: answer.code };
      return { ok: false, code: answer.code ?? "refused" };
    },

    async read(place, purpose): Promise<ReadAnswer> {
      const { data, error } = await service.rpc("vault_read_secret", {
        target_org: place.orgId,
        target_connection: place.connectionId,
        target_purpose: purpose,
      });
      if (error) throw new Error(`vault_read_secret failed: ${error.message}`);
      const row = (data ?? {}) as ReadRow;
      if (!row.ok) return { ok: false, code: row.code ?? "refused" };
      const envelope = toEnvelope(row.envelope);
      // An answer for another firm than the one asked for is never passed on.
      if (
        !envelope ||
        row.org_id !== place.orgId ||
        !row.provider ||
        (row.status !== "connected" && row.status !== "error")
      ) {
        return { ok: false, code: "invalid_answer" };
      }
      return {
        ok: true,
        orgId: row.org_id,
        provider: row.provider,
        externalId: row.external_id ?? null,
        status: row.status,
        expiresAt: row.expires_at ?? null,
        envelope,
      };
    },

    async reportStatus(place, ok, errorCode): Promise<void> {
      const { error } = await service.rpc("vault_report_status", {
        target_org: place.orgId,
        target_connection: place.connectionId,
        target_ok: ok,
        target_error_code: errorCode ?? null,
      });
      if (error) throw new Error(`vault_report_status failed: ${error.message}`);
    },

    async rewrapPending(keyVersion, limit): Promise<SealedPlace[]> {
      const { data, error } = await service.rpc("vault_rewrap_pending", {
        target_key_version: keyVersion,
        target_limit: limit,
      });
      if (error) throw new Error(`vault_rewrap_pending failed: ${error.message}`);
      const rows = Array.isArray(data) ? (data as { org_id?: string; connection_id?: string }[]) : [];
      return rows.flatMap((row) =>
        row.org_id && row.connection_id ? [{ orgId: row.org_id, connectionId: row.connection_id }] : [],
      );
    },

    async rewrap(input): Promise<boolean> {
      const { data, error } = await service.rpc("vault_rewrap_secret", {
        target_org: input.place.orgId,
        target_connection: input.place.connectionId,
        target_from_version: input.fromVersion,
        target_key_version: input.envelope.keyVersion,
        target_iv: input.envelope.iv,
        target_ciphertext: input.envelope.ciphertext,
        target_tag: input.envelope.tag,
      });
      if (error) throw new Error(`vault_rewrap_secret failed: ${error.message}`);
      return Boolean((data as { ok?: boolean } | null)?.ok);
    },
  };
}
