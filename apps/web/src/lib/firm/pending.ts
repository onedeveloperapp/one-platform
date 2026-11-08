import { decisionItems, type WaitingDecisions } from "@/lib/ai/decisions";
import { waitingHref, waitingKey, waitingTagKey, waitPlaceOf } from "@/lib/cases/advance";
import { type FilingAttention, filingAttentionItems, type FilingViewer } from "@/lib/firm/filing-attention";
import { type AckViewer, publicationAckItems, type PublicationAcks } from "@/lib/firm/publication-acks";
import { type FirmToday, type TodayNeed, todayNeeds, type TodayViewer } from "@/lib/firm/today";
import { formatCnj } from "@flyee/rules/cnj";

/**
 * What waits for somebody of the firm, wherever the person is: the pending
 * items of the header (migration 0044). The counts of the home (`firm_today`)
 * and what only this center reads (`firm_pending`), sorted into four groups by
 * how soon somebody must act:
 *
 *   late    what passed its time: deadlines past their day (each, with its
 *           case), hearings with no word on them, papers nobody decided for
 *           too long, cases ONE waits on for too long, messages that did not
 *           go out, complaints past their day, a calendar that stopped;
 *   today   what falls today, and in the next days;
 *   one     what keeps ONE from carrying on: each case it waits on, with what
 *           it waits for, each client's link it could not send, with why, each
 *           conversation where ONE called a person (late once the passenger
 *           waited the setting's minutes), a reading of the DJEN that stopped
 *           or left a communication out, and every decision only a person
 *           takes;
 *   review  what is good to look at and holds nothing up.
 *
 * The first three are the badge: nothing pending or late goes unseen. The
 * last is shown and not counted. Who is looking decides what is theirs, as
 * on the home (`todayNeeds`).
 */

export type OneWait = { caseId: string; seq: number; client: string; waiting: string; since: string | null };

/** Why ONE did not send somebody their link (migration 0046, `client_link_reach`), or `late` once it should have. */
export const LINK_REASONS = [
  "by_person",
  "no_phone",
  "no_number",
  "no_conversation",
  "opted_out",
  "window_closed",
  "late",
] as const;
export type LinkReason = (typeof LINK_REASONS)[number];

export const isLinkReason = (value: unknown): value is LinkReason =>
  (LINK_REASONS as readonly unknown[]).includes(value);

/** Somebody of a case being gathered who never had a link, and why ONE has not sent it. */
export type LinkOwed = { caseId: string; seq: number; personId: string; client: string; reason: LinkReason };

/** A conversation where ONE called a person (migration 0048), with why. */
export type ConversationCalled = {
  conversationId: string;
  contact: string;
  reason: string;
  since: string | null;
  late: boolean;
};

/** A signature that waits for somebody of the firm (migration 0053): a signed file a client sent back, or an outcome nobody can tell. */
export type SignatureToConfirm = {
  envelopeId: string;
  caseId: string;
  seq: number;
  client: string;
  status: "received" | "uncertain";
  since: string | null;
};

export type OverdueDeadline = {
  deadlineId: string;
  caseId: string | null;
  seq: number | null;
  title: string;
  cnj: string;
  dueOn: string;
};

export type FirmPending = {
  oneWaits: OneWait[];
  oneWaitsTotal: number;
  oneWaitsStale: number;
  linksOwed: LinkOwed[];
  linksOwedTotal: number;
  conversationsCalled: ConversationCalled[];
  conversationsCalledTotal: number;
  deadlinesOverdue: OverdueDeadline[];
  deadlinesToday: number;
  hearingsToday: number;
  documentsStale: number;
  documentsStaleHours: number;
  oneWaitsStaleDays: number;
  signaturesToConfirm: SignatureToConfirm[];
  signaturesToConfirmTotal: number;
  packageSignaturesFailed: number;
};

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function oneWaitOf(raw: unknown): OneWait | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const caseId = text(row.case_id);
  const seq = count(row.seq);
  const waiting = text(row.waiting);
  if (!caseId || !UUID.test(caseId) || !seq || !waiting) return null;
  return { caseId, seq, client: text(row.client) ?? "", waiting, since: text(row.since) };
}

function linkOwedOf(raw: unknown): LinkOwed | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const caseId = text(row.case_id);
  const personId = text(row.person_id);
  const seq = count(row.seq);
  if (!caseId || !UUID.test(caseId) || !personId || !UUID.test(personId) || !seq || !isLinkReason(row.reason))
    return null;
  return { caseId, seq, personId, client: text(row.client) ?? "", reason: row.reason };
}

