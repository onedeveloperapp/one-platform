import { caseNow, type CaseNowInput, mayAct, recentByOne, sectionOfEvent } from "./now";
import { describe, expect, it } from "vitest";

// Every person, case and fact here is invented.

const base = (overrides: Partial<CaseNowInput> = {}): CaseNowInput => ({
  status: "documents",
  today: "2026-11-05",
  now: "2026-11-05T15:00:00Z",
  parties: [{ partyId: "pa", role: "claimant", person: { full_name: "Ana Teste", person_id: "pe-a" } }],
  documents: [],
  missing: [],
  civilCourt: [],
  account: "ready",
  interview: null,
  waiting: null,
  waitingSince: null,
  advance: null,
  linksOwed: [],
  envelopes: [],
  proceedings: [],
  drafts: [],
  filings: [],
  unnamedSigners: [],
  deadlines: [],
  hearings: [],
  hearingMinutes: 60,
  publications: [],
  complaints: [],
  statementsWorking: [],
  ...overrides,
});

const ids = (items: { id: string }[]) => items.map((line) => line.id);

const planned = {
  id: "lw",
  kind: "juizado" as const,
  system: "projudi",
  status: "planned" as const,
  systemApproval: { by: "u", at: "2026-11-05T10:00:00Z" },
  systemRefusal: null,
};

