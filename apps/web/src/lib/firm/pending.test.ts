import { describe, expect, it } from "vitest";

import {
  attentionGroups,
  daysSince,
  type FirmPending,
  LINK_REASONS,
  pendingBadge,
  type PendingGroup,
  pendingGroups,
  pendingLate,
  pendingWaitsOnFirm,
  readFirmPending,
  sayPending,
  urgentIds,
} from "@/lib/firm/pending";
import type { FirmToday, TodayViewer } from "@/lib/firm/today";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;

const ENVELOPE_A = "e5300000-0000-4000-8000-00000000000a";
const ENVELOPE_B = "e5300000-0000-4000-8000-00000000000b";

const NOTHING: FirmToday = {
  approvalsMine: 0,
  approvalsWaiting: 0,
  conversationsWaiting: 0,
  conversationsClosing: 0,
  sendsFailed: 0,
  whatsapp: "active",
  documentsToReview: 0,
  clientsFinished: 0,
  chronologiesContested: 0,
  complaintsOverdue: 0,
  filingsReady: 0,
  draftsWaiting: 0,
  publicationsNew: 0,
  publicationsCancelled: 0,
  publicationsToReview: 0,
  djenLate: 0,
  djenIncomplete: 0,
  djenStopped: 0,
  movementsNew: 0,
  trackingFailed: 0,
  deadlinesToConfirm: 0,
  deadlinesSoon: 0,
  deadlinesOverdue: 0,
  deadlinesReview: 0,
  publicationsWithoutDeadline: 0,
  publicationsWithoutHearing: 0,
  hearingsSoon: 0,
  hearingsUnresolved: 0,
  calendarLost: 0,
  hearingsUnwarned: 0,
  civilCourtDeclined: 0,
};

const QUIET: FirmPending = {
  oneWaits: [],
  oneWaitsTotal: 0,
  oneWaitsStale: 0,
  linksOwed: [],
  linksOwedTotal: 0,
  conversationsCalled: [],
  conversationsCalledTotal: 0,
  deadlinesOverdue: [],
  deadlinesToday: 0,
  hearingsToday: 0,
  documentsStale: 0,
  documentsStaleHours: 24,
  oneWaitsStaleDays: 2,
  signaturesToConfirm: [],
  signaturesToConfirmTotal: 0,
  packageSignaturesFailed: 0,
};

const PARTNER: TodayViewer = {
  triagesPublications: true,
  worksDeadlines: true,
  confirmsDeadlines: true,
  managesFirm: true,
};
const ATTENDANCE: TodayViewer = {
  triagesPublications: false,
  worksDeadlines: false,
  confirmsDeadlines: false,
  managesFirm: false,
};

const NOW = new Date("2026-10-22T15:00:00Z");
const CASE_A = "d5100000-0000-4000-8000-00000000000a";
const CASE_B = "d5100000-0000-4000-8000-00000000000b";
const PERSON_A = "d5100000-0000-4000-8000-0000000000a1";
const PERSON_B = "d5100000-0000-4000-8000-0000000000b1";
const CONVERSATION_A = "d5100000-0000-4000-8000-000000000201";
const CONVERSATION_B = "d5100000-0000-4000-8000-000000000202";

const group = (groups: PendingGroup[], key: PendingGroup["key"]) => groups.find((entry) => entry.key === key);
const ids = (groups: PendingGroup[], key: PendingGroup["key"]) =>
  group(groups, key)?.items.map((item) => item.id) ?? [];

