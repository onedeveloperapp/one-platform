import { createHash, webcrypto } from "node:crypto";

import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

/** What pkijs takes as its crypto: the WebCrypto of Node, typed without the DOM. */
type EngineCrypto = ConstructorParameters<typeof pkijs.CryptoEngine>[0]["crypto"];

/**
 * A document signed for a court, built around a signature made elsewhere:
 * a lawyer's ICP-Brasil certificate in the cloud (`@flyee/psc`) signs a
 * hash, and the key never reaches ONE. The result is a CMS (PKCS#7,
 * RFC 5652) with the document inside it: the attached `.p7s` the Projudi of
 * TJGO takes, one file per document (its manual: "será necessário selecionar
 * um documento com extensão .p7s, já assinado com certificado digital"; read
 * on 2026-10-14). The court's own signer writes the same shape with SHA-512
 * and three signed attributes; this one writes SHA-256 with contentType,
 * messageDigest and signingCertificateV2, the attribute ICP-Brasil's
 * profiles ask for, and signingTime only when a caller asks for it. Whether
 * Projudi takes it is confirmed at the filing station's test.
 *
 * What is signed is the DER of the signed attributes (tagged as a SET), by
 * the norm's RAW signature: PKCS#1 v1.5 over its SHA-256. The file is
 * written with definite lengths and the document in one OCTET STRING.
 */

const OID = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingTime: "1.2.840.113549.1.9.5",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  sha256: "2.16.840.1.101.3.4.2.1",
  rsaEncryption: "1.2.840.113549.1.1.1",
} as const;

/** A signature made elsewhere: the RAW PKCS#1 v1.5 signature over the 32 bytes of a SHA-256. */
export type ExternalSigner = (digest: Uint8Array) => Promise<Uint8Array>;

export type AttachedCmsInput = {
  /** The document itself (a PDF), which goes inside the CMS. */
  content: Uint8Array;
  /** The signer's certificate, as the PSC handed it (PEM; of a bundle, the first certificate is the signer's). */
  certificatePem: string;
  /** The certificates of its chain, when the PSC or the platform has them (PEM). */
  chainPems?: string[];
  sign: ExternalSigner;
  /** The moment written into the signature, when a system asks for one; none by default. */
  signingTime?: Date;
};

let engineReady = false;
function ensureEngine(): void {
  if (engineReady) return;
  pkijs.setEngine(
    "one-node",
    new pkijs.CryptoEngine({ name: "one-node", crypto: webcrypto as unknown as EngineCrypto }),
  );
  engineReady = true;
}

/** The bytes in an ArrayBuffer of their own: never a view of a shared or larger buffer. */
const ownBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
};

const sha256 = (bytes: Uint8Array | ArrayBuffer): ArrayBuffer =>
  ownBuffer(createHash("sha256").update(new Uint8Array(bytes)).digest());

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----([A-Za-z0-9+/=\s]+?)-----END CERTIFICATE-----/;

/**
 * The DER of the first certificate of a PEM (a PSC may hand a bundle, the
 * signer's first), read strictly: base64 that decodes to exactly what it
 * says, and one certificate with nothing after it. The bytes returned are the
 * ones parsed, so the hash written of them is the hash of that certificate.
 */
export function certificateDerOf(pem: string): ArrayBuffer {
  const block = PEM_BLOCK.exec(pem);
  if (!block) throw new Error("cms: no certificate in the PEM");
  const text = block[1].replace(/\s+/g, "");
  const bytes = Buffer.from(text, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== text)
    throw new Error("cms: the certificate's base64 is not whole");
  const parsed = asn1js.fromBER(ownBuffer(bytes));
  if (parsed.offset === -1 || parsed.offset !== bytes.length)
    throw new Error("cms: the certificate is not one DER value");
  return ownBuffer(bytes);
}

const certificateOf = (der: ArrayBuffer): pkijs.Certificate => pkijs.Certificate.fromBER(der);

/** The order DER gives the members of a SET OF: their encodings compared as octet strings. */
function derOrdered(attributes: pkijs.Attribute[]): pkijs.Attribute[] {
  const encoded = attributes.map((attribute) => ({
    attribute,
    bytes: new Uint8Array(attribute.toSchema().toBER(false)),
  }));
  encoded.sort((a, b) => {
    const length = Math.max(a.bytes.length, b.bytes.length);
    for (let index = 0; index < length; index += 1) {
      const left = a.bytes[index] ?? 0;
      const right = b.bytes[index] ?? 0;
      if (left !== right) return left - right;
    }
    return 0;
  });
  return encoded.map((item) => item.attribute);
}

/**
 * A moment as X.509 and CMS write it: UTCTime up to 2049, GeneralizedTime from 2050 on, in whole seconds, since
 * RFC 5652 (11.3) allows no fraction of a second in either.
 */
