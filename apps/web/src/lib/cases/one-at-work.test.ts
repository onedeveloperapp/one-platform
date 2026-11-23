import { describe, expect, it } from "vitest";

import type { NowItem } from "@/lib/cases/now";
import {
  dismissWork,
  elapsedText,
  emptyMemory,
  holdingWork,
  holdsScreen,
  isLong,
  LONG_AFTER_MS,
  memoryOf,
  nextStepOf,
  rememberWork,
  startOf,
} from "@/lib/cases/one-at-work";

const work = (id: string, patch: Partial<NowItem> = {}): NowItem => ({
  id,
  owner: "one",
  actor: null,
  tone: "waiting",
  text: { key: "case-now-one-looking" },
  section: null,
  href: null,
  since: null,
  ask: null,
  fields: null,
  slow: false,
  ...patch,
});

const at = Date.parse("2026-11-07T14:31:00Z");

describe("the work that holds the screen", () => {
  it("is what ONE is doing now, never a look it will take soon, a late work or a wait on a court", () => {
    const held = holdingWork([
      work("advance:running"),
      work("advance:due", { text: { key: "case-now-one-looks-soon" } }),
      work("draft:1", { slow: true }),
      work("filing:1", { outside: true }),
      work("documents:checking"),
    ]);
    expect(held.map((item) => item.id)).toEqual(["advance:running", "documents:checking"]);
  });

  it("foretells only what always follows: a piece's text has its citations read", () => {
    expect(nextStepOf(work("draft:1", { text: { key: "case-now-draft-writing" } }))).toBe("one-at-work-next-citations");
    expect(nextStepOf(work("draft:1", { text: { key: "case-now-draft-issuing" } }))).toBeNull();
  });
});

describe("what the screen remembers of ONE's work", () => {
  it("keeps when each work was first seen and forgets what ended", () => {
    const first = rememberWork(emptyMemory(), [work("a"), work("b")], at);
    const later = rememberWork(first, [work("b"), work("c")], at + 5_000);
    expect(later.seen).toEqual({ b: at, c: at + 5_000 });
  });

  it("holds the screen again only for a work the person did not go on without", () => {
    const memory = dismissWork(rememberWork(emptyMemory(), [work("a")], at), [work("a")]);
    expect(holdsScreen(memory, [work("a")])).toBe(false);
    expect(holdsScreen(memory, [work("a"), work("b")])).toBe(true);
    // A work that ended and came back is a new one.
    const ended = rememberWork(memory, [], at + 1_000);
    expect(holdsScreen(ended, [work("a")])).toBe(true);
  });

  it("reads back only what has its shape", () => {
    expect(memoryOf({ seen: { a: 1, b: "x" }, dismissed: ["a", 2] })).toEqual({ seen: { a: 1 }, dismissed: ["a"] });
    expect(memoryOf("nothing")).toEqual(emptyMemory());
  });
});

describe("when ONE is taking longer than usual", () => {
  it("counts from the work's own start, or from when the screen first saw it", () => {
    const memory = rememberWork(emptyMemory(), [work("a")], at);
    expect(startOf(work("a"), memory, at + 9_000)).toBe(at);
    expect(startOf(work("b", { since: "2026-11-07T14:30:00Z" }), memory, at)).toBe(at - 60_000);
  });

  it("says it after two minutes, even on a screen opened late, and waits two more when the person chooses to", () => {
    const memory = emptyMemory();
    const started = [work("a", { since: "2026-11-07T14:31:00Z" })];
    expect(isLong(started, memory, at + LONG_AFTER_MS - 1)).toBe(false);
    expect(isLong(started, memory, at + LONG_AFTER_MS)).toBe(true);
    expect(isLong(started, memory, at + 10 * 60_000)).toBe(true);
    expect(isLong(started, memory, at + LONG_AFTER_MS, at + 2 * LONG_AFTER_MS)).toBe(false);
    expect(isLong([], memory, at + 10 * 60_000)).toBe(false);
  });

  it("says how long in seconds, minutes, or both", () => {
    expect(elapsedText(18_400)).toEqual({ key: "one-at-work-seconds", values: { count: 18 } });
    expect(elapsedText(120_000)).toEqual({ key: "one-at-work-minutes", values: { count: 2 } });
    expect(elapsedText(130_000)).toEqual({ key: "one-at-work-minutes-seconds", values: { minutes: 2, seconds: 10 } });
  });
});
