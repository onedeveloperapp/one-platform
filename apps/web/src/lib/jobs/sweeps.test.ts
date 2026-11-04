import { describe, expect, it, vi } from "vitest";

import type { Sweep } from "@/lib/jobs/schedule";
import { runSweeps } from "@/lib/jobs/sweeps";

vi.mock("server-only", () => ({}));

const service = {} as never;
const at = Date.UTC(2026, 10, 4, 10, 0);

describe("a round of the sweeps (2026-11-04)", () => {
  it("runs each sweep on its own: one that fails leaves the others to run, and is named", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ran: string[] = [];
    const sweeps: Sweep[] = [
      { key: "a", when: { every: 5 }, run: async () => (ran.push("a"), { done: 1 }) },
      {
        key: "b",
        when: { every: 5 },
        run: async () => {
          throw new Error("down");
        },
      },
      { key: "c", when: { every: 5 }, run: async () => (ran.push("c"), { done: 2 }) },
    ];
    const report = await runSweeps(service, sweeps, { at, budgetMs: 60_000 });
    expect(ran.sort()).toEqual(["a", "c"]);
    expect(report.failed).toEqual(["b"]);
    expect(report.ran.a).toEqual({ done: 1 });
    expect(report.ran.c).toEqual({ done: 2 });
    expect(report.skipped).toEqual([]);
    // The log names the sweep and the kind of failure, nothing of the work.
    expect(error).toHaveBeenCalledWith("sweep_failed", { sweep: "b", message: "down" });
  });

  it("starts nothing once the time given is over, and says what it left for the next round", async () => {
    const sweeps: Sweep[] = ["a", "b"].map((key) => ({ key, when: { every: 5 }, run: async () => ({}) }));
    const report = await runSweeps(service, sweeps, { at, budgetMs: 0 });
    expect(report.ran).toEqual({});
    expect(report.skipped.sort()).toEqual(["a", "b"]);
  });

  it("hands each sweep the moment it stops claiming", async () => {
    let seen = 0;
    const sweeps: Sweep[] = [
      {
        key: "a",
        when: { every: 5 },
        run: async (_service, until) => {
          seen = until;
          return {};
        },
      },
    ];
    const before = Date.now();
    await runSweeps(service, sweeps, { at, budgetMs: 30_000 });
    expect(seen).toBeGreaterThanOrEqual(before + 30_000);
    expect(seen).toBeLessThanOrEqual(Date.now() + 30_000);
  });

  it("runs, while ONE is used, only what serves people, and by the clock only what is due", async () => {
    const ran: string[] = [];
    const sweeps: Sweep[] = [
      { key: "used", when: { every: 10 }, whileUsed: true, run: async () => (ran.push("used"), {}) },
      { key: "clock", when: { every: 5 }, run: async () => (ran.push("clock"), {}) },
    ];
    await runSweeps(service, sweeps, { at: Date.UTC(2026, 10, 4, 10, 5), budgetMs: 60_000, whileUsed: true });
    expect(ran).toEqual(["used"]);
    ran.length = 0;
    await runSweeps(service, sweeps, { at: Date.UTC(2026, 10, 4, 10, 5), budgetMs: 60_000 });
    expect(ran).toEqual(["clock"]);
  });
});