describe("what waits for somebody, as the database says it", () => {
  it("reads the answer of firm_pending, and refuses one that is not it", () => {
    const read = readFirmPending({
      one_waits: [
        { case_id: CASE_A, seq: 1, client: "Mariana Duarte", waiting: "claims_missing", since: "2026-10-19T12:00:00Z" },
        { case_id: "not-a-case", seq: 2, waiting: "no_signer" },
      ],
      one_waits_total: 1,
      one_waits_stale: 1,
      deadlines_overdue: [
        {
          deadline_id: "x1",
          case_id: CASE_A,
          seq: 1,
          title: "Réplica",
          cnj: "50002023920998090051",
          due_on: "2026-10-19",
        },
        { deadline_id: "x2", title: "Sem dia", due_on: "ontem" },
      ],
      deadlines_today: 1,
      hearings_today: 0,
      documents_stale: 2,
      documents_stale_hours: 24,
      one_waits_stale_days: 2,
    });
    expect(read?.oneWaits).toEqual([
      { caseId: CASE_A, seq: 1, client: "Mariana Duarte", waiting: "claims_missing", since: "2026-10-19T12:00:00Z" },
    ]);
    expect(read?.deadlinesOverdue.map((deadline) => deadline.deadlineId)).toEqual(["x1"]);
    // A database before the links (0046) owes no link to anybody.
    expect(read?.linksOwed).toEqual([]);
    expect(read?.linksOwedTotal).toBe(0);
    // And one before ONE in the conversations (0048) has no conversation waiting for a person.
    expect(read?.conversationsCalled).toEqual([]);
    expect(read?.conversationsCalledTotal).toBe(0);
    expect(readFirmPending({ one_waits: [] })).toBeNull();
    expect(readFirmPending(null)).toBeNull();
    expect(readFirmPending([])).toBeNull();
  });

  it("reads the links ONE did not send, and leaves out one it cannot read", () => {
    const read = readFirmPending({
      one_waits: [],
      one_waits_total: 0,
      one_waits_stale: 0,
      links_owed: [
        { case_id: CASE_A, seq: 3, person_id: PERSON_A, client: "Mariana Duarte", reason: "window_closed" },
        { case_id: CASE_B, seq: 4, person_id: PERSON_B, client: "Rui Lima", reason: "a reason nobody wrote" },
        { case_id: "not-a-case", seq: 5, person_id: PERSON_B, reason: "no_phone" },
      ],
      links_owed_total: 3,
      deadlines_overdue: [],
      deadlines_today: 0,
      hearings_today: 0,
      documents_stale: 0,
      documents_stale_hours: 24,
      one_waits_stale_days: 2,
    });
    expect(read?.linksOwed).toEqual([
      { caseId: CASE_A, seq: 3, personId: PERSON_A, client: "Mariana Duarte", reason: "window_closed" },
    ]);
    expect(read?.linksOwedTotal).toBe(3);
  });

  it("reads the conversations where ONE called a person, and leaves out one it cannot read", () => {
    const read = readFirmPending({
      one_waits: [],
      one_waits_total: 0,
      one_waits_stale: 0,
      conversations_called: [
        {
          conversation_id: CONVERSATION_A,
          contact: "Mariana",
          reason: "Quer falar com um advogado.",
          since: null,
          late: true,
        },
        { conversation_id: CONVERSATION_B, contact: "Rui", reason: "", late: false },
        { conversation_id: "not-a-conversation", contact: "Rui", reason: "Reclamou do escritório." },
      ],
      conversations_called_total: 4,
      deadlines_overdue: [],
      deadlines_today: 0,
      hearings_today: 0,
      documents_stale: 0,
      documents_stale_hours: 24,
      one_waits_stale_days: 2,
    });
    expect(read?.conversationsCalled).toEqual([
      {
        conversationId: CONVERSATION_A,
        contact: "Mariana",
        reason: "Quer falar com um advogado.",
        since: null,
        late: true,
      },
    ]);
    expect(read?.conversationsCalledTotal).toBe(4);
  });

  it("counts whole days since a wait started", () => {
    expect(daysSince("2026-10-22T09:00:00Z", NOW)).toBe(0);
    expect(daysSince("2026-10-19T14:00:00Z", NOW)).toBe(3);
    expect(daysSince(null, NOW)).toBe(0);
    expect(daysSince("not a moment", NOW)).toBe(0);
  });
});

