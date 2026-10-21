import { createHash } from "node:crypto";

import {
  type CreateEnvelopeInput,
  type Envelope,
  EnvelopeNotSignedError,
  type EnvelopeStatus,
  type SignatureProvider,
  type SignedDocument,
} from "@flyee/signatures/types";

type Stored = { envelope: Envelope; pdf: Uint8Array };

const copyOf = (envelope: Envelope): Envelope => ({
  ...envelope,
  signers: envelope.signers.map((signer) => ({ ...signer })),
});

/**
 * A signature provider in memory, for development and tests. A test opens an
 * envelope through the interface and then plays the client: `sign`, `refuse`
 * or `expire`. The "signed" PDF is the original with a marker appended, so a
 * test can tell the two files apart; it is not a real signature.
 */
export class FakeSignatureProvider implements SignatureProvider {
  readonly name = "fake";

  private readonly stored = new Map<string, Stored>();
  private readonly now: () => number;
  private sequence = 0;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  async createEnvelope(input: CreateEnvelopeInput): Promise<Envelope> {
    if (input.signers.length === 0) throw new Error("an envelope needs at least one signer");
    this.sequence += 1;
    const id = `env_${String(this.sequence).padStart(6, "0")}`;
    const envelope: Envelope = {
      id,
      externalId: input.externalId,
      status: "pending",
      signers: input.signers.map((signer, index) => ({
        name: signer.name,
        signUrl: `https://assinatura.fake.invalid/${id}/${index + 1}`,
        signedAt: null,
      })),
    };
    this.stored.set(id, { envelope, pdf: Uint8Array.from(input.pdf) });
    return copyOf(envelope);
  }

  async getStatus(envelopeId: string): Promise<Envelope | null> {
    const found = this.stored.get(envelopeId);
    return found ? copyOf(found.envelope) : null;
  }

  async downloadSigned(envelopeId: string): Promise<SignedDocument> {
    const found = this.stored.get(envelopeId);
    if (!found) throw new EnvelopeNotSignedError(envelopeId, "unknown");
    if (found.envelope.status !== "signed") throw new EnvelopeNotSignedError(envelopeId, found.envelope.status);
    const marker = new TextEncoder().encode(`\n%% signed by the fake provider: ${envelopeId}\n`);
    const pdf = new Uint8Array(found.pdf.length + marker.length);
    pdf.set(found.pdf, 0);
    pdf.set(marker, found.pdf.length);
    return {
      pdf,
      sha256: createHash("sha256").update(pdf).digest("hex"),
      evidence: found.envelope.signers.map((signer) => ({
        signerName: signer.name,
        signedAt: signer.signedAt ?? "",
      })),
    };
  }

  /** The signer at this position (1 is the first) signs. The envelope is signed once every signer has. */
  sign(envelopeId: string, position: number): void {
    const envelope = this.open(envelopeId);
    const signer = envelope.signers[position - 1];
    if (!signer) throw new Error(`envelope ${envelopeId} has no signer ${position}`);
    signer.signedAt ??= new Date(this.now()).toISOString();
    if (envelope.signers.every((each) => each.signedAt !== null)) envelope.status = "signed";
  }

  /** A signer refuses: the envelope ends refused. */
  refuse(envelopeId: string): void {
    this.open(envelopeId).status = "refused";
  }

  /** The deadline passes with a signature missing. */
  expire(envelopeId: string): void {
    this.open(envelopeId).status = "expired";
  }

  /** The envelope, only while it can still change: a final state stays. */
  private open(envelopeId: string): Envelope {
    const found = this.stored.get(envelopeId);
    if (!found) throw new Error(`unknown envelope ${envelopeId}`);
    const status: EnvelopeStatus = found.envelope.status;
    if (status !== "pending") throw new Error(`envelope ${envelopeId} is already ${status}`);
    return found.envelope;
  }
}
