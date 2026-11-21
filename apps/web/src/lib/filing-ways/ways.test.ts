import { describe, expect, it } from "vitest";

import { courtLoginState, type ScreenSystem, systemsFor, wayAt, waysOffered } from "@/lib/filing-ways/ways";

const TJSP: ScreenSystem = {
  key: "eproc-tjsp",
  name: "eproc do TJSP",
  court: "TJSP",
  system: "eproc",
  uf: "SP",
  ways: ["browser", "extension"],
  ruleNote: null,
};
const TJGO: ScreenSystem = {
  ...TJSP,
  key: "projudi-tjgo",
  name: "Projudi do TJGO",
  court: "TJGO",
  system: "projudi",
  uf: "GO",
};
const TJRJ: ScreenSystem = { ...TJSP, key: "eproc-tjrj", name: "eproc do TJRJ", court: "TJRJ", uf: "RJ", ways: [] };

describe("the ways to file a lawyer may choose", () => {
  it("offers what the platform turned on, none beyond the firm's way, and always by hand", () => {
    expect(waysOffered(TJSP, "browser")).toEqual(["browser", "extension", "hand"]);
    // Before the firm chose its way, and gave its acknowledgment, a lawyer files by hand.
    expect(waysOffered(TJSP, null)).toEqual(["hand"]);
    expect(waysOffered(TJSP, "extension")).toEqual(["extension", "hand"]);
    expect(waysOffered(TJSP, "hand")).toEqual(["hand"]);
    expect(waysOffered(TJRJ, "browser")).toEqual(["hand"]);
  });

  it("is the lawyer's own while ONE still offers it, else the firm's", () => {
    expect(wayAt({ myWays: { "eproc-tjsp": "extension" }, firmWay: "browser" }, TJSP)).toBe("extension");
    expect(wayAt({ myWays: {}, firmWay: "browser" }, TJSP)).toBe("browser");
    // The firm lowered its way: the lawyer's choice beyond it no longer holds.
    expect(wayAt({ myWays: { "eproc-tjsp": "browser" }, firmWay: "extension" }, TJSP)).toBe("extension");
    expect(wayAt({ myWays: {}, firmWay: null }, TJRJ)).toBe("hand");
    expect(wayAt({ myWays: { "eproc-tjsp": "browser" }, firmWay: null }, TJSP)).toBe("hand");
  });

  it("names the systems of the courts of the lawyer's states, else every one ONE works on", () => {
    expect(systemsFor([TJSP, TJGO, TJRJ], ["SP"]).map((system) => system.key)).toEqual(["eproc-tjsp"]);
    expect(systemsFor([TJSP, TJGO, TJRJ], ["RJ"]).map((system) => system.key)).toEqual(["eproc-tjsp", "projudi-tjgo"]);
    expect(systemsFor([TJSP, TJGO, TJRJ], []).map((system) => system.key)).toEqual(["eproc-tjsp", "projudi-tjgo"]);
  });

  it("says where a court login stands from its connection", () => {
    expect(courtLoginState({ status: "connected", last_error: null, metadata: { verified_at: "2026-11-20" } })).toBe(
      "verified",
    );
    expect(courtLoginState({ status: "connected", last_error: null, metadata: {} })).toBe("unchecked");
    expect(courtLoginState({ status: "disconnected", last_error: "court_refused", metadata: {} })).toBe("refused");
    expect(courtLoginState({ status: "disconnected", last_error: "court_blocked", metadata: {} })).toBe("blocked");
  });
});