describe("the center of what waits for somebody", () => {
  it("says nothing waits when nothing does", () => {
    const groups = pendingGroups(NOTHING, QUIET, PARTNER, NOW);
    expect(groups).toEqual([]);
    expect(pendingBadge(groups)).toBe(0);
    expect(pendingLate(groups)).toBe(false);
  });

  it("puts what passed its time first: each deadline with its case, papers and cases waiting too long", () => {
    const today: FirmToday = { ...NOTHING, deadlinesOverdue: 3, documentsToReview: 5, hearingsUnresolved: 1 };
    const pending: FirmPending = {
      ...QUIET,
      deadlinesOverdue: [
        {
          deadlineId: "d1",
          caseId: CASE_A,
          seq: 7,
          title: "Réplica",
          cnj: "50002023920998090051",
          dueOn: "2026-10-19",
        },
        {
          deadlineId: "d2",
          caseId: null,
          seq: null,
          title: "Recurso inominado",
          cnj: "50002023920998090051",
          dueOn: "2026-10-20",
        },
      ],
      documentsStale: 2,
      oneWaits: [
        { caseId: CASE_A, seq: 7, client: "Mariana Duarte", waiting: "claims_missing", since: "2026-10-18T12:00:00Z" },
        { caseId: CASE_B, seq: 8, client: "", waiting: "no_signer", since: "2026-10-22T10:00:00Z" },
      ],
      oneWaitsTotal: 2,
      oneWaitsStale: 1,
    };
    const groups = pendingGroups(today, pending, PARTNER, NOW);
    expect(groups.map((entry) => entry.key)).toEqual(["late", "one", "review"]);
    expect(ids(groups, "late")).toEqual([
      "deadline:d1",
      "deadline:d2",
      "need:overdue",
      "documents:stale",
      `case:${CASE_A}:claims_missing`,
      "need:unresolved",
    ]);
    const late = group(groups, "late")!;
    expect(late.items[0]).toMatchObject({
      href: `/casos/${CASE_A}`,
      label: { key: "pending-deadline", values: { title: "Réplica" } },
      detail: { key: "pending-deadline-detail", values: { seq: 7, day: "19/10/2026" } },
    });
    // A deadline of a lawsuit with no case in ONE goes to the list of deadlines, with the lawsuit's number.
    expect(late.items[1]).toMatchObject({
      href: "/prazos?ver=vencidos",
      detail: { key: "pending-deadline-detail-lawsuit", values: { cnj: "5000202-39.2099.8.09.0051" } },
    });
    // The third deadline past its day was not listed: one line says it, and leads to the list.
    expect(late.items[2]).toMatchObject({ href: "/prazos?ver=vencidos", count: 1 });
    // A case waiting three days is late; one waiting since today is ONE's to carry on once somebody acts.
    // The claim of each claimant is written on the case's own card of how it goes to court.
    expect(late.items[4]).toMatchObject({
      href: `/casos/${CASE_A}#como-vai-a-juizo`,
      detail: { key: "pending-case-waits", values: { days: 4, reason: { message: "advance-waiting-claims-missing" } } },
    });
    expect(group(groups, "one")!.items[0]).toMatchObject({
      id: `case:${CASE_B}:no_signer`,
      // Where the firm puts it right, when that is not the case itself.
      href: "/settings/autonomia#quem-assina",
      label: { key: "pending-case-unnamed", values: { seq: 8 } },
    });
    // The papers that are not late yet are only to look at, and are not counted twice.
    expect(group(groups, "review")!.items).toEqual([expect.objectContaining({ id: "need:documents", count: 3 })]);
    expect(pendingLate(groups)).toBe(true);
    expect(pendingBadge(groups)).toBe(2 + 1 + 2 + 1 + 1 + 1);
  });

  it("asks a person for each link ONE could not send, and says late the one it should have sent", () => {
    const pending: FirmPending = {
      ...QUIET,
      linksOwed: [
        { caseId: CASE_A, seq: 3, personId: PERSON_A, client: "Mariana Duarte", reason: "no_conversation" },
        { caseId: CASE_B, seq: 4, personId: PERSON_B, client: "", reason: "late" },
      ],
      linksOwedTotal: 5,
    };
    const groups = pendingGroups(NOTHING, pending, ATTENDANCE, NOW);
    expect(ids(groups, "late")).toEqual([`link:${CASE_B}:${PERSON_B}`]);
    expect(ids(groups, "one")).toEqual([`link:${CASE_A}:${PERSON_A}`, "links:more"]);
    expect(group(groups, "one")!.items[0]).toMatchObject({
      // The case's card of the link, where the person copies it or sends it.
      href: `/casos/${CASE_A}#case-link`,
      label: { key: "pending-link", values: { client: "Mariana Duarte" } },
      detail: { key: "pending-link-detail", values: { seq: 3, reason: { message: "pending-link-no-conversation" } } },
    });
    expect(group(groups, "late")!.items[0]).toMatchObject({ label: { key: "pending-link-unnamed" } });
    // Every link counts, the ones not listed too.
    expect(pendingBadge(groups)).toBe(5);
    expect(urgentIds(groups)).toContain(`link:${CASE_A}:${PERSON_A}`);
  });

  it("asks a person to answer each passenger ONE said a person would, late once they waited too long", () => {
    const pending: FirmPending = {
      ...QUIET,
      conversationsCalled: [
        {
          conversationId: CONVERSATION_A,
          contact: "Mariana",
          reason: "Quer falar com um advogado.",
          since: null,
          late: true,
        },
        {
          conversationId: CONVERSATION_B,
          contact: "",
          reason: "O ONE não conseguiu responder agora.",
          since: null,
          late: false,
        },
      ],
      conversationsCalledTotal: 3,
    };
    const groups = pendingGroups(NOTHING, pending, ATTENDANCE, NOW);
    expect(ids(groups, "late")).toEqual([`conversation:${CONVERSATION_A}`]);
    expect(ids(groups, "one")).toEqual([`conversation:${CONVERSATION_B}`, "conversations:more"]);
    expect(group(groups, "late")!.items[0]).toMatchObject({
      // The conversation itself, where the person answers.
      href: `/atendimento?c=${CONVERSATION_A}`,
      label: { key: "pending-conversation", values: { contact: "Mariana" } },
      detail: { key: "pending-conversation-detail", values: { reason: "Quer falar com um advogado." } },
    });
    expect(group(groups, "one")!.items[0]).toMatchObject({ label: { key: "pending-conversation-unnamed" } });
    expect(pendingBadge(groups)).toBe(3);
    expect(pendingLate(groups)).toBe(true);
  });

  it("splits what falls today from what falls in the next days", () => {
    const today: FirmToday = {
      ...NOTHING,
      deadlinesSoon: 4,
      hearingsSoon: 3,
      conversationsClosing: 1,
      conversationsWaiting: 1,
    };
    const pending: FirmPending = { ...QUIET, deadlinesToday: 1, hearingsToday: 1 };
    const groups = pendingGroups(today, pending, PARTNER, NOW);
    expect(group(groups, "today")!.items.map((item) => [item.id, item.count])).toEqual([
      ["deadlines:today", 1],
      ["deadlines:soon", 3],
      ["hearings:today", 1],
      ["hearings:soon", 2],
      ["need:closing", 1],
    ]);
    expect(pendingLate(groups)).toBe(false);
    expect(pendingBadge(groups)).toBe(8);
  });

  it("leaves what is only to look at out of the badge, and out of what is told at once", () => {
    const today: FirmToday = {
      ...NOTHING,
      approvalsMine: 1,
      approvalsWaiting: 3,
      movementsNew: 2,
      publicationsNew: 4,
      publicationsToReview: 1,
    };
    const groups = pendingGroups(today, QUIET, PARTNER, NOW);
    expect(ids(groups, "one")).toEqual(["need:publications", "need:approvals"]);
    expect(ids(groups, "review")).toEqual(["need:checks", "need:moved", "need:queue"]);
    expect(pendingBadge(groups)).toBe(5);
    expect(urgentIds(groups)).toEqual(["need:publications", "need:approvals"]);
  });

  it("shows each person what is theirs to do, as the home does", () => {
    const today: FirmToday = {
      ...NOTHING,
      deadlinesOverdue: 1,
      deadlinesSoon: 2,
      publicationsNew: 3,
      approvalsMine: 1,
    };
    const pending: FirmPending = {
      ...QUIET,
      deadlinesToday: 1,
      deadlinesOverdue: [
        {
          deadlineId: "d1",
          caseId: CASE_A,
          seq: 7,
          title: "Réplica",
          cnj: "50002023920998090051",
          dueOn: "2026-10-19",
        },
      ],
    };
    const groups = pendingGroups(today, pending, ATTENDANCE, NOW);
    expect(groups.map((entry) => entry.key)).toEqual(["one"]);
    expect(ids(groups, "one")).toEqual(["need:approvals"]);
  });

  it("names the kind of every line, and asks a person for each signature that waits on the firm", () => {
    const pending: FirmPending = {
      ...QUIET,
      signaturesToConfirm: [
        {
          envelopeId: ENVELOPE_A,
          caseId: CASE_A,
          seq: 7,
          client: "Mariana Duarte",
          status: "received",
          // Sent back two days before NOW: longer than the papers may wait.
          since: "2026-10-20T12:00:00Z",
        },
        {
          envelopeId: ENVELOPE_B,
          caseId: CASE_B,
          seq: 8,
          client: "",
          status: "uncertain",
          since: "2026-10-22T11:00:00Z",
        },
      ],
      signaturesToConfirmTotal: 2,
      packageSignaturesFailed: 2,
      oneWaits: [{ caseId: CASE_A, seq: 7, client: "Mariana Duarte", waiting: "claims_missing", since: null }],
      oneWaitsTotal: 1,
    };
    const groups = pendingGroups(NOTHING, pending, PARTNER, NOW);
    const late = groups.find((entry) => entry.key === "late");
    const one = groups.find((entry) => entry.key === "one");
    expect(late?.items.map((item) => item.id)).toEqual([`signature:${ENVELOPE_A}`]);
    expect(late?.items[0]).toMatchObject({
      href: `/casos/${CASE_A}#case-signatures`,
      tag: { key: "pending-tag-signature" },
      label: { key: "pending-signature", values: { client: "Mariana Duarte" } },
      detail: { key: "pending-signature-received", values: { seq: 7 } },
    });
    expect(one?.items.map((item) => item.id)).toEqual([
      `case:${CASE_A}:claims_missing`,
      `signature:${ENVELOPE_B}`,
      "packages:signature-failed",
    ]);
    expect(one?.items[0].tag).toEqual({ key: "advance-tag-claims" });
    expect(one?.items[1]).toMatchObject({
      label: { key: "pending-signature-unnamed" },
      detail: { key: "pending-signature-uncertain", values: { seq: 8 } },
    });
    expect(one?.items[2]).toMatchObject({ href: "/protocolo", count: 2, tag: { key: "pending-tag-filing" } });
    // What holds a case for the home: what passed its time, then what waits on the firm; never what is only to
    // look at.
    expect(attentionGroups(groups).map((entry) => entry.key)).toEqual(["late", "one"]);
    expect(pendingWaitsOnFirm(groups)).toBe(true);
    expect(pendingWaitsOnFirm(pendingGroups(NOTHING, QUIET, PARTNER, NOW))).toBe(false);
  });

  it("says a line's words with whatever translates them, its values said first", () => {
    const t = (key: string, values?: Record<string, string | number>) =>
      `${key}(${Object.entries(values ?? {})
        .map(([name, value]) => `${name}=${value}`)
        .join(",")})`;
    expect(
      sayPending(t, {
        key: "pending-case-waits",
        values: { days: 2, reason: { message: "advance-waiting-claims-missing" } },
      }),
    ).toBe("pending-case-waits(days=2,reason=advance-waiting-claims-missing())");
  });

  it("has words for every line it can show", () => {
    const today: FirmToday = {
      ...NOTHING,
      deadlinesOverdue: 2,
      deadlinesSoon: 2,
      hearingsSoon: 2,
      documentsToReview: 2,
      approvalsMine: 1,
      approvalsWaiting: 2,
      conversationsWaiting: 2,
      conversationsClosing: 1,
      sendsFailed: 1,
      clientsFinished: 1,
      chronologiesContested: 1,
      complaintsOverdue: 1,
      filingsReady: 1,
      draftsWaiting: 1,
      publicationsNew: 1,
      publicationsCancelled: 1,
      publicationsToReview: 1,
      djenLate: 1,
      movementsNew: 1,
      deadlinesToConfirm: 1,
      deadlinesReview: 1,
      publicationsWithoutDeadline: 1,
      publicationsWithoutHearing: 1,
      hearingsUnresolved: 1,
      calendarLost: 1,
      hearingsUnwarned: 1,
      civilCourtDeclined: 1,
    };
    const pending: FirmPending = {
      ...QUIET,
      deadlinesOverdue: [
        {
          deadlineId: "d1",
          caseId: CASE_A,
          seq: 7,
          title: "Réplica",
          cnj: "50002023920998090051",
          dueOn: "2026-10-19",
        },
        {
          deadlineId: "d2",
          caseId: null,
          seq: null,
          title: "Recurso",
          cnj: "50002023920998090051",
          dueOn: "2026-10-19",
        },
      ],
      deadlinesToday: 1,
      hearingsToday: 1,
      documentsStale: 1,
      oneWaits: [
        { caseId: CASE_A, seq: 7, client: "Mariana Duarte", waiting: "claims_missing", since: null },
        { caseId: CASE_B, seq: 8, client: "", waiting: "draft_in_course", since: null },
      ],
      oneWaitsTotal: 5,
      linksOwed: LINK_REASONS.map((reason, index) => ({
        caseId: CASE_A,
        seq: 7,
        personId: `d5100000-0000-4000-8000-00000000010${index}`,
        client: index === 0 ? "" : "Mariana Duarte",
        reason,
      })),
      linksOwedTotal: LINK_REASONS.length + 1,
      conversationsCalled: [
        {
          conversationId: CONVERSATION_A,
          contact: "Mariana",
          reason: "Quer falar com um advogado.",
          since: null,
          late: true,
        },
        { conversationId: CONVERSATION_B, contact: "", reason: "Reclamou do escritório.", since: null, late: false },
      ],
      conversationsCalledTotal: 3,
      signaturesToConfirm: [
        { envelopeId: ENVELOPE_A, caseId: CASE_A, seq: 7, client: "Mariana Duarte", status: "received", since: null },
        { envelopeId: ENVELOPE_B, caseId: CASE_B, seq: 8, client: "", status: "uncertain", since: null },
      ],
      signaturesToConfirmTotal: 3,
      packageSignaturesFailed: 1,
    };
    const groups = pendingGroups(today, pending, PARTNER, NOW);
    const keys = new Set<string>();
    for (const entry of groups) {
      keys.add(`pending-group-${entry.key}`);
      for (const item of entry.items) {
        keys.add(item.tag.key);
        keys.add(item.label.key);
        if (item.detail) keys.add(item.detail.key);
        for (const value of Object.values({ ...item.label.values, ...item.detail?.values })) {
          if (typeof value === "object") keys.add(value.message);
        }
      }
    }
    for (const key of keys) expect(product[key], key).toBeTruthy();
    for (const key of ["pending-title", "pending-open", "pending-new", "pending-empty-title", "pending-error"]) {
      expect(product[key], key).toBeTruthy();
    }
  });
});