const timeOf = (moment: Date): asn1js.UTCTime | asn1js.GeneralizedTime => {
  const whole = new Date(Math.floor(moment.getTime() / 1000) * 1000);
  return whole.getUTCFullYear() >= 2050 || whole.getUTCFullYear() < 1950
    ? new asn1js.GeneralizedTime({ valueDate: whole })
    : new asn1js.UTCTime({ valueDate: whole });
};

/**
 * The signingCertificateV2 attribute (RFC 5035): the SHA-256 of the signer's
 * certificate, with its issuer and serial, so the signature names the
 * certificate it was made with.
 */
function signingCertificateV2(certificate: pkijs.Certificate, certificateDer: ArrayBuffer): asn1js.Sequence {
  const issuerSerial = new asn1js.Sequence({
    value: [
      // GeneralNames: one directoryName, [4] EXPLICIT Name.
      new asn1js.Sequence({
        value: [
          new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 4 }, value: [certificate.issuer.toSchema()] }),
        ],
      }),
      certificate.serialNumber,
    ],
  });
  // ESSCertIDv2: the hash algorithm is SHA-256 by default, so it is left out.
  const certId = new asn1js.Sequence({
    value: [new asn1js.OctetString({ valueHex: sha256(certificateDer) }), issuerSerial],
  });
  return new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [certId] })] });
}

/** How many bytes an RSA signature of this certificate's key has: the length of its modulus. */
function rsaLengthOf(certificate: pkijs.Certificate): number | null {
  try {
    const key = asn1js.fromBER(
      certificate.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView.slice().buffer,
    );
    const modulus = (key.result as asn1js.Sequence).valueBlock.value[0] as asn1js.Integer;
    const bytes = new Uint8Array(modulus.valueBlock.valueHexView);
    // An INTEGER carries a leading zero when its first bit is set; the modulus' length is without it.
    return bytes[0] === 0 ? bytes.length - 1 : bytes.length;
  } catch {
    return null;
  }
}

export type PreparedCms = {
  /** The SHA-256 of what is signed (the signed attributes' DER): what goes to the PSC. */
  digest: Uint8Array;
  /** The attached `.p7s` around the RAW signature the PSC made over `digest`. */
  assemble: (signature: Uint8Array) => Uint8Array;
};

/**
 * A document's CMS up to its signature: the digest to ask the PSC to sign,
 * and how to write the `.p7s` around what it answers. Several documents are
 * prepared first and their digests sent in one call to the PSC.
 */
export function prepareAttachedCms(input: Omit<AttachedCmsInput, "sign">): PreparedCms {
  ensureEngine();
  const certificateDer = certificateDerOf(input.certificatePem);
  const certificate = certificateOf(certificateDer);
  // The certificate goes into the file as pkijs writes it again; the hash named of it must be of those very bytes.
  if (!sameBytes(certificate.toSchema().toBER(false), certificateDer))
    throw new Error("cms: the certificate is not DER");
  const content = ownBuffer(input.content);
  const chain = (input.chainPems ?? []).map((pem) => certificateOf(certificateDerOf(pem)));
  const keyLength = rsaLengthOf(certificate);

  const attributes = derOrdered([
    new pkijs.Attribute({ type: OID.contentType, values: [new asn1js.ObjectIdentifier({ value: OID.data })] }),
    new pkijs.Attribute({ type: OID.messageDigest, values: [new asn1js.OctetString({ valueHex: sha256(content) })] }),
    new pkijs.Attribute({
      type: OID.signingCertificateV2,
      values: [signingCertificateV2(certificate, certificateDer)],
    }),
    ...(input.signingTime ? [new pkijs.Attribute({ type: OID.signingTime, values: [timeOf(input.signingTime)] })] : []),
  ]);
  const signedAttrs = new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes });

  // What is signed: the attributes' DER with the SET tag in place of the [0] they are written under.
  const toSign = new Uint8Array(signedAttrs.toSchema().toBER(false));
  toSign[0] = 0x31;

  return {
    digest: new Uint8Array(sha256(toSign)),
    assemble(signature: Uint8Array): Uint8Array {
      if (signature.length === 0) throw new Error("cms: the signer returned no signature");
      // A signature is as long as the key's modulus: one handed without its leading zeros gets them back, and one
      // handed with a zero too many in front (a signed integer's habit) loses it.
      let value = signature;
      while (keyLength && value.length > keyLength && value[0] === 0) value = value.subarray(1);
      if (keyLength && value.length < keyLength) {
        const padded = new Uint8Array(keyLength);
        padded.set(value, keyLength - value.length);
        value = padded;
      }
      const signerInfo = new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({ issuer: certificate.issuer, serialNumber: certificate.serialNumber }),
        digestAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 }),
        signedAttrs,
        signatureAlgorithm: new pkijs.AlgorithmIdentifier({
          algorithmId: OID.rsaEncryption,
          algorithmParams: new asn1js.Null(),
        }),
        signature: new asn1js.OctetString({ valueHex: ownBuffer(value) }),
      });
      const signedData = new pkijs.SignedData({
        version: 1,
        digestAlgorithms: [new pkijs.AlgorithmIdentifier({ algorithmId: OID.sha256 })],
        encapContentInfo: new pkijs.EncapsulatedContentInfo({
          eContentType: OID.data,
          eContent: new asn1js.OctetString({ valueHex: content }),
        }),
        certificates: [certificate, ...chain],
        signerInfos: [signerInfo],
      });
      // pkijs cuts the document into pieces of 64 KiB under a constructed OCTET STRING; one piece is what DER writes.
      signedData.encapContentInfo.eContent = new asn1js.OctetString({ valueHex: content });
      const contentInfo = new pkijs.ContentInfo({ contentType: OID.signedData, content: signedData.toSchema(true) });
      return new Uint8Array(contentInfo.toSchema().toBER(false));
    },
  };
}

