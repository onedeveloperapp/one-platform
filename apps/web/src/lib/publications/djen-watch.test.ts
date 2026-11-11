import { readCourtSystemSignal, readDjenOutage, readDjenWatch } from "./djen-watch";
import { describe, expect, it } from "vitest";

describe("the watch over the DJEN", () => {
  it("reads an outage with the day of Brasília it began, and nothing of an answer that is none", () => {
    // 01:30 UTC on the 10th is still the 9th in Brasília.
    expect(readDjenOutage({ down_since: "2026-11-10T01:30:00Z" })).toEqual({
      downSince: "2026-11-10T01:30:00Z",
      downDay: "2026-11-09",
    });
    expect(readDjenOutage(null)).toBeNull();
    expect(readDjenOutage({ down_since: "ontem" })).toBeNull();
  });

  it("reads a signal of another system only when it names one the platform knows", () => {
    expect(
      readCourtSystemSignal(
        { seen_system: "pje", seen: 30, total: 98, percent: 30, first_seen: "2026-10-20", table_system: "projudi" },
        "TJGO",
        "juizado",
      ),
    ).toMatchObject({
      court: "TJGO",
      kind: "juizado",
      seenSystem: "pje",
      tableSystem: "projudi",
      percent: 30,
      firstSeen: "2026-10-20",
    });
    expect(readCourtSystemSignal({ seen_system: "invented" })).toBeNull();
    expect(readCourtSystemSignal(null)).toBeNull();
  });

  it("reads the operator's watch, leaving out a look that is not one", () => {
    const watch = readDjenWatch({
      state: {
        last_probe_at: "2026-11-10T12:00:00Z",
        fresh: true,
        down_since: null,
        day_items: 40,
        day_without_text: 3,
      },
      probes: [
        {
          court: "TJGO",
          day: "2026-11-09",
          at: "2026-11-10T12:00:00Z",
          outcome: "ok",
          latency_ms: 812,
          items: 40,
          without_text: 3,
        },
        { court: "TJSP", at: "agora", outcome: "ok" },
        { court: "TJRJ", at: "2026-11-10T11:00:00Z", outcome: "talvez" },
      ],
      signals: [{ court: "TJGO", kind: "juizado", seen_system: "pje", seen: 30, total: 98, percent: 30 }],
      courts_seen: 12,
    });
    expect(watch?.probes).toHaveLength(1);
    expect(watch?.probes[0]).toMatchObject({ court: "TJGO", latencyMs: 812, withoutText: 3 });
    expect(watch?.signals[0]?.seenSystem).toBe("pje");
    expect(watch?.downSince).toBeNull();
    expect(watch?.courtsSeen).toBe(12);
  });
});
