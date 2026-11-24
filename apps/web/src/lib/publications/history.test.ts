import { describe, expect, it } from "vitest";

import { historyLines, historyReadsOf } from "@/lib/publications/history";

const CNJ = "10002868420998260100";
const lawsuit = (id: string, status: string, filedAt: string | null, cnj: string | null = CNJ) => ({
  id,
  status,
  cnj,
  filedAt,
});

describe("the history of a lawsuit filed before its case was in ONE (0286)", () => {
  it("reads only the rows it can say", () => {
    expect(
      historyReadsOf([
        { proceeding_id: "p1", status: "done", kept: 3 },
        { proceeding_id: "p2", status: "due", kept: null },
        { proceeding_id: "p3", status: "unknown", kept: 1 },
        { status: "done" },
        null,
      ]),
    ).toEqual([
      { proceedingId: "p1", status: "done", kept: 3 },
      { proceedingId: "p2", status: "due", kept: null },
    ]);
  });

  it("says nothing of a lawsuit filed through ONE, nor of one not filed or with no number", () => {
    const lines = historyLines(
      [
        lawsuit("filed-in-one", "filed", "2026-11-22"),
        lawsuit("planned", "planned", null),
        lawsuit("no-number", "filed", "2025-11-17", null),
        lawsuit("bad-number", "filed", "2025-11-17", "123"),
      ],
      [],
      "2026-11-20",
    );
    expect(lines).toEqual([]);
  });

  it("offers the reading of one filed before the case was opened, and says where each reading stands", () => {
    const lines = historyLines(
      [
        lawsuit("before", "filed", "2025-11-17"),
        lawsuit("reading", "filed", "2025-11-17"),
        lawsuit("read", "filed", "2026-11-22"),
        lawsuit("failed", "filed", "2025-10-01"),
      ],
      [
        { proceedingId: "reading", status: "due", kept: null },
        { proceedingId: "read", status: "done", kept: 4 },
        { proceedingId: "failed", status: "failed", kept: null },
      ],
      "2026-11-20",
    );
    expect(lines.map((line) => [line.proceedingId, line.kind, line.kept])).toEqual([
      ["before", "ask", 0],
      ["reading", "due", 0],
      ["read", "done", 4],
      ["failed", "failed", 0],
    ]);
  });
});
