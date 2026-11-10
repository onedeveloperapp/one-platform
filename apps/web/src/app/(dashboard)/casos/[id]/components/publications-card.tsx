"use client";

import type { CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import PublicationCard from "@/components/publications/publication-card";
import IllustrationEmail from "@/icons/illustrations/illustration-email";
import { opensOnArrival } from "@/lib/cases/sections";
import type { Said } from "@/lib/publications/list-state";

type Ready = Extract<CaseState, { kind: "ready" }>;

/**
 * The publications of the case's lawsuits (migration 0104), worked where the case is: what the court published, what
 * ONE triaged it as (ONE may err) and did of it (the hearing recorded, the deadline counted, the client told), and the
 * awareness the lawyer it was addressed to owes, one click away; one ONE left to a person is triaged here too. The
 * very card of the firm's list of publications, the newest first. Shown once a lawsuit is filed, or when the case has
 * any publication.
 *
 * Closest catalog entry: the cards of the court (`HearingsCard`, `DeadlinesCard`), which list what the court set;
 * this lists what the court said, each in the publication's own card.
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
  // What the person said of each since the case was read: kept by the card, so a publication stays where it is.
  const [said, setSaid] = useState<Record<string, Said>>({});
  const [seen, setSeen] = useState<Record<string, boolean>>({});
  const read = state.publicationRows;
  const rows = read?.rows ?? [];
  const filed = state.proceedings.some((proceeding) => proceeding.status === "filed");
  if (!filed && read && rows.length === 0) return null;

  const mayTriage = writable && state.worksDeadlines;
  const owed = rows.filter((row) => row.ackOwed && !said[row.id]).length;
  const untriaged = rows.filter((row) => row.category === null && !said[row.id]).length;

  return (
    <CollapsibleCard
      id="case-publications"
      title={t("case-publications-title")}
      summary={
        !read
          ? null
          : owed > 0
            ? t("case-publications-summary-ack", { count: owed })
            : untriaged > 0
              ? t("case-publications-summary-untriaged", { count: untriaged })
              : rows.length > 0
                ? t("case-publications-summary-all", { count: rows.length })
                : t("case-publications-empty-title")
      }
      description={t("case-publications-body")}
      defaultOpen={opensOnArrival(state.case.status, "publications", owed > 0 || untriaged > 0, rows.length === 0)}
      bodyClassName="gap-3"
    >
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
        rows.map((row) => (
          <PublicationCard
            key={row.id}
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
            onAcknowledged={onChanged}
          />
        ))
      )}
      {read?.more ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("case-publications-more")}
        </Typography>
      ) : null}
    </CollapsibleCard>
  );
}
