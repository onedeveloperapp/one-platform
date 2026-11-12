// @vitest-environment node
import { describe, expect, it } from "vitest";

import { type JudgmentSession, oralStanding, sessionErrorKey, sessionsOf, sessionToShow } from "@/lib/courts/sessions";

const base: JudgmentSession = {
  id: "s1",
  proceedingId: "p1",
  kind: "virtual",
  startsOn: "2026-11-24",
  startsAt: null,
  status: "scheduled",
  withdrawReason: null,
  source: "publication",
  counted: true,
  limitOn: "2026-11-23",
  limitHour: "10:00",
  limitBasis: "Resolução nº 225/2023, art. 78, § 1º",
  limitError: null,
  oralChoice: null,
  oralBy: null,
};

describe("the sessions of judgment and the registration for oral argument (0219)", () => {
  it("reads what the case answered, leaving out what is not a session", () => {
    expect(sessionsOf({ ok: false })).toBeNull();
    expect(
      sessionsOf({
        ok: true,
        sessions: [
          {
            id: "s1",
            proceeding_id: "p1",
            kind: "virtual",
            starts_on: "2026-11-24",
            starts_at: "14:00:00",
            status: "scheduled",
            counted: true,
            limit_on: "2026-11-23",
            limit_hour: "10:00:00",
          },
          { id: "s2", proceeding_id: "p1", kind: "outra", starts_on: "2026-11-24" },
        ],
      })?.map((session) => [session.id, session.startsAt, session.limitHour, session.counted]),
    ).toEqual([["s1", "14:00", "10:00", true]]);
  });

  it("says whether the limit to register is to come, passed, or the firm already said", () => {
    expect(oralStanding(base, "2026-11-20", "15:00")).toBe("open");
    expect(oralStanding(base, "2026-11-23", "09:59")).toBe("open");
    expect(oralStanding(base, "2026-11-23", "10:00")).toBe("passed");
    expect(oralStanding(base, "2026-11-24", "08:00")).toBe("passed");
    expect(oralStanding({ ...base, oralChoice: "registered" }, "2026-11-24", "08:00")).toBe("registered");
    expect(oralStanding({ ...base, counted: false }, "2026-11-20", "08:00")).toBe("counting");
    expect(oralStanding({ ...base, limitOn: null, limitError: "no_rule" }, "2026-11-20", "08:00")).toBe("uncounted");
  });

  it("shows a lawsuit's nearest session to come, else its latest", () => {
    const later = { ...base, id: "s3", startsOn: "2026-12-10" };
    const gone = { ...base, id: "s4", status: "withdrawn" as const, withdrawReason: "Adiada." };
    expect(sessionToShow([later, base, gone], "p1")?.id).toBe("s1");
    expect(sessionToShow([gone], "p1")?.id).toBe("s4");
    expect(sessionToShow([base], "p2")).toBeNull();
  });

  it("has words for every refusal", () => {
    for (const code of ["not_found", "not_filed", "already", "not_open", "not_allowed", "invalid_data"]) {
      expect(sessionErrorKey(code)).not.toBe("session-error-failed");
    }
    expect(sessionErrorKey("other")).toBe("session-error-failed");
  });
});
