"use client";

import type { CaseState } from "../case-types";
import { sentence, useCaseAction } from "./case-action";
import PublicationActionBox from "./publication-action-box";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Button, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import ItemRows, { type ItemRow } from "@/components/product/item-rows";
import PublicationCard, { CATEGORY_LOOK } from "@/components/publications/publication-card";
import IllustrationEmail from "@/icons/illustrations/illustration-email";
import NiDocumentCross from "@/icons/nexture/ni-document-cross";
import NiInbox from "@/icons/nexture/ni-inbox";
import { SECTION_ANCHOR } from "@/lib/cases/now";
import { opensOnArrival } from "@/lib/cases/sections";
import { acknowledgePublication } from "@/lib/publications/actions";
import type { PublicationRow } from "@/lib/publications/facts";
import type { Said } from "@/lib/publications/list-state";
import { CATEGORY_KEY, publicationErrorKey } from "@/lib/publications/publications";
import { orderPublications, type PublicationLine, publicationLine, shortDay } from "@/lib/publications/rows";

type Ready = Extract<CaseState, { kind: "ready" }>;

/** The words of the button that opens a line whose one thing is inside it. */
const OPENER_KEY: Record<string, string> = {
  "case-rows-pub-untriaged": "case-rows-pub-open-triage",
  "case-rows-pub-untriaged-left": "case-rows-pub-open-triage",
  "case-rows-pub-review": "case-rows-pub-open-review",
  "case-rows-pub-judgment": "case-rows-pub-open-judgment",
  "case-rows-pub-left-deadline": "case-rows-pub-open-deadline",
  "case-rows-pub-left-hearing": "case-rows-pub-open-hearing",
  "case-rows-pub-cancelled-unseen": "case-rows-pub-open-cancelled",
};

/**
 * The publications of the case's lawsuits (migration 0104), worked where the case is, one line each (the owner's
 * canvas "ONE · Publicações no caso", 2026-11-10): what asks for the person first (the awareness of what ONE triaged,
 * given in place; a triage, the word on the judgment, what ONE left to a person, opened in the line), then what ONE
 * is reading, then what is settled with what came of it, the newest first. A line opens on the very card of the
 * firm's list of publications, inside it, one at a time. Shown once a lawsuit is filed, or when the case has any
 * publication.
 *
 * Closest catalog entry: `ItemRows`, which draws the lines; the card of each publication is `PublicationCard`
 * `inline`.
 */
