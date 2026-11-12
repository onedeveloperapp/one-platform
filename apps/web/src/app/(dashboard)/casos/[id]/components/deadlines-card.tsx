"use client";

import type { CaseProceeding, CaseState } from "../case-types";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button } from "@mui/material";

import DeadlineCard from "@/components/deadlines/deadline-card";
import DeadlinePanel from "@/components/deadlines/deadline-panel";
import CollapsibleCard from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import IllustrationConfigure from "@/icons/illustrations/illustration-configure";
import { opensOnArrival } from "@/lib/cases/sections";
import { formatCnj } from "@flyee/rules/cnj";
import { formatDayBr } from "@flyee/rules/person";

type Ready = Extract<CaseState, { kind: "ready" }>;

const KIND_KEY: Record<CaseProceeding["kind"], string> = {
  juizado: "case-proceeding-kind-juizado",
  comum: "case-proceeding-kind-comum",
};

/**
 * The deadlines of the case's lawsuits. Somebody comes here to see what is
 * due in this case, and to record a deadline that came from somewhere other
 * than the DJEN (an intimation read in the court's system, one made in a
 * hearing): the rule counts it over the court's calendar and it waits, like
 * any other, for who runs the deadlines. Shown once the court has a lawsuit
 * of the case (filed, or closed since), or when the case already has a
 * deadline.
 */
export default function DeadlinesCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [adding, setAdding] = useState<CaseProceeding | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { deadlines } = state;
  const filed = state.proceedings.filter((proceeding) => proceeding.status !== "planned" && proceeding.cnj);
  const mayWork = writable && state.worksDeadlines;
  const mayConfirm = writable && state.confirmsDeadlines;

  if (filed.length === 0 && deadlines.open.length === 0 && deadlines.closedCount === 0) return null;

  const lawsuitLabel = (proceeding: CaseProceeding) =>
    [t(KIND_KEY[proceeding.kind]), proceeding.cnj ? (formatCnj(proceeding.cnj) ?? proceeding.cnj) : null]
      .filter(Boolean)
      .join(" · ");

  // What of the case's deadlines waits for a person, the most pressing first: past its day, to be confirmed,
  // to be looked at again. The open ones come the nearest first.
  const overdue = deadlines.open.filter((row) => row.overdue).length;
  const toConfirm = deadlines.open.filter((row) => row.status === "proposed").length;
  const toReview = deadlines.open.filter((row) => row.review).length;
  const nearest = deadlines.open.map((row) => row.urgentOn ?? row.dueOn).find(Boolean) ?? null;
  // What waits for a person first (the owner's canvas, 2026-11-10): a deadline to confirm or to look at again, then
  // the confirmed ones, each group in its own order (the nearest first).
  const waitsForPerson = (row: (typeof deadlines.open)[number]) => row.status === "proposed" || row.review;
  const asking = [
    ...deadlines.open.filter((row) => waitsForPerson(row)),
    ...deadlines.open.filter((row) => !waitsForPerson(row)),
  ];

  return (
    <CollapsibleCard
      id="case-deadlines"
      title={t("case-deadlines-title")}
      summary={
        deadlines.open.length === 0
          ? t("case-deadlines-summary-none")
          : [
              t("case-deadlines-summary", { count: deadlines.open.length }),
              nearest ? t("case-deadlines-summary-next", { day: formatDayBr(nearest) ?? nearest }) : null,
            ]
              .filter(Boolean)
              .join(" · ")
      }
      ask={
        overdue > 0
          ? { tone: "failed", label: t("case-deadlines-summary-overdue", { count: overdue }) }
          : toConfirm > 0
            ? { tone: "firm", label: t("case-deadlines-summary-confirm", { count: toConfirm }) }
            : toReview > 0
              ? { tone: "firm", label: t("case-deadlines-summary-review", { count: toReview }) }
              : null
      }
      action={
        <Button variant="outlined" color="grey" size="small" href="/prazos" LinkComponent={Link}>
          {t("case-deadlines-all")}
        </Button>
      }
      defaultOpen={opensOnArrival(state.case.status, "deadlines", overdue + toConfirm + toReview > 0)}
      bodyClassName="gap-3"
    >
      {notice ? (
        <Alert
          severity="success"
          role="status"
          className="neutral bg-background-paper/60!"
          onClose={() => setNotice(null)}
        >
          {notice}
        </Alert>
      ) : null}

      {deadlines.open.length === 0 ? (
        <EmptyState
          titleAs="h3"
          layout="row"
          framed={false}
          illustration={<IllustrationConfigure />}
          title={t("case-deadlines-empty-title")}
          description={t("case-deadlines-empty-body")}
        />
      ) : (
        <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
          {asking.map((row) => (
            <Box component="li" key={`${row.id}:${row.revision}:${row.status}`}>
              <DeadlineCard
                row={row}
                today={deadlines.today}
                soonDays={deadlines.soonDays}
                acts={state.deadlineActs}
                mayConfirm={mayConfirm}
                mayWork={mayWork}
                showCase={false}
                embedded
                onChanged={onChanged}
              />
            </Box>
          ))}
        </Box>
      )}

      {deadlines.closedCount > 0 ? (
        <Box className="flex flex-col gap-3">
          <Box>
            <Button
              variant="text"
              color="grey"
              size="small"
              className="-ml-2"
              onClick={() => setShowClosed((now) => !now)}
            >
              {showClosed
                ? t("case-deadlines-closed-hide")
                : t("case-deadlines-closed-show", { count: deadlines.closedCount })}
            </Button>
          </Box>
          {showClosed ? (
            <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
              {deadlines.closed.map((row) => (
                <Box component="li" key={`${row.id}:${row.revision}:${row.status}`}>
                  <DeadlineCard
                    row={row}
                    today={deadlines.today}
                    soonDays={deadlines.soonDays}
                    acts={state.deadlineActs}
                    mayConfirm={mayConfirm}
                    mayWork={mayWork}
                    showCase={false}
                    embedded
                    onChanged={onChanged}
                  />
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      ) : null}

      {mayWork && filed.length > 0 ? (
        <Box className="border-grey-100 flex flex-wrap items-center gap-2 border-t pt-3">
          {filed.map((proceeding) => (
            <Button
              key={proceeding.id}
              variant="outlined"
              color="grey"
              size="small"
              onClick={() => setAdding(proceeding)}
            >
              {filed.length === 1
                ? t("case-deadlines-add")
                : t("case-deadlines-add-lawsuit", { lawsuit: lawsuitLabel(proceeding) })}
            </Button>
          ))}
        </Box>
      ) : null}

      {adding ? (
        <DeadlinePanel
          subject={{ kind: "lawsuit", proceedingId: adding.id, proceedingKind: adding.kind }}
          acts={state.deadlineActs}
          onClose={() => setAdding(null)}
          onSaved={(saved) => {
            setAdding(null);
            setNotice(
              saved.dueOn
                ? t("deadline-proposed-notice", { day: formatDayBr(saved.dueOn) ?? saved.dueOn })
                : t("deadline-proposed-notice-counting"),
            );
            onChanged();
          }}
        />
      ) : null}
    </CollapsibleCard>
  );
}
