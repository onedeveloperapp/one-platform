import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { certificateFacts, challengeOf, FakePsc, newState, newVerifier } from "@flyee/psc";

import { attachedCms, prepareAttachedCms, readAttachedCms } from "./cms.ts";
import { detectMime } from "./detect.ts";
import { measureFile } from "./measure.ts";

/**
 * A court's signed document built around a signature the lawyer's cloud
 * certificate makes: the fake PSC signs for real with an invented holder's
 * key, so what is built here verifies as it would with a PSC's signature.
 */

const REDIRECT = "https://one.invalid/psc/volta";

/** A session the holder authorized, and a signer that asks the PSC for one RAW signature per digest. */
async function lawyerSession() {
  const psc = await FakePsc.create();
  const verifier = newVerifier();
  const state = newState();
  psc.authorizeUrl({
    clientId: "one",
    redirectUri: REDIRECT,
    state,
    codeChallenge: challengeOf(verifier),
    scope: "signature_session",
    lifetimeSeconds: 3600,
  });
  const token = await psc.exchangeCode({
    clientId: "one",
    clientSecret: "segredo",
    code: psc.approve(state),
    redirectUri: REDIRECT,
    codeVerifier: verifier,
  });
  const [certificate] = await psc.certificates(token.accessToken);
  const sign = async (digest: Uint8Array) =>
    (await psc.sign({ token: token.accessToken, hashes: [{ id: "documento", hash: digest }], format: "RAW" }))
      .signatures[0].value;
  return { psc, certificate, sign, token: token.accessToken };
}

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n");

