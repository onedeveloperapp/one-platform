// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  casePieceFactsOf,
  clientPieceFactsOf,
  factsAskedMessage,
  factsReminderMessage,
  pieceFactsErrorKey,
} from "@/lib/cases/piece-facts";
import { priorComplaintErrorKey, priorComplaintOf } from "@/lib/cases/prior-complaint";

// Every person and fact here is invented.

describe("the client's check of the facts of the initial (0182)", () => {
  it("reads the case's checks, and nothing that is not one", () => {
    expect(casePieceFactsOf({ ok: false })).toBeNull();
    const read = casePieceFactsOf({
      ok: true,
      reachable: true,
      items: [
        {
          id: "c1",
          draft_id: "d1",
          version: 2,
          status: "asked",
          facts: "Você comprou a passagem.",
          draft_version: 2,
          draft_status: "proposed",
        },
        { id: "c2", draft_id: "d2", status: "nonsense" },
      ],
    });
    expect(read?.reachable).toBe(true);
    expect(read?.checks).toHaveLength(1);
    expect(read?.checks[0]).toMatchObject({ id: "c1", version: 2, status: "asked", draftStatus: "proposed" });
  });

  it("shows the client only facts asked, confirmed or corrected, with words in them", () => {
    expect(
      clientPieceFactsOf({
        ok: true,
        items: [
          { id: "a", kind: "comum", facts: "Você viajou.", status: "asked" },
          { id: "b", kind: "juizado", facts: "", status: "asked" },
          { id: "c", kind: "juizado", facts: "Você viajou.", status: "waived" },
        ],
      }),
    ).toEqual([{ id: "a", kind: "comum", facts: "Você viajou.", status: "asked", note: null }]);
  });

  it("speaks to the client by their first name, with no dash nor exclamation", () => {
    for (const text of [factsAskedMessage("Maria"), factsReminderMessage("Maria"), factsAskedMessage("")]) {
      expect(text).not.toMatch(/[–—!]/);
    }
    expect(factsAskedMessage("Maria")).toMatch(/^Maria, a sua ação/);
    expect(factsAskedMessage("")).toMatch(/^A sua ação/);
    expect(pieceFactsErrorKey("note_required")).toBe("piece-facts-error-note");
    expect(pieceFactsErrorKey("anything")).toBe("piece-facts-error");
  });
});

describe("the complaint before the lawsuit (0180)", () => {
  it("reads where it stands, and nothing that is not one", () => {
    expect(priorComplaintOf({ ok: false })).toBeNull();
    expect(priorComplaintOf({ state: "maybe" })).toBeNull();
    const read = priorComplaintOf({
      ok: true,
      state: "waiting",
      overdue: false,
      units: ["Juizado Especial Cível da Comarca de Goianira"],
      complaint: {
        id: "x",
        channel: "consumidor_gov",
        protocol: "2026.11.000456",
        filed_on: "2026-11-10",
        due_on: "2026-11-20",
        outcome: "pending",
        paid_cents: null,
        by_client: true,
      },
      days: 10,
      airline: "LATAM",
    });
    expect(read).toMatchObject({
      state: "waiting",
      units: ["Juizado Especial Cível da Comarca de Goianira"],
      complaint: { protocol: "2026.11.000456", dueOn: "2026-11-20", paidCents: null, byClient: true },
      airline: "LATAM",
    });
    expect(priorComplaintErrorKey("invalid_protocol")).toBe("client-prior-complaint-error-protocol");
    expect(priorComplaintErrorKey(null)).toBe("client-prior-complaint-error");
  });
});
