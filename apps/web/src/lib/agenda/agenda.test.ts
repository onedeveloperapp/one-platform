import {
  agendaEntries,
  digestEmpty,
  digestFor,
  digestHour,
  internalDayOf,
  internalDaysFor,
  internalDaysFrom,
  localOf,
  monthGrid,
  rangeOf,
  readAgendaItems,
  stepOf,
  weekDays,
} from "./agenda";
import { agendaEvents, foldLine, writeIcs } from "./ics";
import { describe, expect, it } from "vitest";

// Every person, case and number here is invented.
const ANA = "a1000000-0000-4000-8000-000000000001";
const CAIO = "a1000000-0000-4000-8000-000000000002";

const count = (dueOn: string, startsOn: string, skipped: unknown[] = []) => ({
  rule: "prazo-v1",
  trigger: "day",
  counting: "business",
  triggerDay: startsOn,
  startsOn,
  dueOn,
  days: 15,
  skipped,
});

const raw = {
  deadlines: [
    {
      id: "d1",
      act: "replica",
      act_name: "Réplica",
      title: "Réplica de Maria Teste",
      status: "confirmed",
      due_on: "2026-11-23",
      starts_on: "2026-11-02",
      explanation: count("2026-11-23", "2026-11-02"),
      case_id: "c1",
      case_seq: 12,
      is_test: false,
      cnj: "1000301-27.2099.8.09.0100",
      court: "TJGO",
      changed_at: "2026-11-09T12:00:00Z",
      people: [CAIO],
    },
    {
      id: "d2",
      act: null,
      act_name: null,
      title: "Manifestação",
      status: "done",
      due_on: "2026-11-24",
      people: [CAIO],
    },
    {
      id: "d3",
      act: null,
      act_name: null,
      title: "Recurso de João Teste",
      status: "proposed",
      due_on: "2026-11-10",
      starts_on: "2026-11-03",
      explanation: null,
      case_id: "c2",
      case_seq: 13,
      is_test: true,
      cnj: "1000302-12.2099.8.09.0100",
      court: "TJGO",
      changed_at: null,
      people: [ANA],
    },
  ],
  hearings: [
    {
      id: "h1",
      kind: "conciliacao",
      mode: "videoconferencia",
      status: "scheduled",
      // 23:30 of the 11th in Manaus.
      starts_at: "2026-11-12T03:30:00Z",
      time_zone: "America/Manaus",
      case_id: "c1",
      case_seq: 12,
      is_test: false,
      cnj: "1000301-27.2099.8.09.0100",
      court: "TJAM",
      attendee_user_id: ANA,
      changed_at: "2026-11-01T12:00:00Z",
      people: [ANA, CAIO],
    },
    {
      id: "h2",
      kind: "una",
      mode: "presencial",
      status: "cancelled",
      starts_at: "2026-11-12T13:00:00Z",
      time_zone: "America/Sao_Paulo",
      case_id: "c1",
      case_seq: 12,
      is_test: false,
      cnj: "1000301-27.2099.8.09.0100",
      court: "TJGO",
      changed_at: "2026-11-11T12:00:00Z",
      people: [CAIO],
    },
  ],
  duration_minutes: 60,
};

describe("the internal deadline of each item", () => {
  it("comes the firm's business days before the fatal one, over the days its count saw", () => {
    // Due on Monday 2026-11-23: the 20th is a national holiday, so two business days before is the 18th.
    expect(internalDayOf("2026-11-23", count("2026-11-23", "2026-11-02"), null, 2)).toBe("2026-11-18");
    expect(internalDayOf("2026-11-23", count("2026-11-23", "2026-11-02"), null, 0)).toBeNull();
    // With no count, the first day the database has; never before it.
    expect(internalDayOf("2026-11-05", null, "2026-11-04", 3)).toBe("2026-11-04");
    expect(internalDayOf("2026-11-05", null, null, 3)).toBeNull();
  });

  it("reads only open deadlines, each with its internal day", () => {
    const items = readAgendaItems(raw, 2);
    expect(items.deadlines.map((item) => [item.id, item.internalOn])).toEqual([
      ["d1", "2026-11-18"],
      ["d3", "2026-11-06"],
    ]);
    expect(items.hearings.map((item) => item.id)).toEqual(["h1", "h2"]);
  });
});

describe("the days of the agenda", () => {
  it("puts a hearing on its own day in its zone, and each deadline on its fatal and internal days", () => {
    expect(localOf("2026-11-12T03:30:00Z", "America/Manaus")).toEqual({ day: "2026-11-11", time: "23:30" });
    const items = readAgendaItems(raw, 2);
    const entries = agendaEntries(items, { kind: "all" }, "2026-11-01", "2026-11-30");
    expect(entries.map((entry) => `${entry.day} ${entry.kind}`)).toEqual([
      "2026-11-06 internal",
      "2026-11-10 fatal",
      "2026-11-11 hearing",
      "2026-11-12 hearing",
      "2026-11-18 internal",
      "2026-11-23 fatal",
    ]);
  });

  it("shows one person what they answer for", () => {
    const items = readAgendaItems(raw, 2);
    const ana = agendaEntries(items, { kind: "person", id: ANA }, "2026-11-01", "2026-11-30");
    expect(ana.map((entry) => `${entry.day} ${entry.kind}`)).toEqual([
      "2026-11-06 internal",
      "2026-11-10 fatal",
      "2026-11-11 hearing",
    ]);
  });

  it("draws a week from Monday and a month in six weeks, and moves by each", () => {
    expect(weekDays("2026-11-12")[0]).toBe("2026-11-09");
    const grid = monthGrid("2026-11-12");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-10-26");
    expect(rangeOf("semana", "2026-11-12")).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(stepOf("mes", "2026-12-31", 1)).toBe("2027-01-01");
    expect(stepOf("mes", "2026-01-15", -1)).toBe("2025-12-01");
    expect(stepOf("semana", "2026-11-12", -1)).toBe("2026-11-05");
  });
});

