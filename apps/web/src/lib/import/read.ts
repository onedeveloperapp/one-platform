import { readCsv } from "@/lib/import/csv";
import { type HeaderScore, sniffSpreadsheet, type TableRead } from "@/lib/import/table";
import { readXlsx } from "@/lib/import/xlsx";

/**
 * A file a person chose, as a table: an Excel workbook or a text export,
 * told by its bytes. What it is not is named, so the screen says what to do
 * (save the old .xls as .xlsx, export the PDF's table as a spreadsheet).
 * `headerScore` says how much a line reads as the headers of what is being
 * brought, to find them under a report's title. Pure but for the unzipping.
 */
export function readSpreadsheet(bytes: Uint8Array, options: { headerScore?: HeaderScore } = {}): TableRead {
  const kind = sniffSpreadsheet(bytes);
  if (kind === "xlsx") return readXlsx(bytes, options);
  if (kind === "csv") return readCsv(bytes, options);
  return { ok: false, code: kind };
}
