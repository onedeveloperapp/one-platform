/**
 * The import of a spreadsheet (docs/ONE-PLANO-DESENVOLVIMENTO.md, S8): what
 * the firm exports from the system it used before, read in the browser. The
 * engine is pure: bytes in, a table out, then rows staged with what each one
 * would do. Nothing here touches the database, so every rule that decides
 * what a cell means is a unit test, not a surprise on a firm's own data.
 *
 * A spreadsheet is a firm's clients: it is read where the person chose it,
 * and only the rows the person confirmed go to the server.
 */

/** A sheet as read: the line of its headers, and every filled line under it as a row. */
export type ParsedTable = {
  headers: string[];
  rows: string[][];
  /**
   * The line of the file each row was on, as the person sees it in the spreadsheet (the first line is 1):
   * an error that points at the wrong line sends her to the wrong client.
   */
  lines: number[];
  format: "xlsx" | "csv";
  /** The sheet read, when the file has several. */
  sheet: string | null;
  /**
   * Every filled line read, the line of the headers among them (`header`, its index), so that a person can
   * say the headers are on another line: a table made by hand has none.
   */
  filled?: { cells: string[][]; lines: number[]; header: number };
};

/** What a file is, by its first bytes: one this reads, or one it names and refuses. */
export type SpreadsheetKind = "xlsx" | "csv" | "legacy-office" | "pdf" | "utf-16" | "binary" | "empty";

type Signature = { bytes: number[]; kind: SpreadsheetKind };

const SIGNATURES: Signature[] = [
  { bytes: [0x50, 0x4b, 0x03, 0x04], kind: "xlsx" },
  // The old .xls and .doc: a compound file.
  { bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], kind: "legacy-office" },
  { bytes: [0x25, 0x50, 0x44, 0x46], kind: "pdf" },
  // Excel's "Texto Unicode": tab-delimited, but UTF-16.
  { bytes: [0xff, 0xfe], kind: "utf-16" },
  { bytes: [0xfe, 0xff], kind: "utf-16" },
];

/** Enough to tell a binary file without reading all of a large one. */
const SCAN_LIMIT = 8192;

/**
 * What a file is, decided from its bytes and never from its name: every file dialog offers "all files", and
 * a PDF read as text would offer its noise as column names. A zip is taken for a workbook; whether it is one
 * is told when it is opened.
 */
export function sniffSpreadsheet(bytes: Uint8Array): SpreadsheetKind {
  if (bytes.length === 0) return "empty";
  const signature = SIGNATURES.find(
    (candidate) =>
      bytes.length >= candidate.bytes.length && candidate.bytes.every((byte, index) => bytes[index] === byte),
  );
  if (signature) return signature.kind;
  const scanned = bytes.length > SCAN_LIMIT ? bytes.subarray(0, SCAN_LIMIT) : bytes;
  return scanned.includes(0x00) ? "binary" : "csv";
}

/** What reading a file came to: its table, or why it could not be read, by a code the screen has words for. */
export type TableRead = { ok: true; table: ParsedTable } | { ok: false; code: TableProblem };

export type TableProblem =
  | "empty"
  | "legacy-office"
  | "pdf"
  | "utf-16"
  | "binary"
  | "not_a_workbook"
  | "too_large"
  | "no_rows";

/**
 * The most rows and columns a file is read to, in the browser: a firm's portfolio is thousands of lawsuits,
 * never millions of cells. How many lines one batch takes is another number, the database's (the setting
 * `import`): a file longer than a batch is brought in more than one.
 */
export const MOST_ROWS = 100_000;
export const MOST_COLUMNS = 80;

/** How many of the first filled lines are looked at for the headers. */
const HEADER_SCAN = 20;

/**
 * How a line is read for the headers: how many facts of a lawsuit its cells name, or a negative number for a
 * line of data (one with a lawsuit's number in it), above which the headers are.
 */
export type HeaderScore = (row: readonly string[]) => number;

export type TableOptions = {
  /** The line of the file each row of cells was on, when it is not its place (a sheet skips its empty rows). */
  lines?: readonly number[];
  headerScore?: HeaderScore;
};

