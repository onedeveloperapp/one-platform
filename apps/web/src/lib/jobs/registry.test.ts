import { beforeAll, describe, expect, it, vi } from "vitest";

import { isValidWhen, type Sweep } from "@/lib/jobs/schedule";

vi.mock("server-only", () => ({}));

let SWEEPS: readonly Sweep[] = [];

// The registry reaches every worker of the platform: loading it takes a while the first time.
beforeAll(async () => {
  ({ SWEEPS } = await import("@/lib/jobs/registry"));
}, 60_000);

describe("the platform's sweeps (2026-11-04)", () => {
  it("are each named once, on a schedule the clock meets, and none is forgotten", () => {
    const keys = SWEEPS.map((sweep) => sweep.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const sweep of SWEEPS) expect(isValidWhen(sweep.when), sweep.key).toBe(true);
    // Every function the job runner had before the clock is a sweep now.
    expect([...keys].sort()).toEqual(
      [
        "ai-stale-runs",
        "backup",
        "billing-cancellations",
        "billing-maintenance",
        "billing-term-end",
        "case-advance",
        "case-documents",
        "case-drafts",
        "case-interviews",
        "case-statements",
        "client-notices",
        "conversation-turns",
        "court-tracking",
        "deadline-counts",
        "djen-capture",
        "files-upkeep",
        "filing-packages",
        "filing-submissions",
        "flight-alerts",
        "flight-checks",
        "flight-watch",
        "hearing-calendar",
        "import-sweep",
        "maintenance",
        "newsletter",
        "package-signatures",
        "pax-readings",
        "pax-retention",
        "pax-unagreed-departures",
        "publication-reading",
        "publication-triage",
        "purge-leads",
        "signatures",
        "template-imports",
        "vault-upkeep",
        "whatsapp-media",
        "whatsapp-outbox",
      ].sort(),
    );
  });

  it("run while ONE is used only where two servers at once do nothing twice", () => {
    const clockOnly = SWEEPS.filter((sweep) => !sweep.whileUsed).map((sweep) => sweep.key);
    // One lane at the DJEN and at the tribunal, a month of ANAC's record downloaded once, and the upkeep.
    for (const key of ["djen-capture", "court-tracking", "flight-checks", "backup", "newsletter"]) {
      expect(clockOnly, key).toContain(key);
    }
    // What a person waits on is also swept while ONE is used.
    for (const key of ["pax-readings", "case-documents", "conversation-turns", "client-notices", "whatsapp-outbox"]) {
      expect(clockOnly, key).not.toContain(key);
    }
  });
});
