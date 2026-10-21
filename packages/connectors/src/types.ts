/**
 * What the vault keeps, and the store it keeps it in.
 *
 * The vault keeps one thing per account of a firm at a vendor: the API token
 * the platform needs to act on that account (and what goes with it, such as an
 * app secret or a refresh token). Never a lawyer's own credential: a password,
 * a PIN, a one-time code or its seed, a certificate or a private key is
 * refused by name before anything is sealed.
 */

/** The fields of a vendor token, all text: `{ access_token: "…" }`. */
export type SecretPayload = Record<string, string>;

/** A token sealed with AES-256-GCM: the key version that sealed it, the nonce, the ciphertext and the tag, base64. */
export interface Envelope {
  keyVersion: number;
  iv: string;
  ciphertext: string;
  tag: string;
}

/**
 * Where a sealed token belongs: the firm and its connection. Every call to the
 * store names both, so work done for one firm cannot reach an account of
 * another by a wrong id, and the seal itself is bound to both: moved anywhere
 * else, it does not open.
 */
export interface SealedPlace {
  orgId: string;
  connectionId: string;
}

export type StoreAnswer = { ok: true; code: "stored" | "replaced" } | { ok: false; code: string };

export interface StoredConnection {
  orgId: string;
  provider: string;
  externalId: string | null;
  status: "connected" | "error";
  expiresAt: string | null;
}

export type ReadAnswer = ({ ok: true; envelope: Envelope } & StoredConnection) | { ok: false; code: string };

/**
 * The store of the vault: in production the vault functions of migration
 * 0017 (the service role, which cannot read the table itself), in tests a
 * fake with the same rules. It never sees a token in the clear.
 */
export interface VaultStore {
  /** Seals the token of a connection a person started. */
  store(input: {
    place: SealedPlace;
    envelope: Envelope;
    expiresAt?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<StoreAnswer>;
  /** The sealed token of a connection, for a purpose that is recorded with the read. */
  read(place: SealedPlace, purpose: string): Promise<ReadAnswer>;
  /** How the last call with the connection went: a failure is a short code. */
  reportStatus(place: SealedPlace, ok: boolean, errorCode?: string | null): Promise<void>;
  /** The connections whose token was sealed by a key older than `keyVersion`. */
  rewrapPending(keyVersion: number, limit: number): Promise<SealedPlace[]>;
  /** Replaces a sealed token with the same token sealed by a newer key, if it is still the one read. */
  rewrap(input: { place: SealedPlace; fromVersion: number; envelope: Envelope }): Promise<boolean>;
}
