import assert from "node:assert/strict";
import test from "node:test";

import {
  type CalendarDay,
  comarcaKey,
  computeDeadline,
  type CourtCalendar,
  type DeadlineInput,
  type DeadlineResult,
  federalJusticeHoliday,
  inYearEndSuspension,
  justiceOfCourt,
  nationalHoliday,
} from "./deadlines.ts";

// The calendar of the Tribunal de Justiça de Goiás for 2026, as its list of holidays says it
// (docs.tjgo.jus.br/institucional/feriados/DOC_feriados_2026_08062026.pdf, read on 2026-10-11): the
// days the national holidays of federal law do not already cover. The days of another court below are
// invented, and say so.

const day = (
  date: string,
  kind: CalendarDay["kind"],
  label: string,
  scope: Partial<Pick<CalendarDay, "proceedingKinds" | "systems" | "comarcas">> = {},
): CalendarDay => ({ day: date, kind, label, proceedingKinds: [], systems: [], comarcas: [], ...scope });

function daysFrom(first: string, last: string): string[] {
  const out: string[] = [];
  for (let at = Date.parse(`${first}T00:00:00Z`); at <= Date.parse(`${last}T00:00:00Z`); at += 86_400_000) {
    out.push(new Date(at).toISOString().slice(0, 10));
  }
  return out;
}

const TJGO_2026: CourtCalendar = {
  years: [{ year: 2026, allComarcas: false, comarcas: ["Goiânia"], checkedOn: "2026-10-11" }],
  days: [
    day("2026-02-16", "closed", "Carnaval"),
    day("2026-02-17", "closed", "Carnaval"),
    day("2026-02-18", "partial", "Carnaval (feriado até 12h)"),
    day("2026-03-20", "closed", "Ponto facultativo (MotoGP em Goiânia)"),
    day("2026-04-01", "closed", "Semana Santa"),
    day("2026-04-02", "closed", "Semana Santa"),
    day("2026-04-03", "closed", "Semana Santa"),
    day("2026-04-20", "closed", "Ponto facultativo"),
    day("2026-05-24", "closed", "Dia de Nossa Senhora Auxiliadora", {
      comarcas: ["Goiânia", "Iporá", "Leopoldo de Bulhões", "Senador Canedo"],
    }),
    day("2026-06-04", "closed", "Corpus Christi"),
    day("2026-06-05", "closed", "Ponto facultativo"),
    day("2026-07-26", "closed", "Fundação da Cidade de Goiás"),
    day("2026-10-24", "closed", "Aniversário de Goiânia"),
    day("2026-10-28", "closed", "Dia do Servidor Público"),
    day("2026-12-08", "closed", "Dia da Justiça"),
    ...daysFrom("2026-12-20", "2027-01-06").map((date) => day(date, "closed", "Recesso forense")),
  ],
};

const GOIANIA = { proceedingKind: "juizado", system: "projudi", comarca: "Goiânia" };

const input = (overrides: Partial<DeadlineInput>): DeadlineInput => ({
  trigger: "publication",
  on: "2026-03-02",
  days: 15,
  counting: "business",
  place: GOIANIA,
  calendar: TJGO_2026,
  ...overrides,
});

function count(overrides: Partial<DeadlineInput>): DeadlineResult {
  const outcome = computeDeadline(input(overrides));
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return (outcome as { ok: true; result: DeadlineResult }).result;
}

