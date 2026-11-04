import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { DRAFT_MARKS, modelMarks, PAPER_MARK_KEY, PAPER_MARKS, unknownMarks } from "@/lib/cases/drafts";
import { modelForKind, paperModelFor } from "@/lib/library/facts";
import messages from "@flyee/content/messages/pt-BR.json";

vi.mock("server-only", () => ({}));

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
// The latest definition of `case_paper_filled`: 0054, with the fields of a firm's own form since 0093.
const PAPERS = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0093_paper_fields.sql"), "utf8");

const FIRM = "f0000000-0000-4000-8000-000000000001";
const OTHER = "f0000000-0000-4000-8000-000000000002";

type Row = {
  id: string;
  org_id: string | null;
  document_kind: string | null;
  proceeding_kind: string | null;
  is_default: boolean | null;
};
const row = (id: string, org: string | null, document: string, kind: string | null, isDefault: boolean): Row => ({
  id,
  org_id: org,
  document_kind: document,
  proceeding_kind: kind,
  is_default: isDefault,
});

describe("the marks of a paper (0054, 0093)", () => {
  it("are the ones the database fills, no more and no fewer", () => {
    const filled = [...PAPERS.matchAll(/replace\(filled, '\[\[([A-Z_]+)\]\]'/g)].map((match) => match[1]);
    expect([...filled].sort()).toEqual([...PAPER_MARKS].sort());
  });

  it("each has its words", () => {
    const product = (messages as { product: Record<string, string> }).product;
    for (const mark of PAPER_MARKS) expect(product[PAPER_MARK_KEY[mark]]).toBeTruthy();
  });

  it("are told apart from the marks of a piece", () => {
    expect(modelMarks("piece")).toBe(DRAFT_MARKS);
    expect(modelMarks("procuracao")).toBe(PAPER_MARKS);
    expect(modelMarks("contrato")).toBe(PAPER_MARKS);
    expect(unknownMarks("[[OUTORGANTE]] contra [[RE]]", modelMarks("procuracao"))).toEqual([]);
    expect(unknownMarks("[[OUTORGANTE]] contra [[RE]]")).toEqual(["OUTORGANTE"]);
    expect(unknownMarks("[[PARTES]], [[NOME]]", modelMarks("contrato"))).toEqual(["PARTES"]);
  });
});

describe("the model ONE writes from", () => {
  it("is a piece's for a piece: a paper of the firm never takes its place", () => {
    const rows = [
      row("power", FIRM, "procuracao", null, true),
      row("platform-juizado", null, "piece", "juizado", true),
      row("platform-power", null, "procuracao", null, true),
    ];
    expect(modelForKind(rows, FIRM, "juizado")).toBe("platform-juizado");
    expect(modelForKind(rows, FIRM, "comum")).toBeNull();
    // A firm's only model, a power of attorney, is not "its only model of the kind" of a piece.
    expect(modelForKind([row("power", FIRM, "procuracao", null, false)], FIRM, "juizado")).toBeNull();
  });

  it("is the firm's own power of attorney, else the platform's; a contract only ever the firm's", () => {
    const platform = row("platform-power", null, "procuracao", null, true);
    expect(paperModelFor([platform], FIRM, "procuracao")).toBe("platform-power");
    expect(paperModelFor([platform], FIRM, "contrato")).toBeNull();
    expect(paperModelFor([platform, row("own", FIRM, "procuracao", null, false)], FIRM, "procuracao")).toBe("own");
    // Two of the firm's and no default: none, as the database answers, never the platform's.
    expect(
      paperModelFor(
        [platform, row("a", FIRM, "procuracao", null, false), row("b", FIRM, "procuracao", null, false)],
        FIRM,
        "procuracao",
      ),
    ).toBeNull();
    expect(
      paperModelFor(
        [row("a", FIRM, "contrato", null, false), row("b", FIRM, "contrato", null, true)],
        FIRM,
        "contrato",
      ),
    ).toBe("b");
    // Another firm's models are nobody's here.
    expect(paperModelFor([row("theirs", OTHER, "contrato", null, true)], FIRM, "contrato")).toBeNull();
  });
});
