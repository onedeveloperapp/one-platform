/**
 * Electronic signature of the documents a firm's CLIENT signs: the power of
 * attorney, the fee agreement, the declarations (docs/ONE-PLANO-DESENVOLVIMENTO.md,
 * 4.6, 6 and 7).
 *
 * This is not the lawyer's signature. A lawyer signs inside the court's own
 * system when filing, with whatever certificate that system takes, and ONE
 * never receives a certificate, a PIN or a password.
 */

/**
 * Where an envelope stands:
 * - `pending`: at least one signature is missing;
 * - `signed`: every signer signed, and the signed PDF can be downloaded;
 * - `refused`: a signer refused. It never becomes signed: a new envelope is made;
 * - `expired`: the deadline passed with a signature missing.
 */
export type EnvelopeStatus = "pending" | "signed" | "refused" | "expired";

/** Who signs. The provider reaches the person by the channel the firm connected (a link, e-mail or WhatsApp). */
export type Signer = { name: string; email?: string; phone?: string };

export type CreateEnvelopeInput = {
  /** The document to sign, as PDF bytes. */
  pdf: Uint8Array;
  /** The document's name as the signer reads it. */
  title: string;
  /** In signing order. At least one. */
  signers: Signer[];
  /** ONE's own reference (the document version of a case). It comes back on every read. */
  externalId: string;
};

export type EnvelopeSigner = {
  name: string;
  /** The address this signer opens to sign. */
  signUrl: string;
  /** When they signed, as an ISO instant; null while they have not. */
  signedAt: string | null;
};

export type Envelope = {
  /** The provider's identifier. */
  id: string;
  externalId: string;
  status: EnvelopeStatus;
  signers: EnvelopeSigner[];
};

export type SignedDocument = {
  pdf: Uint8Array;
  /** SHA-256 of `pdf`, in hex: what the case stores to prove the file was not changed. */
  sha256: string;
  /** One entry per signer, in signing order. */
  evidence: { signerName: string; signedAt: string }[];
};

/** The signed document was asked for while a signature is missing, or after a refusal or the deadline. */
export class EnvelopeNotSignedError extends Error {
  readonly envelopeId: string;
  readonly status: EnvelopeStatus | "unknown";

  constructor(envelopeId: string, status: EnvelopeStatus | "unknown") {
    super(`envelope ${envelopeId} is ${status}, not signed`);
    this.name = "EnvelopeNotSignedError";
    this.envelopeId = envelopeId;
    this.status = status;
  }
}

export interface SignatureProvider {
  readonly name: string;
  /** Opens an envelope and returns it `pending`, with one signing address per signer. */
  createEnvelope(input: CreateEnvelopeInput): Promise<Envelope>;
  /** The envelope as it stands; null when the provider does not know the id. */
  getStatus(envelopeId: string): Promise<Envelope | null>;
  /** The signed PDF and its evidence. Throws `EnvelopeNotSignedError` unless the envelope is `signed`. */
  downloadSigned(envelopeId: string): Promise<SignedDocument>;
}
