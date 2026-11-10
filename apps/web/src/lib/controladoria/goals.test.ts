import { describe, expect, it } from "vitest";

import {
  type ClosingGoal,
  closingGoalsOf,
  firstView,
  goalCounts,
  goalInputOf,
  goalPhase,
  goalProgress,
  goalsOfView,
  monthLabel,
  periodPresets,
  viewOfPeriod,
  wholeMonth,
} from "@/lib/controladoria/goals";

const goal = (id: string, startsOn: string, endsOn: string, more: Partial<ClosingGoal> = {}): ClosingGoal => ({
  id,
  startsOn,
  endsOn,
  module: null,
  incident: null,
  origin: null,
  partnership: null,
  partner: null,
  target: 40,
  closings: null,
  archivedAt: null,
  archiveReason: null,
  ...more,
});

const TODAY = "2026-11-08";

describe("closingGoalsOf", () => {
  it("reads each goal, and says the closings are not counted while no rule exists", () => {
    const read = closingGoalsOf({
      today: TODAY,
      rule: null,
      may_manage: true,
      goals: [
        {
          id: "g1",
          starts_on: "2026-11-01",
          ends_on: "2026-11-30",
          module: "direito-do-passageiro",
          incident: "delay",
          origin: "agency",
          partnership: "p1",
          partner: "Viagens Sol",
          target: 12,
          closings: null,
          archived_at: null,
          archive_reason: null,
        },
        { id: "g2", starts_on: "2026-11", ends_on: "2026-11-30", target: 3 },
      ],
    });
    expect(read?.counting).toBe(false);
    expect(read?.mayManage).toBe(true);
    expect(read?.goals).toEqual([
      goal("g1", "2026-11-01", "2026-11-30", {
        module: "direito-do-passageiro",
        incident: "delay",
        origin: "agency",
        partnership: "p1",
        partner: "Viagens Sol",
        target: 12,
      }),
    ]);
  });

  it("counts by the rule of a closing, and says when the test cases are what it counts", () => {
    const read = closingGoalsOf({
      today: TODAY,
      rule: "fechamento-v1",
      tests_counted: true,
      may_manage: false,
      goals: [{ id: "g1", starts_on: "2026-11-01", ends_on: "2026-11-30", target: 4, closings: 3 }],
    });
    expect(read?.counting).toBe(true);
    expect(read?.testsCounted).toBe(true);
    expect(read?.goals[0].closings).toBe(3);
    expect(closingGoalsOf({ today: TODAY, rule: "fechamento-v1", goals: [] })?.testsCounted).toBe(false);
  });

  it("is null for anything that is not an answer", () => {
    expect(closingGoalsOf(null)).toBeNull();
    expect(closingGoalsOf({ goals: [] })).toBeNull();
    expect(closingGoalsOf({ today: TODAY, goals: {} })).toBeNull();
  });
});

describe("where a goal stands", () => {
  const goals = [
    goal("now-long", "2026-11-01", "2026-12-31"),
    goal("now-short", "2026-11-01", "2026-11-30"),
    goal("next", "2026-12-01", "2026-12-31"),
    goal("past", "2026-10-01", "2026-10-31"),
    goal("older", "2026-09-01", "2026-09-30"),
    goal("archived", "2026-11-01", "2026-11-30", { archivedAt: "2026-11-02T10:00:00Z", archiveReason: "Trocada" }),
  ];

  it("is in force from its first day to its last, both included", () => {
    expect(goalPhase(goal("a", TODAY, TODAY), TODAY)).toBe("now");
    expect(goalPhase(goal("b", "2026-11-09", "2026-11-30"), TODAY)).toBe("next");
    expect(goalPhase(goal("c", "2026-11-01", "2026-11-07"), TODAY)).toBe("past");
    expect(goalPhase(goals[5], TODAY)).toBe("archived");
  });

  it("counts each view and lists it in the order it is read", () => {
    expect(goalCounts(goals, TODAY)).toEqual({ "em-vigor": 2, proximas: 1, encerradas: 2, arquivadas: 1 });
    expect(goalsOfView(goals, "em-vigor", TODAY).map((item) => item.id)).toEqual(["now-short", "now-long"]);
    expect(goalsOfView(goals, "encerradas", TODAY).map((item) => item.id)).toEqual(["past", "older"]);
  });

  it("opens on the goals in force, else the next ones, else the ended ones", () => {
    expect(firstView(goalCounts(goals, TODAY))).toBe("em-vigor");
    expect(firstView({ "em-vigor": 0, proximas: 1, encerradas: 3, arquivadas: 0 })).toBe("proximas");
    expect(firstView({ "em-vigor": 0, proximas: 0, encerradas: 3, arquivadas: 0 })).toBe("encerradas");
    expect(firstView({ "em-vigor": 0, proximas: 0, encerradas: 0, arquivadas: 2 })).toBe("em-vigor");
  });
});

