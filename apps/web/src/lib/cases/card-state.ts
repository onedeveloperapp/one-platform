import type { CaseNow } from "@/lib/cases/now";
import type { CaseSection } from "@/lib/cases/sections";
import { complaintOverdue } from "@/lib/cases/statements";
import type { PendingText } from "@/lib/firm/pending";

/**
 * Where each card of the case stands, said on its head (the owner, 2026-11-05: "identifique de forma mais explícita a
 * situação de cada card"): one state per card, in a word or two with its colour and icon, so a closed card reads as
 * done, being done by ONE, waiting for the client, asking the firm, failed, or nothing yet, before anybody opens it.
 * Read from what the top of the case says of each card (`caseNow`'s sections: the firm's, the client's, ONE's work,
 * a failure) and, where nothing there waits, from the card's own facts (all documents accepted, the power of attorney
 * signed, the piece issued). Pure.
 */

/** How a card stands: done, ONE at work, waiting for the client, asking the firm, failed, or nothing to say yet. */
export type CardTone = "done" | "working" | "client" | "firm" | "failed" | "idle";

export type CardState = { tone: CardTone; text: PendingText };

type Doc = { status: "received" | "accepted" | "rejected"; kind: string };
type Envelope = { status: string };
type Lawsuit = { status: "planned" | "filed" | "closed"; system: string | null; systemApproval: unknown | null };
type Draft = { status: string };
type Filing = { status: string };
type Statement = { stage: string };
type Complaint = { outcome: string; answerDueOn: string | null };
type Link = { revokedAt: string | null; expiresAt: string; finishedAt: string | null; visits: number };
type Hearing = { status: string; startsAt: string };

export type CardStateInput = {
  status: string;
  now: string;
  today: string;
  /** People whose data the case still lacks. */
  peopleMissing: number;
  people: number;
  flightMissing: boolean;
  segments: number;
  documentsMissing: number;
  documents: Doc[];
  account: string | null;
  statements: Statement[];
  interviewOpen: boolean;
  envelopes: Envelope[];
  proceedings: Lawsuit[];
  drafts: Draft[];
  filings: Filing[];
  hearings: Hearing[];
  /** The publications of the case's lawsuits: what they were triaged as, and whether ONE's triage waits (0104). */
  publications: { category: string | null; ackOwed: boolean }[];
  /** The case's open deadlines, and whether it ever had one. */
  deadlinesOpen: number;
  complaints: Complaint[];
  links: Link[];
  dossierIssued: boolean;
};

const text = (key: string, values?: PendingText["values"]): PendingText => (values ? { key, values } : { key });
const at = (tone: CardTone, key: string, values?: PendingText["values"]): CardState => ({
  tone,
  text: text(key, values),
});

/** What the top says of a card, said in a word; null when it says nothing there. */
function fromNow(section: CaseSection, now: CaseNow): CardTone | null {
  const mark = now.sections[section];
  if (!mark) return null;
  if (mark.failed) return "failed";
  if (mark.firm) return "firm";
  if (mark.working) return "working";
  if (mark.client) return "client";
  return null;
}

/** The words of a card the top marks, by its card: what it waits for, in two or three words. */
const MARKED_KEY: Partial<Record<CaseSection, Partial<Record<CardTone, string>>>> = {
  people: { firm: "card-state-people-firm", working: "card-state-people-working", client: "card-state-people-client" },
  trip: { client: "card-state-trip-client", firm: "card-state-trip-firm" },
  statements: {
    firm: "card-state-statements-firm",
    working: "card-state-statements-working",
    client: "card-state-statements-client",
    failed: "card-state-statements-failed",
  },
  documents: {
    firm: "card-state-documents-firm",
    working: "card-state-documents-working",
    client: "card-state-documents-client",
    failed: "card-state-documents-failed",
  },
  signatures: {
    firm: "card-state-signatures-firm",
    working: "card-state-signatures-working",
    client: "card-state-signatures-client",
    failed: "card-state-signatures-failed",
  },
  rules: { firm: "card-state-rules-firm", client: "card-state-rules-client" },
  proceedings: { firm: "card-state-proceedings-firm" },
  drafts: {
    firm: "card-state-drafts-firm",
    working: "card-state-drafts-working",
    client: "card-state-drafts-client",
    failed: "card-state-drafts-failed",
  },
  filing: {
    firm: "card-state-filing-firm",
    working: "card-state-filing-working",
    client: "card-state-filing-client",
    failed: "card-state-filing-failed",
  },
  hearings: { firm: "card-state-hearings-firm", working: "card-state-hearings-working" },
  publications: { firm: "card-state-publications-firm", working: "card-state-publications-working" },
  deadlines: {
    firm: "card-state-deadlines-firm",
    failed: "card-state-deadlines-failed",
    working: "card-state-deadlines-working",
  },
  complaints: { firm: "card-state-complaints-firm" },
  link: { firm: "card-state-link-firm", working: "card-state-link-working", client: "card-state-link-client" },
};

const GENERIC_KEY: Record<Exclude<CardTone, "done" | "idle">, string> = {
  firm: "card-state-firm",
  working: "card-state-working",
  client: "card-state-client",
  failed: "card-state-failed",
};