describe("caseNow", () => {
  it("says ONE checks the documents it checks, never as the firm's task, and reads a person's data from them", () => {
    const now = caseNow(
      base({
        documents: [
          {
            id: "d1",
            kind: "identity",
            partyId: "pa",
            status: "received",
            createdAt: "2026-11-05T14:58:00Z",
            processing: "working",
            check: null,
          },
        ],
        missing: [{ type: "fields", personId: "pe-a", name: "Ana Teste", fields: ["cpf", "birth_date"] }],
      }),
    );
    expect(ids(now.working)).toEqual(["documents:checking", "reading:pe-a"]);
    expect(now.blocking).toEqual([]);
    expect(now.holder).toBe("one");
    expect(now.sections.documents).toMatchObject({ working: true, firm: false });
  });

  it("asks the firm only for a document that waits for a person, and the client for what is missing", () => {
    const now = caseNow(
      base({
        documents: [
          {
            id: "d1",
            kind: "identity",
            partyId: "pa",
            status: "received",
            createdAt: "2026-11-05T14:00:00Z",
            processing: "done",
            check: { waiting: true, answer: { decisao: "aceitar" } },
          },
        ],
        missing: [{ type: "flight" }],
      }),
    );
    expect(ids(now.blocking)).toEqual(["documents:suggested", "missing:flight"]);
    expect(now.blocking[0]).toMatchObject({ owner: "firm", tone: "attention", section: "documents" });
    expect(now.blocking[1]).toMatchObject({ owner: "client", tone: "waiting", section: "trip" });
    expect(now.holder).toBe("firm");
  });

  it("is with the client when only the client owes something", () => {
    const now = caseNow(base({ missing: [{ type: "flight" }] }));
    expect(now.holder).toBe("client");
    expect(now.sections.trip).toMatchObject({ client: true });
  });

  it("holds the case on the client's account only before its lawsuits, never after (0097)", () => {
    expect(ids(caseNow(base({ account: "incomplete" })).blocking)).toContain("account:incomplete");
    expect(ids(caseNow(base({ account: "missing" })).blocking)).toContain("account:missing");
    for (const account of ["incomplete", "missing"] as const) {
      const now = caseNow(base({ status: "drafting", account, proceedings: [planned] }));
      expect(ids(now.blocking)).not.toContain(`account:${account}`);
      expect(now.sections.statements).not.toMatchObject({ client: true });
    }
    // What the firm decides of an account still asks the firm: its approval writes the piece again.
    expect(ids(caseNow(base({ account: "proposed", proceedings: [planned] })).blocking)).toContain("account:proposed");
  });

  it("says the package waits for a lawyer to file it, never that the case is with ONE", () => {
    const now = caseNow(
      base({
        status: "drafting",
        proceedings: [planned],
        drafts: [{ id: "dr", proceedingId: "lw", status: "issued", work: null }],
        filings: [
          {
            id: "fp",
            proceedingId: "lw",
            system: "projudi",
            status: "ready",
            blocker: null,
            signature: { takesSigned: true, status: "signed" },
          },
        ],
      }),
    );
    expect(now.blocking.map((line) => [line.id, line.owner, line.actor])).toEqual([["filing:fp", "firm", "lawyer"]]);
    expect(now.blocking[0].text).toEqual({
      key: "case-now-filing-ready",
      values: { kind: { message: "case-proceeding-kind-juizado" }, system: { message: "case-system-projudi" } },
    });
    expect(now.holder).toBe("firm");
  });

  it("says the system the firm approves while ONE writes the piece, and the platform's own waits as the platform's", () => {
    const now = caseNow(
      base({
        status: "drafting",
        proceedings: [
          { ...planned, systemApproval: null },
          { ...planned, id: "lw2", system: null },
        ],
        drafts: [{ id: "dr", proceedingId: "lw", status: "generating", work: "generate" }],
      }),
    );
    expect(ids(now.working)).toEqual(["draft:dr"]);
    expect(now.blocking.map((line) => [line.id, line.owner])).toEqual([
      ["system:lw", "firm"],
      ["system:lw2", "platform"],
    ]);
    expect(now.holder).toBe("firm");
    // With only the platform's wait left, the case is with the platform.
    expect(caseNow(base({ status: "drafting", proceedings: [{ ...planned, system: null }] })).holder).toBe("platform");
  });

  it("says a paper the client sent back by gov.br waits for the firm, and one sent to sign waits for the client", () => {
    const envelope = {
      id: "e1",
      documentId: "doc",
      createdAt: "2026-11-05T12:00:00Z",
      signers: [{ name: "Ana Teste", signedAt: null }],
    };
    expect(caseNow(base({ envelopes: [{ ...envelope, status: "received" }] })).blocking[0]).toMatchObject({
      owner: "firm",
      section: "signatures",
    });
    const pending = caseNow(base({ envelopes: [{ ...envelope, status: "pending" }] }));
    expect(pending.blocking[0]).toMatchObject({ owner: "client", tone: "waiting" });
    expect(pending.holder).toBe("client");
    expect(ids(caseNow(base({ envelopes: [{ ...envelope, status: "opening" }] })).working)).toEqual(["envelope:e1"]);
  });

  it("in court, says the hearing that passed with no word on it, and the decision nobody said is the judgment", () => {
    const now = caseNow(
      base({
        status: "filed",
        hearings: [{ id: "h1", status: "scheduled", startsAt: "2026-11-05T12:00:00Z", timeZone: "America/Sao_Paulo" }],
        publications: [
          { id: "p1", category: "decisao", availableOn: "2026-11-04", judgment: null, readings: [] },
          { id: "p2", category: null, availableOn: "2026-11-05", judgment: null, readings: [] },
          {
            id: "p3",
            category: "prazo",
            availableOn: "2026-11-05",
            judgment: null,
            readings: [{ kind: "deadline", status: "due" }],
          },
        ],
      }),
    );
    expect(ids(now.blocking)).toEqual(["hearing:h1", "publications:untriaged", "judgment:p1"]);
    expect(now.blocking[0].text).toEqual({
      key: "case-now-hearing-silent",
      values: { day: "05/11/2026", time: "09:00" },
    });
    expect(now.blocking.find((line) => line.id === "judgment:p1")?.ask).toEqual({
      kind: "judgment",
      publicationId: "p1",
    });
    expect(ids(now.working)).toEqual(["reading:p3:deadline"]);
    expect(now.holder).toBe("firm");
    // Nothing waiting in court: the case is with the court.
    expect(caseNow(base({ status: "filed" })).holder).toBe("court");
  });

  it("says a wait ONE recorded that no fact of the case says, with where it is put right", () => {
    const now = caseNow(base({ status: "drafting", waiting: "no_signer", waitingSince: "2026-11-04T10:00:00Z" }));
    expect(now.blocking).toEqual([
      expect.objectContaining({
        id: "wait:no_signer",
        owner: "firm",
        actor: "partner",
        href: "/settings/autonomia#quem-assina",
        since: "2026-11-04T10:00:00Z",
      }),
    ]);
    // A wait said by the case's own facts is not said twice.
    expect(caseNow(base({ waiting: "case_incomplete", missing: [{ type: "flight" }] })).blocking).toHaveLength(1);
    // ONE trying again by itself is ONE's, never the firm's.
    expect(caseNow(base({ waiting: "step_failed" })).working.map((line) => line.owner)).toEqual(["one"]);
  });

  it("says ONE is looking at the case, or owes it a look", () => {
    expect(ids(caseNow(base({ advance: { running: true, due: true } })).working)).toEqual(["advance:running"]);
    expect(ids(caseNow(base({ advance: { running: false, due: true } })).working)).toEqual(["advance:due"]);
  });

  it("says nothing of a case that ended", () => {
    const now = caseNow(
      base({ status: "closed", missing: [{ type: "flight" }], advance: { running: true, due: true } }),
    );
    expect(now).toMatchObject({ working: [], blocking: [], holder: "ended" });
  });

  it("puts the firm's failures first, then what is the firm's, the client's and the platform's", () => {
    const now = caseNow(
      base({
        status: "filed",
        missing: [{ type: "flight" }],
        deadlines: [
          { id: "dl1", status: "confirmed", overdue: true, review: false },
          { id: "dl2", status: "proposed", overdue: false, review: false },
        ],
        proceedings: [{ ...planned, system: null }],
      }),
    );
    expect(ids(now.blocking)).toEqual(["deadlines:overdue", "deadlines:confirm", "missing:flight", "system:lw"]);
  });
});

