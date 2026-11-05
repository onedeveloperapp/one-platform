import type { PendingItem, PendingText } from "@/lib/firm/pending";

/**
 * Each answer of the AI that waits for a person, as the home and the center of what waits name it (the owner,
 * 2026-11-05): one line per decision, leading to where it is decided, on its case or in its conversation, never to a
 * list of them. The text of a piece leads to its case's pieces, where it is approved as the text a lawyer just read;
 * the check of a document to the case's documents; the order of the facts (and a transcription) to the case's
 * account; ONE's answer to a passenger to its conversation. Pure: the answers, read, turned into lines.
 */

export type DecisionKind = "piece" | "document" | "chronology" | "transcription" | "conversation" | "other";

export type WaitingDecision = {
  approvalId: string;
  kind: DecisionKind;
  /** The person's function is one of those the task names: theirs to decide. */
  mine: boolean;
  caseId: string | null;
  caseSeq: number | null;
  /** Whoever answers for the case, or the name the firm has for the passenger of a conversation. */
  client: string;
  conversationId: string | null;
  since: string;
};

/** The decisions that wait, as read for the person who asks. */
export type WaitingDecisions = {
  /** The person's own, the oldest first, as many as were read. */
  mine: WaitingDecision[];
  /** How many are the person's in all: more than `mine` when there were more than a read takes. */
  mineTotal: number;
  /** How many wait for another function of the firm. */
  others: number;
};

/** Where a decision is decided. */
export function decisionHref(decision: WaitingDecision): string {
  if (decision.kind === "conversation" && decision.conversationId) return `/atendimento?c=${decision.conversationId}`;
  if (!decision.caseId) return "/aprovacoes";
  switch (decision.kind) {
    case "piece":
      return `/casos/${decision.caseId}#case-drafts`;
    case "document":
      return `/casos/${decision.caseId}#case-documents`;
    case "chronology":
    case "transcription":
      return `/casos/${decision.caseId}#case-statements`;
    default:
      return "/aprovacoes";
  }
}

const TAG_KEY: Record<DecisionKind, string> = {
  piece: "pending-tag-piece",
  document: "pending-tag-documents",
  chronology: "pending-tag-account",
  transcription: "pending-tag-account",
  conversation: "pending-tag-conversation",
  other: "pending-tag-approval",
};

const DETAIL_KEY: Record<DecisionKind, string> = {
  piece: "pending-decision-piece",
  document: "pending-decision-document",
  chronology: "pending-decision-chronology",
  transcription: "pending-decision-transcription",
  conversation: "pending-decision-conversation",
  other: "pending-decision-other",
};

/** One line of the center for each of the person's decisions, and one for the rest when there were more. */
export function decisionItems(decisions: WaitingDecisions): PendingItem[] {
  const labelOf = (decision: WaitingDecision): PendingText => {
    if (decision.kind === "conversation") {
      return decision.client
        ? { key: "pending-conversation", values: { contact: decision.client } }
        : { key: "pending-conversation-unnamed" };
    }
    if (decision.caseSeq === null) return { key: "pending-decision-unplaced" };
    return decision.client
      ? { key: "pending-case", values: { seq: decision.caseSeq, client: decision.client } }
      : { key: "pending-case-unnamed", values: { seq: decision.caseSeq } };
  };
  const items: PendingItem[] = decisions.mine.map((decision) => ({
    id: `decision:${decision.approvalId}`,
    href: decisionHref(decision),
    tag: { key: TAG_KEY[decision.kind] },
    label: labelOf(decision),
    detail: { key: DETAIL_KEY[decision.kind] },
    count: 1,
  }));
  const unlisted = decisions.mineTotal - decisions.mine.length;
  if (unlisted > 0) {
    items.push({
      id: "decisions:more",
      href: "/aprovacoes",
      tag: { key: "pending-tag-approval" },
      label: { key: "pending-decisions-more", values: { count: unlisted } },
      count: unlisted,
    });
  }
  return items;
}