function conversationCalledOf(raw: unknown): ConversationCalled | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const conversationId = text(row.conversation_id);
  const reason = text(row.reason);
  if (!conversationId || !UUID.test(conversationId) || !reason) return null;
  return { conversationId, contact: text(row.contact) ?? "", reason, since: text(row.since), late: row.late === true };
}

function signatureOf(raw: unknown): SignatureToConfirm | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const envelopeId = text(row.envelope_id);
  const caseId = text(row.case_id);
  const seq = count(row.seq);
  if (!envelopeId || !UUID.test(envelopeId) || !caseId || !UUID.test(caseId) || !seq) return null;
  if (row.status !== "received" && row.status !== "uncertain") return null;
  return { envelopeId, caseId, seq, client: text(row.client) ?? "", status: row.status, since: text(row.since) };
}

function overdueOf(raw: unknown): OverdueDeadline | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const deadlineId = text(row.deadline_id);
  const title = text(row.title);
  const dueOn = text(row.due_on);
  const caseId = text(row.case_id);
  if (!deadlineId || !title || !dueOn || !DAY.test(dueOn)) return null;
  return {
    deadlineId,
    caseId: caseId && UUID.test(caseId) ? caseId : null,
    seq: count(row.seq),
    title,
    cnj: text(row.cnj) ?? "",
    dueOn,
  };
}

/** The database's answer, checked. Null when it is not what was expected: the center then says it could not read. */
export function readFirmPending(raw: unknown): FirmPending | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const answer = raw as Record<string, unknown>;
  const oneWaitsTotal = count(answer.one_waits_total);
  const oneWaitsStale = count(answer.one_waits_stale);
  const deadlinesToday = count(answer.deadlines_today);
  const hearingsToday = count(answer.hearings_today);
  const documentsStale = count(answer.documents_stale);
  const documentsStaleHours = count(answer.documents_stale_hours);
  const oneWaitsStaleDays = count(answer.one_waits_stale_days);
  if (
    oneWaitsTotal === null ||
    oneWaitsStale === null ||
    deadlinesToday === null ||
    hearingsToday === null ||
    documentsStale === null ||
    documentsStaleHours === null ||
    oneWaitsStaleDays === null ||
    !Array.isArray(answer.one_waits) ||
    !Array.isArray(answer.deadlines_overdue)
  ) {
    return null;
  }
  return {
    oneWaits: answer.one_waits.map(oneWaitOf).filter((row): row is OneWait => row !== null),
    oneWaitsTotal,
    oneWaitsStale,
    // Read where the database says them (0046); a database without them owes no link to anybody.
    linksOwed: Array.isArray(answer.links_owed)
      ? answer.links_owed.map(linkOwedOf).filter((row): row is LinkOwed => row !== null)
      : [],
    linksOwedTotal: count(answer.links_owed_total) ?? 0,
    // Read where the database says them (0048); a database without them has no conversation waiting.
    conversationsCalled: Array.isArray(answer.conversations_called)
      ? answer.conversations_called.map(conversationCalledOf).filter((row): row is ConversationCalled => row !== null)
      : [],
    conversationsCalledTotal: count(answer.conversations_called_total) ?? 0,
    deadlinesOverdue: answer.deadlines_overdue.map(overdueOf).filter((row): row is OverdueDeadline => row !== null),
    deadlinesToday,
    hearingsToday,
    documentsStale,
    documentsStaleHours,
    oneWaitsStaleDays,
    // Read where the database says them (0053); a database without them has no signature waiting for a person.
    signaturesToConfirm: Array.isArray(answer.signatures_to_confirm)
      ? answer.signatures_to_confirm.map(signatureOf).filter((row): row is SignatureToConfirm => row !== null)
      : [],
    signaturesToConfirmTotal: count(answer.signatures_to_confirm_total) ?? 0,
    packageSignaturesFailed: count(answer.package_signatures_failed) ?? 0,
  };
}

export type PendingGroupKey = "late" | "today" | "one" | "review";

/** Words of the `product` namespace, with their values; a value that is itself words is said first (`message`). */
export type PendingText = { key: string; values?: Record<string, string | number | { message: string }> };

/** The words of a `PendingText`, with whatever translates the `product` namespace. */
export function sayPending(
  t: (key: string, values?: Record<string, string | number>) => string,
  text: PendingText,
): string {
  const values = Object.fromEntries(
    Object.entries(text.values ?? {}).map(([name, value]) => [
      name,
      typeof value === "object" ? t(value.message) : value,
    ]),
  );
  return t(text.key, values);
}

