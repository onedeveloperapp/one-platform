import { strFromU8, unzipSync } from "fflate";

import { MOST_COLUMNS, MOST_ROWS, tableOf, type TableOptions, type TableRead } from "@/lib/import/table";

/**
 * An Excel workbook (.xlsx) as a table: its first sheet a person sees, read
 * from the zip the file is. What is read: the shared strings, the styles (to
 * tell a date from a number: Excel keeps a date as the count of days since
 * 1900), the workbook (its sheets, which are hidden, and whether it counts
 * from 1904) and the sheet's cells. A date comes out as "YYYY-MM-DD" (with
 * " HH:MM" when it has an hour), a number as written, a text as it is. A
 * formula's cell gives the value Excel last computed for it. The elements
 * are read with or without a namespace's prefix (`<x:row>`, which some
 * programs write).
 *
 * It refuses what it cannot read as a whole: a zip that is no workbook, one
 * protected by a password (a compound file inside), one that unpacks to more
 * than the limit. Pure but for the unzipping: no I/O.
 *
 * A number of more than fifteen digits typed as a number is not one Excel
 * keeps: it rounds it to fifteen, and what it lost is lost. Such a number
 * comes out as Excel shows it ("5.12345672202581E+19"), never as twenty
 * digits that would be another lawsuit's; a lawsuit's number comes whole
 * only as text, which is how the systems export it.
 */

/** The most a workbook may unpack to: a portfolio's is a few megabytes. */
const MOST_BYTES = 80 * 1024 * 1024;

/** A namespace's prefix an element may carry. */
const PREFIX = "(?:[A-Za-z_][\\w.-]*:)?";

const decode = (text: string): string =>
  text.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (whole, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[entity] ?? whole;
  });

/** Excel escapes a control character in a string as _xHHHH_. */
const unescape = (text: string): string =>
  text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));

const PHONETIC = new RegExp(`<${PREFIX}rPh[\\s\\S]*?<\\/${PREFIX}rPh>`, "g");
const TEXT = new RegExp(`<${PREFIX}t(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${PREFIX}t>`, "g");
const VALUE = new RegExp(`<${PREFIX}v(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${PREFIX}v>`);

/** The text of a string item: every `<t>` of it, but the phonetic ones. */
function stringOf(item: string): string {
  const plain = item.replace(PHONETIC, "");
  let text = "";
  for (const match of plain.matchAll(TEXT)) text += match[1];
  return unescape(decode(text));
}

/**
 * The elements of a name in a text, each with its opening tag's attributes and its body (none when it closes
 * itself). Read by hand and not by one pattern: a cell that closes itself must not take the next cell's body.
 */
function* elements(text: string, name: string): Generator<{ attributes: string; body: string }> {
  const open = new RegExp(`<(${PREFIX})${name}(\\s[^>]*?)?(\\/)?>`, "g");
  for (let match = open.exec(text); match; match = open.exec(text)) {
    if (match[3]) {
      yield { attributes: match[2] ?? "", body: "" };
      continue;
    }
    const close = `</${match[1]}${name}>`;
    const end = text.indexOf(close, open.lastIndex);
    if (end === -1) return;
    yield { attributes: match[2] ?? "", body: text.slice(open.lastIndex, end) };
    open.lastIndex = end + close.length;
  }
}

/** An attribute of a tag, by its name (with any prefix of the name, for `r:id`). */
const attribute = (tag: string, name: string): string | null =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

/** The tags of a name in a text, opening or closing themselves (their attributes only). */
const tags = (text: string, name: string): string[] =>
  [...text.matchAll(new RegExp(`<${PREFIX}${name}\\s[^>]*>`, "g"))].map((match) => match[0]);

/** The built-in number formats that are dates or times. */
const DATE_FORMATS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56,
  57, 58,
]);

/** A custom format is a date when, outside its quoted text and brackets, it has a day, a month, a year or an hour. */
const isDateFormat = (code: string): boolean =>
  /[dmyhs]/i.test(
    code
      .replace(/"[^"]*"/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/\\./g, ""),
  ) && !/^general$/i.test(code.trim());

/** For each cell style, whether its number format is a date. */
function dateStyles(styles: string | null): boolean[] {
  if (!styles) return [];
  const custom = new Map<number, string>();
  for (const tag of tags(styles, "numFmt")) {
    const id = Number(attribute(tag, "numFmtId"));
    const code = attribute(tag, "formatCode");
    if (Number.isInteger(id) && code !== null) custom.set(id, decode(code));
  }
  const formats = [...elements(styles, "cellXfs")][0]?.body ?? "";
  return tags(formats, "xf").map((tag) => {
    const id = Number(attribute(tag, "numFmtId") ?? 0);
    return custom.has(id) ? isDateFormat(custom.get(id) as string) : DATE_FORMATS.has(id);
  });
}