export default function PublicationsCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  // One action at a time on the case: the awareness given on a line waits like any other.
  const action = useCaseAction("publications");
  // What the person said of each since the case was read: kept by the card, so a publication stays where it is.
  const [said, setSaid] = useState<Record<string, Said>>({});
  const [seen, setSeen] = useState<Record<string, boolean>>({});
  const [acked, setAcked] = useState<Record<string, boolean>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const read = state.publicationRows;
  const rows = read?.rows ?? [];
  const filed = state.proceedings.some((proceeding) => proceeding.status === "filed");
  if (!filed && read && rows.length === 0) return null;

  const mayTriage = writable && state.worksDeadlines;
  const lined = rows.map((row) => ({
    row,
    line: publicationLine(row, {
      said: said[row.id] ?? null,
      seenCancel: seen[row.id] === true,
      acked: acked[row.id] === true,
    }),
  }));
  const { ask, working, done } = orderPublications(lined);
  const owed = lined.filter((item) => item.line.action === "ack").length;

  const ackWords = {
    doing: t("case-action-pub-ack-doing"),
    done: t("case-action-pub-ack-done"),
    failed: t("case-action-pub-ack-failed"),
  };
  const acknowledge = (row: PublicationRow) =>
    action.run(`ack-${row.id}`, ackWords, async () => {
      setProblem(null);
      const result = await acknowledgePublication(row.id, row.caseId);
      if (!result.ok) {
        setProblem(t(publicationErrorKey(result.code)));
        return false;
      }
      setAcked((current) => ({ ...current, [row.id]: true }));
      return true;
    });

  const asLine = ({ row, line }: { row: PublicationRow; line: PublicationLine }): ItemRow => {
    const category = said[row.id]?.category ?? row.category;
    const what = [row.kind, row.documentType].filter(Boolean).join(", ");
    const look = !row.active
      ? { icon: <NiDocumentCross size="small" />, tone: "primary" as const, tint: "bg-error-light/10 text-error" }
      : category
        ? { icon: CATEGORY_LOOK[category].icon, tone: CATEGORY_LOOK[category].tone, tint: undefined }
        : { icon: <NiInbox size="small" />, tone: "accent-3" as const, tint: undefined };
    const day = shortDay(row.availableOn);
    const opener = OPENER_KEY[line.key];
    return {
      key: row.id,
      icon: look.icon,
      tone: look.tone,
      tint: look.tint,
      title: [
        !row.active
          ? t("case-rows-pub-cancelled-title")
          : category
            ? t(CATEGORY_KEY[category])
            : t("case-rows-pub-untriaged-title"),
        what,
      ]
        .filter(Boolean)
        .join(" · "),
      detail: t("case-rows-pub-detail", { day }),
      state: { tone: line.tone, text: t(line.key, line.values) },
      action:
        line.action === "ack" && mayTriage ? (
          <Button
            variant="contained"
            size="small"
            disabled={action.busy}
            loading={action.pending(`ack-${row.id}`)}
            loadingPosition="start"
            onClick={() => void acknowledge(row)}
          >
            {action.pending(`ack-${row.id}`) ? sentence(ackWords.doing) : t("publication-ack")}
          </Button>
        ) : undefined,
      opener: line.action === "open" && mayTriage && opener ? t(opener) : undefined,
      openLabel: t("case-rows-pub-open-label", { day }),
      content: () => (
        <>
          <PublicationActionBox view={state.publicationActions.find((item) => item.publicationId === row.id) ?? null} />
          <PublicationCard
            inline
            row={row}
            progress={null}
            acts={state.deadlineActs}
            colleagues={state.colleagues}
            courtZones={state.courtZones}
            mayTriage={mayTriage}
            said={said[row.id] ?? null}
            seen={seen[row.id] === true}
            onSaid={(value) => {
              setSaid((current) => ({ ...current, [row.id]: value }));
              onChanged();
            }}
            onSeen={() => {
              setSeen((current) => ({ ...current, [row.id]: true }));
              onChanged();
            }}
            onAcknowledged={() => {
              setAcked((current) => ({ ...current, [row.id]: true }));
              onChanged();
            }}
          />
        </>
      ),
    };
  };

  return (
    <CollapsibleCard
      id="case-publications"
      title={t("case-publications-title")}
      summary={
        !read
          ? null
          : ask.length > 0
            ? t("case-publications-summary-ask", { count: ask.length, total: rows.length })
            : rows.length > 0
              ? t("case-publications-summary-all", { count: rows.length })
              : t("case-publications-empty-title")
      }
      description={t("case-publications-body")}
      defaultOpen={opensOnArrival(state.case.status, "publications", owed > 0 || ask.length > 0, rows.length === 0)}
      bodyClassName="gap-3"
    >
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {problem}
        </Alert>
      ) : null}
      {!read ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {t("case-publications-error")}
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          titleAs="h3"
          layout="row"
          framed={false}
          illustration={<IllustrationEmail />}
          title={t("case-publications-empty-title")}
          description={t("case-publications-empty-body")}
        />
      ) : (
        <ItemRows
          arrival={[SECTION_ANCHOR.publications]}
          sections={[
            { key: "ask", title: t("item-rows-ask"), ask: true, rows: ask.map(asLine) },
            { key: "working", title: t("item-rows-working"), rows: working.map(asLine) },
            { key: "done", title: t("case-rows-pub-done"), rows: done.map(asLine), shown: 5 },
          ]}
        />
      )}
      {read?.more ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("case-publications-more")}
        </Typography>
      ) : null}
    </CollapsibleCard>
  );
}
