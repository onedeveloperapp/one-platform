import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CourtCalendar } from "@flyee/rules/deadlines";
import { businessDayBefore } from "@flyee/rules/deadlines";
import { ORAL_ARGUMENT_RULE_VERSION, oralArgumentLimit } from "@flyee/rules/sessions";

const NONE: CourtCalendar = { years: [], days: [] };
const PLACE = { proceedingKind: "juizado", system: "projudi", comarca: "Goiânia" };
const TURMA = {
  until: "previous_business_day" as const,
  hour: "10:00",
  basis: "Resolução nº 225/2023 do TJGO, art. 78, § 1º",
};

describe("the registration for oral argument (sustentacao-v1)", () => {
  it("is due at 10h of the business day before a virtual session", () => {
    // A session starting on a Tuesday: the Monday before.
    const out = oralArgumentLimit({
      startsOn: "2026-11-24",
      startsAt: "10:00",
      rule: TURMA,
      calendar: NONE,
      place: PLACE,
    });
    assert.deepEqual(out, {
      ok: true,
      limit: {
        on: "2026-11-23",
        hour: "10:00",
        basis: TURMA.basis,
        passed: [],
        ruleVersion: ORAL_ARGUMENT_RULE_VERSION,
      },
    });
  });

  it("passes the weekend, a national holiday and a day the court was closed, saying each", () => {
    // A session on Monday 2026-11-16: Sunday and Saturday pass, Friday 13 is closed by the court, Thursday 12 is it.
    const calendar: CourtCalendar = {
      years: [],
      days: [
        {
          day: "2026-11-13",
          kind: "closed",
          label: "Ponto facultativo",
          proceedingKinds: [],
          systems: [],
          comarcas: [],
        },
      ],
    };
    const out = oralArgumentLimit({ startsOn: "2026-11-16", startsAt: null, rule: TURMA, calendar, place: PLACE });
    assert.equal(out.ok && out.limit.on, "2026-11-12");
    assert.deepEqual(out.ok && out.limit.passed, [{ day: "2026-11-13", label: "Ponto facultativo" }]);
    // The day after Tiradentes: the national holiday is passed with its name.
    const after = businessDayBefore("2026-04-22", NONE, PLACE);
    assert.equal(after?.day, "2026-04-20");
    assert.equal(after?.passed[0]?.day, "2026-04-21");
  });

  it("never puts the limit on a day of partial business, nor on a closure of another comarca's", () => {
    const calendar: CourtCalendar = {
      years: [],
      days: [
        {
          day: "2026-02-18",
          kind: "partial",
          label: "Quarta-feira de cinzas, expediente a partir das 12h",
          proceedingKinds: [],
          systems: [],
          comarcas: [],
        },
        { day: "2026-02-17", kind: "closed", label: "Carnaval", proceedingKinds: [], systems: [], comarcas: [] },
        {
          day: "2026-02-16",
          kind: "closed",
          label: "Feriado local",
          proceedingKinds: [],
          systems: [],
          comarcas: ["Anápolis"],
        },
      ],
    };
    const out = oralArgumentLimit({ startsOn: "2026-02-19", startsAt: null, rule: TURMA, calendar, place: PLACE });
    assert.equal(out.ok && out.limit.on, "2026-02-16");
  });

  it("is the session's own opening for a presencial one, with its hour when the pauta says it", () => {
    const rule = { until: "session_start" as const, hour: null, basis: "CPC, art. 937, § 2º" };
    const out = oralArgumentLimit({ startsOn: "2026-11-24", startsAt: "14:00", rule, calendar: NONE, place: PLACE });
    assert.equal(out.ok && out.limit.on, "2026-11-24");
    assert.equal(out.ok && out.limit.hour, "14:00");
    const unknown = oralArgumentLimit({ startsOn: "2026-11-24", startsAt: null, rule, calendar: NONE, place: PLACE });
    assert.equal(unknown.ok && unknown.limit.hour, null);
  });

  it("refuses what it cannot read", () => {
    assert.deepEqual(
      oralArgumentLimit({ startsOn: "24/11/2026", startsAt: null, rule: TURMA, calendar: NONE, place: PLACE }),
      {
        ok: false,
        code: "invalid_day",
      },
    );
    assert.deepEqual(
      oralArgumentLimit({ startsOn: "2026-11-24", startsAt: "25:00", rule: TURMA, calendar: NONE, place: PLACE }),
      {
        ok: false,
        code: "invalid_hour",
      },
    );
    assert.deepEqual(
      oralArgumentLimit({
        startsOn: "2026-11-24",
        startsAt: null,
        rule: { ...TURMA, hour: null },
        calendar: NONE,
        place: PLACE,
      }),
      { ok: false, code: "invalid_rule" },
    );
  });

  it("counts hours before the session, or before its day, from its first minute when its hour is not known", () => {
    const cnj = {
      until: "hours_before" as const,
      hour: null,
      hours: 48,
      anchor: "session" as const,
      basis: "Res. CNJ 591/2024",
    };
    const timed = oralArgumentLimit({
      startsOn: "2026-11-24",
      startsAt: "14:00",
      rule: cnj,
      calendar: NONE,
      place: PLACE,
    });
    assert.deepEqual(timed.ok && [timed.limit.on, timed.limit.hour], ["2026-11-22", "14:00"]);
    const untimed = oralArgumentLimit({
      startsOn: "2026-11-24",
      startsAt: null,
      rule: cnj,
      calendar: NONE,
      place: PLACE,
    });
    assert.deepEqual(untimed.ok && [untimed.limit.on, untimed.limit.hour], ["2026-11-22", "00:00"]);
    const day = oralArgumentLimit({
      startsOn: "2026-11-24",
      startsAt: "14:00",
      rule: { ...cnj, anchor: "day" as const },
      calendar: NONE,
      place: PLACE,
    });
    assert.deepEqual(day.ok && [day.limit.on, day.limit.hour], ["2026-11-22", "00:00"]);
  });

  it("counts days from the publication of the pauta as a term is, and says when there is none", () => {
    const tjmg = {
      until: "days_after_publication" as const,
      hour: null,
      days: 5,
      counting: "business" as const,
      basis: "Código de Normas dos Juizados do TJMG, art. 176, § 1º",
    };
    // Made available on Tuesday 2026-11-10: published on the 11th, counted from the 12th, five business days.
    const out = oralArgumentLimit({
      startsOn: "2026-11-30",
      startsAt: null,
      rule: tjmg,
      calendar: NONE,
      place: PLACE,
      publishedOn: "2026-11-10",
    });
    assert.deepEqual(out.ok && [out.limit.on, out.limit.hour], ["2026-11-18", null]);
    assert.deepEqual(
      oralArgumentLimit({ startsOn: "2026-11-30", startsAt: null, rule: tjmg, calendar: NONE, place: PLACE }),
      {
        ok: false,
        code: "no_publication",
      },
    );
  });
});