/** Excel's count of days as a date: "YYYY-MM-DD", with " HH:MM" when it has an hour. Null when it is no date. */
export function excelDate(serial: number, from1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return null;
  // Day 1 is 1 January 1900, and Excel counts a 29 February 1900 that never was.
  const days = from1904 ? serial + 1462 : serial < 60 ? serial + 1 : serial;
  const whole = Math.floor(days);
  const date = new Date(Date.UTC(1899, 11, 30) + whole * 86_400_000);
  const minutes = Math.round((days - whole) * 1440);
  const day = date.toISOString().slice(0, 10);
  if (minutes === 0 || minutes >= 1440) return day;
  return `${day} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A column's letters ("A", "AB") as its index. */
function columnOf(reference: string | null): number | null {
  const letters = /^[A-Z]+/.exec(reference ?? "")?.[0];
  if (!letters) return null;
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/**
 * A number as a person reads it: no exponent for a whole number Excel keeps whole, no ".0". A whole number of
 * more than fifteen digits is one Excel did not keep whole: it is written as Excel shows it, with its exponent.
 */
export function numberOf(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  if (Number.isInteger(value)) return value.toExponential().replace("e", "E");
  return /e/i.test(raw) ? String(value) : raw;
}

export function readXlsx(bytes: Uint8Array, options: Pick<TableOptions, "headerScore"> = {}): TableRead {
  let files: Record<string, Uint8Array>;
  let unpacked = 0;
  let tooLarge = false;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (
          !/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(
            file.name,
          )
        ) {
          return false;
        }
        unpacked += file.originalSize;
        if (unpacked > MOST_BYTES) tooLarge = true;
        return !tooLarge;
      },
    });
  } catch {
    return { ok: false, code: "not_a_workbook" };
  }
  if (tooLarge) return { ok: false, code: "too_large" };
  const text = (name: string): string | null => (files[name] ? strFromU8(files[name]) : null);
  const workbook = text("xl/workbook.xml");
  if (!workbook) return { ok: false, code: "not_a_workbook" };

  // The first sheet a person sees (a hidden one holds what a system keeps for itself), by where its relation points.
  const sheets = tags(workbook, "sheet");
  const first = sheets.find((tag) => !/^(hidden|veryHidden)$/.test(attribute(tag, "state") ?? "")) ?? sheets[0] ?? "";
  const name = attribute(first, "name");
  const relation = attribute(first, `${PREFIX}id`);
  const relations = text("xl/_rels/workbook.xml.rels") ?? "";
  const target = tags(relations, "Relationship").find((tag) => attribute(tag, "Id") === relation);
  const path = target ? (attribute(target, "Target") ?? "").replace(/^\/?(xl\/)?/, "xl/") : "xl/worksheets/sheet1.xml";
  const sheet = text(path) ?? text("xl/worksheets/sheet1.xml");
  if (!sheet) return { ok: false, code: "not_a_workbook" };

  const strings = [...elements(text("xl/sharedStrings.xml") ?? "", "si")].map((item) => stringOf(item.body));
  const dates = dateStyles(text("xl/styles.xml"));
  const from1904 = new RegExp(`<${PREFIX}workbookPr\\s[^>]*date1904="(1|true)"`).test(workbook);

  // Only the rows with something in them, each with the line it is on: a sheet may say it goes on to a row
  // far below, where somebody once formatted an empty cell.
  const cells: string[][] = [];
  const lines: number[] = [];
  let line = 0;
  for (const sheetRow of elements(sheet, "row")) {
    // A row says its own number; the ones between are empty lines of the sheet.
    const numbered = Number(attribute(sheetRow.attributes, "r"));
    line = Number.isInteger(numbered) && numbered > line ? numbered : line + 1;
    const row: string[] = [];
    let next = 0;
    for (const cell of elements(sheetRow.body, "c")) {
      const tag = cell.attributes;
      const column = columnOf(attribute(tag, "r")) ?? next;
      next = column + 1;
      if (column >= MOST_COLUMNS) continue;
      const body = cell.body;
      const type = attribute(tag, "t");
      const raw = VALUE.exec(body)?.[1] ?? null;
      let value = "";
      if (type === "inlineStr") value = stringOf(body);
      else if (raw === null) value = "";
      else if (type === "s") value = strings[Number(raw)] ?? "";
      else if (type === "str") value = unescape(decode(raw));
      else if (type === "b") value = raw === "1" ? "VERDADEIRO" : "FALSO";
      else if (type === "e") value = "";
      else if (type === "d") value = raw.slice(0, 10);
      else if (dates[Number(attribute(tag, "s") ?? -1)]) value = excelDate(Number(raw), from1904) ?? numberOf(raw);
      else value = numberOf(raw);
      while (row.length < column) row.push("");
      row[column] = value;
    }
    if (!row.some((value) => value.trim() !== "")) continue;
    // The headers sit among the first lines: a sheet with this many more is larger than an import reads.
    if (cells.length > MOST_ROWS + 50) return { ok: false, code: "too_large" };
    cells.push(row);
    lines.push(line);
  }
  return tableOf(cells, "xlsx", name ? decode(name) : null, { lines, headerScore: options.headerScore });
}
