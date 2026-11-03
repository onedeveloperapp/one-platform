import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DOCX_TYPE, readDocx } from "@/lib/library/docx";
import { downloadWord } from "@/lib/library/word-download";

/**
 * "Baixar em Word" as the browser takes it: the text read, the Word document
 * written and handed over as a file through a link's click, which the
 * library's own reader reads back. The model is invented.
 */

type Saved = { name: string; blob: Blob };

let saved: Saved[] = [];
const blobs: Blob[] = [];

// jsdom has no object addresses: the address says where the blob is kept, and letting it go does nothing (also
// when the browser's timer lets it go after a test).
Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  writable: true,
  value: (blob: Blob) => `blob:${blobs.push(blob) - 1}`,
});
Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: () => undefined });

beforeEach(() => {
  saved = [];
  // jsdom does not navigate: the click of the file's link is recorded instead, with the link gone from the page after.
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.isConnected).toBe(true);
    saved.push({ name: this.download, blob: blobs[Number(this.href.split(":").pop())] });
  });
});

const paragraphsOf = async (blob: Blob) => {
  const read = readDocx(new Uint8Array(await blob.arrayBuffer()));
  if (!read.ok) throw new Error(read.code);
  return read.paragraphs;
};

describe("Baixar em Word", () => {
  it("reads the model when pressed and hands it over as a Word document under its own name", async () => {
    const read = vi.fn(async () => "PROCURAÇÃO\n\nOutorgante: [[OUTORGANTE]].");
    expect(await downloadWord("Procuração: modelo do escritório", read, "documento")).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("Procuração modelo do escritório.docx");
    expect(saved[0].blob.type).toBe(DOCX_TYPE);
    expect(Object.keys(unzipSync(new Uint8Array(await saved[0].blob.arrayBuffer())))).toContain("word/document.xml");
    expect(await paragraphsOf(saved[0].blob)).toEqual(["PROCURAÇÃO", "Outorgante: [[OUTORGANTE]]."]);
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  });

  it("takes the text in hand without reading anything, under the fallback name when it has none", async () => {
    expect(await downloadWord("  ", "O passageiro autoriza a agência.", "documento")).toBe(true);
    expect(saved.map((file) => file.name)).toEqual(["documento.docx"]);
    expect(await paragraphsOf(saved[0].blob)).toEqual(["O passageiro autoriza a agência."]);
  });

  it("hands over nothing when the text could not be read, or is empty", async () => {
    expect(await downloadWord("Contrato", async () => null, "documento")).toBe(false);
    expect(await downloadWord("Contrato", "  \n ", "documento")).toBe(false);
    expect(saved).toHaveLength(0);
  });
});
