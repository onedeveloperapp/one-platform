import { type Keyring, openSecret, sealSecret, VaultOpenError } from "@flyee/connectors/crypto";
import type { ReadAnswer, SealedPlace, SecretPayload, StoredConnection, VaultStore } from "@flyee/connectors/types";

/**
 * The vault of the firms' vendor tokens: what the backend does to seal a
 * token, open it for a piece of work, report how the work went, and reseal
 * everything under a new key.
 *
 * The store holds only sealed tokens and the vault holds only the keys:
 * neither alone can read a token. Every open goes through the store's read,
 * which records what it was for, so a caller opens once per batch of work and
 * keeps the token in memory for that batch only.
 */

/**
 * True when a name says it holds a lawyer's own credential: a password, a
 * PIN, a one-time code or its seed, a certificate or a private key. The same
 * rule as `is_credential_name` in migration 0017: camelCase is split first,
 * and a word that merely contains one of these is not one.
 */
export function isCredentialName(name: string): boolean {
  const normal = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return /(^|[^a-z0-9])(senha|password|passwd|passphrase|pin|otp|totp|mfa|2fa|seed|certificado|certificate|cert|pfx|p12|pkcs12|private_?key|chave_?privada)([^a-z0-9]|$)/.test(
    normal,
  );
}

/** True when any key of the value, at any depth, is a credential name. */
export function hasCredentialKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => hasCredentialKey(item));
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).some(([key, item]) => isCredentialName(key) || hasCredentialKey(item));
}

const FIELD_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_FIELDS = 16;
const MAX_PAYLOAD_BYTES = 16_000;
const PURPOSE = /^[a-z][a-z0-9_.-]{2,63}$/;

/** Why a token is refused before anything is sealed, or null when it may be sealed. */
export function checkPayload(payload: SecretPayload): string | null {
  const entries = Object.entries(payload ?? {});
  if (entries.length === 0) return "empty";
  if (entries.length > MAX_FIELDS) return "too_many_fields";
  for (const [key, value] of entries) {
    // First: a lawyer's credential is named as such, whatever its spelling.
    if (isCredentialName(key)) return "credential_field";
    if (!FIELD_NAME.test(key)) return "invalid_field_name";
    if (typeof value !== "string" || value.length === 0) return "invalid_value";
  }
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_PAYLOAD_BYTES) return "too_large";
  return null;
}

export type SealResult = { kind: "sealed"; replaced: boolean } | { kind: "refused"; code: string };

export type OpenResult =
  | { kind: "opened"; payload: SecretPayload; connection: StoredConnection & { connectionId: string } }
  | { kind: "refused"; code: string };

export type RewrapReport = { rewrapped: number; skipped: number; failed: { connectionId: string; code: string }[] };

export class Vault {
  private readonly store: VaultStore;
  private readonly keyring: Keyring;

  constructor(store: VaultStore, keyring: Keyring) {
    this.store = store;
    this.keyring = keyring;
  }

  /** The key version that seals now. */
  get currentKeyVersion(): number {
    return this.keyring.current;
  }

  /**
   * Seals the token of a connection a person started (`begin_connection`),
   * or replaces it. The place comes from that start: the firm and the
   * connection it returned.
   */
  async seal(
    where: SealedPlace,
    payload: SecretPayload,
    options: { expiresAt?: Date | string | null; metadata?: Record<string, unknown> | null } = {},
  ): Promise<SealResult> {
    const problem = checkPayload(payload);
    if (problem) return { kind: "refused", code: problem };
    if (options.metadata && hasCredentialKey(options.metadata)) return { kind: "refused", code: "invalid_metadata" };

    const expiresAt = options.expiresAt instanceof Date ? options.expiresAt.toISOString() : (options.expiresAt ?? null);
    const answer = await this.store.store({
      place: where,
      envelope: sealSecret(this.keyring, payload, where),
      expiresAt,
      metadata: options.metadata ?? null,
    });
    return answer.ok
      ? { kind: "sealed", replaced: answer.code === "replaced" }
      : { kind: "refused", code: answer.code };
  }

  /**
   * Opens the token of a connection of a firm for one piece of work.
   * `purpose` is recorded with the read (`whatsapp.send`). A connection that
   * is cut, that expired, that has no token or that belongs to another firm
   * gives a refusal, never an exception.
   */
  async open(where: SealedPlace, purpose: string): Promise<OpenResult> {
    if (!PURPOSE.test(purpose)) return { kind: "refused", code: "invalid_purpose" };
    return this.openAnswer(where, await this.store.read(where, purpose));
  }

  /**
   * Opens what another audited door of the store read: a lawyer's
   * authorization at their cloud certificate's provider is read by a function
   * of its own, for one use declared first (migration 0041), never by the
   * store's general read. The seal is bound to its firm and connection as
   * always, so an answer for any other place does not open.
   */
  openAnswer(where: SealedPlace, answer: ReadAnswer): OpenResult {
    if (!answer.ok) return { kind: "refused", code: answer.code };
    try {
      const payload = openSecret(this.keyring, answer.envelope, where);
      const connection = {
        connectionId: where.connectionId,
        orgId: answer.orgId,
        provider: answer.provider,
        externalId: answer.externalId,
        status: answer.status,
        expiresAt: answer.expiresAt,
      };
      return { kind: "opened", payload, connection };
    } catch (error) {
      if (error instanceof VaultOpenError) return { kind: "refused", code: error.code };
      throw error;
    }
  }

  /** How the work with a connection went. A failure is a short code (`token_revoked`), never the vendor's message. */
  report(where: SealedPlace, ok: boolean, errorCode?: string | null): Promise<void> {
    return this.store.reportStatus(where, ok, errorCode ?? null);
  }

  /**
   * Reseals, under the newest key, the tokens an older key sealed: a batch
   * per call, so a job repeats it until nothing is pending. A token that can
   * no longer be read (cut or expired meanwhile) is skipped; one sealed by a
   * key no longer listed is reported, because nothing but that key opens it.
   */
  async rewrap(limit = 100): Promise<RewrapReport> {
    const report: RewrapReport = { rewrapped: 0, skipped: 0, failed: [] };
    const pending = await this.store.rewrapPending(this.keyring.current, limit);
    for (const where of pending) {
      const { connectionId } = where;
      const answer = await this.store.read(where, "vault.rotation");
      if (!answer.ok) {
        report.skipped += 1;
        continue;
      }
      let payload: SecretPayload;
      try {
        payload = openSecret(this.keyring, answer.envelope, where);
      } catch (error) {
        if (!(error instanceof VaultOpenError)) throw error;
        report.failed.push({ connectionId, code: error.code });
        continue;
      }
      const done = await this.store.rewrap({
        place: where,
        fromVersion: answer.envelope.keyVersion,
        envelope: sealSecret(this.keyring, payload, where),
      });
      if (done) report.rewrapped += 1;
      else report.skipped += 1;
    }
    return report;
  }
}