/** One line of the center: what, of which case and why, and where it is done. */
export type PendingItem = {
  /** Stable while the thing waits: what the center compares to say something new arrived. */
  id: string;
  href: string;
  /** What kind of thing it is, in a word or two (a deadline, the claim, a signature): how a person tells it at a glance. */
  tag: PendingText;
  label: PendingText;
  detail?: PendingText;
  /** How many things the line stands for; one when it is one thing of one case. */
  count: number;
};

export type PendingGroup = { key: PendingGroupKey; items: PendingItem[]; total: number };

/** The group of each need of the home. A need left out (the ones split below) is placed by hand. */
const NEED_GROUP: Partial<Record<TodayNeed["key"], PendingGroupKey>> = {
  unresolved: "late",
  complaints: "late",
  failed: "late",
  calendar: "late",
  closing: "today",
  approvals: "one",
  publications: "one",
  // What ONE cannot read of the DJEN until a person acts: a reading that stopped, a communication left out. Never
  // late: nothing of it passed a time, and a reading that is late is ONE's own (2026-11-05).
  reading: "one",
  skipped: "one",
  confirm: "one",
  recheck: "one",
  untimed: "one",
  unwritten: "one",
  drafts: "one",
  filings: "one",
  civil: "one",
  contested: "one",
  unwarned: "one",
  cancelled: "one",
  checks: "review",
  clients: "review",
  moved: "review",
  waiting: "review",
  queue: "review",
};

/** What kind of thing each need of the home is, in a word or two. */
const NEED_TAG: Record<TodayNeed["key"], string> = {
  overdue: "pending-tag-deadline",
  due: "pending-tag-deadline",
  confirm: "pending-tag-deadline",
  recheck: "pending-tag-deadline",
  untimed: "pending-tag-deadline",
  hearings: "pending-tag-hearing",
  unresolved: "pending-tag-hearing",
  unwritten: "pending-tag-hearing",
  unwarned: "pending-tag-hearing",
  calendar: "pending-tag-calendar",
  closing: "pending-tag-conversation",
  waiting: "pending-tag-conversation",
  failed: "pending-tag-message",
  approvals: "pending-tag-approval",
  queue: "pending-tag-approval",
  checks: "pending-tag-publication",
  cancelled: "pending-tag-publication",
  publications: "pending-tag-publication",
  reading: "pending-tag-publication",
  skipped: "pending-tag-publication",
  clients: "pending-tag-client",
  civil: "pending-tag-civil",
  documents: "pending-tag-documents",
  moved: "pending-tag-movement",
  drafts: "pending-tag-piece",
  filings: "pending-tag-filing",
  contested: "pending-tag-account",
  complaints: "pending-tag-complaint",
};

/** A day of the calendar as people read it: 12/10/2026. */
const dayLabel = (day: string): string => day.split("-").reverse().join("/");

