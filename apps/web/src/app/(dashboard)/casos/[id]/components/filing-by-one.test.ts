// @vitest-environment node
import type { CaseFiling } from "../case-types";
import { filedWithoutNumber, oneFilesIt } from "./filing-by-one";
import { describe, expect, it } from "vitest";

// Only what the two rules read of a package.
const filing = (status: CaseFiling["status"], byOne: CaseFiling["byOne"]): CaseFiling =>
  ({ status, byOne }) as unknown as CaseFiling;
const sub = (status: NonNullable<NonNullable<CaseFiling["byOne"]>["submission"]>["status"]) => ({
  id: "s",
  status,
  channel: "mni" as const,
  protocol: null,
  caseNumber: null,
  message: null,
  error: null,
  attempts: 0,
  retryAfter: null,
  filedAt: null,
  requested: false,
});

describe("when the lawyer's own steps step back for ONE's filing (0101)", () => {
  it("steps back while ONE files the package or is about to, and only then", () => {
    const channel = { channel: "mni" as const, mode: "auto" as const };
    expect(oneFilesIt(filing("ready", { ...channel, blocker: null, submission: null }))).toBe(true);
    expect(oneFilesIt(filing("ready", { ...channel, blocker: "not_signed", submission: null }))).toBe(true);
    for (const status of ["owed", "claimed", "sending"] as const) {
      expect(oneFilesIt(filing("ready", { ...channel, blocker: null, submission: sub(status) }))).toBe(true);
    }
    // A court with no channel, a firm that keeps it to a lawyer, or a filing that came back: the lawyer's way shows.
    expect(oneFilesIt(filing("ready", { channel: null, mode: "auto", blocker: "no_channel", submission: null }))).toBe(
      false,
    );
    expect(oneFilesIt(filing("ready", { ...channel, blocker: "awaits_lawyer", submission: null }))).toBe(false);
    for (const status of ["refused", "unknown", "failed"] as const) {
      expect(oneFilesIt(filing("ready", { ...channel, blocker: null, submission: sub(status) }))).toBe(false);
    }
    expect(oneFilesIt(filing("requested", { ...channel, blocker: null, submission: null }))).toBe(false);
    expect(oneFilesIt(null)).toBe(false);
  });

  it("leaves only the receipt to attach when the court took the lawsuit and gave no number", () => {
    const channel = { channel: "mni" as const, mode: "auto" as const, blocker: null };
    expect(filedWithoutNumber(filing("ready", { ...channel, submission: sub("filed") }))).toBe(true);
    expect(filedWithoutNumber(filing("filed", { ...channel, submission: sub("filed") }))).toBe(false);
    expect(filedWithoutNumber(filing("ready", { ...channel, submission: sub("sending") }))).toBe(false);
  });
});