test("an intimation in the court's own system that came first starts the term, said as an assumption", () => {
  // Made available Monday 2 March (published Tuesday 3); the lawyer read it in the system on Friday 27 February.
  const earlier = count({ portalOn: "2026-02-27" });
  assert.equal(earlier.publishedOn, "2026-03-03");
  assert.equal(earlier.fromDay, "2026-02-27");
  assert.equal(earlier.startsOn, "2026-03-02");
  assert.deepEqual(earlier.assumptions, [{ code: "portal_first", day: "2026-02-27" }]);
  assert.ok(earlier.dueOn < count({}).dueOn);

  // Read on a Saturday: made on Monday 2 March, still before the DJEN's publication on Tuesday.
  const weekend = count({ portalOn: "2026-02-28" });
  assert.equal(weekend.fromDay, "2026-03-02");
  assert.equal(weekend.startsOn, "2026-03-03");
  assert.deepEqual(weekend.assumptions, [{ code: "portal_first", day: "2026-02-28" }]);

  // Read after the DJEN published it, or on the same day: the DJEN's start stands, and nothing is said.
  for (const portalOn of ["2026-03-03", "2026-03-10"]) {
    const later = count({ portalOn });
    assert.equal(later.fromDay, "2026-03-03");
    assert.deepEqual(later.assumptions, []);
  }

  // A day that is no day, or a deadline that runs from a day a person gave, is counted as before.
  assert.equal(count({ portalOn: "not a day" }).fromDay, "2026-03-03");
  assert.equal(count({ trigger: "day", on: "2026-03-04", portalOn: "2026-02-27" }).fromDay, "2026-03-04");
});

test("a publication is published on the next business day, and the term counts from the business day after", () => {
  // Made available on a Monday: published on Tuesday, counted from Wednesday, the court's day off skipped.
  const result = count({});
  assert.equal(result.rule, "prazo-v3");
  assert.equal(result.justice, "estadual");
  assert.equal(result.publishedOn, "2026-03-03");
  assert.equal(result.fromDay, "2026-03-03");
  assert.equal(result.startsOn, "2026-03-04");
  assert.equal(result.dueOn, "2026-03-25");
  assert.equal(result.countedDueOn, "2026-03-25");
  assert.deepEqual(result.skipped, [
    { from: "2026-03-20", to: "2026-03-20", reason: "closed", label: "Ponto facultativo (MotoGP em Goiânia)" },
  ]);
  assert.equal(result.moved, null);
  assert.deepEqual(result.assumptions, []);
  // The calendar the count went through, with the day it was checked: what the court decreed since is not in it.
  assert.deepEqual(result.checkedYears, [{ year: 2026, checkedOn: "2026-10-11" }]);
});

test("Carnival: a publication of Friday is published on Ash Wednesday, whose partial business is said", () => {
  const result = count({ on: "2026-02-13", days: 5 });
  assert.equal(result.publishedOn, "2026-02-18");
  assert.equal(result.startsOn, "2026-02-19");
  assert.equal(result.dueOn, "2026-02-25");
  assert.deepEqual(result.skipped, [{ from: "2026-02-16", to: "2026-02-17", reason: "closed", label: "Carnaval" }]);
  // Read as moving the start, the deadline would be a business day later: the conservative day is
  // given, and the reading is the person's to weigh.
  assert.deepEqual(result.assumptions, [
    { code: "partial_start", day: "2026-02-18", label: "Carnaval (feriado até 12h)" },
  ]);
});

test("a last day of partial business moves to the next business day, and one in the middle counts", () => {
  const moved = count({ on: "2026-02-04", days: 7 });
  assert.equal(moved.countedDueOn, "2026-02-18");
  assert.equal(moved.dueOn, "2026-02-19");
  assert.deepEqual(moved.moved, {
    from: "2026-02-18",
    to: "2026-02-19",
    reason: "partial",
    label: "Carnaval (feriado até 12h)",
  });
  assert.deepEqual(moved.assumptions, []);

  const through = count({ on: "2026-02-11", days: 5 });
  assert.equal(through.dueOn, "2026-02-23");
  assert.equal(through.moved, null);
});

test("terms stop from 20 December to 20 January, in the civil court and in the small-claims court alike", () => {
  for (const proceedingKind of ["comum", "juizado"]) {
    const result = count({ on: "2026-12-11", place: { ...GOIANIA, proceedingKind } });
    assert.equal(result.publishedOn, "2026-12-14");
    assert.equal(result.startsOn, "2026-12-15");
    assert.equal(result.dueOn, "2027-02-04", proceedingKind);
    assert.deepEqual(result.skipped, [{ from: "2026-12-20", to: "2027-01-20", reason: "suspension", label: "" }]);
    // The calendar of 2027 was not checked: its Carnival, for one, is not on record.
    assert.deepEqual(result.assumptions, [{ code: "calendar_unchecked", years: [2027] }]);
  }
});