/** The document inside a CMS signed by a signature made elsewhere: the attached `.p7s`. */
export async function attachedCms(input: AttachedCmsInput): Promise<Uint8Array> {
  const prepared = prepareAttachedCms(input);
  return prepared.assemble(await input.sign(prepared.digest));
}

/** The bytes of an OCTET STRING, whole whether it was written in one piece or in many. */
function octetsOf(value: asn1js.OctetString): Uint8Array {
  if (!value.idBlock.isConstructed) return new Uint8Array(value.valueBlock.valueHexView);
  const pieces = (value.valueBlock.value as asn1js.OctetString[]).map(octetsOf);
  const whole = new Uint8Array(pieces.reduce((total, piece) => total + piece.length, 0));
  let offset = 0;
  for (const piece of pieces) {
    whole.set(piece, offset);
    offset += piece.length;
  }
  return whole;
}

const sameBytes = (a: ArrayBuffer | Uint8Array, b: ArrayBuffer | Uint8Array): boolean =>
  Buffer.from(new Uint8Array(a)).equals(Buffer.from(new Uint8Array(b)));

/**
 * What a CMS carries and whether its signature holds over its own content:
 * the message digest is the document's, the signature verifies with the
 * certificate the signer names, and signingCertificateV2 names that very
 * certificate (its SHA-256, its issuer and serial). Never its chain: the
 * court's system checks that. The backend reads every `.p7s` back with this
 * before using it.
 */
export async function readAttachedCms(
  bytes: Uint8Array,
): Promise<{ content: Uint8Array; signed: boolean; signerSubject: string; signerSerialHex: string }> {
  ensureEngine();
  const contentInfo = pkijs.ContentInfo.fromBER(ownBuffer(bytes));
  if (contentInfo.contentType !== OID.signedData) throw new Error("cms: not a signed data");
  const signedData = new pkijs.SignedData({ schema: contentInfo.content });
  const eContent = signedData.encapContentInfo.eContent;
  if (!eContent) throw new Error("cms: no document inside");
  const content = octetsOf(eContent);

  const signerInfo = signedData.signerInfos[0];
  const sid = signerInfo?.sid;
  const certificate =
    sid instanceof pkijs.IssuerAndSerialNumber
      ? (signedData.certificates ?? []).find(
          (item): item is pkijs.Certificate =>
            item instanceof pkijs.Certificate &&
            item.issuer.isEqual(sid.issuer) &&
            item.serialNumber.isEqual(sid.serialNumber),
        )
      : undefined;

  let signed = false;
  if (certificate) {
    try {
      const result = await signedData.verify({ signer: 0, checkChain: false, extendedMode: true });
      signed = Boolean((result as { signatureVerified?: boolean }).signatureVerified);
    } catch {
      signed = false;
    }
    // signingCertificateV2 must name the certificate the signature verifies with.
    const attribute = signerInfo.signedAttrs?.attributes.find((item) => item.type === OID.signingCertificateV2);
    try {
      const signingCertificate = attribute?.values[0] as asn1js.Sequence | undefined;
      const certs = signingCertificate?.valueBlock.value[0] as asn1js.Sequence | undefined;
      const essCertId = certs?.valueBlock.value[0] as asn1js.Sequence | undefined;
      const hash = essCertId?.valueBlock.value[0] as asn1js.OctetString | undefined;
      const written = certificate.toSchema().toBER(false);
      if (!hash || !sameBytes(hash.valueBlock.valueHexView, sha256(written))) signed = false;
    } catch {
      signed = false;
    }
  }
  const subject = certificate?.subject.typesAndValues.find((item) => item.type === "2.5.4.3")?.value.valueBlock.value;
  return {
    content,
    signed,
    signerSubject: typeof subject === "string" ? subject : "",
    signerSerialHex: certificate ? Buffer.from(certificate.serialNumber.valueBlock.valueHexView).toString("hex") : "",
  };
}
