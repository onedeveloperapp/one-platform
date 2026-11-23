import { describe, expect, it } from "vitest";

import {
  courtLoginState,
  firmChoiceAsks,
  lawyerChoiceAsks,
  personFilingStep,
  screenStanding,
  type ScreenSystem,
  systemsFor,
  systemsToChoose,
  termPoints,
  wayInForce,
  wayProposed,
  waysOffered,
} from "@/lib/filing-ways/ways";

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

  it("files by the lawyer's own choice while ONE still offers it, else by hand", () => {
    expect(wayInForce({ myWays: { "eproc-tjsp": "extension" }, firmWay: "browser" }, TJSP)).toBe("extension");
    // The firm's way is only marked for the lawyer: an automated way asks their own acknowledgment (0264).
    expect(wayInForce({ myWays: {}, firmWay: "browser" }, TJSP)).toBe("hand");
    // The firm lowered its way: the lawyer's choice beyond it no longer holds.
    expect(wayInForce({ myWays: { "eproc-tjsp": "browser" }, firmWay: "extension" }, TJSP)).toBe("hand");
    expect(wayInForce({ myWays: {}, firmWay: null }, TJRJ)).toBe("hand");
    expect(wayInForce({ myWays: { "eproc-tjsp": "browser" }, firmWay: null }, TJSP)).toBe("hand");
  });

  it("marks the lawyer's own choice while offered, else the firm's, else the most automated way offered", () => {
    expect(wayProposed("extension", TJSP, "browser")).toBe("extension");
    expect(wayProposed(undefined, TJSP, "browser")).toBe("browser");
    expect(wayProposed(null, TJSP, "extension")).toBe("extension");
    // Beyond the firm's way, the lawyer's old choice is not marked.
    expect(wayProposed("browser", TJSP, "extension")).toBe("extension");
    // A system where ONE offers only the extension, under a firm that chose ONE's browser.
    expect(wayProposed(undefined, { ways: ["extension"] }, "browser")).toBe("extension");
    expect(wayProposed(undefined, TJSP, null)).toBe("hand");
    expect(wayProposed(undefined, TJRJ, "browser")).toBe("hand");
  });

  it("asks a lawyer about the courts of their states, their lawsuits and their choices, else every one ONE works on", () => {
    const keys = (systems: ScreenSystem[]) => systems.map((system) => system.key);
    const data = { systems: [TJSP, TJGO, TJRJ], myWays: {}, lawsuitSystems: [] as string[] };
    expect(keys(systemsFor(data, ["SP"]))).toEqual(["eproc-tjsp"]);
    // The owner's test of 2026-11-23: registered in Rio de Janeiro, where ONE does not file on the screen yet.
    expect(keys(systemsFor(data, ["RJ"]))).toEqual(["eproc-tjsp", "projudi-tjgo"]);
    expect(keys(systemsFor(data, []))).toEqual(["eproc-tjsp", "projudi-tjgo"]);
    // A lawsuit they sign went to the client's domicile in another state: that court is asked too.
    expect(keys(systemsFor({ ...data, lawsuitSystems: ["eproc-tjsp"] }, ["GO"]))).toEqual([
      "eproc-tjsp",
      "projudi-tjgo",
    ]);
    expect(keys(systemsFor({ ...data, lawsuitSystems: ["eproc-tjsp"] }, ["RJ"]))).toEqual(["eproc-tjsp"]);
    // A court they already chose a way at stays where they change it.
    expect(keys(systemsFor({ ...data, myWays: { "projudi-tjgo": "hand" as const } }, ["SP"]))).toEqual([
      "eproc-tjsp",
      "projudi-tjgo",
    ]);
    // A regional court has no state of its own (0275): it is never one of a state's.
    expect(keys(systemsFor({ ...data, systems: [{ ...TJSP, key: "pje-trt2", uf: null }, TJGO] }, ["SP"]))).toEqual([
      "pje-trt2",
      "projudi-tjgo",
    ]);
    expect(keys(systemsToChoose(data, ["SP", "GO"], "extension"))).toEqual(["eproc-tjsp", "projudi-tjgo"]);
    // A firm that files by hand, or chose nothing yet, leaves its lawyers nothing to choose.
    expect(systemsToChoose(data, ["SP"], "hand")).toEqual([]);
    expect(systemsToChoose(data, ["SP"], null)).toEqual([]);
  });

  it("asks a lawyer's own setup how they file where they have a way to choose, or the firm's way first", () => {
    const data = {
      systems: [TJSP, TJGO, TJRJ],
      firmWay: "browser" as const,
      myWays: {},
      decidesForFirm: false,
      lawyer: true,
      lawsuitSystems: [] as string[],
    };
    expect(personFilingStep(data, ["SP"])).toEqual({ shown: true, owed: true });
    expect(personFilingStep({ ...data, myWays: { "eproc-tjsp": "hand" as const } }, ["SP"])).toEqual({
      shown: true,
      owed: false,
    });
    // No court of ONE's in their states: every court ONE files in is asked, the setup never left empty.
    expect(personFilingStep(data, ["RJ"])).toEqual({ shown: true, owed: true });
    // A court of a lawsuit they sign, in a state of no registration of theirs, is owed until they answer it.
    expect(
      personFilingStep({ ...data, lawsuitSystems: ["eproc-tjsp"], myWays: { "projudi-tjgo": "hand" as const } }, [
        "GO",
      ]),
    ).toEqual({ shown: true, owed: true });
    expect(personFilingStep({ ...data, firmWay: "hand" as const }, ["SP"])).toEqual({ shown: false, owed: false });
    // A partner who decides for a firm that chose no way yet chooses it there, whatever their states.
    expect(personFilingStep({ ...data, firmWay: null, decidesForFirm: true }, ["RJ"])).toEqual({
      shown: true,
      owed: true,
    });
    expect(personFilingStep({ ...data, lawyer: false }, ["SP"])).toEqual({ shown: false, owed: false });
  });

  it("says whose turn it is for ONE to file a lawsuit on a court's screen", () => {
    const facts = (
      firmWay: "browser" | "extension" | "hand" | null,
      ways: ("browser" | "extension" | "hand" | null)[],
    ) => ({
      key: "eproc-tjsp",
      name: "eproc do TJSP",
      ways: ["browser", "extension"],
      firmWay,
      lawyers: ways.map((way, index) => ({ userId: `u${index}`, way })),
    });
    // Who decides for the firm chooses first: no lawyer may choose an automated way before it.
    expect(screenStanding(facts(null, [null]))).toEqual({ kind: "firm_unchosen" });
    // The owner's test of 2026-11-23: the firm chose ONE's browser, its lawyer never chose a way there.
    expect(screenStanding(facts("browser", [null]))).toEqual({ kind: "choose", lawyers: ["u0"] });
    // A lawyer whose way is automated hands it to ONE in a batch, whoever else of the lawsuit files by hand.
    expect(screenStanding(facts("browser", ["hand", "browser", null]))).toEqual({ kind: "batch", lawyers: ["u1"] });
    // The firm lowered its way: a lawyer's choice beyond it no longer holds, and is asked again.
    expect(screenStanding(facts("extension", ["browser"]))).toEqual({ kind: "choose", lawyers: ["u0"] });
    // Filed by hand, as the firm or every lawyer of the lawsuit chose.
    expect(screenStanding(facts("hand", [null]))).toEqual({ kind: "hand" });
    expect(screenStanding(facts("browser", ["hand", "hand"]))).toEqual({ kind: "hand" });
    // A screen ONE does not file on, or a lawsuit with no lawyer yet: nothing to say of it.
    expect(screenStanding({ ...facts("browser", [null]), ways: [] })).toBeNull();
    expect(screenStanding(facts("browser", []))).toBeNull();
  });

  it("asks the login and the acknowledgment where a lawyer's choice needs them", () => {
    // ONE's browser with no login kept: both, and something to save.
    expect(lawyerChoiceAsks({ way: "browser", saved: undefined, login: null, changing: false })).toEqual({
      login: true,
      aware: true,
      save: true,
    });
    // ONE's browser already chosen with a login kept: nothing, unless the court refused it or it is being changed.
    expect(
      lawyerChoiceAsks({ way: "browser", saved: "browser", login: { state: "verified" }, changing: false }),
    ).toEqual({ login: false, aware: false, save: false });
    expect(
      lawyerChoiceAsks({ way: "browser", saved: "browser", login: { state: "refused" }, changing: false }).login,
    ).toBe(true);
    expect(
      lawyerChoiceAsks({ way: "browser", saved: "browser", login: { state: "unchecked" }, changing: true }),
    ).toEqual({ login: true, aware: true, save: true });
    // The extension asks the acknowledgment only; by hand asks nothing, and is saved when it is a choice made: the
    // first time too, so a lawyer who chose it is not asked again.
    expect(lawyerChoiceAsks({ way: "extension", saved: "browser", login: null, changing: false })).toEqual({
      login: false,
      aware: true,
      save: true,
    });
    expect(lawyerChoiceAsks({ way: "hand", saved: undefined, login: null, changing: false })).toEqual({
      login: false,
      aware: false,
      save: true,
    });
    expect(lawyerChoiceAsks({ way: "hand", saved: "hand", login: null, changing: false }).save).toBe(false);
    expect(lawyerChoiceAsks({ way: "hand", saved: "extension", login: null, changing: false }).save).toBe(true);
  });

  it("asks the firm's acknowledgment for an automated way being chosen", () => {
    expect(firmChoiceAsks({ way: "browser", saved: null })).toEqual({ aware: true, save: true });
    expect(firmChoiceAsks({ way: "browser", saved: "browser" })).toEqual({ aware: false, save: false });
    expect(firmChoiceAsks({ way: "hand", saved: null })).toEqual({ aware: false, save: true });
    expect(firmChoiceAsks({ way: "extension", saved: "hand" })).toEqual({ aware: true, save: true });
  });

  it("lists the points of an acknowledgment's text", () => {
    expect(termPoints("Intro.\n\nEstá ciente de que:\n\n- um ponto;\n- outro ponto;\n\nAssume.")).toEqual([
      "um ponto;",
      "outro ponto;",
    ]);
    expect(termPoints("Sem pontos.")).toEqual([]);
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