test("a publication made during the suspension is published, and its term starts after the suspension", () => {
  const during = count({ on: "2027-01-13", days: 10 });
  assert.equal(during.publishedOn, "2027-01-14");
  assert.equal(during.startsOn, "2027-01-21");
  assert.equal(during.dueOn, "2027-02-03");
  assert.deepEqual(during.skipped, [{ from: "2027-01-15", to: "2027-01-20", reason: "suspension", label: "" }]);

  // Made available before the recess: published when the court's business starts again.
  const before = count({ on: "2026-12-18", days: 1 });
  assert.equal(before.publishedOn, "2027-01-07");
  assert.equal(before.startsOn, "2027-01-21");
  assert.deepEqual(before.skipped, [
    { from: "2026-12-20", to: "2027-01-06", reason: "closed", label: "Recesso forense" },
    { from: "2027-01-08", to: "2027-01-20", reason: "suspension", label: "" },
  ]);
});

// An invented court, with an invented comarca, to see the days of one comarca apply to it alone.
const LOCAL: CourtCalendar = {
  years: [{ year: 2026, allComarcas: true, comarcas: [] }],
  days: [day("2026-09-08", "closed", "Aniversário da cidade", { comarcas: ["Vila Exemplo"] })],
};

test("a day of a comarca is that comarca's only, and a comarca not known says so", () => {
  const there = count({
    trigger: "day",
    on: "2026-09-04",
    days: 3,
    calendar: LOCAL,
    place: { ...GOIANIA, comarca: "Comarca de Vila Exemplo" },
  });
  assert.equal(there.startsOn, "2026-09-09");
  assert.equal(there.dueOn, "2026-09-11");
  assert.deepEqual(there.skipped, [
    { from: "2026-09-07", to: "2026-09-07", reason: "holiday", label: "Independência do Brasil" },
    { from: "2026-09-08", to: "2026-09-08", reason: "closed", label: "Aniversário da cidade" },
  ]);
  assert.deepEqual(there.assumptions, []);

  const elsewhere = count({
    trigger: "day",
    on: "2026-09-04",
    days: 3,
    calendar: LOCAL,
    place: { ...GOIANIA, comarca: "Outra Cidade" },
  });
  assert.equal(elsewhere.dueOn, "2026-09-10");
  assert.deepEqual(elsewhere.assumptions, []);

  const unknown = count({
    trigger: "day",
    on: "2026-09-04",
    days: 3,
    calendar: LOCAL,
    place: { ...GOIANIA, comarca: null },
  });
  assert.equal(unknown.dueOn, "2026-09-10");
  assert.deepEqual(unknown.assumptions, [{ code: "comarca_unknown" }]);

  // A calendar that holds the days of some comarcas only: another comarca's own holidays are not on record.
  const some: CourtCalendar = { ...LOCAL, years: [{ year: 2026, allComarcas: false, comarcas: ["Vila Exemplo"] }] };
  const unlisted = count({
    trigger: "day",
    on: "2026-09-04",
    days: 3,
    calendar: some,
    place: { ...GOIANIA, comarca: "Outra Cidade" },
  });
  assert.deepEqual(unlisted.assumptions, [{ code: "local_days_unchecked", years: [2026] }]);
  const listed = count({
    trigger: "day",
    on: "2026-09-04",
    days: 3,
    calendar: some,
    place: { ...GOIANIA, comarca: "VILA EXEMPLO" },
  });
  assert.deepEqual(listed.assumptions, []);
});