describe("the e-mail of the morning", () => {
  it("says a person's items of the day and of the next 48 hours, never a typed title nor a test case", () => {
    const items = readAgendaItems(raw, 2);
    const digest = digestFor(items, { userId: CAIO, wholeFirm: false }, "2026-11-10", new Date("2026-11-11T10:00:00Z"));
    expect(digest.today).toEqual([]);
    expect(digest.next.map((line) => [line.day, line.kind, line.name, line.cancelled, line.changed])).toEqual([
      ["2026-11-11", "hearing", "Audiência de conciliação", false, false],
      ["2026-11-12", "hearing", "Audiência una", true, true],
    ]);
    const ana = digestFor(items, { userId: ANA, wholeFirm: false }, "2026-11-10", new Date("2026-11-10T10:00:00Z"));
    // Her deadline of the 10th is of a test case: left out.
    expect(ana.today).toEqual([]);
    expect(JSON.stringify(digestFor(items, { userId: ANA, wholeFirm: true }, "2026-11-23", new Date()))).not.toContain(
      "Maria",
    );
  });

  it("says nothing to who has nothing", () => {
    const items = readAgendaItems(raw, 2);
    expect(digestEmpty(digestFor(items, { userId: "nobody", wholeFirm: false }, "2026-11-10", new Date()))).toBe(true);
  });

  it("goes on a business morning of Brasília only", () => {
    expect(digestHour(new Date("2026-11-10T11:00:00Z"))).toEqual({ day: "2026-11-10", due: true });
    expect(digestHour(new Date("2026-11-10T09:00:00Z")).due).toBe(false);
    expect(digestHour(new Date("2026-11-10T16:00:00Z")).due).toBe(false);
    // Friday the 20th of November is a national holiday; the 21st a Saturday.
    expect(digestHour(new Date("2026-11-20T11:00:00Z")).due).toBe(false);
    expect(digestHour(new Date("2026-11-21T11:00:00Z")).due).toBe(false);
  });
});

describe("the calendar link", () => {
  it("writes whole days, moments in UTC, a cancelled hearing as cancelled, and no typed title", () => {
    const items = readAgendaItems(raw, 2);
    const events = agendaEvents(
      items,
      { kind: "person", id: CAIO },
      { from: "2026-11-01", to: "2026-11-30" },
      "https://one.example",
      new Date("2026-11-10T12:00:00Z"),
    );
    const file = writeIcs("ONE · Agenda de Caio", events);
    expect(file.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(file).toContain("DTSTART;VALUE=DATE:20261123\r\nDTEND;VALUE=DATE:20261124");
    expect(file).toContain("SUMMARY:Prazo fatal: Réplica · Caso 12");
    expect(file).toContain("SUMMARY:Prazo interno: Réplica · Caso 12");
    expect(file).toContain("DTSTART:20261112T033000Z\r\nDTEND:20261112T043000Z");
    expect(file).toContain("STATUS:CANCELLED");
    expect(file).not.toContain("Maria");
    expect(file.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  });

  it("escapes what the format reserves and folds long lines without splitting a character", () => {
    const file = writeIcs("A; B, C", []);
    expect(file).toContain("X-WR-CALNAME:A\\; B\\, C");
    const long = `SUMMARY:${"ã".repeat(60)}`;
    const folded = foldLine(long);
    expect(folded.split("\r\n ").join("")).toBe(long);
    expect(folded.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
  });
});

describe("the internal days of each act (0167)", () => {
  it("reads the firm's days and the acts' days, keeping only days", () => {
    expect(internalDaysFrom(2, { contestacao: 5, recurso: 0, nada: "x", demais: 99 })).toEqual({
      days: 2,
      byAct: { contestacao: 5, recurso: 0 },
    });
    expect(internalDaysFrom(null, null)).toEqual({ days: 0, byAct: {} });
  });

  it("takes the act's days, else the firm's, and the act's zero switches it off", () => {
    const rule = { days: 2, byAct: { contestacao: 5, recurso: 0 } };
    expect(internalDaysFor(rule, "contestacao")).toBe(5);
    expect(internalDaysFor(rule, "recurso")).toBe(0);
    expect(internalDaysFor(rule, "manifestacao")).toBe(2);
    expect(internalDaysFor(rule, null)).toBe(2);
    expect(internalDaysFor(3, "contestacao")).toBe(3);
  });
});
