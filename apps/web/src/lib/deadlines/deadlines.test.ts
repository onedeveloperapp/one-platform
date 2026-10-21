import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  ASSUMPTION_KEY,
  calendarOf,
  COUNTING_KEY,
  countInput,
  daysBetween,
  DEADLINE_REVIEW_REASONS,
  DEADLINE_STATUSES,
  DEADLINE_VIEWS,
  deadlineErrorKey,
  deadlinesAddress,
  type DeadlineToCount,
  deadlineUrgentOn,
  lastDeadlinePage,
  readCheckedYears,
  readCount,
  SKIP_KEY,
  STATUS_KEY,
  todayInBrasilia,
  TRIGGER_KEY,
  VIEW_KEY,
  weekdayOf,
} from "@/lib/deadlines/deadlines";
import messages from "@flyee/content/messages/pt-BR.json";
import { computeDeadline, DEADLINE_RULE_VERSION } from "@flyee/rules/deadlines";

const ROOT = path.resolve(__dirname, "../../../../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0034_deadlines.sql"), "utf8");
const product = messages.product as Record<string, string>;

/** The values a check constraint of migration 0034 allows, in its order. */
function allowed(constraint: string): string[] {
  const start = MIGRATION.indexOf(`constraint ${constraint} check`);
  expect(start, constraint).toBeGreaterThan(-1);
  const list = /(?:in \(|array\[)([^)\]]+)[)\]]/.exec(MIGRATION.slice(start));
  return [...(list?.[1] ?? "").matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);
}