test("a day of a kind of lawsuit or of a system applies to it alone, and is not applied when that is not known", () => {
  const scoped: CourtCalendar = {
    years: [{ year: 2026, allComarcas: true, comarcas: [] }],
    days: [
      day("2026-09-09", "suspended", "Migração do sistema", { systems: ["pje"] }),
      day("2026-09-10", "closed", "Só da vara cível", { proceedingKinds: ["comum"] }),
    ],
  };
  const pje = count({
    trigger: "day",
    on: "2026-09-08",
    days: 2,
    calendar: scoped,
    place: { proceedingKind: "juizado", system: "pje", comarca: "X" },
  });
  assert.equal(pje.dueOn, "2026-09-11");
  assert.deepEqual(pje.skipped, [
    { from: "2026-09-09", to: "2026-09-09", reason: "court_suspension", label: "Migração do sistema" },
  ]);

  const civil = count({
    trigger: "day",
    on: "2026-09-08",
    days: 2,
    calendar: scoped,
    place: { proceedingKind: "comum", system: "projudi", comarca: "X" },
  });
  assert.equal(civil.dueOn, "2026-09-11");
  assert.deepEqual(civil.skipped, [
    { from: "2026-09-10", to: "2026-09-10", reason: "closed", label: "Só da vara cível" },
  ]);

  const unsure = count({
    trigger: "day",
    on: "2026-09-08",
    days: 2,
    calendar: scoped,
    place: { proceedingKind: null, system: null, comarca: "X" },
  });
  assert.equal(unsure.dueOn, "2026-09-10");
  assert.deepEqual(unsure.assumptions, [
    { code: "scope_unknown", what: "proceeding_kind", days: ["2026-09-10"] },
    { code: "scope_unknown", what: "system", days: ["2026-09-09"] },
  ]);
});

test("a term in calendar days counts every day the terms run, and its last day moves off a day with no business", () => {
  const fromDay = count({ trigger: "day", on: "2026-10-29", days: 2, counting: "calendar" });
  assert.equal(fromDay.startsOn, "2026-10-30");
  assert.equal(fromDay.countedDueOn, "2026-10-31");
  assert.equal(fromDay.dueOn, "2026-11-03");
  assert.deepEqual(fromDay.moved, { from: "2026-10-31", to: "2026-11-03", reason: "not_business", label: "" });
  assert.deepEqual(fromDay.skipped, [{ from: "2026-11-02", to: "2026-11-02", reason: "holiday", label: "Finados" }]);

  // From a publication, the count starts on the first business day after it all the same (§ 3º).
  const published = count({ on: "2026-10-30", days: 3, counting: "calendar" });
  assert.equal(published.publishedOn, "2026-11-03");
  assert.equal(published.startsOn, "2026-11-04");
  assert.equal(published.dueOn, "2026-11-06");

  // A weekend in the middle counts.
  const across = count({ trigger: "day", on: "2026-10-30", days: 5, counting: "calendar" });
  assert.equal(across.startsOn, "2026-10-31");
  assert.equal(across.dueOn, "2026-11-04");
  assert.deepEqual(across.assumptions, []);
});

test("a term in calendar days runs through the year's end, and says a procedural one would end later", () => {
  // Art. 219 counts every procedural term in business days, so the rule cannot tell this one procedural:
  // it does not stop from 20 December to 20 January, which gives the earlier day, and says so.
  const result = count({ trigger: "day", on: "2026-12-15", days: 10, counting: "calendar" });
  assert.equal(result.startsOn, "2026-12-16");
  assert.equal(result.countedDueOn, "2026-12-25");
  // Christmas is in the court's recess: the last day moves to the first day the court has business.
  assert.equal(result.dueOn, "2027-01-07");
  assert.deepEqual(result.moved, {
    from: "2026-12-25",
    to: "2027-01-07",
    reason: "not_business",
    label: "Recesso forense",
  });
  assert.deepEqual(result.skipped, [
    { from: "2026-12-26", to: "2027-01-06", reason: "closed", label: "Recesso forense" },
  ]);
  assert.deepEqual(result.assumptions, [
    { code: "calendar_suspension" },
    { code: "calendar_unchecked", years: [2027] },
  ]);

  // The same term in business days stops at the suspension, as the code says.
  const procedural = count({ trigger: "day", on: "2026-12-15", days: 10 });
  assert.equal(procedural.dueOn, "2027-01-29");
  assert.ok(result.dueOn < procedural.dueOn);

  // From a publication of January, the count in calendar days starts on the business day after it.
  const published = count({ on: "2027-01-13", days: 3, counting: "calendar" });
  assert.equal(published.publishedOn, "2027-01-14");
  assert.equal(published.startsOn, "2027-01-15");
  assert.equal(published.dueOn, "2027-01-18");
  assert.deepEqual(published.assumptions, [
    { code: "calendar_suspension" },
    { code: "calendar_unchecked", years: [2027] },
  ]);

  // A day the court suspended the terms is run through the same way.
  const suspended: CourtCalendar = {
    years: [{ year: 2026, allComarcas: true, comarcas: [] }],
    days: [day("2026-09-09", "suspended", "Migração do sistema")],
  };
  const through = count({ trigger: "day", on: "2026-09-08", days: 2, counting: "calendar", calendar: suspended });
  assert.equal(through.dueOn, "2026-09-10");
  assert.deepEqual(through.assumptions, [{ code: "calendar_suspension" }]);
  assert.equal(count({ trigger: "day", on: "2026-09-08", days: 2, calendar: suspended }).dueOn, "2026-09-11");
});

