import { tableOf, type TableOptions, type TableRead } from "@/lib/import/table";

/**
 * A text export (CSV) as a table. Its encoding is told by its bytes (UTF-8
 * when they are, Windows-1252 otherwise: what Excel in Portuguese writes),
 * its delimiter by its first lines (";" is what a Brazilian Excel writes,
 * "," what others do), and its cells by the usual rule: a cell in double
 * quotes may hold the delimiter, a line break and a doubled quote.
 *
 * Pure: no I/O.
 */

/** The bytes as text: UTF-8 when they are valid UTF-8, Windows-1252 otherwise. A byte order mark is dropped. */
export function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const DELIMITERS = [";", ",", "\t", "|"] as const;

/** The cells of a text, by a delimiter. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** How many first lines a delimiter is judged by. */
const SAMPLE_LINES = 30;

/**
 * The delimiter of a text: the one whose most common number of cells (more than one) the first lines agree on,
 * weighed by that number: a title alone on its line counts for none, and a comma inside a value ("1.500,00")
 * splits a line of a ";" file in two, never in as many cells as its ";" do. ";" when none cuts a line (a
 * single column).
 */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 20_000);
  // A sample that was cut ends in a line that may be cut too: it is not judged.
  const cut = text.length > sample.length;
  let best: { delimiter: string; weight: number; cells: number } = { delimiter: ";", weight: 0, cells: 1 };
  for (const delimiter of DELIMITERS) {
    const all = parseDelimited(sample, delimiter).filter((row) => row.some((cell) => cell.trim() !== ""));
    const rows = (cut ? all.slice(0, -1) : all).slice(0, SAMPLE_LINES);
    const counts = new Map<number, number>();
    for (const row of rows) if (row.length > 1) counts.set(row.length, (counts.get(row.length) ?? 0) + 1);
    for (const [cells, agreeing] of counts) {
      const weight = agreeing * cells;
      if (weight > best.weight || (weight === best.weight && cells > best.cells)) best = { delimiter, weight, cells };
    }
  }
  return best.delimiter;
}

export function readCsv(bytes: Uint8Array, options: Pick<TableOptions, "headerScore"> = {}): TableRead {
  const text = decodeText(bytes);
  return tableOf(parseDelimited(text, detectDelimiter(text)), "csv", null, { headerScore: options.headerScore });
}
