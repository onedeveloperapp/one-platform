import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
} from "pdf-lib";

/**
 * The firm's letterhead (the plan "o escritório preparado antes do primeiro atendimento", phase 2, the owner,
 * 2026-11-20), as a PDF draws it on: either a blank page of the firm's paper, drawn under every page (`page`), or the
 * header and the footer read from a Word document the firm writes on, drawn on every page (`bands`). With it, where
 * the text goes: the margins.
 *
 * `readPdfLetterhead` measures a blank page of the firm's paper: where its printing lies (text, pictures and drawings,
 * followed through the page's content as a reader would draw it), the header being what is printed in the top 40% of
 * the page and the footer what is in the bottom 25%. A page with lines of text in between is no blank page: it holds
 * the text of a piece, and is refused so the person sends the blank one. The margins put the text clear of both bands.
 */

export type BandLine = { text: string; align: "left" | "center" | "right"; sizePt: number; bold: boolean };
export type BandImage = {
  bytes: Uint8Array;
  mime: "image/png" | "image/jpeg";
  widthPt: number;
  heightPt: number;
  align: "left" | "center" | "right";
};
export type Band = { lines: BandLine[]; images: BandImage[] };

export type LetterheadMargins = { top: number; bottom: number; left: number; right: number };

export type PdfLetterhead =
  | { kind: "page"; pdf: Uint8Array; margins: LetterheadMargins }
  | {
      kind: "bands";
      header: Band;
      footer: Band;
      /** The margins of the text, and the distance of each band from its edge. */
      margins: LetterheadMargins & { header: number; footer: number };
    };

/** The least room the text keeps from each edge, whatever the letterhead says. */
export const LEAST_MARGIN = { top: 56, bottom: 48, left: 48, right: 48 } as const;

/** Space between a band and the text. */
const CLEARANCE = 14;

export type PdfLetterheadReading =
  | {
      ok: true;
      page: { width: number; height: number };
      margins: LetterheadMargins;
      /** How far down the header goes and how far up the footer comes, from their edges; 0 when there is none. */
      header: number;
      footer: number;
    }
  | { ok: false; code: "not_pdf" | "empty" | "not_blank" };

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

type Box = { low: number; high: number; text: boolean };

/** The tokens of a content stream: numbers, names, operators, and strings and arrays as single operands. */
function* operations(content: string): Generator<{ operator: string; operands: (number | string)[] }> {
  const operands: (number | string)[] = [];
  let at = 0;
  const length = content.length;
  while (at < length) {
    const char = content[at]!;
    if (/\s/.test(char)) {
      at += 1;
    } else if (char === "%") {
      while (at < length && content[at] !== "\n" && content[at] !== "\r") at += 1;
    } else if (char === "(") {
      // A string, its parentheses balanced and escaped ones skipped.
      let depth = 1;
      at += 1;
      while (at < length && depth > 0) {
        if (content[at] === "\\") at += 2;
        else {
          if (content[at] === "(") depth += 1;
          else if (content[at] === ")") depth -= 1;
          at += 1;
        }
      }
      operands.push("(string)");
    } else if (char === "<" && content[at + 1] === "<") {
      // A dictionary (of a marked content): its contents skipped.
      let depth = 0;
      while (at < length) {
        if (content.startsWith("<<", at)) {
          depth += 1;
          at += 2;
        } else if (content.startsWith(">>", at)) {
          depth -= 1;
          at += 2;
          if (depth === 0) break;
        } else at += 1;
      }
      operands.push("<<dict>>");
    } else if (char === "<") {
      const end = content.indexOf(">", at);
      at = end < 0 ? length : end + 1;
      operands.push("<hex>");
    } else if (char === "[") {
      // An array (of a TJ, a dash): one operand.
      let depth = 0;
      while (at < length) {
        const c = content[at]!;
        if (c === "(") {
          let inner = 1;
          at += 1;
          while (at < length && inner > 0) {
            if (content[at] === "\\") at += 2;
            else {
              if (content[at] === "(") inner += 1;
              else if (content[at] === ")") inner -= 1;
              at += 1;
            }
          }
          continue;
        }
        if (c === "[") depth += 1;
        if (c === "]") {
          depth -= 1;
          at += 1;
          if (depth === 0) break;
          continue;
        }
        at += 1;
      }
      operands.push("[array]");
    } else if (char === "/") {
      const match = /^\/[^\s/()<>[\]{}%]*/.exec(content.slice(at, at + 128));
      operands.push(match ? match[0] : "/");
      at += match ? match[0].length : 1;
    } else {
      const match = /^[^\s/()<>[\]{}%]+/.exec(content.slice(at, at + 64));
      const word = match ? match[0] : char;
      at += word.length;
      const value = Number(word);
      if (Number.isFinite(value) && /^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
        operands.push(value);
      } else if (word === "BI") {
        // An inline picture: its bytes run to the "EI" that ends them.
        const end = content.indexOf("EI", at);
        at = end < 0 ? length : end + 2;
        yield { operator: "BI", operands: [] };
        operands.length = 0;
      } else {
        yield { operator: word, operands: operands.splice(0) };
      }
    }
  }
}

