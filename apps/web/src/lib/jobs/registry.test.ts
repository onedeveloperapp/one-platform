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
        "agenda-digests",
        "ai-health",
        "ai-stale-runs",
        "appeal-papers",
        "area-script",
        "backup",
        "billing-cancellations",
        "billing-maintenance",
        "billing-term-end",
        "case-advance",
        "case-documents",
        "case-drafts",
        "case-forecasts",
        "case-interviews",
        "case-statements",
        "chat-data-checks",
        "chat-questions",
        "chatwoot-mirror",
        "chatwoot-upkeep",
        "client-money",
        "client-notices",
        "conversation-turns",
        "court-tracking",
        "deadline-counts",
        "djen-capture",
        "djen-watch",
        "document-reuse",
        "files-copy",
        "files-upkeep",
        "filing-packages",
        "filing-submissions",
        "finance-categorize",
        "finance-closing",
        "finance-documents",
        "finance-receipts",
        "finance-retention",
        "finance-series",
        "firm-personality",
        "flight-alerts",
        "flight-checks",
        "flight-watch",
        "hearing-briefs",
        "hearing-calendar",
        "hearing-results",
        "import-sweep",
        "intermediate-pieces",
        "lawsuit-amounts",
        "lawsuit-outcomes",
        "lead-followups",
        "maintenance",
        "market-reading",
        "newsletter",
        "package-signatures",
        "passenger-welcome",
        "pax-readings",
        "pax-retention",
        "pax-unagreed-departures",
        "piece-facts",
        "piece-filings",
        "publication-acks",
        "publication-actions",
        "publication-reading",
        "publication-triage",
        "purge-leads",
        "referral-asks",
        "session-limits",
        "signature-links",
        "signatures",
        "template-imports",
        "trip-day",
        "usage-meter",
        "vault-upkeep",
        "weekly-digests",
        "whatsapp-media",
        "whatsapp-outbox",
        "whatsapp-profile",
      ].sort(),
    );
  });

  it("run while ONE is used only where two servers at once do nothing twice", () => {
    const clockOnly = SWEEPS.filter((sweep) => !sweep.whileUsed).map((sweep) => sweep.key);
    // One lane at the DJEN and at the tribunal, a month of ANAC's record downloaded once, and the upkeep.
    for (const key of ["djen-capture", "djen-watch", "court-tracking", "flight-checks", "backup", "newsletter"]) {
      expect(clockOnly, key).toContain(key);
    }
    // What a person waits on is also swept while ONE is used.
    for (const key of ["pax-readings", "case-documents", "conversation-turns", "client-notices", "whatsapp-outbox"]) {
      expect(clockOnly, key).not.toContain(key);
    }
  });
});
