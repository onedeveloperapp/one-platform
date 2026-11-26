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
 * 2026-11-20), as a PDF draws it on: the firm's own paper, a page of it drawn under every page (`page`: its first page
 * under the first, where the firm's first page differs, and its following page under the others), or, as a letterhead
 * read before 0300 still is, a header and a footer drawn on every page (`bands`). With it, where the text goes: the
 * margins.
 *
 * The paper is copied, never drawn again (the owner, 2026-11-25: "não é pra inventar, mas sim copiar ... exatamente
 * como o usuário enviou"). `readPdfPaper` takes the firm's PDF as it is, its first two pages; a page that holds the
 * text of a document (lines of a piece in the middle) has that text taken out and keeps everything else exactly where
 * it was: what matters of a letterhead is its paper, never its content. A Word document becomes such a PDF on ONE's
 * server (`@flyee/documents/office`), its body emptied first.
 *
 * `readPdfLetterhead` measures a blank page of the firm's paper: where its printing lies (text, pictures and drawings,
 * followed through the page's content as a reader would draw it), the header being what is printed in the top 40% of
 * the page and the footer what is in the bottom 25%. The margins put the text clear of both bands.
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

/** A page of the firm's paper (counted from 0) and where the text goes on it. */
export type PaperPage = { page: number; margins: LetterheadMargins };

export type PdfLetterhead =
  | {
      kind: "page";
      pdf: Uint8Array;
      /** Where the text goes on every page but the first, or on every page when the first does not differ. */
      margins: LetterheadMargins;
      /** The page of the paper under every page but the first; 0 when it is not said. */
      page?: number;
      /** The page of the paper under the first page and its margins, where the firm's first page differs. */
      first?: PaperPage;
    }
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

/**
 * A piece of a page's printing: its lowest and highest point, its leftmost one, whether it is text, and, for text the
 * page's own content shows (never a form it draws), the operation that shows it, which may be taken out.
 */
type Box = { low: number; high: number; left: number; text: boolean; shown?: Operation };

/** An operation of a content stream: its operator, its operands, and where it lies in the stream, operands first. */
type Operation = { operator: string; operands: (number | string)[]; start: number; end: number };

/** The tokens of a content stream: numbers, names, operators, and strings and arrays as single operands. */
function* operations(content: string): Generator<Operation> {
  const operands: (number | string)[] = [];
  let at = 0;
  // Where the operands of the operation being read begin.
  let start = -1;
  const length = content.length;
  while (at < length) {
    const char = content[at]!;
    if (start < 0 && char !== "%" && !/\s/.test(char)) start = at;
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
        yield { operator: "BI", operands: [], start, end: at };
        operands.length = 0;
        start = -1;
      } else {
        yield { operator: word, operands: operands.splice(0), start, end: at };
        start = -1;
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
  const push = (points: [number, number][], text: boolean, shown?: Operation) => {
    if (points.length === 0) return;
    const ys = points.map(([, y]) => y);
    const xs = points.map(([x]) => x);
    boxes.push({ low: Math.min(...ys), high: Math.max(...ys), left: Math.min(...xs), text, ...(shown ? { shown } : {}) });
  };
  const xobjects = resources?.lookup(PDFName.of("XObject"));
  for (const operation of operations(contents)) {
    const { operator, operands } = operation;
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
        push(
          [apply(place, 0, -0.2 * fontSize), apply(place, 0, 0.8 * fontSize)],
          true,
          depth === 0 && operation.start >= 0 ? operation : undefined,
        );
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

// ---------- The firm's paper, copied ----------

/** How far the printing of a page of the paper comes in from each edge, and where the text goes on it. */
export type PaperMeasure = { header: number; footer: number; margins: LetterheadMargins };

export type PdfPaperReading =
  | {
      ok: true;
      /** The paper: the firm's first page and, when the file has one, its following page. */
      pdf: Uint8Array;
      pages: number;
      page: { width: number; height: number };
      first: PaperMeasure;
      rest: PaperMeasure;
      /** The text of a document was taken out of the paper's pages. */
      stripped: boolean;
      /** The fonts the paper's pages are written in, by their names. */
      fonts: string[];
    }
  | { ok: false; code: "not_pdf" | "empty" };

type PdfPage = ReturnType<PDFDocument["getPage"]>;

/** The content of a page as one text, with its resources. */
function contentOf(pdf: PDFDocument, page: PdfPage): { contents: string; resources?: PDFDict } {
  const raw = page.node.Contents();
  const streams = raw instanceof PDFArray ? raw.asArray().map((item) => pdf.context.lookup(item)) : [raw];
  const contents = streams
    .map((stream) => (stream instanceof PDFRef ? decoded(pdf.context.lookup(stream)) : decoded(stream)))
    .join("\n");
  return { contents, resources: page.node.Resources() };
}

const middleOf = (box: { low: number; high: number }) => (box.low + box.high) / 2;

/** A line of text of a page: its pieces at about the same height. */
type TextLine = { low: number; high: number; middle: number; left: number };

/**
 * The body of a document on a page of its paper: the lines of text in the middle of the page and those that follow
 * them closely above and below; null when the middle holds no more than a line (a mark of the paper, such as
 * "CONFIDENCIAL"). What is farther than the body's own spacing is the paper's header or footer, and stays.
 */
function bodyOf(boxes: readonly Box[], height: number): { low: number; high: number; left: number } | null {
  const lines: TextLine[] = [];
  for (const box of [...boxes].filter((item) => item.text).sort((a, b) => middleOf(b) - middleOf(a))) {
    const last = lines.at(-1);
    if (last && Math.abs(last.middle - middleOf(box)) < 2) {
      last.low = Math.min(last.low, box.low);
      last.high = Math.max(last.high, box.high);
      last.left = Math.min(last.left, box.left);
    } else {
      lines.push({ low: box.low, high: box.high, middle: middleOf(box), left: box.left });
    }
  }
  const seeds = lines.flatMap((line, index) =>
    line.middle >= height * 0.25 && line.middle <= height * 0.75 ? [index] : [],
  );
  if (seeds.length < 2) return null;
  const gaps = seeds
    .slice(1)
    .map((index, at) => lines[seeds[at]!]!.middle - lines[index]!.middle)
    .filter((gap) => gap > 0)
    .sort((a, b) => a - b);
  const spacing = gaps.length > 0 ? gaps[Math.floor(gaps.length / 2)]! : 16;
  const reach = Math.max(spacing * 2.2, 24);
  let first = seeds[0]!;
  let last = seeds.at(-1)!;
  while (first > 0 && lines[first - 1]!.middle - lines[first]!.middle <= reach && lines[first - 1]!.middle < height * 0.9) {
    first -= 1;
  }
  while (
    last < lines.length - 1 &&
    lines[last]!.middle - lines[last + 1]!.middle <= reach &&
    lines[last + 1]!.middle > height * 0.08
  ) {
    last += 1;
  }
  const body = lines.slice(first, last + 1);
  return {
    low: Math.min(...body.map((line) => line.low)),
    high: Math.max(...body.map((line) => line.high)),
    left: Math.min(...body.map((line) => line.left)),
  };
}

/** The content with the operations that show the given text taken out, every other operation as it was. */
function withoutShown(contents: string, shown: readonly Operation[]): string {
  let out = contents;
  for (const operation of [...shown].sort((a, b) => b.start - a.start)) {
    const [aw, ac] = operation.operands;
    // A quote moves to the next line before it shows: the move stays, the text goes.
    const kept =
      operation.operator === "'"
        ? " T* "
        : operation.operator === '"' && typeof aw === "number" && typeof ac === "number"
          ? ` ${aw} Tw ${ac} Tc T* `
          : " ";
    out = out.slice(0, operation.start) + kept + out.slice(operation.end);
  }
  return out;
}

/** How far the printing comes in from the top and the bottom edge, and where the text goes clear of it. */
function measureOf(
  boxes: readonly Box[],
  height: number,
  body: { left: number } | null,
  base: LetterheadMargins | undefined,
): PaperMeasure {
  // What runs down the whole page (a stripe at its side) is no header nor footer.
  const bands = boxes.filter((box) => box.high - box.low < height * 0.95);
  const headerBoxes = bands.filter((box) => middleOf(box) > height * 0.6);
  const footerBoxes = bands.filter((box) => middleOf(box) < height * 0.25);
  const header = headerBoxes.length > 0 ? height - Math.min(...headerBoxes.map((box) => box.low)) : 0;
  const footer = footerBoxes.length > 0 ? Math.max(...footerBoxes.map((box) => box.high)) : 0;
  const side = body ? Math.min(Math.max(body.left, LEAST_MARGIN.left), 120) : 62;
  return {
    header: Math.round(header),
    footer: Math.round(footer),
    margins: {
      top: Math.round(Math.max(LEAST_MARGIN.top, base?.top ?? 0, header + CLEARANCE)),
      bottom: Math.round(Math.max(LEAST_MARGIN.bottom, base?.bottom ?? 0, footer + CLEARANCE)),
      left: Math.round(Math.max(LEAST_MARGIN.left, base?.left ?? side)),
      right: Math.round(Math.max(LEAST_MARGIN.right, base?.right ?? side)),
    },
  };
}

/** The fonts a page's resources name, without the mark of a subset ("ABCDEF+"). */
function fontsOf(pdf: PDFDocument, page: PdfPage): string[] {
  const names = new Set<string>();
  const seen = new Set<PDFDict>();
  // The page's own fonts, and those of the forms it draws (a suite writes a header or a box in one), a few deep.
  const walk = (resources: unknown, depth: number) => {
    const dict = resources instanceof PDFRef ? pdf.context.lookup(resources) : resources;
    if (!(dict instanceof PDFDict) || seen.has(dict) || depth > 3) return;
    seen.add(dict);
    const fonts = dict.lookup(PDFName.of("Font"));
    if (fonts instanceof PDFDict) {
      for (const value of fonts.values()) {
        const font = pdf.context.lookup(value);
        if (!(font instanceof PDFDict)) continue;
        // A font drawn by its own glyphs (Type3) has no BaseFont: its descriptor, or its own name, says which it is.
        const descriptor = font.lookup(PDFName.of("FontDescriptor"));
        const name = [
          font.lookup(PDFName.of("BaseFont")),
          descriptor instanceof PDFDict ? descriptor.lookup(PDFName.of("FontName")) : undefined,
          font.lookup(PDFName.of("Name")),
        ].find((item) => item instanceof PDFName);
        if (name instanceof PDFName) names.add(name.decodeText().replace(/^[A-Z]{6}\+/, ""));
      }
    }
    const xobjects = dict.lookup(PDFName.of("XObject"));
    if (!(xobjects instanceof PDFDict)) return;
    for (const value of xobjects.values()) {
      const object = pdf.context.lookup(value);
      if (object instanceof PDFStream && object.dict.lookup(PDFName.of("Subtype")) === PDFName.of("Form")) {
        walk(object.dict.get(PDFName.of("Resources")), depth + 1);
      }
    }
  };
  walk(page.node.Resources(), 0);
  return [...names];
}

/** A text of a content stream as the bytes of a stream: each character one byte, as it was read. */
const latin1 = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);

/**
 * The firm's paper from a PDF of it, copied as it is: its first page and, when it has one, its following page (a
 * Word document's first page may have a header of its own). A page that holds the text of a document has that text
 * taken out, everything else staying exactly where it was. Each page is measured: where its header ends and its
 * footer begins, and where the text goes clear of both, never closer than `base` (a Word document's own margins).
 */
export async function readPdfPaper(
  bytes: Uint8Array,
  options: { base?: LetterheadMargins } = {},
): Promise<PdfPaperReading> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch {
    return { ok: false, code: "not_pdf" };
  }
  const count = Math.min(source.getPageCount(), 2);
  if (count === 0) return { ok: false, code: "not_pdf" };
  const size = source.getPage(0).getSize();
  let stripped = false;
  const measures: PaperMeasure[] = [];
  const fonts = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const page = source.getPage(index);
    const { height } = page.getSize();
    const { contents, resources } = contentOf(source, page);
    const boxes = printedBoxes(source, contents, resources, IDENTITY).filter((box) => box.high > 0 && box.low < height);
    if (index === 0 && boxes.length === 0) return { ok: false, code: "empty" };
    const body = bodyOf(boxes, height);
    let kept = boxes;
    if (body) {
      const taken = boxes.filter(
        (box) => box.text && box.shown && middleOf(box) >= body.low - 0.5 && middleOf(box) <= body.high + 0.5,
      );
      if (taken.length > 0) {
        const text = withoutShown(
          contents,
          taken.map((box) => box.shown!),
        );
        page.node.set(PDFName.of("Contents"), source.context.register(source.context.flateStream(latin1(text))));
        kept = boxes.filter((box) => !taken.includes(box));
        stripped = true;
      }
    }
    measures.push(measureOf(kept, height, body, options.base));
    for (const font of fontsOf(source, page)) fonts.add(font);
  }
  const paper = await PDFDocument.create();
  for (const page of await paper.copyPages(
    source,
    Array.from({ length: count }, (_, index) => index),
  )) {
    paper.addPage(page);
  }
  // The same paper gives the same bytes: no clock in the file.
  paper.setCreationDate(new Date(0));
  paper.setModificationDate(new Date(0));
  return {
    ok: true,
    pdf: await paper.save(),
    pages: count,
    page: { width: size.width, height: size.height },
    first: measures[0]!,
    rest: measures[count - 1]!,
    stripped,
    fonts: [...fonts].sort(),
  };
}
