import { describe, expect, it } from "vitest";

import { type BatchCandidate, batchCounts, batchTurn, eligibleGroups, unchosenGroups } from "@/lib/filing-ways/batches";
import type { ScreenSystem } from "@/lib/filing-ways/ways";

const TJSP: ScreenSystem = {
  key: "eproc-tjsp",
  name: "eproc do TJSP",
  court: "TJSP",
  system: "eproc",
  uf: "SP",
  ways: ["browser", "extension"],
  ruleNote: null,
};
const TJGO: ScreenSystem = { ...TJSP, key: "projudi-tjgo", name: "Projudi do TJGO", court: "TJGO", system: "projudi" };

const row = (id: string, extra: Partial<BatchCandidate> = {}): BatchCandidate => ({
  id,
  caseId: `case-${id}`,
  caseSeq: 1,
  client: "Cliente Teste",
  court: "TJSP",
  system: "eproc",
  status: "ready",
  blocker: null,
  proceedingId: `lawsuit-${id}`,
  ...extra,
});

describe("the batches a lawyer hands ONE", () => {
  it("takes the ready packages the lawyer signs, not yet submitted, at a system of an automated way, by system", () => {
    const groups = eligibleGroups({
      candidates: [
        row("a"),
        row("b"),
        row("blocked", { blocker: "civil_court_acceptance_missing" }),
        row("building", { status: "requested" }),
        row("theirs"),
        row("gone"),
        row("rio", { court: "TJRJ" }),
        row("go", { court: "TJGO", system: "projudi" }),
      ],
      ways: { systems: [TJSP, TJGO], myWays: { "eproc-tjsp": "browser", "projudi-tjgo": "hand" }, firmWay: "browser" },
      signs: new Set([
        "lawsuit-a",
        "lawsuit-b",
        "lawsuit-blocked",
        "lawsuit-building",
        "lawsuit-gone",
        "lawsuit-rio",
        "lawsuit-go",
      ]),
      submitted: new Set(["gone"]),
    });
    expect(groups.map((group) => [group.system.key, group.way, group.packages.map((item) => item.id)])).toEqual([
      ["eproc-tjsp", "browser", ["a", "b"]],
    ]);
  });

  it("files only by the lawyer's own choice, and tells them what ONE could file once they choose", () => {
    const input = {
      candidates: [row("a"), row("b"), row("go", { court: "TJGO", system: "projudi" }), row("theirs")],
      ways: { systems: [TJSP, TJGO], myWays: { "projudi-tjgo": "hand" as const }, firmWay: "browser" as const },
      signs: new Set(["lawsuit-a", "lawsuit-b", "lawsuit-go"]),
      submitted: new Set<string>(),
    };
    // The firm chose ONE's browser, but the lawyer never chose at the eproc: the database would refuse the batch.
    expect(eligibleGroups(input)).toEqual([]);
    expect(unchosenGroups(input).map((group) => [group.system.key, group.count])).toEqual([["eproc-tjsp", 2]]);
    // A firm that files by hand leaves nothing to choose.
    expect(unchosenGroups({ ...input, ways: { ...input.ways, firmWay: "hand" } })).toEqual([]);
  });

  it("offers nothing before the firm chose its way", () => {
    expect(
      eligibleGroups({
        candidates: [row("a")],
        ways: { systems: [TJSP], myWays: { "eproc-tjsp": "browser" }, firmWay: null },
        signs: new Set(["lawsuit-a"]),
        submitted: new Set(),
      }),
    ).toEqual([]);
  });

  it("says whose turn a batch is and how its filings went", () => {
    expect(batchTurn({ status: "awaiting_code", way: "browser", personId: "ana" }, "ana")).toBe("code_mine");
    expect(batchTurn({ status: "awaiting_code", way: "browser", personId: "ana" }, "bia")).toBe("code_theirs");
    expect(batchTurn({ status: "awaiting_confirmation", way: "extension", personId: "ana" }, "ana")).toBe(
      "confirm_mine",
    );
    expect(batchTurn({ status: "approved", way: "extension", personId: "ana" }, "ana")).toBe("extension_mine");
    expect(batchTurn({ status: "approved", way: "browser", personId: "ana" }, "ana")).toBe("one_waits_browser");
    expect(batchTurn({ status: "running", way: "browser", personId: "ana" }, "bia")).toBe("one_files");
    expect(
      batchCounts({
        submissions: [
          { id: "1", packageId: "p1", caseId: "c1", status: "filed", summaryFileId: null },
          { id: "2", packageId: "p2", caseId: "c2", status: "unknown", summaryFileId: null },
          { id: "3", packageId: "p3", caseId: "c3", status: "owed", summaryFileId: null },
        ],
      }),
    ).toEqual({ total: 3, filed: 1, unknown: 1, refused: 0, waiting: 1 });
  });
});
