"use client";

import type { CaseProceeding, CaseState } from "../case-types";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import DeadlineCard from "@/components/deadlines/deadline-card";
import DeadlineDialog from "@/components/deadlines/deadline-dialog";
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

  return (
    <Card component="section" aria-labelledby="case-deadlines">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-wrap items-center gap-3">
          <Typography id="case-deadlines" variant="h5" component="h2" className="mb-0 min-w-0 flex-1">
            {t("case-deadlines-title")}
          </Typography>
          <Button variant="text" color="grey" size="small" href="/prazos" LinkComponent={Link}>
            {t("case-deadlines-all")}
          </Button>
        </Box>

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
          <Typography variant="body2" className="text-text-secondary">
            {t("case-deadlines-none")}
          </Typography>
        ) : (
          <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
            {deadlines.open.map((row) => (
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
      </CardContent>

      {adding ? (
        <DeadlineDialog
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
    </Card>
  );
}