test("a start day that is no business day is kept as given, and said", () => {
  const result = count({ trigger: "day", on: "2026-10-10", days: 5 });
  assert.equal(result.startsOn, "2026-10-13");
  assert.equal(result.dueOn, "2026-10-19");
  assert.deepEqual(result.skipped, [
    { from: "2026-10-12", to: "2026-10-12", reason: "holiday", label: "Nossa Senhora Aparecida" },
  ]);
  assert.deepEqual(result.assumptions, [{ code: "start_not_business", day: "2026-10-10" }]);
});

test("what the rule cannot know is said: a year nobody checked, a comarca not known, a publication before the DJEN's rule", () => {
  const result = count({
    on: "2025-05-15",
    days: 5,
    calendar: { years: [], days: [] },
    place: { proceedingKind: null, system: null, comarca: null },
  });
  assert.equal(result.publishedOn, "2025-05-16");
  assert.equal(result.dueOn, "2025-05-23");
  assert.deepEqual(result.assumptions, [
    { code: "djen_before_rule" },
    { code: "calendar_unchecked", years: [2025] },
    { code: "comarca_unknown" },
  ]);
});

test("the national holidays are the ones of federal law, 20 November from 2024 on", () => {
  assert.equal(nationalHoliday("2026-04-21"), "Tiradentes");
  assert.equal(nationalHoliday("2026-10-12"), "Nossa Senhora Aparecida");
  // Good Friday and Corpus Christi are each court's.
  assert.equal(nationalHoliday("2026-04-03"), null);
  assert.equal(nationalHoliday("2026-06-04"), null);
  assert.equal(nationalHoliday("2023-11-20"), null);
  assert.equal(nationalHoliday("2024-11-20"), "Dia Nacional de Zumbi e da Consciência Negra");

  const empty = { years: [], days: [] };
  assert.equal(count({ trigger: "day", on: "2023-11-17", days: 1, calendar: empty }).dueOn, "2023-11-20");
  assert.equal(count({ trigger: "day", on: "2025-11-19", days: 1, calendar: empty }).dueOn, "2025-11-21");

  assert.equal(inYearEndSuspension("2026-12-19"), false);
  assert.equal(inYearEndSuspension("2026-12-20"), true);
  assert.equal(inYearEndSuspension("2027-01-20"), true);
  assert.equal(inYearEndSuspension("2027-01-21"), false);
});

test("a comarca is compared without accents, case or the word comarca", () => {
  assert.equal(comarcaKey("Comarca de Goiânia"), "goiania");
  assert.equal(comarcaKey("  GOIÂNIA "), "goiania");
  assert.equal(comarcaKey("Leopoldo de Bulhões"), "leopoldo de bulhoes");
  assert.equal(comarcaKey("Comarca dos Campos"), "campos");
  assert.equal(comarcaKey(null), "");
});