const decoded = (stream: unknown): string => {
  if (stream instanceof PDFRawStream) return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
  if (stream instanceof PDFStream) return Buffer.from(stream.getContents()).toString("latin1");
  return "";
};

/** Where a page's printing lies: each piece's lowest and highest point, and whether it is text. */
function printedBoxes(pdf: PDFDocument, contents: string, resources: PDFDict | undefined, start: Matrix, depth = 0): Box[] {
  const boxes: Box[] = [];
  const stack: Matrix[] = [];
  let ctm = start;
  let tm: Matrix = IDENTITY;
  let tlm: Matrix = IDENTITY;
  let fontSize = 12;
  let leading = 0;
  let path: [number, number][] = [];
  const num = (value: number | string | undefined) => (typeof value === "number" ? value : 0);
  const push = (points: [number, number][], text: boolean) => {
    if (points.length === 0) return;
    const ys = points.map(([, y]) => y);
    boxes.push({ low: Math.min(...ys), high: Math.max(...ys), text });
  };
  const xobjects = resources?.lookup(PDFName.of("XObject"));
  for (const { operator, operands } of operations(contents)) {
    const [a, b, c, d, e, f] = operands.map(num);
    switch (operator) {
      case "q":
        stack.push(ctm);
        break;
      case "Q":
        ctm = stack.pop() ?? start;
        break;
      case "cm":
        ctm = multiply([a!, b!, c!, d!, e!, f!], ctm);
        break;
      case "BT":
        tm = IDENTITY;
        tlm = IDENTITY;
        break;
      case "Tf":
        fontSize = num(operands[1]) || fontSize;
        break;
      case "TL":
        leading = a!;
        break;
      case "Tm":
        tm = [a!, b!, c!, d!, e!, f!];
        tlm = tm;
        break;
      case "Td":
      case "TD":
        if (operator === "TD") leading = -b!;
        tlm = multiply([1, 0, 0, 1, a!, b!], tlm);
        tm = tlm;
        break;
      case "T*":
        tlm = multiply([1, 0, 0, 1, 0, -leading], tlm);
        tm = tlm;
        break;
      case "'":
      case '"':
      case "Tj":
      case "TJ": {
        // The quotes move to the next line first, then show it.
        if (operator === "'" || operator === '"') {
          tlm = multiply([1, 0, 0, 1, 0, -leading], tlm);
          tm = tlm;
        }
        const place = multiply(tm, ctm);
        push([apply(place, 0, -0.2 * fontSize), apply(place, 0, 0.8 * fontSize)], true);
        break;
      }
      case "re":
        path.push(apply(ctm, a!, b!), apply(ctm, a! + c!, b! + d!));
        break;
      case "m":
      case "l":
        path.push(apply(ctm, a!, b!));
        break;
      case "c":
        path.push(apply(ctm, a!, b!), apply(ctm, c!, d!), apply(ctm, e!, f!));
        break;
      case "v":
      case "y":
        path.push(apply(ctm, a!, b!), apply(ctm, c!, d!));
        break;
      case "f":
      case "F":
      case "f*":
      case "S":
      case "s":
      case "B":
      case "B*":
      case "b":
      case "b*":
        push(path, false);
        path = [];
        break;
      case "n":
        path = [];
        break;
      case "BI":
        push([apply(ctm, 0, 0), apply(ctm, 1, 1), apply(ctm, 1, 0), apply(ctm, 0, 1)], false);
        break;
      case "Do": {
        const name = typeof operands[0] === "string" ? operands[0].slice(1) : "";
        const object = xobjects instanceof PDFDict ? pdf.context.lookup(xobjects.get(PDFName.of(name))) : undefined;
        if (!(object instanceof PDFStream)) break;
        const subtype = object.dict.lookup(PDFName.of("Subtype"));
        if (subtype === PDFName.of("Form") && depth < 3) {
          const matrix = object.dict.lookup(PDFName.of("Matrix"));
          const form: Matrix =
            matrix instanceof PDFArray && matrix.size() === 6
              ? (matrix.asArray().map((item) => (item instanceof PDFNumber ? item.asNumber() : 0)) as Matrix)
              : IDENTITY;
          const inner = object.dict.lookup(PDFName.of("Resources"));
          boxes.push(
            ...printedBoxes(pdf, decoded(object), inner instanceof PDFDict ? inner : resources, multiply(form, ctm), depth + 1),
          );
        } else {
          push([apply(ctm, 0, 0), apply(ctm, 1, 1), apply(ctm, 1, 0), apply(ctm, 0, 1)], false);
        }
        break;
      }
      default:
        break;
    }
  }
  return boxes;
}

