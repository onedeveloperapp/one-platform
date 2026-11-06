import { type CardStateInput, cardStates } from "./card-state";
import type { CaseNow } from "./now";
import { describe, expect, it } from "vitest";

// Every case here is invented.

const quiet: CaseNow = { working: [], blocking: [], holder: "one", sections: {} };

const base = (overrides: Partial<CardStateInput> = {}): CardStateInput => ({
  status: "documents",
  now: "2026-11-05T15:00:00Z",
  today: "2026-11-05",
  peopleMissing: 0,
  people: 1,
  flightMissing: false,
  segments: 1,
  documentsMissing: 0,
  documents: [],
  account: null,
  statements: [],
  interviewOpen: false,
  envelopes: [],
  proceedings: [],
  drafts: [],
  filings: [],
  hearings: [],
  publications: [],
  deadlinesOpen: 0,
  complaints: [],
  links: [],
  dossierIssued: false,
  ...overrides,
});

describe("cardStates", () => {
  it("says a card done when everything in it is", () => {
    const states = cardStates(
      base({
        documents: [
          { status: "accepted", kind: "identity" },
          { status: "accepted", kind: "ticket" },
        ],
        envelopes: [{ status: "signed" }],
        account: "ready",
      }),
      quiet,
    );
    expect(states.people).toEqual({ tone: "done", text: { key: "card-state-people-done" } });
    expect(states.trip?.tone).toBe("done");
    expect(states.documents).toEqual({
      tone: "done",
      text: { key: "card-state-documents-done", values: { count: 2 } },
    });
    expect(states.signatures?.text.key).toBe("card-state-signatures-done");
    expect(states.statements?.text.key).toBe("card-state-statements-done");
  });

  it("puts what the top says of a card before its own facts: the firm's, ONE's work, the client's, a failure", () => {
    const now: CaseNow = {
      ...quiet,
      sections: {
        documents: { firm: false, failed: false, client: false, working: true },
        drafts: { firm: true, failed: false, client: false, working: true },
        filing: { firm: false, failed: true, client: false, working: false },
        signatures: { firm: false, failed: false, client: true, working: false },
      },
    };
    const states = cardStates(base({ documents: [{ status: "accepted", kind: "identity" }] }), now);
    expect(states.documents).toEqual({ tone: "working", text: { key: "card-state-documents-working" } });
    expect(states.drafts?.tone).toBe("firm");
    expect(states.filing?.tone).toBe("failed");
    expect(states.signatures).toEqual({ tone: "client", text: { key: "card-state-signatures-client" } });
  });

  it("says what is still missing as the client's, and nothing yet as such", () => {
    const states = cardStates(base({ peopleMissing: 1, segments: 0, flightMissing: true, documentsMissing: 2 }), quiet);
    expect(states.people?.tone).toBe("client");
    expect(states.trip?.text.key).toBe("card-state-trip-client");
    expect(states.documents?.text.key).toBe("card-state-documents-client");
    expect(states.proceedings).toEqual({ tone: "idle", text: { key: "card-state-proceedings-none" } });
    expect(states.drafts?.tone).toBe("idle");
  });

  it("says the court's side: filed, the hearing set, the deadlines in day", () => {
    const states = cardStates(
      base({
        status: "filed",
        proceedings: [{ status: "filed", system: "projudi", systemApproval: null }],
        filings: [{ status: "filed" }],
        hearings: [{ status: "scheduled", startsAt: "2026-12-01T13:00:00Z" }],
        deadlinesOpen: 0,
      }),
      quiet,
    );
    expect(states.proceedings?.text.key).toBe("card-state-proceedings-filed");
    expect(states.filing?.tone).toBe("done");
    expect(states.hearings?.text.key).toBe("card-state-hearings-next");
    expect(states.deadlines?.tone).toBe("done");
  });

  it("says the publications: none yet, ONE's triage that waits for the lawyer's awareness, and all of them done", () => {
    expect(cardStates(base({ status: "filed" }), quiet).publications?.text.key).toBe("card-state-publications-none");
    const waiting = cardStates(
      base({
        status: "filed",
        publications: [
          { category: "audiencia", ackOwed: true },
          { category: "prazo", ackOwed: false },
        ],
      }),
      quiet,
    );
    expect(waiting.publications).toBeUndefined();
    const done = cardStates(base({ status: "filed", publications: [{ category: "ciencia", ackOwed: false }] }), quiet);
    expect(done.publications).toMatchObject({ tone: "done", text: { key: "card-state-publications-done" } });
    // What the top says of the card comes first: the lawyer's awareness, the firm's.
    const marked = cardStates(base({ status: "filed", publications: [{ category: "prazo", ackOwed: true }] }), {
      ...quiet,
      sections: { publications: { firm: true, working: false, client: false, failed: false } },
    });
    expect(marked.publications).toMatchObject({ tone: "firm", text: { key: "card-state-publications-firm" } });
    // What waits is the triage ONE left to a person: the card says that, not the awareness.
    const toTriage = cardStates(base({ status: "filed", publications: [{ category: null, ackOwed: false }] }), {
      ...quiet,
      sections: { publications: { firm: true, working: false, client: false, failed: false } },
    });
    expect(toTriage.publications).toMatchObject({
      tone: "firm",
      text: { key: "card-state-publications-firm-triage" },
    });
  });

  it("says a complaint past its day as the firm's, and the client's link as where it stands", () => {
    const states = cardStates(
      base({
        complaints: [{ outcome: "pending", answerDueOn: "2026-11-01" }],
        links: [{ revokedAt: null, expiresAt: "2026-12-01T00:00:00Z", finishedAt: null, visits: 2 }],
      }),
      quiet,
    );
    expect(states.complaints?.tone).toBe("firm");
    expect(states.link).toEqual({ tone: "client", text: { key: "card-state-link-opened" } });
  });
});