export function cardStates(input: CardStateInput, now: CaseNow): Partial<Record<CaseSection, CardState>> {
  const states: Partial<Record<CaseSection, CardState>> = {};
  const set = (section: CaseSection, own: () => CardState | null) => {
    const tone = fromNow(section, now);
    if (tone) {
      states[section] = at(tone, MARKED_KEY[section]?.[tone] ?? GENERIC_KEY[tone as keyof typeof GENERIC_KEY]);
      return;
    }
    const state = own();
    if (state) states[section] = state;
  };

  set("people", () =>
    input.people === 0
      ? at("idle", "card-state-people-none")
      : input.peopleMissing > 0
        ? at("client", "card-state-people-client")
        : at("done", "card-state-people-done"),
  );

  set("trip", () =>
    input.segments === 0
      ? at(
          input.flightMissing ? "client" : "idle",
          input.flightMissing ? "card-state-trip-client" : "card-state-trip-none",
        )
      : at("done", "card-state-trip-done"),
  );

  set("statements", () => {
    if (input.interviewOpen) return at("client", "card-state-statements-asking");
    if (input.statements.some((statement) => statement.stage === "confirmed"))
      return at("done", "card-state-statements-confirmed");
    if (input.account === "ready") return at("done", "card-state-statements-done");
    if (input.statements.some((statement) => statement.stage === "waiting_client")) {
      return at("client", "card-state-statements-confirm");
    }
    return input.statements.length === 0 ? at("idle", "card-state-statements-none") : null;
  });

  set("documents", () => {
    if (input.documents.length === 0) {
      return input.documentsMissing > 0
        ? at("client", "card-state-documents-client")
        : at("idle", "card-state-documents-none");
    }
    if (input.documentsMissing > 0) return at("client", "card-state-documents-client");
    const accepted = input.documents.filter((document) => document.status === "accepted").length;
    return accepted > 0 && input.documents.every((document) => document.status !== "received")
      ? at("done", "card-state-documents-done", { count: accepted })
      : null;
  });

  set("signatures", () => {
    if (input.envelopes.length === 0) return at("idle", "card-state-signatures-none");
    if (input.envelopes.some((envelope) => envelope.status === "pending"))
      return at("client", "card-state-signatures-client");
    if (input.envelopes.some((envelope) => envelope.status === "signed"))
      return at("done", "card-state-signatures-done");
    return null;
  });

  set("rules", () =>
    input.proceedings.length > 0 ? at("done", "card-state-rules-done") : at("idle", "card-state-rules-none"),
  );

  set("proceedings", () => {
    if (input.proceedings.length === 0) return at("idle", "card-state-proceedings-none");
    if (input.proceedings.some((proceeding) => proceeding.status === "filed"))
      return at("done", "card-state-proceedings-filed");
    if (input.proceedings.some((proceeding) => proceeding.status === "planned" && !proceeding.system)) {
      return at("idle", "card-state-proceedings-platform");
    }
    return input.proceedings.every((proceeding) => proceeding.status !== "planned" || proceeding.systemApproval)
      ? at("done", "card-state-proceedings-done")
      : null;
  });

  set("drafts", () => {
    const live = input.drafts.filter((draft) => !["cancelled", "rejected"].includes(draft.status));
    if (live.length === 0) return at("idle", "card-state-drafts-none");
    if (live.some((draft) => draft.status === "issued")) return at("done", "card-state-drafts-done");
    return null;
  });

  set("filing", () => {
    if (input.filings.some((filing) => filing.status === "filed")) return at("done", "card-state-filing-done");
    return input.filings.some((filing) => filing.status !== "cancelled") ? null : at("idle", "card-state-filing-none");
  });

  set("hearings", () => {
    const nowAt = Date.parse(input.now);
    const next = input.hearings
      .filter((hearing) => hearing.status === "scheduled" && Date.parse(hearing.startsAt) > nowAt)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    return next ? at("idle", "card-state-hearings-next") : at("idle", "card-state-hearings-none");
  });

  // ONE triages what the court publishes and the lawyer says they are aware of it (0104): every one triaged and
  // acknowledged is done; none yet is said so.
  set("publications", () => {
    if (input.publications.length === 0) return at("idle", "card-state-publications-none");
    return input.publications.every((publication) => publication.category !== null && !publication.ackOwed)
      ? at("done", "card-state-publications-done")
      : null;
  });

  set("deadlines", () =>
    input.deadlinesOpen > 0
      ? at("idle", "card-state-deadlines-open", { count: input.deadlinesOpen })
      : at("done", "card-state-deadlines-done"),
  );

  set("complaints", () => {
    if (input.complaints.length === 0) return at("idle", "card-state-complaints-none");
    if (input.complaints.some((complaint) => complaintOverdue(complaint, input.today))) {
      return at("firm", "card-state-complaints-firm");
    }
    if (input.complaints.some((complaint) => complaint.outcome === "pending"))
      return at("client", "card-state-complaints-waiting");
    return at("done", "card-state-complaints-done");
  });

  set("link", () => {
    const live = input.links.filter((link) => !link.revokedAt && Date.parse(link.expiresAt) > Date.parse(input.now));
    if (input.links.some((link) => link.finishedAt)) return at("done", "card-state-link-done");
    if (live.length > 0) {
      return live.some((link) => link.visits > 0)
        ? at("client", "card-state-link-opened")
        : at("client", "card-state-link-sent");
    }
    return at("idle", "card-state-link-none");
  });

  if (input.dossierIssued) states.dossier = at("done", "card-state-dossier-done");

  return states;
}