describe("viewOfPeriod", () => {
  it("says where a goal just saved landed", () => {
    expect(viewOfPeriod("2026-11-01", "2026-11-30", TODAY)).toBe("em-vigor");
    expect(viewOfPeriod("2026-12-01", "2026-12-31", TODAY)).toBe("proximas");
    expect(viewOfPeriod("2026-10-01", "2026-10-31", TODAY)).toBe("encerradas");
  });
});

describe("goalProgress", () => {
  it("says nothing while the closings are not counted", () => {
    expect(goalProgress(goal("a", "2026-11-01", "2026-11-30"))).toBeNull();
  });

  it("says how far a counted goal went, never past its end", () => {
    expect(goalProgress(goal("a", "2026-11-01", "2026-11-30", { closings: 10 }))).toEqual({
      done: 10,
      target: 40,
      percent: 25,
    });
    expect(goalProgress(goal("a", "2026-11-01", "2026-11-30", { closings: 50 }))?.percent).toBe(100);
  });
});

describe("the periods", () => {
  it("offers this month, the next and this quarter, across the turn of the year", () => {
    expect(periodPresets(TODAY)).toEqual({
      month: { startsOn: "2026-11-01", endsOn: "2026-11-30" },
      next: { startsOn: "2026-12-01", endsOn: "2026-12-31" },
      quarter: { startsOn: "2026-10-01", endsOn: "2026-12-31" },
    });
    expect(periodPresets("2026-12-15").next).toEqual({ startsOn: "2027-01-01", endsOn: "2027-01-31" });
    expect(periodPresets("2028-02-10").month.endsOn).toBe("2028-02-29");
  });

  it("names a whole calendar month by its month", () => {
    expect(wholeMonth("2026-11-01", "2026-11-30")).toBe(true);
    expect(wholeMonth("2026-11-01", "2026-11-29")).toBe(false);
    expect(wholeMonth("2026-10-01", "2026-12-31")).toBe(false);
    expect(monthLabel("2026-11-01")).toBe("Novembro de 2026");
    expect(monthLabel("2027-03-01")).toBe("Março de 2027");
    expect(monthLabel("2026-11-01", true)).toBe("novembro de 2026");
  });
});

describe("goalInputOf", () => {
  const base = { startsOn: "2026-11-01", endsOn: "2026-11-30", target: 40 };

  it("takes what a save needs, and a partner agency is of the cases that came from agencies", () => {
    const read = goalInputOf({
      ...base,
      module: "direito-do-passageiro",
      incident: "delay",
      origin: "ads",
      partnership: "d1140000-0000-4000-8000-00000000000a",
    });
    expect(read).toEqual({
      ok: true,
      goal: {
        id: null,
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        module: "direito-do-passageiro",
        incident: "delay",
        origin: "agency",
        partnership: "d1140000-0000-4000-8000-00000000000a",
        target: 40,
      },
    });
  });

  it("refuses a period that ends before it starts or lasts more than a year, and a target that is no count", () => {
    expect(goalInputOf({ ...base, endsOn: "2026-10-31" })).toEqual({ ok: false, field: "period" });
    expect(goalInputOf({ ...base, endsOn: "2027-12-31" })).toEqual({ ok: false, field: "period" });
    expect(goalInputOf({ ...base, startsOn: "1/11/2026" })).toEqual({ ok: false, field: "period" });
    expect(goalInputOf({ ...base, target: 0 })).toEqual({ ok: false, field: "target" });
    expect(goalInputOf({ ...base, target: 2.5 })).toEqual({ ok: false, field: "target" });
  });

  it("leaves out what is not a scope it knows", () => {
    const read = goalInputOf({ ...base, module: "Módulo", incident: "x", origin: "tv", partnership: "p1" });
    expect(read.ok && read.goal).toMatchObject({ module: null, incident: null, origin: null, partnership: null });
  });
});
