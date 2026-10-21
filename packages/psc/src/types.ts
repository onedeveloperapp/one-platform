/**
 * A lawyer's ICP-Brasil certificate in the cloud, at a certificate
 * provider the ITI accredited (a PSC: "Prestador de Serviço de Confiança").
 * The holder authorizes an application at the PSC with their own factors (an
 * app, a PIN, a QR code), and the application then asks the PSC to sign
 * hashes with that certificate: the key never leaves the PSC, and the
 * application never collects the holder's factors.
 *
 * Every PSC answers the same core the ITI's DOC-ICP-17.01 (version 3.0,
 * Instrução Normativa ITI nº 20/2020, item 6.4; read on 2026-10-14) sets:
 * `oauth/authorize` with PKCE, `oauth/token`, `oauth/certificate-discovery`
 * and `oauth/signature` over a SHA-256 hash, the signature back as RAW
 * (PKCS#1 v1.5) or as a detached CMS. Its base address is the PSC's, as the
 * ITI's list of PSCs gives it: data, never a constant.
 */

/** What an authorization lets the application do: one signature, several in one call, or any while it lasts. */
export type PscScope = "single_signature" | "multi_signature" | "signature_session";
export const PSC_SCOPES: readonly PscScope[] = ["single_signature", "multi_signature", "signature_session"];

/** What a PSC answered when its work could not be done, by what the caller does next. */
export type PscErrorCode =
  /** The holder said no at the PSC, or closed its page. */
  | "denied"
  /** The code or the token is no longer valid (it lived its time): the holder authorizes again. */
  | "expired"
  /** A token of one signature was used already (the norm forbids a second one). */
  | "token_used"
  /** The PSC refused the request as it was: a hash it does not take, a certificate revoked or expired. */
  | "refused"
  /** The application's own credentials were refused: the platform's to fix, never the holder's. */
  | "not_authorized"
  /** The PSC did not answer, or answered as down: try again later. */
  | "unavailable";

export class PscError extends Error {
  readonly code: PscErrorCode;
  constructor(code: PscErrorCode, message: string) {
    super(message);
    this.name = "PscError";
    this.code = code;
  }
}

/** The holder's page at the PSC: where the application sends them to authorize it. */
export type AuthorizeRequest = {
  clientId: string;
  redirectUri: string;
  /** What comes back with the code, so the answer is matched to the request that asked it. */
  state: string;
  /** base64url(SHA-256(verifier)): the code is worth nothing without the verifier the application kept. */
  codeChallenge: string;
  scope: PscScope;
  /** How long the authorization lasts, in seconds (a session of a natural person: at most 7 days). */
  lifetimeSeconds?: number;
  /** The holder's CPF, digits only: the PSC offers that person's certificates. */
  loginHint?: string;
};

export type TokenRequest = {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
};

/** What the PSC hands back for a code: the token, how long it lives, and whose certificate it reaches. */
export type PscToken = {
  accessToken: string;
  /** Seconds from now. A token of a natural person lives at most 7 days; there is never a refresh. */
  expiresIn: number;
  /** The scope the PSC says it granted, when it says one: the norm has it answered when it is not the one asked. */
  scope: string | null;
  /** Whose authorization it is, as the PSC says it: a CPF (a person) or a CNPJ. */
  identification: { type: "CPF" | "CNPJ"; value: string } | null;
};

/** One certificate the token reaches, in PEM. */
export type PscCertificate = { alias: string; pem: string };

/** A SHA-256 hash to sign, under an id the answer is matched by. */
export type HashToSign = { id: string; hash: Uint8Array };

/** RAW: the PKCS#1 v1.5 signature over the hash. CMS: a detached CMS over it, built by the PSC. */
export type SignatureFormat = "RAW" | "CMS";

export type SignRequest = {
  token: string;
  hashes: HashToSign[];
  format: SignatureFormat;
  /** The certificate to sign with, when the token reaches more than one. */
  certificateAlias?: string;
};

export type PscSignature = { id: string; value: Uint8Array };

export type SignResult = { certificateAlias: string; signatures: PscSignature[] };

/** The contract any PSC client honours: the fake and the client of the ITI's norm. */
export interface PscProvider {
  readonly name: string;
  /** The address of the holder's page at the PSC, where they authorize the application. */
  authorizeUrl(request: AuthorizeRequest): string;
  /** The code the holder's authorization brought back, exchanged for a token. */
  exchangeCode(request: TokenRequest): Promise<PscToken>;
  /** The certificates the token reaches. */
  certificates(token: string): Promise<PscCertificate[]>;
  /** Hashes signed with the holder's certificate: one per hash, by its id. */
  sign(request: SignRequest): Promise<SignResult>;
}

/** The object identifier of SHA-256, as the norm names a hash's algorithm. */
export const SHA256_OID = "2.16.840.1.101.3.4.2.1";

/** The longest a natural person's authorization lives, by the norm: 7 days. */
export const MAX_PERSON_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