test("an input the rule cannot count is refused, and a calendar that never lets a term end too", () => {
  const cases: [Partial<DeadlineInput>, string][] = [
    [{ days: 0 }, "invalid_days"],
    [{ days: 366 }, "invalid_days"],
    [{ days: 2.5 }, "invalid_days"],
    [{ on: "2026-02-30" }, "invalid_day"],
    [{ on: "2018-12-31" }, "invalid_day"],
    [{ trigger: "hearing" as DeadlineInput["trigger"] }, "invalid_trigger"],
    [{ counting: "hours" as DeadlineInput["counting"] }, "invalid_counting"],
  ];
  for (const [overrides, code] of cases) {
    assert.deepEqual(computeDeadline(input(overrides)), { ok: false, code }, JSON.stringify(overrides));
  }
  const shut: CourtCalendar = {
    years: [],
    days: daysFrom("2026-01-01", "2033-12-31").map((date) => day(date, "closed", "Fechado")),
  };
  assert.deepEqual(computeDeadline(input({ calendar: shut })), { ok: false, code: "too_long" });

  const long = count({ on: "2026-01-02", days: 365 });
  assert.ok(long.dueOn > "2027-06-01" && long.dueOn < "2027-12-31", long.dueOn);
});

test("the same input gives the same deadline", () => {
  assert.deepEqual(count({ on: "2026-12-11" }), count({ on: "2026-12-11" }));
});

test("the justice of a court is read from its acronym", () => {
  assert.equal(justiceOfCourt("TRT18"), "trabalho");
  assert.equal(justiceOfCourt("TST"), "trabalho");
  assert.equal(justiceOfCourt("trf1"), "federal");
  assert.equal(justiceOfCourt("TRF6"), "federal");
  assert.equal(justiceOfCourt("TJGO"), "estadual");
  assert.equal(justiceOfCourt(null), "estadual");
});

test("the holidays of the Justiça Federal are the law's (Lei nº 5.010/1966, art. 62)", () => {
  // Easter Sunday of 2026 is 5 April: Holy Week from Wednesday 1 April, Carnival on 16 and 17 February.
  assert.equal(federalJusticeHoliday("2026-03-31"), null);
  assert.equal(federalJusticeHoliday("2026-04-01"), "Semana Santa");
  assert.equal(federalJusticeHoliday("2026-04-05"), "Semana Santa");
  assert.equal(federalJusticeHoliday("2026-04-06"), null);
  assert.equal(federalJusticeHoliday("2026-02-16"), "Carnaval");
  assert.equal(federalJusticeHoliday("2026-02-17"), "Carnaval");
  assert.equal(federalJusticeHoliday("2026-02-18"), null);
  assert.equal(federalJusticeHoliday("2026-08-11"), "Dia da instalação dos cursos jurídicos");
  assert.equal(federalJusticeHoliday("2026-12-08"), "Nossa Senhora da Conceição");
  assert.equal(federalJusticeHoliday("2027-01-06"), "Recesso da Justiça Federal");
  assert.equal(federalJusticeHoliday("2027-01-07"), null);
  // Easter of 2027 is 28 March: Holy Week from Wednesday 24 March.
  assert.equal(federalJusticeHoliday("2027-03-24"), "Semana Santa");
  assert.equal(federalJusticeHoliday("2027-03-23"), null);
});

test("a term in a federal court passes Holy Week; one in a labour court counts as a state court's does", () => {
  // Made available on Monday 30 March 2026 and published on Tuesday 31: five business days.
  const base: Partial<DeadlineInput> = {
    on: "2026-03-30",
    days: 5,
    calendar: { years: [], days: [] },
    place: { proceedingKind: "juizado", system: "pje", comarca: null },
  };
  const state = count({ ...base, justice: "estadual" });
  const labour = count({ ...base, justice: "trabalho" });
  const federal = count({ ...base, justice: "federal" });
  assert.equal(state.publishedOn, "2026-03-31");
  // In a state court and a labour one, Good Friday is the court's own day, not the law's: 1, 2, 3, 6 and 7 April.
  assert.equal(state.dueOn, "2026-04-07");
  assert.equal(labour.dueOn, "2026-04-07");
  assert.equal(labour.justice, "trabalho");
  // In a federal court, Wednesday 1 to Sunday 5 April are holidays: 6 to 10 April.
  assert.equal(federal.startsOn, "2026-04-06");
  assert.equal(federal.dueOn, "2026-04-10");
  assert.equal(federal.justice, "federal");
  assert.ok(federal.skipped.some((skip) => skip.reason === "holiday" && skip.label === "Semana Santa"));
});
