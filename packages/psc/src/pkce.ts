import { createHash, randomBytes } from "node:crypto";

/**
 * The proof that a code is spent by who asked for it (PKCE, RFC 7636; the
 * norm makes it mandatory): the application keeps a random verifier, sends
 * its SHA-256 as the challenge, and only the verifier exchanges the code.
 */

const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

/** A new verifier: 32 random bytes, 43 characters of base64url (within the 43 to 128 the RFC takes). */
export const newVerifier = (): string => base64url(randomBytes(32));

/** The challenge of a verifier: base64url(SHA-256(verifier)), the method S256. */
export const challengeOf = (verifier: string): string =>
  base64url(createHash("sha256").update(verifier, "ascii").digest());

/** A random state to match the PSC's answer to the request that asked for it. */
export const newState = (): string => base64url(randomBytes(24));
