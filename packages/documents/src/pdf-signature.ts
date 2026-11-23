/**
 * How many digital signatures a PDF carries, read from its bytes: a signature dictionary whose `/ByteRange` covers
 * the file from its first byte around the signature value (`/Contents <...>`), as every signer writes it (ISO 32000,
 * 12.8.1: the value sits at known offsets, so the dictionary is never compressed away).
 *
 * The first check of a paper a client sends back signed at gov.br (the owner's test of 2026-11-23: a client sent the
 * papers back exactly as ONE issued them, with no signature, and the firm was asked to confirm them). Whether a
 * signature is valid, whose it is and over which document is read elsewhere: this says only whether one is there.
 * Pure.
 */
export function pdfSignatures(bytes: Uint8Array): number {
  const text = latin1(bytes);
  if (!text.startsWith("%PDF-")) return 0;
  let found = 0;
  for (const match of text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)) {
    const [start, before, after, rest] = match.slice(1, 5).map(Number);
    // From the first byte, a gap that holds the signature value, then on to at most the end of the file (a later
    // signature or revision may follow a signature's range).
    if (start !== 0 || before <= 0 || after <= before || after + rest > bytes.length) continue;
    const value = text.slice(before, after).replace(/[<>\s]/g, "");
    if (value.length > 0 && /^[0-9A-Fa-f]+$/.test(value) && !/^0+$/.test(value)) found += 1;
  }
  return found;
}

/** The bytes as one character each, so that offsets in the text are offsets in the file. */
function latin1(bytes: Uint8Array): string {
  let text = "";
  const step = 0x8000;
  for (let at = 0; at < bytes.length; at += step) {
    text += String.fromCharCode(...bytes.subarray(at, at + step));
  }
  return text;
}
