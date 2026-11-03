"use client";

import type { CaseState } from "../case-types";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Button, Card, CardContent, Typography } from "@mui/material";

import ProgressSteps, { ProgressNow, type ProgressStep } from "@/components/product/progress-steps";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiFlag from "@/icons/nexture/ni-flag";
import NiFolder from "@/icons/nexture/ni-folder";
import NiMessageDots from "@/icons/nexture/ni-message-dots";
import NiMoney from "@/icons/nexture/ni-money";
import NiPen from "@/icons/nexture/ni-pen";
import NiScale from "@/icons/nexture/ni-scale";
import NiSendRight from "@/icons/nexture/ni-send-right";
import { waitingFix, waitingKey } from "@/lib/cases/advance";
import {
  caseJourney,
  type CourtFacts,
  JOURNEY_ENDED_KEY,
  JOURNEY_HOLDER_KEY,
  JOURNEY_NOW_KEY,
  JOURNEY_STEP_KEY,
  journeyHolder,
  type JourneyStepId,
} from "@/lib/cases/journey";
import { momentIn } from "@/lib/hearings/hearings";

type Ready = Extract<CaseState, { kind: "ready" }>;

const STEP_ICON: Record<JourneyStepId, ReactNode> = {
  intake: <NiMessageDots size="small" />,
  documents: <NiFolder size="small" />,
  signature: <NiPen size="small" />,
  drafting: <NiDocumentFull size="small" />,
  filing: <NiSendRight size="small" />,
  hearing: <NiCalendar size="small" />,
  judgment: <NiScale size="small" />,
  payment: <NiMoney size="small" />,
  closed: <NiFlag size="small" />,
};

/** A day as the steps say it: "3 de nov.", with the year when it is not this one. A bare day is the day itself. */
const dayLabel = (value: string, thisYear: string) => {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  const year = new Intl.DateTimeFormat("pt-BR", { year: "numeric", timeZone: "America/Sao_Paulo" }).format(date);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
    ...(year === thisYear ? {} : { year: "numeric" }),
    timeZone: "America/Sao_Paulo",
  }).format(date);
};

/** What the case's lawsuits show in court: the latest hearing held, the next one set, and what was published. */
function courtFactsOf(state: Ready): CourtFacts {
  const now = Date.parse(state.hearings.now);
  const held = state.hearings.past
    .filter((hearing) => hearing.status === "held")
    .map((hearing) => hearing.startsAt)
    .sort()
    .at(-1);
  const next = state.hearings.upcoming
    .filter((hearing) => hearing.status === "scheduled" && Date.parse(hearing.startsAt) > now)
    .map((hearing) => hearing.startsAt)
    .sort()[0];
  return {
    heldAt: held ?? null,
    nextHearingAt: next ?? null,
    decidedAt: state.courtPublications.decidedAt,
    paidAt: state.courtPublications.paidAt,
  };
}

/**
 * Where the case stands along its way, at the top of the case (the owner, 2026-11-03): from the first conversation
 * to the end, each step done, under way or still to come with the day it began; in court, the hearing, the judgment
 * and the payment as its lawsuits show them. Under it, in a sentence, what happens now and who the case is with (the
 * client, the firm, ONE or the court), what ONE waits for to carry the case on by itself, with the way to put it
 * right to who may, and the next hearing. Somebody who opens a case reads first where it is, then what it lacks.
 */
export default function JourneyCard({ state, missing }: { state: Ready; missing: number }) {
  const t = useTranslations("product");
  const current = state.case;
  const court = courtFactsOf(state);
  const journey = caseJourney({
    status: current.status,
    createdAt: current.createdAt,
    moments: state.stageMoments,
    court,
  });
  const thisYear = state.today.slice(0, 4);

  const steps: ProgressStep[] = journey.steps.map((step) => ({
    key: step.id,
    label: t(JOURNEY_STEP_KEY[step.id]),
    state: step.state,
    when: step.scheduled
      ? t("journey-hearing-on", { day: dayLabel(step.scheduled, thisYear) })
      : step.at
        ? dayLabel(step.at, thisYear)
        : null,
    icon: STEP_ICON[step.id],
  }));

  const waiting = state.advance?.waiting ?? null;
  const pieceWaitsLawyer = state.pieces.drafts.some((draft) => draft.status === "proposed" && draft.work === null);
  const holder = journeyHolder({
    status: current.status,
    waiting,
    missing,
    pieceWaitsLawyer,
    paid: court.paidAt !== null,
  });
  const fix = waiting ? waitingFix(waiting) : null;
  // The way to put it right is offered to who may take it: a partner names who signs, a lawyer the model.
  const fixable = fix && (waiting === "no_signer" ? state.partner : state.lawyer) && !state.supportVisit;
  const nextHearing = court.nextHearingAt
    ? state.hearings.upcoming.find((hearing) => hearing.startsAt === court.nextHearingAt)
    : null;
  const hearingAt = nextHearing ? momentIn(nextHearing.startsAt, nextHearing.timeZone) : null;

  // What else is said under the sentence: what ONE waits for (what the case lacks is listed in its own card, so
  // only counted here), and in court the next hearing, or that none is set yet.
  const lines = [
    waiting && waiting !== "case_incomplete" && current.status !== "filed"
      ? [
          t("advance-note", { reason: t(waitingKey(waiting)) }),
          state.advance?.checkedLabel ? t("advance-checked", { when: state.advance.checkedLabel }) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null,
    missing > 0 && holder === "client" ? t("journey-missing", { count: missing }) : null,
    hearingAt
      ? t("journey-next-hearing", { day: hearingAt.day, time: hearingAt.time })
      : journey.current === "hearing" && !journey.ended
        ? t("journey-hearing-unset")
        : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <Card component="section" aria-labelledby="case-journey-title">
      <CardContent className="flex flex-col gap-5">
        <Typography id="case-journey-title" variant="h5" component="h2" className="mb-0">
          {t("journey-title")}
        </Typography>
        <ProgressSteps
          steps={steps}
          label={t("journey-title")}
          stateWords={{
            done: t("journey-state-done"),
            current: t("journey-state-current"),
            next: t("journey-state-next"),
            stopped: t("journey-state-stopped"),
          }}
        />
        <ProgressNow
          tone={journey.ended === "closed" ? "done" : journey.ended === "declined" ? "stopped" : "progress"}
          lead={t(JOURNEY_HOLDER_KEY[holder])}
          text={t(journey.ended ? JOURNEY_ENDED_KEY[journey.ended] : JOURNEY_NOW_KEY[journey.current])}
          extra={
            lines.length > 0 ? (
              <>
                {lines.map((line) => (
                  <Typography key={line} variant="body2" className="text-text-secondary">
                    {line}
                  </Typography>
                ))}
              </>
            ) : undefined
          }
          action={
            fixable && fix ? (
              <Button variant="outlined" color="grey" size="small" href={fix.href} LinkComponent={Link}>
                {t(fix.key)}
              </Button>
            ) : undefined
          }
        />
      </CardContent>
    </Card>
  );
}
