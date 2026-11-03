import { savedFileName, saveFile } from "@/lib/files/save-file";
import { DOCX_TYPE, textDocx } from "@/lib/library/docx";

/**
 * What "Baixar em Word" does when pressed: the text in hand, or read then,
 * written as a Word document in the browser (`textDocx`) and handed over as a
 * file under the document's name. False when there was no text to hand over
 * (it could not be read, or it is empty), and nothing is saved.
 */
export async function downloadWord(
  name: string,
  source: string | (() => Promise<string | null>),
  fallback: string,
): Promise<boolean> {
  const body = typeof source === "string" ? source : await source();
  if (body === null || body.trim() === "") return false;
  saveFile(textDocx(body), savedFileName(name, "docx", fallback), DOCX_TYPE);
  return true;
}
