import { describe, expect, it } from "vitest";

import { savedFileName } from "@/lib/files/save-file";

describe("the name a file is saved under", () => {
  it("is the name on the screen with its accents, and what a file system refuses taken out", () => {
    expect(savedFileName("Procuração (modelo do ONE)", "docx", "documento")).toBe("Procuração (modelo do ONE).docx");
    expect(savedFileName('Contrato: honorários / 2026 * "êxito"?', "docx", "documento")).toBe(
      "Contrato honorários 2026 êxito.docx",
    );
    expect(savedFileName("  Petição\tinicial  \n  juizado  ", "docx", "documento")).toBe(
      "Petição inicial juizado.docx",
    );
  });

  it("never ends in a dot or a space, keeps 100 characters and falls back when nothing is left", () => {
    expect(savedFileName("Modelo final. . .", "docx", "documento")).toBe("Modelo final.docx");
    expect(savedFileName("a".repeat(150), "docx", "documento")).toBe(`${"a".repeat(100)}.docx`);
    expect(savedFileName(" /:*? ", "docx", "documento")).toBe("documento.docx");
  });
});