describe("what the code says matches what the database keeps", () => {
  it("lists the states, the triggers, the countings and the codes of what a count could not know as the table does", () => {
    expect([...DEADLINE_STATUSES]).toEqual(allowed("deadlines_status_check"));
    expect(Object.keys(TRIGGER_KEY)).toEqual(allowed("deadlines_trigger_check"));
    expect(Object.keys(COUNTING_KEY)).toEqual(allowed("deadlines_counting_check"));
    expect(Object.keys(ASSUMPTION_KEY).sort()).toEqual(allowed("deadlines_assumptions_check").sort());
  });

  it("asks the database for the lists it has", () => {
    const body = /create or replace function public\.firm_deadlines[\s\S]*?\$\$;/.exec(MIGRATION)?.[0] ?? "";
    for (const view of DEADLINE_VIEWS) expect(body, view).toContain(`'${view}'`);
  });

  it("knows every reason the database gives to look at a deadline again, and no other", () => {
    const body =
      /create or replace function public\.deadline_review_reasons_of\([\s\S]*?\$\$;/.exec(MIGRATION)?.[0] ?? "";
    const given = [...body.matchAll(/then '([a-z_]+)' end/g)].map((match) => match[1]);
    expect(given).toEqual([...DEADLINE_REVIEW_REASONS]);
  });

  it("has words for every state, list, reason, assumption and refusal", () => {
    const keys = [
      ...Object.values(STATUS_KEY),
      ...Object.values(COUNTING_KEY),
      ...Object.values(TRIGGER_KEY),
      ...Object.values(SKIP_KEY),
      ...Object.values(ASSUMPTION_KEY),
      ...Object.values(VIEW_KEY).flatMap((view) => Object.values(view)),
      ...[
        "not_found",
        "not_allowed",
        "not_allowed_in_support_session",
        "cancelled",
        "not_filed",
        "court_unknown",
        "too_many",
        "closed",
        "open",
        "changed",
        "counting",
        "reason_required",
        "invalid_data",
        "invalid_day",
        "invalid_days",
        "too_long",
        "anything else",
        null,
      ].map(deadlineErrorKey),
    ];
    for (const key of keys) expect(product[key], key).toBeTruthy();
  });
});

describe("what the backend's count is read as", () => {
  const counted = computeDeadline({
    trigger: "publication",
    on: "2026-02-13",
    days: 5,
    counting: "business",
    place: { proceedingKind: "juizado", system: "projudi", comarca: "Goiânia" },
    calendar: calendarOf(
      [{ year: 2026, all_comarcas: false, comarcas: ["Goiânia"], checked_on: "2026-10-11" }],
      [
        { day: "2026-02-16", kind: "closed", label: "Carnaval", proceeding_kinds: [], systems: [], comarcas: [] },
        { day: "2026-02-17", kind: "closed", label: "Carnaval", proceeding_kinds: null, systems: null, comarcas: null },
        {
          day: "2026-02-18",
          kind: "partial",
          label: "Carnaval (feriado até 12h)",
          proceeding_kinds: [],
          systems: [],
          comarcas: [],
        },
        // A kind the rule does not know is left out, never guessed.
        { day: "2026-02-19", kind: "holiday", label: "Outro", proceeding_kinds: [], systems: [], comarcas: [] },
      ],
    ),
  });

  it("is the rule's own answer, read back whole", () => {
    expect(counted.ok).toBe(true);
    if (!counted.ok) return;
    const stored = JSON.parse(JSON.stringify({ ...counted.result, place: { court: "TJGO" } }));
    expect(readCount(stored)).toEqual(counted.result);
    expect(counted.result.dueOn).toBe("2026-02-25");
    expect(counted.result.rule).toBe(DEADLINE_RULE_VERSION);
    // The calendar it went through, with the day it was checked: what the court decreed since is not in it.
    expect(counted.result.checkedYears).toEqual([{ year: 2026, checkedOn: "2026-10-11" }]);
  });

  it("is nothing when it is not a count, and keeps only what a count may hold", () => {
    expect(readCount(null)).toBeNull();
    expect(readCount([])).toBeNull();
    expect(readCount({ rule: "prazo-v1" })).toBeNull();
    const odd = readCount({
      rule: "prazo-v1",
      trigger: "day",
      counting: "calendar",
      triggerDay: "2026-03-02",
      startsOn: "2026-03-03",
      dueOn: "2026-03-05",
      days: 3,
      skipped: [{ from: "2026-03-04", to: "x", reason: "closed", label: "Feriado" }, { reason: "odd" }],
      moved: { from: "2026-03-05", to: "2026-03-06", reason: "elsewhere" },
      assumptions: [{ code: "comarca_unknown" }, { code: "invented" }, { code: "partial_start" }],
    });
    expect(odd?.skipped).toEqual([]);
    expect(odd?.moved).toBeNull();
    expect(odd?.assumptions).toEqual([{ code: "comarca_unknown" }]);
    expect(odd?.publishedOn).toBeNull();
    expect(odd?.checkedYears).toEqual([]);
  });

  it("reads the checked years as a count says them and as a list of the database does", () => {
    expect(
      readCheckedYears([
        { year: 2026, checkedOn: "2026-10-11" },
        { year: 2027, checked_on: "2027-01-05" },
        { year: 2028, checkedOn: "ontem" },
        { year: "2029" },
        null,
      ]),
    ).toEqual([
      { year: 2026, checkedOn: "2026-10-11" },
      { year: 2027, checkedOn: "2027-01-05" },
      { year: 2028, checkedOn: null },
    ]);
    expect(readCheckedYears("nothing")).toEqual([]);
  });
});

describe("the input of the rule from what the database hands over", () => {
  const read: DeadlineToCount = {
    id: "d",
    org_id: "o",
    claim: 1,
    revision: 3,
    trigger: "day",
    trigger_on: "2026-10-10",
    days: 5,
    counting: "business",
    court: "TJGO",
    place: { proceeding_kind: "comum", system: "projudi", comarca: "Goiânia" },
    years: [{ year: 2026, all_comarcas: true, comarcas: null }],
    days_off: [
      {
        day: "2026-10-28",
        kind: "closed",
        label: "Dia do Servidor Público",
        proceeding_kinds: null,
        systems: null,
        comarcas: null,
      },
    ],
  };

  it("is what the person gave and where the lawsuit is, with the court's calendar", () => {
    expect(countInput(read)).toEqual({
      trigger: "day",
      on: "2026-10-10",
      days: 5,
      counting: "business",
      place: { proceedingKind: "comum", system: "projudi", comarca: "Goiânia" },
      calendar: {
        years: [{ year: 2026, allComarcas: true, comarcas: [], checkedOn: null }],
        days: [
          {
            day: "2026-10-28",
            kind: "closed",
            label: "Dia do Servidor Público",
            proceedingKinds: [],
            systems: [],
            comarcas: [],
          },
        ],
      },
    });
  });

  it("is nothing for a trigger or a counting the rule does not know, and a lawsuit not known is no place", () => {
    expect(countInput({ ...read, trigger: "hearing" })).toBeNull();
    expect(countInput({ ...read, counting: "hours" })).toBeNull();
    expect(countInput({ ...read, place: null })?.place).toEqual({ proceedingKind: null, system: null, comarca: null });
  });
});

describe("how the screens say where a deadline is", () => {
  it("writes the address of a list and its page, the first ones saying nothing", () => {
    expect(deadlinesAddress("confirmar", 0)).toBe("/prazos");
    expect(deadlinesAddress("vencidos", 0)).toBe("/prazos?ver=vencidos");
    expect(deadlinesAddress("confirmar", 2)).toBe("/prazos?pagina=3");
    expect(deadlinesAddress("rever", 1)).toBe("/prazos?ver=rever&pagina=2");
    expect(lastDeadlinePage(0)).toBe(0);
    expect(lastDeadlinePage(25)).toBe(0);
    expect(lastDeadlinePage(26)).toBe(1);
  });

  it("counts days between two days, and names the day of the week as people do", () => {
    expect(daysBetween("2026-10-11", "2026-10-11")).toBe(0);
    expect(daysBetween("2026-10-11", "2026-10-14")).toBe(3);
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2026-10-14", "2026-10-11")).toBe(-3);
    expect(weekdayOf("2026-02-18")).toBe("quarta-feira");
    expect(weekdayOf("2026-10-11")).toBe("domingo");
  });

  it("says the day a deadline is urgent by as the database does", () => {
    const confirmed = {
      status: "confirmed",
      dueOn: "2026-03-25",
      computedDueOn: "2026-03-25",
      computedRevision: 2,
      revision: 2,
      confirmedAgainst: "2026-03-25",
    };
    // In order: its own day.
    expect(deadlineUrgentOn(confirmed)).toBe("2026-03-25");
    // A count in force now gives an earlier day: the earlier.
    expect(deadlineUrgentOn({ ...confirmed, computedDueOn: "2026-03-24" })).toBe("2026-03-24");
    // A later one: still its own.
    expect(deadlineUrgentOn({ ...confirmed, computedDueOn: "2026-03-26" })).toBe("2026-03-25");
    // Confirmed later than counted, with a reason, and the count unchanged: the person's day.
    expect(deadlineUrgentOn({ ...confirmed, dueOn: "2026-03-30" })).toBe("2026-03-30");
    // Being counted again: its own day meanwhile.
    expect(deadlineUrgentOn({ ...confirmed, computedDueOn: "2026-03-20", computedRevision: 1 })).toBe("2026-03-25");
    // Confirmed by hand with no count, then counted earlier: the earlier.
    expect(deadlineUrgentOn({ ...confirmed, confirmedAgainst: null, computedDueOn: "2026-03-23" })).toBe("2026-03-23");
    // Proposed: the counted day it carries.
    expect(deadlineUrgentOn({ ...confirmed, status: "proposed", computedDueOn: "2026-03-20" })).toBe("2026-03-25");
  });

  it("takes today as Brasília's", () => {
    // 02:30 in UTC is still the day before in Brasília.
    expect(todayInBrasilia(new Date("2026-10-12T02:30:00Z"))).toBe("2026-10-11");
    expect(todayInBrasilia(new Date("2026-10-12T03:30:00Z"))).toBe("2026-10-12");
  });
});