/** Measures a blank page of the firm's paper: its first page. */
export async function readPdfLetterhead(bytes: Uint8Array): Promise<PdfLetterheadReading> {
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch {
    return { ok: false, code: "not_pdf" };
  }
  const page = pdf.getPages()[0];
  if (!page) return { ok: false, code: "not_pdf" };
  const { width, height } = page.getSize();
  const raw = page.node.Contents();
  const streams = raw instanceof PDFArray ? raw.asArray().map((item) => pdf.context.lookup(item)) : [raw];
  const contents = streams.map((stream) => (stream instanceof PDFRef ? decoded(pdf.context.lookup(stream)) : decoded(stream))).join("\n");
  const resources = page.node.Resources();
  // Only what falls on the page counts.
  const boxes = printedBoxes(pdf, contents, resources, IDENTITY).filter(
    (box) => box.high > 0 && box.low < height && box.high - box.low < height * 0.95,
  );
  if (boxes.length === 0) return { ok: false, code: "empty" };

  const headerLine = height * 0.6;
  const footerLine = height * 0.25;
  const middleText = boxes.filter((box) => box.text && box.low >= footerLine && box.high <= headerLine);
  // A few words in the middle may be the paper's (a mark); lines of a piece are not.
  if (middleText.length > 3) return { ok: false, code: "not_blank" };

  const headerBoxes = boxes.filter((box) => (box.low + box.high) / 2 > headerLine);
  const footerBoxes = boxes.filter((box) => (box.low + box.high) / 2 < footerLine);
  const header = headerBoxes.length > 0 ? height - Math.min(...headerBoxes.map((box) => box.low)) : 0;
  const footer = footerBoxes.length > 0 ? Math.max(...footerBoxes.map((box) => box.high)) : 0;
  return {
    ok: true,
    page: { width, height },
    header: Math.round(header),
    footer: Math.round(footer),
    margins: {
      top: Math.round(Math.max(LEAST_MARGIN.top, header + CLEARANCE)),
      bottom: Math.round(Math.max(LEAST_MARGIN.bottom, footer + CLEARANCE)),
      left: 62,
      right: 62,
    },
  };
}
