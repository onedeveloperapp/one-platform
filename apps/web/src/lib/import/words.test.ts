// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { importLimitsOf, inPieces } from "@/lib/import/limits";
import { PORTFOLIO_FIELDS } from "@/lib/import/mapping";
import { ROW_ERRORS, ROW_WARNINGS } from "@/lib/import/portfolio";
import { canImportPortfolio, IMPORT_FUNCTIONS } from "@/lib/import/who";
import {
  FIELD_KEY,
  IMPORT_REFUSALS,
  importErrorKey,
  LINE_ERROR_KEY,
  REFUSED_LINE_CODES,
  refusedLineKey,
  ROW_FIELDS,
  ROW_PROBLEM_KEY,
  rowFieldKey,
  TABLE_PROBLEM_KEY,
} from "@/lib/import/words";
import messages from "@flyee/content/messages/pt-BR.json";

const ROOT = path.resolve(__dirname, "../../../../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0032_portfolio_import.sql"), "utf8");
const product = messages.product as Record<string, string>;

/** The body of a function of migration 0032. */
function body(name: string): string {
  const start = MIGRATION.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = MIGRATION.indexOf("\n$$;", start);
  return MIGRATION.slice(start, end);
}

/** The codes a function answers a person with when it refuses. */
const refusals = (name: string): string[] =>
  [...body(name).matchAll(/'ok', false, 'code', '([a-z_]+)'/g)].map((match) => match[1]);

describe("the words of the import of a portfolio", () => {
  it("has words for every refusal the database answers a person with, and the list says them all", () => {
    const answered = [
      ...new Set(
        [
          "create_import_batch",
          "add_import_rows",
          "commit_import_batch",
          "revert_import_batch",
          "discard_import_batch",
        ].flatMap(refusals),
      ),
    ];
    expect(answered.length).toBeGreaterThan(0);
    expect([...answered].sort()).toEqual([...IMPORT_REFUSALS].sort());
    for (const code of IMPORT_REFUSALS) expect(importErrorKey(code), code).not.toBe("import-error-failed");
  });

  it("says each code with words of the catalog, and anything else as a failure", () => {
    for (const code of [
      ...IMPORT_REFUSALS,
      "not_authorized",
      "batch_not_found",
      "second_factor_required",
      "not_allowed_in_support_session",
      "interrupted",
      "failed",
      "anything else",
    ]) {
      expect(product[importErrorKey(code)], code).toBeTruthy();
    }
    expect(importErrorKey("anything else")).toBe("import-error-failed");
    expect(product["import-error-invalid-row-at"]).toContain("{what}");
  });

  it("says what of a line the database refused, for every field it names", () => {
    const named = [...body("add_import_rows").matchAll(/then '([a-z_]+)'/g)].map((match) => match[1]);
    expect([...new Set(named)].sort()).toEqual([...ROW_FIELDS].sort());
    for (const field of [...ROW_FIELDS, undefined, "anything else"]) {
      expect(product[rowFieldKey(field)], String(field)).toBeTruthy();
    }
    expect(rowFieldKey("anything else")).toBe("import-row-field-other");
  });

  it("has words for what a file is not, for each column, and for each problem of a line", () => {
    for (const key of Object.values(TABLE_PROBLEM_KEY)) expect(product[key], key).toBeTruthy();
    expect(Object.keys(FIELD_KEY).sort()).toEqual([...PORTFOLIO_FIELDS].sort());
    for (const key of Object.values(FIELD_KEY)) expect(product[key], key).toBeTruthy();
    expect(Object.keys(ROW_PROBLEM_KEY).sort()).toEqual([...ROW_ERRORS, ...ROW_WARNINGS].sort());
    for (const key of Object.values(ROW_PROBLEM_KEY)) {
      expect(product[key], key).toBeTruthy();
      // Each says how many lines it is in.
      expect(product[key], key).toContain("{count, plural,");
    }
    expect(Object.keys(LINE_ERROR_KEY).sort()).toEqual([...ROW_ERRORS].sort());
    for (const key of Object.values(LINE_ERROR_KEY)) expect(product[key], key).toBeTruthy();
  });

  it("says why a line was refused: by the batch's own codes, by the case's, or in general words", () => {
    // The codes the batch itself gives a line it did not bring.
    const own = [...MIGRATION.matchAll(/outcome = 'refused', code = '([a-z_]+)'/g)].map((match) => match[1]);
    expect([...new Set(own)].sort()).toEqual(["expired", "undone"]);
    for (const code of own) expect(refusedLineKey(code), code).not.toBe("import-refused-other");
    for (const code of REFUSED_LINE_CODES) expect(product[refusedLineKey(code)], code).toBeTruthy();
    // A line that failed for a reason nobody foresaw, and one with no code at all.
    expect(refusedLineKey("failed")).toBe("import-refused-other");
    expect(refusedLineKey(null)).toBe("import-refused-other");
    expect(product["import-refused-other"]).toBeTruthy();
  });

  it("is shown to who the database lets bring a portfolio, and to nobody else", () => {
    const allowed = [...body("import_batch_for_writer").matchAll(/firm_function in \(([^)]+)\)/g)].flatMap((match) =>
      [...match[1].matchAll(/'([a-z_]+)'/g)].map((name) => name[1]),
    );
    expect([...new Set(allowed)].sort()).toEqual([...IMPORT_FUNCTIONS].sort());
    for (const firmFunction of IMPORT_FUNCTIONS) expect(canImportPortfolio(firmFunction)).toBe(true);
    for (const other of ["atendimento", "", null, undefined]) expect(canImportPortfolio(other)).toBe(false);
  });
});

describe("the limits of a batch", () => {
  it("are the database's, and what cannot be read is what the setting seeds", () => {
    expect(importLimitsOf({ max_rows: 800, rows_per_call: 50, oldest_filed_on: "2000-01-01" })).toEqual({
      maxRows: 800,
      rowsPerCall: 50,
      oldestFiledOn: "2000-01-01",
    });
    const seeded = { maxRows: 20_000, rowsPerCall: 200, oldestFiledOn: "1990-01-01" };
    expect(importLimitsOf(null)).toEqual(seeded);
    expect(importLimitsOf({ max_rows: "many", rows_per_call: 0, oldest_filed_on: "ontem" })).toEqual(seeded);
    // What the app falls back to is what the migration seeds.
    expect(MIGRATION).toContain("'max_rows', 20000");
    expect(MIGRATION).toContain("'rows_per_call', 200");
    expect(MIGRATION).toContain("'oldest_filed_on', '1990-01-01'");
  });

  it("cut a list in pieces of a size, none of them empty", () => {
    expect(inPieces([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(inPieces([], 2)).toEqual([]);
    expect(inPieces([1, 2], 0)).toEqual([[1], [2]]);
  });
});