describe("a document signed for a court by the lawyer's cloud certificate", () => {
  it("goes inside a CMS whose signature holds over it, naming who signed", async () => {
    const { certificate, sign, psc } = await lawyerSession();
    const p7s = await attachedCms({ content: PDF, certificatePem: certificate.pem, sign });
    const read = await readAttachedCms(p7s);
    assert.deepEqual(read.content, PDF);
    assert.equal(read.signed, true);
    assert.equal(read.signerSubject, "ADVOGADA TESTE DA SILVA:12345678909");
    // One signature asked of the PSC for one document.
    assert.equal(psc.signed.length, 1);
  });

  it("no longer holds once a byte of the document inside it changed", async () => {
    const { certificate, sign } = await lawyerSession();
    const p7s = await attachedCms({ content: PDF, certificatePem: certificate.pem, sign });
    const marker = new TextEncoder().encode("/Catalog");
    const at = Buffer.from(p7s).indexOf(Buffer.from(marker));
    assert.ok(at > 0);
    const tampered = new Uint8Array(p7s);
    tampered[at + 1] = tampered[at + 1] ^ 0x01;
    const read = await readAttachedCms(tampered);
    assert.equal(read.signed, false);
  });

  it("writes the moment of the signature only when a system asks for it, and holds either way", async () => {
    const { certificate, sign } = await lawyerSession();
    const plain = await attachedCms({ content: PDF, certificatePem: certificate.pem, sign });
    const timed = await attachedCms({
      content: PDF,
      certificatePem: certificate.pem,
      sign,
      signingTime: new Date("2026-10-15T12:00:00Z"),
    });
    // The signingTime attribute's object identifier, 1.2.840.113549.1.9.5, in DER.
    const signingTimeOid = Buffer.from("06092a864886f70d010905", "hex");
    assert.equal(Buffer.from(plain).indexOf(signingTimeOid), -1);
    assert.ok(Buffer.from(timed).indexOf(signingTimeOid) > 0);
    assert.equal((await readAttachedCms(plain)).signed, true);
    assert.equal((await readAttachedCms(timed)).signed, true);
  });

  it("prepares several documents and signs them in one call to the PSC, each holding over its own", async () => {
    const { certificate, psc, token } = await lawyerSession();
    const other = new TextEncoder().encode("%PDF-1.7\n2 0 obj << /Type /Pages >> endobj\n%%EOF\n");
    const prepared = [PDF, other].map((content) => prepareAttachedCms({ content, certificatePem: certificate.pem }));
    const answer = await psc.sign({
      token,
      hashes: prepared.map((item, index) => ({ id: `doc-${index}`, hash: item.digest })),
      format: "RAW",
    });
    assert.equal(psc.signed.length, 1);
    const files = prepared.map((item, index) => item.assemble(answer.signatures[index].value));
    const read = await Promise.all(files.map((file) => readAttachedCms(file)));
    assert.deepEqual(read[0].content, PDF);
    assert.deepEqual(read[1].content, other);
    assert.ok(read.every((item) => item.signed));
    // A signature put around the other document does not hold.
    assert.equal((await readAttachedCms(prepared[0].assemble(answer.signatures[1].value))).signed, false);
  });

  it("signs with the first certificate of a bundle, and names that very one", async () => {
    const { certificate, sign } = await lawyerSession();
    const other = await FakePsc.create({ holderName: "OUTRA PESSOA", holderCpf: "52998224725" });
    const bundle = `${certificate.pem}
${other.certificatePem}
`;
    const read = await readAttachedCms(await attachedCms({ content: PDF, certificatePem: bundle, sign }));
    assert.equal(read.signed, true);
    assert.equal(read.signerSubject, "ADVOGADA TESTE DA SILVA:12345678909");
  });

  it("puts back the leading zeros of a signature a PSC handed without them", async () => {
    const { certificate, sign } = await lawyerSession();
    // A signature starts with a zero byte one time in 256: the documents differ until one does.
    for (let attempt = 0; attempt < 4000; attempt += 1) {
      const content = new TextEncoder().encode(`%PDF-1.7 tentativa ${attempt}`);
      const prepared = prepareAttachedCms({ content, certificatePem: certificate.pem });
      const signature = await sign(prepared.digest);
      if (signature[0] !== 0) continue;
      const read = await readAttachedCms(prepared.assemble(signature.slice(1)));
      assert.equal(read.signed, true);
      return;
    }
    assert.fail("no signature with a leading zero came out");
  });

  it("drops a zero too many in front of a signature, as a signed integer writes one", async () => {
    const { certificate, sign } = await lawyerSession();
    const prepared = prepareAttachedCms({ content: PDF, certificatePem: certificate.pem });
    const signature = await sign(prepared.digest);
    const longer = new Uint8Array(signature.length + 1);
    longer.set(signature, 1);
    assert.equal((await readAttachedCms(prepared.assemble(longer))).signed, true);
  });

  it("writes a moment from 2050 on as a GeneralizedTime, and a document over 64 KiB in one piece", async () => {
    const { certificate, sign } = await lawyerSession();
    const late = await attachedCms({
      content: PDF,
      certificatePem: certificate.pem,
      sign,
      signingTime: new Date("2051-01-01T00:00:00Z"),
    });
    // The signingTime attribute: its OID, a SET of 17 bytes, and a GeneralizedTime of 15 characters.
    assert.ok(Buffer.from(late).indexOf(Buffer.from("06092a864886f70d01090531111" + "80f", "hex")) > 0);
    assert.equal((await readAttachedCms(late)).signed, true);
    // In whole seconds, whatever fraction the moment carried (RFC 5652, 11.3).
    const fraction = await attachedCms({
      content: PDF,
      certificatePem: certificate.pem,
      sign,
      signingTime: new Date("2051-03-04T05:06:07.120Z"),
    });
    assert.ok(Buffer.from(fraction).indexOf(Buffer.from("20510304050607Z", "latin1")) > 0);
    assert.equal(Buffer.from(fraction).indexOf(Buffer.from("20510304050607.", "latin1")), -1);

    const large = new Uint8Array(200_000).map((_, index) => index % 251);
    const p7s = await attachedCms({ content: large, certificatePem: certificate.pem, sign });
    const read = await readAttachedCms(p7s);
    assert.equal(read.signed, true);
    assert.deepEqual(read.content, large);
    // The document is one primitive OCTET STRING (tag 0x04), never a constructed one (0x24) cut in pieces.
    const header = Buffer.from([0x04, 0x83, (200_000 >> 16) & 0xff, (200_000 >> 8) & 0xff, 200_000 & 0xff]);
    assert.ok(Buffer.from(p7s).indexOf(header) > 0);
  });

  it("reads back the serial of the certificate the signature was made with", async () => {
    const { certificate, sign } = await lawyerSession();
    const read = await readAttachedCms(await attachedCms({ content: PDF, certificatePem: certificate.pem, sign }));
    assert.equal(read.signerSerialHex, certificateFacts(certificate.pem).serialHex);
  });

  it("is told by its bytes as a .p7s, and nothing else that opens as a SEQUENCE is", async () => {
    const { certificate, sign } = await lawyerSession();
    const p7s = await attachedCms({ content: PDF, certificatePem: certificate.pem, sign });
    assert.equal(detectMime(p7s), "application/pkcs7-mime");
    assert.equal((await measureFile(p7s)).detectedMime, "application/pkcs7-mime");
    // A certificate is a SEQUENCE too, and no signed data.
    assert.equal(
      detectMime(new Uint8Array(Buffer.from(certificate.pem.replace(/-----[^-]+-----|\s/g, ""), "base64"))),
      null,
    );
  });

  it("refuses to build on a signer that returned nothing", async () => {
    const { certificate } = await lawyerSession();
    await assert.rejects(
      attachedCms({ content: PDF, certificatePem: certificate.pem, sign: async () => new Uint8Array(0) }),
      /no signature/,
    );
  });
});
