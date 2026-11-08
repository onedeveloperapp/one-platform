import { strToU8, zipSync } from "fflate";

/**
 * A table written as an Excel workbook (.xlsx), in the person's browser: the project's own writer, with no paid
 * component (phase 1 of the plan of the controladoria). One sheet, its first line the titles in bold and frozen,
 * with Excel's filter on them; a text as a text (never read as a formula, whatever it starts with), a number as a
 * number, a day and a moment as Excel's own dates, so a column sorts and filters as what it is. Pure: it answers the
 * bytes of the file. `readXlsx` (`lib/import/xlsx.ts`) reads back what this writes.
 */

export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * What a column holds: `text`, `number`, `date` ("YYYY-MM-DD") or `moment` ("YYYY-MM-DD HH:MM", already on the
 * clock it is to be read on).
 */
export type XlsxKind = "text" | "number" | "date" | "moment";

export type XlsxColumn = { title: string; kind?: XlsxKind; /** In characters. */ width?: number };

/** A cell's value; null is an empty cell. */
export type XlsxCell = string | number | null;

/** The styles of `styles.xml`, by their place in `cellXfs`. */
const STYLE = { plain: 0, title: 1, date: 2, moment: 3 } as const;

/** Excel counts days from 30 December 1899. */
const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 30);

/** What XML 1.0 does not take, even escaped (a control character a court's or a client's text may carry). */
// eslint-disable-next-line no-control-regex
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

/** What has to change in a text: most cells have none of it, and are written as they are. */
// eslint-disable-next-line no-control-regex
const NEEDS_ESCAPE = /[&<>"\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/;

const escapeXml = (text: string): string =>
  NEEDS_ESCAPE.test(text)
    ? text
        .replace(NOT_XML, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
    : text;

/** The letters of a column, from zero: A, B, ... Z, AA. */
export function columnName(index: number): string {
  let name = "";
  for (let at = index + 1; at > 0; at = Math.floor((at - 1) / 26)) {
    name = String.fromCharCode(65 + ((at - 1) % 26)) + name;
  }
  return name;
}

/** A day or a moment as Excel's number of days; null when it is not one. */
export function excelSerial(value: string): number | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(value);
  if (!parts) return null;
  const [, year, month, day, hour, minute] = parts;
  const at = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour ?? 0), Number(minute ?? 0));
  const whole = new Date(at);
  // A day the calendar does not have is no day: it would roll over to another.
  if (whole.getUTCMonth() !== Number(month) - 1 || whole.getUTCDate() !== Number(day)) return null;
  return (at - EPOCH) / DAY_MS;
}

const textCell = (ref: string, text: string, style: number = STYLE.plain): string =>
  `<c r="${ref}"${style ? ` s="${style}"` : ""} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;

function cellXml(ref: string, value: XlsxCell, kind: XlsxKind): string {
  if (value === null || value === "") return "";
  if (kind === "number" && typeof value === "number" && Number.isFinite(value))
    return `<c r="${ref}"><v>${value}</v></c>`;
  if ((kind === "date" || kind === "moment") && typeof value === "string") {
    const serial = excelSerial(value);
    if (serial !== null) return `<c r="${ref}" s="${kind === "date" ? STYLE.date : STYLE.moment}"><v>${serial}</v></c>`;
  }
  return textCell(ref, String(value));
}

/** A sheet's name as Excel takes it: at most 31 characters, none of the few it refuses. */
export function sheetName(name: string): string {
  const clean = name
    .replace(/[[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31)
    .trim();
  return clean || "Planilha";
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

/** The bytes of a workbook of one sheet. */
export function writeXlsx(input: { sheet: string; columns: XlsxColumn[]; rows: XlsxCell[][] }): Uint8Array {
  const { columns, rows } = input;
  // A hundred thousand lines of a dozen cells each: each column's letters and kind are worked out once.
  const letters = columns.map((_, at) => columnName(at));
  const kinds = columns.map((column) => column.kind ?? "text");
  const lastColumn = columnName(Math.max(columns.length - 1, 0));
  const lines: string[] = [
    `<row r="1">${columns.map((column, at) => textCell(`${letters[at]}1`, column.title, STYLE.title)).join("")}</row>`,
  ];
  rows.forEach((row, index) => {
    const line = index + 2;
    let cells = "";
    for (let at = 0; at < letters.length; at += 1) {
      cells += cellXml(`${letters[at]}${line}`, row[at] ?? null, kinds[at]);
    }
    lines.push(`<row r="${line}">${cells}</row>`);
  });
  const widths = columns
    .map((column, at) => `<col min="${at + 1}" max="${at + 1}" width="${column.width ?? 16}" customWidth="1"/>`)
    .join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>${
    widths ? `<cols>${widths}</cols>` : ""
  }<sheetData>${lines.join("")}</sheetData><autoFilter ref="A1:${lastColumn}${rows.length + 1}"/></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheetName(input.sheet))}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  return zipSync(
    {
      "[Content_Types].xml": strToU8(CONTENT_TYPES),
      "_rels/.rels": strToU8(ROOT_RELS),
      "xl/workbook.xml": strToU8(workbook),
      "xl/_rels/workbook.xml.rels": strToU8(WORKBOOK_RELS),
      "xl/styles.xml": strToU8(STYLES),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    },
    { level: 1 },
  );
}
