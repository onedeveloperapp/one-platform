import { createHash } from "node:crypto";

import { PDFDocument } from "pdf-lib";

import { detectMime } from "@flyee/documents/detect";
import type { FileMeasure } from "@flyee/documents/types";

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/**
 * The pages of a PDF, or null when it cannot be read: damaged, or protected
 * (encrypted, whether or not it opens without a password: its structure may
 * be readable while its content is not, and a page copied out of it comes out
 * garbled). A file that says it is a PDF and cannot be read is still kept as
 * what its bytes say; what uses it (a filing package, the check of a
 * document) decides what to do with one that has no pages.
 */
export async function countPdfPages(bytes: Uint8Array): Promise<number | null> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return pdf.isEncrypted ? null : pdf.getPageCount();
  } catch {
    return null;
  }
}

/** What the backend records of a file before keeping it: its hash, its size, what its bytes are, its pages. */
export async function measureFile(bytes: Uint8Array): Promise<FileMeasure> {
  const detectedMime = detectMime(bytes);
  return {
    sha256: sha256Hex(bytes),
    bytes: bytes.byteLength,
    detectedMime,
    pages: detectedMime === "application/pdf" ? await countPdfPages(bytes) : null,
  };
}
