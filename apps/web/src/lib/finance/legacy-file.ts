/**
 * The open bills of the system a firm used before, read in the person's browser (migration 0153): the file is never
 * uploaded, only its lines go to the books, each with the hash of its key in the file so the same file brought twice
 * opens nothing twice. A PDF, an old `.xls` or a file whose columns cannot be told is named and refused with what to do.
 * A typed line that does not check is left out of its bill (the bill goes without it). Browser-only.
 */
import {
  legacyBillsFromTable,
  type LegacyColumns,
  legacyColumns,
  type LegacyDirection,
  legacyHeaderScore,
  type LegacyRead,
} from "@/lib/finance/legacy-bills";
import { readSpreadsheet } from "@/lib/import/read";
import type { ParsedTable } from "@/lib/import/table";
import { readBoleto } from "@flyee/rules/boleto";

export type LegacyFileProblem = "too_large" | "unreadable" | "pdf" | "spreadsheet" | "no_lines" | "columns_unknown";

export type LegacyFile =
  | { ok: true; fileName: string; table: Pick<ParsedTable, "headers" | "rows">; columns: LegacyColumns }
  | { ok: false; code: LegacyFileProblem };

/** How many lines one call takes: the setting `finance.import_lines_per_call`. */
export const IMPORT_LINES_PER_CALL = 500;

/** The largest file read: thousands of open bills are far smaller. */
export const MAX_LEGACY_BYTES = 10 * 1024 * 1024;

/** Reads the file and finds its columns; the bills are read from it once the person says the way, if it has none. */
export async function readLegacyFile(file: File): Promise<LegacyFile> {
  if (file.size > MAX_LEGACY_BYTES) return { ok: false, code: "too_large" };
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, code: "unreadable" };
  }
  const table = readSpreadsheet(bytes, { headerScore: legacyHeaderScore });
  if (!table.ok) {
    if (table.code === "pdf") return { ok: false, code: "pdf" };
    if (table.code === "no_rows" || table.code === "empty") return { ok: false, code: "no_lines" };
    return { ok: false, code: "spreadsheet" };
  }
  const columns = legacyColumns(table.table.headers);
  if (!columns) return { ok: false, code: "columns_unknown" };
  return { ok: true, fileName: file.name.slice(0, 200), table: table.table, columns };
}

/** What the database takes of each line: the key hashed to fit, and a typed line only where it checks. */
export type LegacyLine = {
  line: number;
  key: string;
  direction: LegacyDirection;
  counterparty: string | null;
  description: string | null;
  cents: number;
  due_on: string;
  competence_on: string;
  category: string | null;
  cnj: string | null;
  typed_line: string | null;
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The bills of the file under the way the person said, and the lines as the database takes them. */
export async function legacyLines(
  file: Extract<LegacyFile, { ok: true }>,
  fallback: LegacyDirection | null,
  today: string,
): Promise<{ read: LegacyRead; lines: LegacyLine[] }> {
  const read = legacyBillsFromTable(file.table, file.columns, fallback);
  const lines = await Promise.all(
    read.bills.map(async (bill) => ({
      line: bill.line,
      key: `l:${(await sha256(bill.key)).slice(0, 48)}`,
      direction: bill.direction,
      counterparty: bill.counterparty,
      description: bill.description,
      cents: bill.cents,
      due_on: bill.dueOn,
      competence_on: bill.competenceOn,
      category: bill.category,
      cnj: bill.cnj,
      typed_line: bill.typedLine && readBoleto(bill.typedLine, today).ok ? bill.typedLine : null,
    })),
  );
  return { read, lines };
}
