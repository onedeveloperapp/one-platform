/**
 * A bank statement read in the person's browser (phase 4, migrations 0126 and 0127): the file is never uploaded, only
 * its lines go to the books, with the file's SHA-256 so the same file twice adds nothing. An OFX (the format every bank
 * exports, and the one the screen recommends), or a CSV or an Excel workbook read by the portfolio's own reader. OFX 1
 * files are often written in Windows-1252 (their header says `CHARSET:1252`, not always rightly), OFX 2 in UTF-8: the
 * bytes say which. A PDF is named and refused with what to do. Browser-only.
 */
import { occurrenceKeys, statementFromTable, statementHeaderScore } from "@/lib/finance/statement-table";
import { readSpreadsheet } from "@/lib/import/read";
import { type OfxLine, readOfx } from "@flyee/rules/finance";

export type StatementFormat = "ofx" | "csv" | "xlsx" | "pdf";

/** What the screen sends of a statement: its days, the bank's balance when it says one, and its lines. */
export type ReadStatement = {
  startsOn: string | null;
  endsOn: string | null;
  balance: { cents: number; on: string } | null;
  lines: OfxLine[];
};

export type StatementFileProblem =
  | "not_ofx"
  | "no_lines"
  | "too_large"
  | "unreadable"
  | "pdf"
  | "columns_unknown"
  | "spreadsheet";

export type StatementFile =
  | { ok: true; statement: ReadStatement; sha256: string; fileName: string; format: StatementFormat }
  | { ok: false; code: StatementFileProblem };

/** The largest statement read: a year of a busy account is far smaller. */
export const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;

function decode(bytes: Uint8Array): string {
  // UTF-8 first, whatever the header says (some banks write CHARSET:1252 over UTF-8 bytes); a file whose bytes are no
  // UTF-8 is Windows-1252, as OFX 1 usually is. Plain ASCII reads the same either way.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** An OFX, by what its first bytes say: its header, or its first tag. */
function looksOfx(bytes: Uint8Array): boolean {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048)).toUpperCase();
  return head.includes("OFXHEADER") || head.includes("<OFX>") || head.includes("<?OFX");
}

/**
 * The lines of a spreadsheet each with an id: the export's own (a column of ids), or the hash of its key and of how
 * many times that key came before it in the file.
 */
export async function withIds(lines: readonly OfxLine[]): Promise<OfxLine[]> {
  const keys = occurrenceKeys(lines);
  const encoder = new TextEncoder();
  return Promise.all(
    lines.map(async (line, index) =>
      line.bankId
        ? { ...line, bankId: `id:${line.bankId}` }
        : { ...line, bankId: `t:${(await sha256(encoder.encode(keys[index]))).slice(0, 48)}` },
    ),
  );
}

export async function readStatementFile(file: File): Promise<StatementFile> {
  if (file.size > MAX_STATEMENT_BYTES) return { ok: false, code: "too_large" };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, code: "unreadable" };
  }
  const fileName = file.name.slice(0, 200);
  if (looksOfx(bytes)) {
    const read = readOfx(decode(bytes));
    if (!read.ok) return { ok: false, code: read.code };
    const { startsOn, endsOn, balance, lines } = read.statement;
    return {
      ok: true,
      statement: { startsOn, endsOn, balance, lines },
      sha256: await sha256(bytes),
      fileName,
      format: "ofx",
    };
  }
  const table = readSpreadsheet(bytes, { headerScore: statementHeaderScore });
  if (!table.ok) {
    if (table.code === "pdf") return { ok: false, code: "pdf" };
    if (table.code === "no_rows" || table.code === "empty") return { ok: false, code: "no_lines" };
    return { ok: false, code: "spreadsheet" };
  }
  const read = statementFromTable(table.table);
  if (!read.ok) return { ok: false, code: read.code };
  return {
    ok: true,
    statement: { ...read.statement, lines: await withIds(read.statement.lines) },
    sha256: await sha256(bytes),
    fileName,
    format: table.table.format,
  };
}