/**
 * The line of the headers, among the filled lines (their indexes). A report opens with its title, the firm's
 * name, the day it was issued, a filter, each on a line of one or two cells: the headers are, among the
 * first filled lines above the first line of data, the one whose cells name the most facts of a lawsuit
 * (two at least; on a tie, the one nearest the data); when none names two, the first of them filled at least
 * two thirds as much as the fullest (two cells at least). A sheet of one column has its first line.
 */
function headerLine(cells: readonly string[][], score: HeaderScore | undefined): number {
  const seen: { index: number; filled: number }[] = [];
  for (let index = 0; index < cells.length && seen.length < HEADER_SCAN; index += 1) {
    if (score && score(cells[index]) < 0) break;
    seen.push({ index, filled: cells[index].reduce((count, cell) => count + (cell.trim() === "" ? 0 : 1), 0) });
  }
  // A sheet whose first line is already one of data has no headers: its first line is taken, to be chosen again.
  if (seen.length === 0) return 0;
  if (score) {
    let best = { index: -1, named: 1 };
    for (const line of seen) {
      const named = score(cells[line.index]);
      if (named >= best.named && named >= 2) best = { index: line.index, named };
    }
    if (best.index !== -1) return best.index;
  }
  const fullest = Math.max(...seen.map((line) => line.filled));
  const least = Math.max(2, Math.ceil((fullest * 2) / 3));
  return (seen.find((line) => line.filled >= least) ?? seen[0]).index;
}

/** A table whose headers are the filled line at `header`, every filled line under it a row. */
function sliced(
  filled: { cells: string[][]; lines: number[] },
  header: number,
  format: ParsedTable["format"],
  sheet: string | null,
): TableRead {
  const rows = filled.cells.slice(header + 1);
  if (rows.length === 0) return { ok: false, code: "no_rows" };
  return {
    ok: true,
    table: {
      headers: filled.cells[header].map((cell) => cell.replace(/\s+/g, " ").trim()),
      rows,
      lines: filled.lines.slice(header + 1),
      format,
      sheet,
      filled: { ...filled, header },
    },
  };
}

/**
 * A table from rows of cells: the line of the headers (past a report's title), every filled line under it
 * as a row, each with the line of the file it was on; what is above the headers and the empty lines are
 * left out of the rows, and kept to choose the headers again.
 */
export function tableOf(
  cells: string[][],
  format: ParsedTable["format"],
  sheet: string | null,
  options: TableOptions = {},
): TableRead {
  const width = Math.min(
    cells.reduce((most, row) => Math.max(most, row.length), 0),
    MOST_COLUMNS,
  );
  const filled: { cells: string[][]; lines: number[] } = { cells: [], lines: [] };
  for (let index = 0; index < cells.length; index += 1) {
    if (!cells[index].some((cell) => cell.trim() !== "")) continue;
    if (filled.cells.length > MOST_ROWS + HEADER_SCAN) return { ok: false, code: "too_large" };
    filled.cells.push(Array.from({ length: width }, (_, column) => (cells[index][column] ?? "").trim()));
    filled.lines.push(options.lines?.[index] ?? index + 1);
  }
  if (filled.cells.length === 0) return { ok: false, code: "no_rows" };
  const read = sliced(filled, headerLine(filled.cells, options.headerScore), format, sheet);
  if (read.ok && read.table.rows.length > MOST_ROWS) return { ok: false, code: "too_large" };
  return read;
}

/** The lines a person may say the headers are on: the first filled lines of the file, each with its first cells. */
export function headerChoices(table: ParsedTable): { index: number; line: number; preview: string }[] {
  if (!table.filled) return [];
  return table.filled.cells.slice(0, HEADER_SCAN).map((cells, index) => ({
    index,
    line: table.filled!.lines[index],
    preview: cells
      .filter((cell) => cell !== "")
      .slice(0, 4)
      .join(" · ")
      .slice(0, 90),
  }));
}

/** The same file with its headers on another of its filled lines (`index`, as `headerChoices` gives it). */
export function withHeaderAt(table: ParsedTable, index: number): TableRead {
  if (!table.filled || index < 0 || index >= table.filled.cells.length) return { ok: true, table };
  return sliced(table.filled, index, table.format, table.sheet);
}

/** A column's letters, as a spreadsheet names it: 0 is "A", 26 is "AA". */
export function columnLetters(index: number): string {
  let letters = "";
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }
  return letters;
}
