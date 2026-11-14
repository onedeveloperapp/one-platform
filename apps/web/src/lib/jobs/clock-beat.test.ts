import { describe, expect, it } from "vitest";

import { CLOCK_SILENT_MS, clockAlive } from "@/lib/jobs/clock-beat";

// The app's own rounds run only while the clock on ONE's server is silent (lib/jobs/while-used.ts).
describe("whether the clock beat lately", () => {
  const now = Date.parse("2026-11-14T13:00:00Z");
  const beat = (msAgo: number) => ({ at: new Date(now - msAgo).toISOString(), host: "vps", commit: "abc" });

  it("is alive while its last beat is recent", () => {
    expect(clockAlive(beat(0), now)).toBe(true);
    expect(clockAlive(beat(5 * 60_000), now)).toBe(true);
    expect(clockAlive(beat(CLOCK_SILENT_MS - 1), now)).toBe(true);
  });

  it("is silent after three beats with none, or with no mark at all", () => {
    expect(clockAlive(beat(CLOCK_SILENT_MS), now)).toBe(false);
    expect(clockAlive(null, now)).toBe(false);
    expect(clockAlive(undefined, now)).toBe(false);
    expect(clockAlive({}, now)).toBe(false);
    expect(clockAlive({ at: "never" }, now)).toBe(false);
    expect(clockAlive("2026-11-14T13:00:00Z", now)).toBe(false);
  });

  it("does not take a mark from the far future as alive", () => {
    expect(clockAlive(beat(-CLOCK_SILENT_MS), now)).toBe(false);
    expect(clockAlive(beat(-60_000), now)).toBe(true);
  });
});