/** Whole days between a moment and now; 0 the same day. */
export function daysSince(since: string | null, now: Date): number {
  if (!since) return 0;
  const then = Date.parse(since);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

/** The words of why a link did not go, and what to do. */
export const LINK_REASON_KEY: Record<LinkReason, string> = {
  by_person: "pending-link-by-person",
  no_phone: "pending-link-no-phone",
  no_number: "pending-link-no-number",
  no_conversation: "pending-link-no-conversation",
  opted_out: "pending-link-opted-out",
  window_closed: "pending-link-window-closed",
  late: "pending-link-late",
};

const needItem = (need: TodayNeed): PendingItem => ({
  id: `need:${need.key}`,
  href: need.href,
  tag: { key: NEED_TAG[need.key] },
  label: { key: `today-need-${need.key}` },
  detail: { key: `today-need-${need.key}-hint` },
  count: need.count,
});

/**
 * The needs of the home with the decisions that wait read one by one (the owner, 2026-11-05): the person's own are
 * lines of their own, each leading to where it is decided, so their count leaves the needs; the ones of another
 * function stay one need, counted as the list of all of them shows them (never the text of a piece, approved on its
 * case only). Unread, the needs stay as the home counted them.
 */
export function withDecisions(needs: readonly TodayNeed[], decisions: WaitingDecisions | null): TodayNeed[] {
  if (!decisions) return [...needs];
  return needs
    .filter((need) => need.key !== "approvals")
    .map((need) => (need.key === "queue" ? { ...need, count: decisions.others } : need))
    .filter((need) => need.count > 0);
}

/** The groups of the center, most urgent first, each with what it holds; a group with nothing is left out. */
export function pendingGroups(
  today: FirmToday,
  pending: FirmPending,
  viewer: TodayViewer,
  now: Date = new Date(),
  decisions: WaitingDecisions | null = null,
  /** What ONE's filing waits on a person for (0102); null when it could not be read. */
  filing: { attention: FilingAttention; viewer: FilingViewer } | null = null,
  /** The awareness of ONE's triage of the publications owed (0104); null when it could not be read. */
  acks: { acks: PublicationAcks; viewer: AckViewer } | null = null,
): PendingGroup[] {
  const groups: Record<PendingGroupKey, PendingItem[]> = { late: [], today: [], one: [], review: [] };
  const needs = withDecisions(todayNeeds(today, viewer), decisions);
  // Each decision of the person's, where it is decided: its case or its conversation.
  if (decisions) groups.one.push(...decisionItems(decisions));

  // Deadlines past their day, each with its case: the one thing nothing else may come before.
  if (viewer.worksDeadlines && today.deadlinesOverdue > 0) {
    for (const deadline of pending.deadlinesOverdue) {
      groups.late.push({
        id: `deadline:${deadline.deadlineId}`,
        href: deadline.caseId ? `/casos/${deadline.caseId}` : "/prazos?ver=vencidos",
        tag: { key: "pending-tag-deadline" },
        label: { key: "pending-deadline", values: { title: deadline.title } },
        detail:
          deadline.seq !== null
            ? { key: "pending-deadline-detail", values: { seq: deadline.seq, day: dayLabel(deadline.dueOn) } }
            : {
                key: "pending-deadline-detail-lawsuit",
                values: { cnj: formatCnj(deadline.cnj) ?? deadline.cnj, day: dayLabel(deadline.dueOn) },
              },
        count: 1,
      });
    }
    const unlisted = today.deadlinesOverdue - pending.deadlinesOverdue.length;
    if (unlisted > 0) {
      groups.late.push({
        id: "need:overdue",
        href: "/prazos?ver=vencidos",
        tag: { key: "pending-tag-deadline" },
        label: { key: "pending-deadlines-more", values: { count: unlisted } },
        count: unlisted,
      });
    }
  }

  // Papers nobody decided for longer than the setting's hours are late; the rest are to look at.
  if (pending.documentsStale > 0) {
    groups.late.push({
      id: "documents:stale",
      href: "/casos?ver=documentos",
      tag: { key: "pending-tag-documents" },
      label: {
        key: "pending-documents-stale",
        values: { count: pending.documentsStale, hours: pending.documentsStaleHours },
      },
      count: pending.documentsStale,
    });
  }
  const freshDocuments = Math.max(today.documentsToReview - pending.documentsStale, 0);
  if (freshDocuments > 0) {
    groups.review.push({
      id: "need:documents",
      href: "/casos?ver=documentos",
      tag: { key: "pending-tag-documents" },
      label: { key: "today-need-documents" },
      detail: { key: "today-need-documents-hint" },
      count: freshDocuments,
    });
  }

  // Each case ONE carries and cannot carry on without a person, with what it waits for.
  for (const wait of pending.oneWaits) {
    const days = daysSince(wait.since, now);
    const stale = days >= pending.oneWaitsStaleDays;
    // Who the wait is with, by the one table the case screen reads too (`WAIT_PLACE`): never the client's on the
    // case and the firm's here.
    const place = waitPlaceOf(wait.waiting);
    // ONE's own work under way (the client's account being ordered, a try again) is nobody's to do, until it took
    // too long.
    if (place.owner === "one" && !stale) continue;
    // What waits on the client (their data, their signature, their word) is the firm's to follow up only once it
    // waited too long; what only the platform puts right is the firm's to look at, never to do.
    const group = place.owner === "platform" ? "review" : stale ? "late" : place.owner === "firm" ? "one" : "review";
    groups[group].push({
      id: `case:${wait.caseId}:${wait.waiting}`,
      href: waitingHref(wait.waiting, wait.caseId),
      tag: { key: waitingTagKey(wait.waiting) },
      label: wait.client
        ? { key: "pending-case", values: { seq: wait.seq, client: wait.client } }
        : { key: "pending-case-unnamed", values: { seq: wait.seq } },
      detail: { key: "pending-case-waits", values: { days, reason: { message: waitingKey(wait.waiting) } } },
      count: 1,
    });
  }
  // Each client ONE could not send the link to, with why: without it the client sends nothing. One ONE should
  // have sent by now is late.
  for (const link of pending.linksOwed) {
    groups[link.reason === "late" ? "late" : "one"].push({
      id: `link:${link.caseId}:${link.personId}`,
      href: `/casos/${link.caseId}#case-link`,
      tag: { key: "pending-tag-link" },
      label: link.client ? { key: "pending-link", values: { client: link.client } } : { key: "pending-link-unnamed" },
      detail: {
        key: "pending-link-detail",
        values: { seq: link.seq, reason: { message: LINK_REASON_KEY[link.reason] } },
      },
      count: 1,
    });
  }
  // Each passenger ONE told a person answers: one who waited the setting's minutes is late.
  for (const called of pending.conversationsCalled) {
    groups[called.late ? "late" : "one"].push({
      id: `conversation:${called.conversationId}`,
      href: `/atendimento?c=${called.conversationId}`,
      tag: { key: "pending-tag-conversation" },
      label: called.contact
        ? { key: "pending-conversation", values: { contact: called.contact } }
        : { key: "pending-conversation-unnamed" },
      detail: { key: "pending-conversation-detail", values: { reason: called.reason } },
      count: 1,
    });
  }
  // Each signature a person of the firm confirms or looks at: a file a client sent back waiting longer than the
  // papers may is late.
  for (const signature of pending.signaturesToConfirm) {
    const stale =
      signature.since !== null && now.getTime() - Date.parse(signature.since) > pending.documentsStaleHours * 3_600_000;
    groups[stale ? "late" : "one"].push({
      id: `signature:${signature.envelopeId}`,
      href: `/casos/${signature.caseId}#case-signatures`,
      tag: { key: "pending-tag-signature" },
      label: signature.client
        ? { key: "pending-signature", values: { client: signature.client } }
        : { key: "pending-signature-unnamed" },
      detail: {
        key: signature.status === "received" ? "pending-signature-received" : "pending-signature-uncertain",
        values: { seq: signature.seq },
      },
      count: 1,
    });
  }
  const unlistedSignatures = pending.signaturesToConfirmTotal - pending.signaturesToConfirm.length;
  if (unlistedSignatures > 0) {
    groups.one.push({
      id: "signatures:more",
      href: "/casos",
      tag: { key: "pending-tag-signature" },
      label: { key: "pending-signatures-more", values: { count: unlistedSignatures } },
      count: unlistedSignatures,
    });
  }
  if (pending.packageSignaturesFailed > 0) {
    groups.one.push({
      id: "packages:signature-failed",
      href: "/protocolo",
      tag: { key: "pending-tag-filing" },
      label: { key: "pending-package-signatures-failed", values: { count: pending.packageSignaturesFailed } },
      count: pending.packageSignaturesFailed,
    });
  }
  const unlistedConversations = pending.conversationsCalledTotal - pending.conversationsCalled.length;
  if (unlistedConversations > 0) {
    groups.one.push({
      id: "conversations:more",
      href: "/atendimento?ver=chamou",
      tag: { key: "pending-tag-conversation" },
      label: { key: "pending-conversations-more", values: { count: unlistedConversations } },
      count: unlistedConversations,
    });
  }
  const unlistedLinks = pending.linksOwedTotal - pending.linksOwed.length;
  if (unlistedLinks > 0) {
    groups.one.push({
      id: "links:more",
      href: "/casos",
      tag: { key: "pending-tag-link" },
      label: { key: "pending-links-more", values: { count: unlistedLinks } },
      count: unlistedLinks,
    });
  }
  const unlistedCases = pending.oneWaitsTotal - pending.oneWaits.length;
  if (unlistedCases > 0) {
    groups.one.push({
      id: "cases:more",
      href: "/casos",
      tag: { key: "pending-tag-case" },
      label: { key: "pending-cases-more", values: { count: unlistedCases } },
      count: unlistedCases,
    });
  }

  // What falls today, apart from what falls in the next days.
  if (viewer.worksDeadlines) {
    if (pending.deadlinesToday > 0) {
      groups.today.push({
        id: "deadlines:today",
        href: "/prazos?ver=proximos",
        tag: { key: "pending-tag-deadline" },
        label: { key: "pending-deadlines-today", values: { count: pending.deadlinesToday } },
        count: pending.deadlinesToday,
      });
    }
    const laterDeadlines = Math.max(today.deadlinesSoon - pending.deadlinesToday, 0);
    if (laterDeadlines > 0) {
      groups.today.push({
        id: "deadlines:soon",
        href: "/prazos?ver=proximos",
        tag: { key: "pending-tag-deadline" },
        label: { key: "pending-deadlines-later", values: { count: laterDeadlines } },
        count: laterDeadlines,
      });
    }
    if (pending.hearingsToday > 0) {
      groups.today.push({
        id: "hearings:today",
        href: "/agenda",
        tag: { key: "pending-tag-hearing" },
        label: { key: "pending-hearings-today", values: { count: pending.hearingsToday } },
        count: pending.hearingsToday,
      });
    }
    const laterHearings = Math.max(today.hearingsSoon - pending.hearingsToday, 0);
    if (laterHearings > 0) {
      groups.today.push({
        id: "hearings:soon",
        href: "/agenda",
        tag: { key: "pending-tag-hearing" },
        label: { key: "pending-hearings-later", values: { count: laterHearings } },
        count: laterHearings,
      });
    }
  }

  // What ONE's filing waits on a person for: a lawyer's signature in the cloud before the package needs it, and a
  // filing that came back (0102).
  if (filing) {
    groups.one.push(...filingAttentionItems(filing.attention, filing.viewer, now));
  }
  // ONE triaged a publication and the lawyer it was addressed to has not said they are aware of it (0104): late past
  // the setting's hours.
  if (acks) {
    const items = publicationAckItems(acks.acks, acks.viewer);
    groups.late.push(...items.late);
    groups.one.push(...items.one);
  }

  // Every other need of the home, in the home's own order, in its group (the deadlines, hearings and papers
  // were placed above, split by how soon).
  for (const entry of needs) {
    const group = NEED_GROUP[entry.key];
    if (group) groups[group].push(needItem(entry));
  }
  const order: PendingGroupKey[] = ["late", "today", "one", "review"];
  return order
    .map((key) => ({
      key,
      items: groups[key],
      total: groups[key].reduce((sum, item) => sum + item.count, 0),
    }))
    .filter((group) => group.items.length > 0);
}

/** What the badge counts: everything but what is only to look at. */
export function pendingBadge(groups: readonly PendingGroup[]): number {
  return groups.filter((group) => group.key !== "review").reduce((sum, group) => sum + group.total, 0);
}

/** Something passed its time. */
export const pendingLate = (groups: readonly PendingGroup[]): boolean =>
  groups.some((group) => group.key === "late" && group.total > 0);

/** A case waits for the firm to act (ONE can only go on once somebody does). */
export const pendingWaitsOnFirm = (groups: readonly PendingGroup[]): boolean =>
  groups.some((group) => group.key === "one" && group.total > 0);

/** What holds a case until somebody of the firm acts, for the home: what passed its time, then what waits on the firm. */
export const attentionGroups = (groups: readonly PendingGroup[]): PendingGroup[] =>
  groups.filter((group) => group.key === "late" || group.key === "one");

/** The group of each need the center places by hand, beside `NEED_GROUP`. */
const PLACED_BY_HAND: Partial<Record<TodayNeed["key"], PendingGroupKey>> = {
  overdue: "late",
  due: "today",
  hearings: "today",
  documents: "review",
};

/**
 * The home's tiles beside its list of what holds a case (`attentionGroups`): each need of the home once (the owner,
 * 2026-11-04, who found the home saying most things twice). What passed its time and what waits on the firm are lines
 * of that list; the tiles keep what falls today and in the next days and what is good to look at. The papers to
 * check are one list of cases, so their tile goes while the list names the ones waiting too long.
 */
export function homeTiles(needs: readonly TodayNeed[], attention: readonly PendingGroup[]): TodayNeed[] {
  const listed = new Set(attention.flatMap((group) => group.items.map((item) => item.id)));
  return needs.filter((need) => {
    if (need.key === "documents") return !listed.has("documents:stale");
    const place = PLACED_BY_HAND[need.key] ?? NEED_GROUP[need.key];
    return place !== "late" && place !== "one";
  });
}

/** The ids that would make somebody stop: a new one of these is told at once, wherever the person is. */
export const urgentIds = (groups: readonly PendingGroup[]): string[] =>
  groups
    .filter((group) => group.key === "late" || group.key === "one")
    .flatMap((group) => group.items.map((item) => item.id));
