"use client";

import type { CaseProceeding, CaseState } from "../case-types";
import HearingForecast from "./hearing-forecast";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Typography } from "@mui/material";

import HearingCard from "@/components/hearings/hearing-card";
import HearingPanel from "@/components/hearings/hearing-panel";
import CollapsibleCard from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import IllustrationPlatforms from "@/icons/illustrations/illustration-platforms";
import { opensOnArrival } from "@/lib/cases/sections";
import { momentIn } from "@/lib/hearings/hearings";
import { formatCnj } from "@flyee/rules/cnj";

type Ready = Extract<CaseState, { kind: "ready" }>;

const KIND_KEY: Record<CaseProceeding["kind"], string> = {
  juizado: "case-proceeding-kind-juizado",
  comum: "case-proceeding-kind-comum",
};

/**
 * The hearings of the case's lawsuits. Somebody comes here to know when the
 * client is heard, how and who goes, and to say what came of a hearing that
 * passed; or to write one the court set. The ones with no word on them come
 * first, then the ones to come; the latest held or cancelled a click away.
 * Shown once a lawsuit is filed, or when the case already has a hearing.
 */
export default function HearingsCard({
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
  const [showPast, setShowPast] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { hearings } = state;
  const filed = state.proceedings.filter((proceeding) => proceeding.status === "filed" && proceeding.cnj);
  const mayWork = writable && state.worksDeadlines;

  if (filed.length === 0 && hearings.upcoming.length === 0 && hearings.past.length === 0) return null;

  const lawsuitLabel = (proceeding: CaseProceeding) =>
    [t(KIND_KEY[proceeding.kind]), proceeding.cnj ? (formatCnj(proceeding.cnj) ?? proceeding.cnj) : null]
      .filter(Boolean)
      .join(" · ");

  // The next hearing to come, in the zone it is said in; and the ones whose time passed with no word on what
  // came of them. A hearing in the coming week opens the card too.
  const nowAt = Date.parse(hearings.now);
  const silent = hearings.upcoming.filter(
    (row) =>
      row.status === "scheduled" && Date.parse(row.startsAt) + Math.max(hearings.durationMinutes, 1) * 60_000 <= nowAt,
  ).length;
  const coming =
    hearings.upcoming.find((row) => row.status === "scheduled" && Date.parse(row.startsAt) > nowAt) ?? null;
  const comingAt = coming ? momentIn(coming.startsAt, coming.timeZone) : null;
  const soon = coming !== null && Date.parse(coming.startsAt) - nowAt < 7 * 24 * 60 * 60 * 1000;
  const forecastVersion = (proceedingId: string) => {
    const lawsuit = state.proceedings.find((proceeding) => proceeding.id === proceedingId);
    return lawsuit ? `${lawsuit.status}|${lawsuit.unit ?? ""}|${lawsuit.cnj ?? ""}` : "";
  };

  return (
    <CollapsibleCard
      id="case-hearings"
      title={t("case-hearings-title")}
      summary={
        comingAt
          ? t("case-hearings-summary-next", { day: comingAt.day, time: comingAt.time })
          : t("case-hearings-summary-none")
      }
      ask={silent > 0 ? { tone: "firm", label: t("case-hearings-summary-silent", { count: silent }) } : null}
      more={{ label: t("case-hearings-all"), href: "/agenda" }}
      defaultOpen={opensOnArrival(state.case.status, "hearings", silent > 0 || soon)}
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

      {hearings.upcoming.length === 0 ? (
        <EmptyState
          titleAs="h3"
          layout="row"
          framed={false}
          illustration={<IllustrationPlatforms />}
          title={t("case-hearings-empty-title")}
          description={t("case-hearings-empty-body")}
        />
      ) : (
        <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
          {hearings.upcoming.map((row) => (
            <Box component="li" key={`${row.id}:${row.revision}:${row.status}`} className="flex flex-col gap-2">
              <HearingCard
                row={row}
                now={hearings.now}
                durationMinutes={hearings.durationMinutes}
                colleagues={state.colleagues}
                mayWork={mayWork}
                showCase={false}
                embedded
                onChanged={onChanged}
              />
              <HearingBriefBox brief={state.hearingBriefs.find((brief) => brief.hearingId === row.id) ?? null} />
              {/* What to expect of the airline there and what an offer is worth (0250), under the next hearing only. */}
              {coming?.id === row.id ? (
                <HearingForecast
                  proceedingId={row.proceedingId}
                  version={forecastVersion(row.proceedingId)}
                  airlines={state.airlines}
                />
              ) : null}
            </Box>
          ))}
        </Box>
      )}

      {hearings.past.length > 0 ? (
        <Box className="flex flex-col gap-3">
          <Box>
            <Button
              variant="text"
              color="grey"
              size="small"
              className="-ml-2"
              onClick={() => setShowPast((now) => !now)}
            >
              {showPast ? t("case-hearings-past-hide") : t("case-hearings-past-show", { count: hearings.past.length })}
            </Button>
          </Box>
          {showPast ? (
            <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
              {hearings.past.map((row) => (
                <Box component="li" key={`${row.id}:${row.revision}:${row.status}`}>
                  <HearingCard
                    row={row}
                    now={hearings.now}
                    durationMinutes={hearings.durationMinutes}
                    colleagues={state.colleagues}
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
                ? t("case-hearings-add")
                : t("case-hearings-add-lawsuit", { lawsuit: lawsuitLabel(proceeding) })}
            </Button>
          ))}
        </Box>
      ) : null}

      {adding ? (
        <HearingPanel
          subject={{
            proceedingId: adding.id,
            lawsuitLabel: lawsuitLabel(adding),
            zones: adding.court ? (state.courtZones[adding.court] ?? null) : null,
          }}
          colleagues={state.colleagues}
          onClose={() => setAdding(null)}
          onSaved={() => {
            setAdding(null);
            setNotice(t("hearing-scheduled-notice"));
            onChanged();
          }}
        />
      ) : null}
    </CollapsibleCard>
  );
}

/**
 * The brief ONE wrote for who goes to the hearing (0187), two business days before: shown on the case one click away,
 * said as ONE's and whether it went by e-mail.
 */
function HearingBriefBox({ brief }: { brief: { body: string; emailed: boolean } | null }) {
  const t = useTranslations("product");
  const [open, setOpen] = useState(false);
  if (!brief) return null;
  return (
    <Box className="flex flex-col gap-1">
      <Box>
        <Button variant="text" color="grey" size="small" className="-ml-2" onClick={() => setOpen((now) => !now)}>
          {open ? t("hearing-brief-hide") : t("hearing-brief-show")}
        </Button>
      </Box>
      {open ? (
        <Box className="border-grey-100 bg-grey-25 flex flex-col gap-1 rounded-xl border p-3">
          {brief.body.split("\n").map((line, index) => (
            <Typography key={index} variant="body2">
              {line}
            </Typography>
          ))}
          <Typography variant="caption" className="text-text-secondary">
            {t(brief.emailed ? "hearing-brief-emailed" : "hearing-brief-kept")}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
}
