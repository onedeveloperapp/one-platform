import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { Envelope, SealedPlace, SecretPayload } from "@flyee/connectors/types";

/**
 * The sealing of the vault: AES-256-GCM with a key that never enters the
 * database. The key lives in the environment (`VAULT_KEYS`), with a version,
 * so it can be rotated: the newest version seals, every listed version opens,
 * and the rotation job reseals what an older version sealed.
 *
 * A seal is bound to its place (the firm and the connection) through the
 * additional authenticated data: the same ciphertext copied under another
 * connection, or another firm, fails to open instead of opening there.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The keys of the vault: the version that seals, and every version that still opens. */
export interface Keyring {
  current: number;
  keys: ReadonlyMap<number, Buffer>;
}

export type KeyringResult =
  | { ok: true; keyring: Keyring }
  | { ok: false; problem: "not_configured" | "malformed"; detail: string };

/**
 * Reads `VAULT_KEYS`: `2:<base64 of 32 bytes>,1:<base64 of 32 bytes>`. The
 * highest version seals. Anything malformed refuses the whole keyring: a
 * vault that half-reads its keys would seal with the wrong one.
 */
export function parseKeyring(raw: string | null | undefined): KeyringResult {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, problem: "not_configured", detail: "VAULT_KEYS is not set" };

  const keys = new Map<number, Buffer>();
  for (const entry of text.split(",")) {
    const match = /^\s*(\d{1,4}):([A-Za-z0-9+/]+={0,2})\s*$/.exec(entry);
    if (!match) return { ok: false, problem: "malformed", detail: "each key is version:base64" };
    const version = Number(match[1]);
    const key = Buffer.from(match[2], "base64");
    if (version < 1) return { ok: false, problem: "malformed", detail: "versions start at 1" };
    if (key.length !== KEY_BYTES) {
      return { ok: false, problem: "malformed", detail: `key ${version} is not ${KEY_BYTES} bytes` };
    }
    if (keys.has(version)) return { ok: false, problem: "malformed", detail: `key ${version} is listed twice` };
    keys.set(version, key);
  }
  return { ok: true, keyring: { current: Math.max(...keys.keys()), keys } };
}

/** A new key for `VAULT_KEYS`, base64: `node -e "…generateKey()"` or any 32 random bytes. */
export const generateKey = (): string => randomBytes(KEY_BYTES).toString("base64");

/** What binds a seal to its place. */
const placeOf = (where: SealedPlace): Buffer => Buffer.from(`one-vault/v1/${where.orgId}/${where.connectionId}`, "utf8");

/** Why a sealed token did not open. */
export type OpenFailure = "unknown_key_version" | "tampered";

export class VaultOpenError extends Error {
  readonly code: OpenFailure;

  constructor(code: OpenFailure) {
    super(`vault: ${code}`);
    this.name = "VaultOpenError";
    this.code = code;
  }
}

/** Seals a token for its place with the newest key, under a fresh nonce. */
export function sealSecret(keyring: Keyring, payload: SecretPayload, where: SealedPlace): Envelope {
  const key = keyring.keys.get(keyring.current);
  if (!key) throw new Error("vault: the current key is missing from the keyring");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(placeOf(where));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return {
    keyVersion: keyring.current,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

/** Opens a sealed token in its place, or throws `VaultOpenError`. Never returns a half-read token. */
export function openSecret(keyring: Keyring, envelope: Envelope, where: SealedPlace): SecretPayload {
  const key = keyring.keys.get(envelope.keyVersion);
  if (!key) throw new VaultOpenError("unknown_key_version");
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, "base64"), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(placeOf(where));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const text = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
    const payload: unknown = JSON.parse(text.toString("utf8"));
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new VaultOpenError("tampered");
    }
    return payload as SecretPayload;
  } catch (error) {
    if (error instanceof VaultOpenError) throw error;
    // A wrong place, a changed byte or a wrong tag all end here, by design
    // indistinguishable: GCM says only that the seal does not hold.
    throw new VaultOpenError("tampered");
  }
}
