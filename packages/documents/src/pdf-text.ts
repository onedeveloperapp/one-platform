import type { PDFFont } from "pdf-lib";

/**
 * What the standard fonts of a PDF can write, and how a text is broken into lines. Apart from the writers so that one
 * that runs in the person's browser (`table-pdf`) carries neither `sharp` nor the verification mark.
 */

/**
 * The typographic characters people paste, by their codes, as the plain ones the standard fonts write:
 * curly and low quotes and the primes, every hyphen and dash and the minus sign, the bullet, the ellipsis,
 * the ligatures a PDF copies as one character, the spaces that are not the plain one, and what has no
 * width at all. Whatever is not here and is not Latin-1 has no plain form: `unwritableCharacters` names
 * it, and the database refuses to approve a piece that holds one (`unwritable_characters`, migration
 * 0029, which lists the same codes).
 */
const PLAIN = new Map<number, string>([
  [0x2018, "'"],
  [0x2019, "'"],
  [0x201a, "'"],
  [0x2032, "'"],
  [0x201c, '"'],
  [0x201d, '"'],
  [0x201e, '"'],
  [0x2033, '"'],
  [0x2010, "-"],
  [0x2011, "-"],
  [0x2012, "-"],
  [0x2013, "-"],
  [0x2014, "-"],
  [0x2015, "-"],
  [0x2212, "-"],
  [0x2022, "-"],
  [0x2026, "..."],
  [0xfb00, "ff"],
  [0xfb01, "fi"],
  [0xfb02, "fl"],
  [0xfb03, "ffi"],
  [0xfb04, "ffl"],
  [0x00a0, " "],
  [0x202f, " "],
  [0x2002, " "],
  [0x2003, " "],
  [0x2007, " "],
  [0x2009, " "],
  [0x0009, " "],
  [0x000d, ""],
  [0x00ad, ""],
  [0x200b, ""],
  [0x200c, ""],
  [0x200d, ""],
  [0xfeff, ""],
]);

/** The codes written in a plain form: what a text may hold beyond Latin-1. */
export const PLAIN_CODES: readonly number[] = [...PLAIN.keys()];

/** A character the standard fonts write: Latin-1, with no control character of either range. */
const isWritable = (unit: string): boolean =>
  unit === "\n" || (unit >= " " && unit <= "ÿ" && !(unit >= "\u007f" && unit <= "\u009f"));

/** Text the standard fonts can write: Latin-1, with what people paste brought to its plain form. */
export function writableText(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC")) {
    const plain = PLAIN.get(char.codePointAt(0) ?? 0) ?? char;
    for (const unit of plain) {
      if (isWritable(unit)) out += unit;
    }
  }
  return out;
}

/**
 * The characters of a text `writableText` would leave out: what a document made of it could not say. Each
 * once, in the order they appear, twenty at most. A text that holds none is written whole.
 */
export function unwritableCharacters(text: string): string[] {
  const found: string[] = [];
  for (const char of text.normalize("NFC")) {
    const plain = PLAIN.get(char.codePointAt(0) ?? 0);
    if (plain !== undefined || isWritable(char) || found.includes(char)) continue;
    found.push(char);
    if (found.length === 20) break;
  }
  return found;
}

/** No line holds more characters than this, however narrow they are: what bounds the measure of a long word. */
const MOST_IN_A_LINE = 1000;

/** Breaks a text into the lines that fit a width, by the measure of its words. A word wider than the line is cut. */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/ +/).filter(Boolean)) {
      let rest = word;
      // A single word wider than the line (an address, a hash) is cut where it stops fitting. Only its start
      // is measured, and the place is found by halving: a word of any length is cut in the time of its length.
      while (font.widthOfTextAtSize(rest.slice(0, MOST_IN_A_LINE), size) > width) {
        let cut = 1;
        for (let most = Math.min(rest.length, MOST_IN_A_LINE); cut < most; ) {
          const middle = (cut + most + 1) >> 1;
          if (font.widthOfTextAtSize(rest.slice(0, middle), size) <= width) cut = middle;
          else most = middle - 1;
        }
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      const candidate = line ? `${line} ${rest}` : rest;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
      } else {
        lines.push(line);
        line = rest;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Text the standard fonts can write, for a list of people to be read: a letter outside Latin-1 keeps its base letter
 * ("ş" is "s"), and what has no plain form reads "?", so a name is never shown shorter as if it were the whole of it.
 * A document that speaks for somebody takes `writableText`, and `unwritableCharacters` to refuse what it would lose.
 */
export function closestText(text: string): string {
  let out = "";
  for (const char of text.normalize("NFC")) {
    const plain = PLAIN.get(char.codePointAt(0) ?? 0);
    if (plain !== undefined) out += plain;
    else if (isWritable(char)) out += char;
    else if (!/\p{C}/u.test(char)) {
      const base = char.normalize("NFD").replace(/\p{M}+/gu, "");
      out += base !== char && base !== "" && Array.from(base).every(isWritable) ? base : "?";
    }
  }
  return out;
}
