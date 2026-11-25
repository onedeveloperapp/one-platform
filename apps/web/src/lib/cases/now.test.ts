import { caseNow, type CaseNowInput, dataInChatOf, mayAct, recentByOne, sectionOfEvent } from "./now";
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

  // The owner, 2026-11-25: the firm complements the account with what the client told it, from the line itself.
  it("lets the firm complement an account still owed, by its interview or by its accounts' questions", () => {
    const open = caseNow(
      base({ account: "incomplete", interview: { status: "open", inChat: false, position: 2, total: 4, done: 1 } }),
    ).blocking.find((line) => line.id === "account:incomplete");
    expect(open).toMatchObject({ owner: "client", complement: true });
    const accounts = caseNow(base({ account: "incomplete" })).blocking.find((line) => line.id === "account:incomplete");
    expect(accounts?.complement).toBe(true);
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
    // Before anything is signed, ONE asks the account in the chat after the signature: its work to come, never what
    // holds the case (the owner's test of 2026-11-13).
    const before = caseNow(base({ account: "missing", accountAfterSignature: true }));
    expect(ids(before.blocking)).not.toContain("account:missing");
    // Said under what ONE does later, never as ONE's work now (the owner's test of 2026-11-23).
    expect(ids(before.later)).toEqual(["account:after-signature"]);
    expect(ids(before.working)).toEqual([]);
    expect(before.holder).toBe("one");
    // While the client still owes their data, the case is the client's, the account said as ONE's work to come.
    const owing = caseNow(base({ account: "missing", accountAfterSignature: true, missing: [{ type: "flight" }] }));
    expect(ids(owing.later)).toContain("account:after-signature");
    expect(owing.holder).toBe("client");
  });

  it("says the data ONE asks in the chat as ONE's until it asked, then the client's to answer there (0280)", () => {
    const owed = {
      type: "fields" as const,
      personId: "pe-a",
      name: "Ana Teste",
      fields: ["nationality", "marital_status", "profession"],
    };
    // Not asked yet: ONE's work now, never what holds the case nor "completes on the link".
    const toAsk = caseNow(base({ missing: [owed], dataInChat: { personId: "pe-a", state: "to_ask" } }));
    expect(ids(toAsk.working)).toEqual(["data:pe-a"]);
    expect(toAsk.working[0]).toMatchObject({ owner: "one", text: { key: "case-now-data-chat-ask" } });
    expect(toAsk.blocking).toEqual([]);
    expect(toAsk.holder).toBe("one");
    // Asked once the client answers what comes first: what ONE does later.
    const later = caseNow(base({ missing: [owed], dataInChat: { personId: "pe-a", state: "later" } }));
    expect(ids(later.later)).toEqual(["data:pe-a"]);
    expect(later.working).toEqual([]);
    // Asked: the client answers in the chat.
    const asked = caseNow(base({ missing: [owed], dataInChat: { personId: "pe-a", state: "asked" } }));
    expect(asked.blocking[0]).toMatchObject({
      id: "missing:fields:pe-a",
      owner: "client",
      text: { key: "case-now-data-chat-answer" },
    });
    expect(asked.holder).toBe("client");
    // With no chat, or a field the chat does not ask, the client completes it on the link.
    // What the database answers, read; anything else is no chat.
    expect(dataInChatOf({ person_id: "pe-a", state: "asked" })).toEqual({ personId: "pe-a", state: "asked" });
    expect(dataInChatOf({ person_id: "pe-a", state: "outro" })).toBeNull();
    expect(dataInChatOf(null)).toBeNull();
    for (const input of [
      base({ missing: [owed] }),
      base({
        missing: [{ ...owed, fields: ["cpf", "profession"] }],
        dataInChat: { personId: "pe-a", state: "to_ask" },
      }),
      base({ missing: [owed], dataInChat: { personId: "pe-other", state: "to_ask" } }),
    ]) {
      expect(caseNow(input).blocking[0]).toMatchObject({ owner: "client", text: { key: "case-now-missing-fields" } });
    }
  });

  it("says the piece waits for the client while ONE asks what it lacks, else for a lawyer (0099)", () => {
    const draft = { id: "dr", proceedingId: "lw", status: "proposed", work: null, requestedAt: null } as const;
    const asking = caseNow(
      base({
        status: "drafting",
        account: "incomplete",
        proceedings: [planned],
        drafts: [draft] as unknown as CaseNowInput["drafts"],
        interview: { status: "open", inChat: true, position: 1, total: 2, done: 0 },
      }),
    );
    const line = asking.blocking.find((one) => one.id === "draft:dr");
    expect(line).toMatchObject({ owner: "client", text: { key: "case-now-draft-asking-chat" } });
    expect(asking.holder).toBe("client");
    const review = caseNow(
      base({
        status: "drafting",
        proceedings: [planned],
        drafts: [draft] as unknown as CaseNowInput["drafts"],
      }),
    );
    expect(review.blocking.find((one) => one.id === "draft:dr")).toMatchObject({
      owner: "firm",
      text: { key: "case-now-draft-review" },
    });
    // What the text leaves to complete is said, once each, for the lawyer to do (the owner, 2026-11-13).
    const gaps = caseNow(
      base({
        status: "drafting",
        proceedings: [planned],
        drafts: [
          {
            ...draft,
            body: "Ré: [COMPLETAR: razão social da companhia], CNPJ [COMPLETAR: CNPJ da companhia]. [COMPLETAR: CNPJ da companhia]",
          },
        ] as unknown as CaseNowInput["drafts"],
      }),
    );
    expect(gaps.blocking.find((one) => one.id === "draft:dr")).toMatchObject({
      owner: "firm",
      text: {
        key: "case-now-draft-complete",
        values: { gaps: "razão social da companhia, CNPJ da companhia" },
      },
    });
    // Once the client answered, ONE writes it again: its work, nothing asked of a lawyer (0100).
    const rewriting = caseNow(
      base({
        status: "drafting",
        proceedings: [planned],
        drafts: [{ ...draft, oneRedo: "rewriting" }] as unknown as CaseNowInput["drafts"],
      }),
    );
    expect(rewriting.working.find((one) => one.id === "draft:dr")).toMatchObject({
      owner: "one",
      text: { key: "case-now-draft-rewriting" },
    });
    expect(rewriting.blocking.find((one) => one.id === "draft:dr")).toBeUndefined();
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

  it("never says a held package is to be filed: built again, or the contact its court's screen asks (0288)", () => {
    const held = (code: string) =>
      caseNow(
        base({
          status: "drafting",
          proceedings: [planned],
          drafts: [{ id: "dr", proceedingId: "lw", status: "issued", work: null }],
          filings: [
            {
              id: "fp",
              proceedingId: "lw",
              system: "eproc",
              status: "ready",
              blocker: null,
              held: code,
              signature: { takesSigned: false, status: null },
            },
          ],
        }),
      );
    const words = { kind: { message: "case-proceeding-kind-juizado" }, system: { message: "case-system-eproc" } };
    for (const [code, key] of [
      ["package_outdated", "case-now-filing-outdated"],
      ["contact_missing", "case-now-filing-contact"],
    ] as const) {
      const now = held(code);
      expect(now.blocking.map((line) => [line.id, line.owner, line.actor, line.tone])).toEqual([
        ["filing:fp:held", "firm", "anyone", "attention"],
      ]);
      expect(now.blocking[0].text).toEqual({ key, values: words });
      expect(now.holder).toBe("firm");
    }
  });

  it("says ONE files the package itself, and that a sending tried again later waits on the court", () => {
    const filing = (submission: { status: string; attempts?: number; retryAfter?: string | null }) =>
      caseNow(
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
              byOne: { channel: "mni", blocker: null, submission },
            },
          ],
        }),
      ).working.find((line) => line.id === "filing:fp");
    expect(filing({ status: "sending" })).toMatchObject({ owner: "one", text: { key: "case-now-filing-one" } });
    expect(filing({ status: "sending" })?.outside).toBeUndefined();
    expect(filing({ status: "owed", attempts: 2, retryAfter: "2026-11-05T16:00:00Z" })?.outside).toBe(true);
    expect(filing({ status: "owed", attempts: 2, retryAfter: "2026-11-05T14:00:00Z" })?.outside).toBeUndefined();
  });

  it("says a lawyer's batch on the court's screen is ONE's work, and its first filing held for the lawyer's word theirs", () => {
    const now = (status: string) =>
      caseNow(
        base({
          status: "drafting",
          proceedings: [planned],
          drafts: [{ id: "dr", proceedingId: "lw", status: "issued", work: null }],
          filings: [
            {
              id: "fp",
              proceedingId: "lw",
              system: "eproc",
              status: "ready",
              blocker: null,
              signature: { takesSigned: false, status: null },
              // No channel of the court: the lawyer's extension files it on the court's screen (0264).
              byOne: { channel: null, blocker: "no_channel", submission: { status, channel: "extension" } },
            },
          ],
        }),
      );
    for (const status of ["owed", "claimed", "sending"]) {
      expect(now(status).working.find((line) => line.id === "filing:fp")).toMatchObject({
        owner: "one",
        text: { key: "case-now-filing-one" },
      });
    }
    expect(now("confirming").blocking.find((line) => line.id === "filing:fp")).toMatchObject({
      owner: "firm",
      actor: "lawyer",
      text: { key: "case-now-filing-screen-confirm" },
    });
  });

  it("says what ONE waits for to file on the court's screen, the firm's way or a lawyer's or the batch, never ONE's work", () => {
    const screen = (
      firmWay: "browser" | "extension" | "hand" | null,
      ways: ("browser" | "extension" | "hand" | null)[],
    ) =>
      caseNow(
        base({
          status: "drafting",
          proceedings: [planned],
          drafts: [{ id: "dr", proceedingId: "lw", status: "issued", work: null }],
          filings: [
            {
              id: "fp",
              proceedingId: "lw",
              system: "eproc",
              status: "ready",
              blocker: null,
              signature: { takesSigned: false, status: null },
              byOne: {
                channel: null,
                blocker: "no_channel",
                submission: null,
                screen: {
                  key: "eproc-tjsp",
                  name: "eproc do TJSP",
                  ways: ["browser", "extension"],
                  firmWay,
                  lawyers: ways.map((way, index) => ({ userId: `u${index}`, way })),
                },
              },
            },
          ],
        }),
      ).blocking.find((line) => line.id === "filing:fp");
    const kind = { message: "case-proceeding-kind-juizado" };
    expect(screen(null, [null])).toMatchObject({
      owner: "firm",
      actor: "partner",
      text: { key: "case-now-filing-screen-firm", values: { kind, system: "eproc do TJSP" } },
    });
    // The owner's test of 2026-11-23: the firm chose ONE's browser, its lawyer never chose a way at the eproc of TJSP.
    expect(screen("browser", [null])).toMatchObject({
      owner: "firm",
      actor: "lawyer",
      text: { key: "case-now-filing-screen-choose", values: { kind, system: "eproc do TJSP" } },
    });
    expect(screen("browser", ["hand", "extension"])).toMatchObject({
      owner: "firm",
      actor: "lawyer",
      text: { key: "case-now-filing-screen-batch" },
    });
    // Filed by hand, as the firm or every lawyer of the lawsuit chose: the steps of the court's system.
    for (const line of [screen("hand", [null]), screen("browser", ["hand"])]) {
      expect(line).toMatchObject({ owner: "firm", actor: "lawyer", text: { key: "case-now-filing-ready" } });
    }
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

  it("says a paper sent back signed once, by its envelope and by its own name (the owner's test of 2026-11-23)", () => {
    const doc = {
      kind: "contract",
      partyId: "pa",
      createdAt: "2026-11-05T12:00:00Z",
      processing: "skipped" as const,
      check: null,
    };
    const now = caseNow(
      base({
        documents: [
          { ...doc, id: "doc", status: "accepted" },
          // What the client sent back signed for that envelope: said by the envelope, never also as a document.
          { ...doc, id: "signed", status: "received", envelopeId: "e1" },
        ],
        envelopes: [
          {
            id: "e1",
            documentId: "doc",
            status: "received",
            createdAt: "2026-11-05T12:00:00Z",
            signers: [{ name: "Ana Teste", signedAt: null }],
          },
        ],
      }),
    );
    expect(ids(now.blocking)).toEqual(["envelope:e1"]);
    expect(now.blocking[0].text).toEqual({
      key: "case-now-envelope-received",
      values: { names: "Ana Teste", document: { message: "case-now-document-contract" } },
    });
  });

  it("in court with no hearing set, says a publication that waits for triage may be the hearing", () => {
    const untriaged = { id: "p1", category: null, availableOn: "2026-11-05", judgment: null, readings: [] };
    const textOf = (now: ReturnType<typeof caseNow>) =>
      now.blocking.find((line) => line.id === "publications:untriaged")?.text;
    expect(textOf(caseNow(base({ status: "filed", publications: [untriaged] })))).toEqual({
      key: "case-now-publications-untriaged-hearing",
      values: { count: 1 },
    });
    // A hearing set, or one triaged before, and the publication is only one to triage.
    const scheduled = {
      id: "h1",
      status: "scheduled",
      startsAt: "2026-11-09T12:00:00Z",
      timeZone: "America/Sao_Paulo",
    };
    expect(textOf(caseNow(base({ status: "filed", hearings: [scheduled], publications: [untriaged] })))?.key).toBe(
      "case-now-publications-untriaged",
    );
    const known = { ...untriaged, id: "p0", category: "audiencia" };
    expect(textOf(caseNow(base({ status: "filed", publications: [known, untriaged] })))?.key).toBe(
      "case-now-publications-untriaged",
    );
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
        href: "/settings/regras#quem-assina",
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
