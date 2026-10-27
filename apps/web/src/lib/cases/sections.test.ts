import { describe, expect, it } from "vitest";

import { CASE_STATUSES } from "@/lib/cases/cases";
import { CASE_SECTIONS, opensOnArrival } from "@/lib/cases/sections";

describe("which cards of a case open on arrival", () => {
  it("opens what the client is gathering while the case is gathered", () => {
    for (const section of ["people", "trip", "statements", "documents", "link"] as const) {
      expect(opensOnArrival("intake", section, false), section).toBe(true);
    }
    expect(opensOnArrival("intake", "filing", false)).toBe(false);
    expect(opensOnArrival("intake", "deadlines", false)).toBe(false);
  });

  it("opens the lawsuits, their pieces and packages in the drafting, and the court's course once filed", () => {
    expect(opensOnArrival("drafting", "drafts", false)).toBe(true);
    expect(opensOnArrival("drafting", "people", false)).toBe(false);
    expect(opensOnArrival("filed", "deadlines", false)).toBe(true);
    expect(opensOnArrival("filed", "documents", false)).toBe(false);
  });

  it("leaves an empty card closed, unless something in it waits", () => {
    expect(opensOnArrival("intake", "trip", false, true)).toBe(false);
    expect(opensOnArrival("intake", "trip", true, true)).toBe(true);
    expect(opensOnArrival("intake", "summary", false, true)).toBe(true);
  });

  it("leaves the plan of the lawsuits to its own reason once the case is drafted", () => {
    expect(opensOnArrival("drafting", "rules", false)).toBe(false);
    expect(opensOnArrival("drafting", "rules", true)).toBe(true);
  });

  it("opens any card where something waits for a person, at any stage", () => {
    for (const status of CASE_STATUSES) {
      for (const section of CASE_SECTIONS) expect(opensOnArrival(status, section, true)).toBe(true);
    }
  });

  it("keeps the case's facts and story open on every stage, an ended case included", () => {
    for (const status of CASE_STATUSES) {
      expect(opensOnArrival(status, "summary", false)).toBe(true);
      expect(opensOnArrival(status, "timeline", false)).toBe(true);
    }
    expect(opensOnArrival("closed", "proceedings", false)).toBe(false);
  });
});
