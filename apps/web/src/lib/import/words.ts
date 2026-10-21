import type { PortfolioField } from "@/lib/import/mapping";
import type { RowError, RowProblem } from "@/lib/import/portfolio";
import type { TableProblem } from "@/lib/import/table";

/**
 * The words of the import of a portfolio (migration 0032), by code: why a
 * file could not be read, what a column is, why a line cannot go or what was
 * left out of it, and what an action answered. Pure: a test reads that every
 * code has its words in the catalog.
 */

export const TABLE_PROBLEM_KEY: Record<TableProblem, string> = {
  empty: "import-file-empty",
  "legacy-office": "import-file-legacy",
  pdf: "import-file-pdf",
  "utf-16": "import-file-utf16",
  binary: "import-file-binary",
  not_a_workbook: "import-file-not-workbook",
  too_large: "import-file-too-large",
  no_rows: "import-file-no-rows",
};

export const FIELD_KEY: Record<PortfolioField, string> = {
  cnj: "import-field-cnj",
  client_name: "import-field-client",
  client_document: "import-field-document",
  opponent: "import-field-opponent",
  unit: "import-field-unit",
  comarca: "import-field-comarca",
  kind: "import-field-kind",
  filed_on: "import-field-filed",
  status: "import-field-status",
  folder: "import-field-folder",
  responsible: "import-field-responsible",
  claim_value: "import-field-value",
  notes: "import-field-notes",
};

/** How many lines a problem is in (each takes `count`): what does not go, and what goes with something left out. */
export const ROW_PROBLEM_KEY: Record<RowProblem, string> = {
  missing_cnj: "import-problem-missing-cnj",
  imprecise_cnj: "import-problem-imprecise-cnj",
  invalid_cnj: "import-problem-invalid-cnj",
  court_not_known: "import-problem-court",
  missing_client: "import-problem-missing-client",
  invalid_cpf: "import-problem-invalid-cpf",
  company_document: "import-problem-company",
  cpf_other_name: "import-problem-cpf-other-name",
  invalid_date: "import-problem-invalid-date",
  old_date: "import-problem-old-date",
  future_date: "import-problem-future-date",
};

/** Why one line does not go, said beside it. */
export const LINE_ERROR_KEY: Record<RowError, string> = {
  missing_cnj: "import-line-missing-cnj",
  imprecise_cnj: "import-line-imprecise-cnj",
  invalid_cnj: "import-line-invalid-cnj",
  court_not_known: "import-line-court",
  missing_client: "import-line-missing-client",
};

/** What an action of the import answered, by the code the database or the server gave; anything else is "failed". */
const ERROR_KEY: Record<string, string> = {
  not_authorized: "import-error-not-allowed",
  batch_not_found: "import-error-not-found",
  batch_not_staged: "import-error-not-staged",
  batch_not_committed: "import-error-not-committed",
  invalid_rows: "import-error-invalid-rows",
  invalid_row: "import-error-invalid-row",
  repeated_line: "import-error-repeated",
  too_many_rows: "import-error-too-many",
  no_rows: "import-error-no-rows",
  second_factor_required: "import-error-second-factor",
  not_allowed_in_support_session: "import-error-support",
  // The app's own: the lines were being decided when a call failed, and what was decided stays.
  interrupted: "import-error-interrupted",
};
export const importErrorKey = (code: string): string => ERROR_KEY[code] ?? "import-error-failed";

/** The codes the database answers a person with (migration 0032), each of which has words. */
export const IMPORT_REFUSALS: readonly string[] = [
  "batch_not_staged",
  "batch_not_committed",
  "invalid_rows",
  "invalid_row",
  "repeated_line",
  "too_many_rows",
  "no_rows",
];

/** What of a line the database refused, when it refused one (`add_import_rows` answers `field`). */
const ROW_FIELD_KEY: Record<string, string> = {
  row: "import-row-field-row",
  cnj: "import-row-field-cnj",
  client_name: "import-row-field-client",
  cpf: "import-row-field-cpf",
  kind: "import-row-field-kind",
  court: "import-row-field-court",
  airline: "import-row-field-airline",
  filed_on: "import-row-field-filed",
  closed: "import-row-field-closed",
  text: "import-row-field-text",
};
export const rowFieldKey = (field: string | undefined): string =>
  (field ? ROW_FIELD_KEY[field] : undefined) ?? "import-row-field-other";

/** The fields `add_import_rows` names, each of which has words. */
export const ROW_FIELDS: readonly string[] = Object.keys(ROW_FIELD_KEY);

/**
 * Why a line was refused when its batch was decided, by the code the case or
 * the lawsuit gave, or the batch's own (`undone`: undone before the line was
 * decided; `expired`: left for too long); else in general words.
 */
const REFUSED_LINE_KEY: Record<string, string> = {
  unknown_airline: "import-refused-airline",
  invalid_cpf: "import-refused-cpf",
  cpf_in_use: "import-refused-cpf",
  invalid_name: "import-refused-name",
  undone: "import-refused-undone",
  expired: "import-refused-expired",
};
export const refusedLineKey = (code: string | null): string =>
  (code ? REFUSED_LINE_KEY[code] : undefined) ?? "import-refused-other";

/** The codes of a refused line that have their own words; the test reads that the catalog has each. */
export const REFUSED_LINE_CODES: readonly string[] = Object.keys(REFUSED_LINE_KEY);
