import { pdfSignatures } from "@flyee/documents/pdf-signature";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Every PDF here is made up in place: a page that says nothing, and a revision that signs it as a signer writes one.

const PAGE = "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n";

/** The file with a revision that signs it: the `/ByteRange` around the value, at the offsets it really has. */
function signedOf(base: string, value = "3082054306092A864886F70D010702A0"): string {
  const pad = (n: number) => String(n).padStart(10, "0");
  const head = (range: string) =>
    `${base}9 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange ${range} /Contents <`;
  const tail = "> >>\nendobj\n%%EOF\n";
  const width = head("[0 0000000000 0000000000 0000000000]").length;
  const before = width - 1;
  const after = width + value.length + 1;
  const total = width + value.length + tail.length;
  return `${head(`[0 ${pad(before)} ${pad(after)} ${pad(total - after)}]`)}${value}${tail}`;
}

const bytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe("whether a PDF carries a digital signature", () => {
  it("finds none in a paper as ONE issued it, the one a client sent back unsigned", () => {
    assert.equal(pdfSignatures(bytes(PAGE)), 0);
  });

  it("finds the signature a signer writes, and one more for each revision that signs again", () => {
    const once = signedOf(PAGE);
    assert.equal(pdfSignatures(bytes(once)), 1);
    assert.equal(pdfSignatures(bytes(signedOf(once))), 2);
  });

  it("takes no range that does not fit the file, no empty or reserved value, and nothing that is not a PDF", () => {
    const once = signedOf(PAGE);
    // The signed revision cut short: its range runs past the end of the file.
    assert.equal(pdfSignatures(bytes(once.slice(0, -10))), 0);
    // A signature field reserved and never signed holds zeros.
    assert.equal(pdfSignatures(bytes(signedOf(PAGE, "0".repeat(32)))), 0);
    assert.equal(pdfSignatures(bytes(signedOf(PAGE, ""))), 0);
    assert.equal(pdfSignatures(bytes(`texto ${once}`)), 0);
  });
});