describe("who may act on a line", () => {
  const viewer = {
    lawyer: false,
    partner: false,
    decidesForFirm: false,
    decidesCourtSystem: false,
    confirmsDeadlines: false,
    worksDeadlines: false,
  };
  it("offers each line's way only to who may take it", () => {
    expect(mayAct("anyone", viewer)).toBe(true);
    expect(mayAct("lawyer", viewer)).toBe(false);
    expect(mayAct("lawyer", { ...viewer, lawyer: true })).toBe(true);
    expect(mayAct("partner", { ...viewer, decidesForFirm: true })).toBe(true);
    expect(mayAct("confirmers", { ...viewer, worksDeadlines: true })).toBe(false);
  });
});

describe("what ONE did a moment ago", () => {
  const events = [
    { id: "1", at: "2026-11-05T14:59:00Z", kind: "document_accepted", actorType: "system" },
    { id: "2", at: "2026-11-05T14:50:00Z", kind: "person_saved", actorType: "person" },
    { id: "3", at: "2026-11-05T14:40:00Z", kind: "draft_requested", actorType: "system" },
    { id: "4", at: "2026-11-03T14:40:00Z", kind: "proceeding_saved", actorType: "system" },
  ];
  it("keeps ONE's own events of the last day, the latest first", () => {
    expect(recentByOne(events, "2026-11-05T15:00:00Z").map((event) => event.id)).toEqual(["1", "3"]);
  });
  it("leads each to the card it is about", () => {
    expect(sectionOfEvent("document_accepted")).toBe("documents");
    expect(sectionOfEvent("draft_requested")).toBe("drafts");
    expect(sectionOfEvent("filing_package_ready")).toBe("filing");
    expect(sectionOfEvent("created")).toBeNull();
  });
});
