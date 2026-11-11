import { readWeeklyFacts, weekLabel, weeklyDue } from "./weekly-digest";
import { describe, expect, it } from "vitest";

describe("the partner's weekly digest", () => {
  it("goes on Monday mornings of Brasília, telling the week before", () => {
    // Monday, 9 November 2026, 10:00 in Brasília (13:00 UTC).
    expect(weeklyDue(new Date("2026-11-09T13:00:00Z"))).toEqual({ week: "2026-11-02", due: true });
    // The same Monday at 06:00 in Brasília, and at noon.
    expect(weeklyDue(new Date("2026-11-09T09:00:00Z")).due).toBe(false);
    expect(weeklyDue(new Date("2026-11-09T15:00:00Z")).due).toBe(false);
    // A Wednesday names the same week, and is no day of the digest.
    expect(weeklyDue(new Date("2026-11-11T13:00:00Z"))).toEqual({ week: "2026-11-02", due: false });
    // A Sunday night in Brasília is still the week before's Sunday.
    expect(weeklyDue(new Date("2026-11-09T02:00:00Z"))).toEqual({ week: "2026-10-26", due: false });
  });

  it("says the week in the reader's words, across two months too", () => {
    expect(weekLabel("2026-11-02")).toBe("2 a 8 de novembro");
    expect(weekLabel("2026-10-26")).toBe("26 de outubro a 1 de novembro");
  });

  it("reads the database's answer, taking anything that is not a count as zero", () => {
    const facts = readWeeklyFacts({
      week: "2026-11-02",
      tests_counted: true,
      cases: { opened: 3, opened_before: "1", closings: -2, going: 9 },
      outcomes: { received: 1, received_cents: 412350 },
      one: { tasks: 41, minutes: 610 },
    });
    expect(facts?.testsCounted).toBe(true);
    expect(facts?.cases).toMatchObject({ opened: 3, openedBefore: 1, closings: 0, filed: 0, going: 9 });
    expect(facts?.outcomes.receivedCents).toBe(412350);
    expect(facts?.ahead).toEqual({ deadlines: 0, hearings: 0 });
    expect(readWeeklyFacts({ cases: {} })).toBeNull();
    expect(readWeeklyFacts(null)).toBeNull();
  });
});
