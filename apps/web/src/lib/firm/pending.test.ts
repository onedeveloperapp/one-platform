import { describe, expect, it } from "vitest";

import {
  daysSince,
  type FirmPending,
  pendingBadge,
  type PendingGroup,
  pendingGroups,
  pendingLate,
  readFirmPending,
  urgentIds,
} from "@/lib/firm/pending";
import type { FirmToday, TodayViewer } from "@/lib/firm/today";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;

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
  deadlinesOverdue: [],
  deadlinesToday: 0,
  hearingsToday: 0,
  documentsStale: 0,
  documentsStaleHours: 24,
  oneWaitsStaleDays: 2,
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
    expect(readFirmPending({ one_waits: [] })).toBeNull();
    expect(readFirmPending(null)).toBeNull();
    expect(readFirmPending([])).toBeNull();
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
    expect(late.items[4]).toMatchObject({
      href: `/casos/${CASE_A}`,
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
    };
    const groups = pendingGroups(today, pending, PARTNER, NOW);
    const keys = new Set<string>();
    for (const entry of groups) {
      keys.add(`pending-group-${entry.key}`);
      for (const item of entry.items) {
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
