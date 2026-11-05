"use client";

import type { CaseState } from "../case-types";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { Box, Button, Card, CardContent, Collapse, Typography } from "@mui/material";

import ProgressSteps, { ProgressBar, ProgressNow, type ProgressStep } from "@/components/product/progress-steps";
import StateLine from "@/components/product/state-line";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import type { LiveRead } from "@/components/product/use-live-read";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiFlag from "@/icons/nexture/ni-flag";
import NiFolder from "@/icons/nexture/ni-folder";
import NiLoader from "@/icons/nexture/ni-loader";
import NiMessageDots from "@/icons/nexture/ni-message-dots";
import NiMoney from "@/icons/nexture/ni-money";
import NiPen from "@/icons/nexture/ni-pen";
import NiScale from "@/icons/nexture/ni-scale";
import NiSendRight from "@/icons/nexture/ni-send-right";
import { eventKeyOf, PERSON_FIELD_KEY } from "@/lib/cases/cases";
import {
  type CaseJourney,
  JOURNEY_ENDED_KEY,
  JOURNEY_NOW_KEY,
  JOURNEY_STEP_KEY,
  type JourneyStepId,
} from "@/lib/cases/journey";
import {
  ACTOR_KEY,
  type CaseNow,
  HOLDER_KEY,
  mayAct,
  type NowItem,
  OWNER_KEY,
  recentByOne,
  SECTION_ANCHOR,
  sectionOfEvent,
} from "@/lib/cases/now";
import type { CaseSection } from "@/lib/cases/sections";
import { sayPending } from "@/lib/firm/pending";
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

/** The card each step of the way is done in, on this screen. */
const STEP_SECTION: Partial<Record<JourneyStepId, CaseSection>> = {
  intake: "people",
  documents: "documents",
  signature: "signatures",
  drafting: "drafts",
  filing: "filing",
  hearing: "hearings",
};

/** The tint of whose turn a line is: the firm's to act, the client's and ONE's under way, the platform's only said. */
const OWNER_TONE: Record<NowItem["owner"], StatusTone> = {
  firm: "attention",
  client: "info",
  one: "info",
  platform: "neutral",
};

/** How many lines of what holds the case are each owner's, in the order the list says them. */
const OWNER_COUNT_KEY: Record<NowItem["owner"], string> = {
  firm: "case-now-count-firm",
  client: "case-now-count-client",
  one: "case-now-count-one",
  platform: "case-now-count-platform",
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

/** A moment as a clock says it, in Brasília: 14:32. */
const clock = (at: number | string) =>
  new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(
    new Date(at),
  );

/** Opens a card of the screen and brings it into view, also when its address is already the page's. */
export function goToSection(section: CaseSection) {
  const id = SECTION_ANCHOR[section];
  if (window.location.hash === `#${id}`) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else window.location.hash = id;
}

/**
 * Where the case stands, at its top (the owner, 2026-11-03; its audit, 2026-11-05): the steps of its way, who the
 * case is with now, and under it what ONE is doing at this moment (each with since when and the card it is in),
 * what holds the case and whose turn each thing is (the firm's with who of it acts and the way to it for who may,
 * the client's, the platform's), and what ONE did a moment ago. It is the one place that says it: the cards below
 * hold the work. The screen follows the database by itself (`live`), and says when it last knew it was current.
 */
export default function JourneyCard({
  state,
  journey,
  now,
  live,
  onJudgment,
}: {
  state: Ready;
  journey: CaseJourney;
  now: CaseNow;
  live: LiveRead;
  /** The person says whether a decision the court published is the judgment. */
  onJudgment: (publicationId: string, judgment: boolean) => Promise<void>;
}) {
  const t = useTranslations("product");
  const [stepsOpen, setStepsOpen] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);
  const thisYear = state.today.slice(0, 4);
  const working = now.working.length > 0;
  const viewer = {
    lawyer: state.lawyer,
    partner: state.partner,
    decidesForFirm:
      state.partner || (state.managesFirm && !state.team.some((member) => member.firmFunction === "socio")),
    decidesCourtSystem: state.decidesCourtSystem,
    confirmsDeadlines: state.confirmsDeadlines,
    worksDeadlines: state.worksDeadlines,
  };

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
  const current = steps.findIndex((step) => step.key === journey.current);

  // The next hearing set, in the zone it is said in.
  const nowAt = Date.parse(state.hearings.now);
  const nextHearing =
    state.hearings.upcoming
      .filter((hearing) => hearing.status === "scheduled" && Date.parse(hearing.startsAt) > nowAt)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null;
  const hearingAt = nextHearing ? momentIn(nextHearing.startsAt, nextHearing.timeZone) : null;

  // What happens at the step, in a sentence: a piece is approved by ONE or by a lawyer as the firm has it.
  const nowKey = journey.ended
    ? JOURNEY_ENDED_KEY[journey.ended]
    : journey.current === "drafting" && state.autonomy.piece_text !== "approval"
      ? "journey-now-drafting-one"
      : JOURNEY_NOW_KEY[journey.current];
  const extra = hearingAt
    ? t("journey-next-hearing", { day: hearingAt.day, time: hearingAt.time })
    : journey.current === "hearing" &&
        !journey.ended &&
        // A publication that waits for triage may be the hearing the court marked: its own line says so.
        !now.blocking.some((line) => line.id.startsWith("hearing:") || line.id === "publications:untriaged")
      ? t("journey-hearing-unset")
      : null;

  const say = (line: NowItem) => {
    if (line.fields) {
      const fields = line.fields.map((field) => t(PERSON_FIELD_KEY[field as keyof typeof PERSON_FIELD_KEY])).join(", ");
      return t(line.text.key, { ...(line.text.values as Record<string, string>), fields });
    }
    return sayPending(t, line.text);
  };
  const whose = (line: NowItem) =>
    line.owner === "firm" && line.actor ? t(ACTOR_KEY[line.actor]) : t(OWNER_KEY[line.owner]);

  const way = (line: NowItem, label: string) => {
    if (state.supportVisit) return null;
    if (line.owner === "firm" && !mayAct(line.actor, viewer)) return null;
    if (line.href) {
      return (
        <Button variant="outlined" color="grey" size="small" href={line.href} LinkComponent={Link}>
          {label}
        </Button>
      );
    }
    if (line.section) {
      const section = line.section;
      return (
        <Button variant="outlined" color="grey" size="small" onClick={() => goToSection(section)}>
          {label}
        </Button>
      );
    }
    return null;
  };

  const ask = (line: NowItem) => {
    if (!line.ask || state.supportVisit || !mayAct(line.actor, viewer)) return null;
    const publicationId = line.ask.publicationId;
    const answer = async (judgment: boolean) => {
      setAnswering(publicationId);
      try {
        await onJudgment(publicationId, judgment);
      } finally {
        setAnswering(null);
      }
    };
    return (
      <Box className="flex flex-wrap gap-2">
        <Button
          variant="outlined"
          color="grey"
          size="small"
          disabled={answering === publicationId}
          onClick={() => void answer(true)}
        >
          {t("case-now-judgment-yes")}
        </Button>
        <Button
          variant="outlined"
          color="grey"
          size="small"
          disabled={answering === publicationId}
          onClick={() => void answer(false)}
        >
          {t("case-now-judgment-no")}
        </Button>
      </Box>
    );
  };

  const ago = (at: string) => {
    const minutes = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60_000));
    if (minutes < 1) return t("case-now-ago-now");
    if (minutes < 60) return t("case-now-ago-minutes", { count: minutes });
    return t("case-now-ago-hours", { count: Math.round(minutes / 60) });
  };
  const recent = recentByOne(state.events, state.readAt);

  return (
    <Card component="section" aria-labelledby="case-journey-title">
      <CardContent className="flex flex-col gap-5">
        <Box className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <Typography id="case-journey-title" variant="h5" component="h2" className="mb-0">
            {t("journey-title")}
          </Typography>
          {live.live ? (
            <Box className="flex flex-wrap items-center gap-2" role="status">
              <Typography variant="body2" className="text-text-secondary">
                {live.failed
                  ? t("case-now-live-failed")
                  : live.checkedAt
                    ? t("case-now-live", { time: clock(live.checkedAt) })
                    : null}
              </Typography>
              {live.failed ? (
                <Button variant="text" color="grey" size="small" onClick={live.checkNow}>
                  {t("case-now-live-retry")}
                </Button>
              ) : null}
            </Box>
          ) : null}
        </Box>

        {/* From a tablet on, the steps across; on a phone, who has the case first and the steps one tap away. */}
        <Box className="hidden md:block">
          <ProgressSteps
            steps={steps}
            label={t("journey-title")}
            working={working}
            stateWords={{
              done: t("journey-state-done"),
              current: t("journey-state-current"),
              next: t("journey-state-next"),
              stopped: t("journey-state-stopped"),
            }}
            href={(step) => {
              const section = STEP_SECTION[step.key as JourneyStepId];
              return section ? `#${SECTION_ANCHOR[section]}` : null;
            }}
          />
        </Box>

        <ProgressNow
          tone={journey.ended === "closed" ? "done" : journey.ended === "declined" ? "stopped" : "progress"}
          working={working}
          lead={t(HOLDER_KEY[now.holder])}
          text={t(nowKey)}
          extra={
            extra ? (
              <Typography variant="body2" className="text-text-secondary">
                {extra}
              </Typography>
            ) : undefined
          }
        />

        <Box className="flex flex-col gap-2 md:hidden">
          <Box className="flex flex-wrap items-center justify-between gap-2">
            <Typography variant="body2" className="font-semibold">
              {t("case-now-steps-compact", {
                position: current + 1,
                total: steps.length,
                step: steps[current]?.label ?? "",
              })}
            </Typography>
            <Button variant="text" color="grey" size="small" onClick={() => setStepsOpen((open) => !open)}>
              {stepsOpen ? t("case-now-steps-hide") : t("case-now-steps-show")}
            </Button>
          </Box>
          <ProgressBar
            steps={steps.length}
            reached={journey.reached}
            state={journey.ended === "declined" ? "stopped" : journey.ended ? "done" : "progress"}
            label={t("journey-bar-label", {
              label: steps[current]?.label ?? "",
              position: current + 1,
              total: steps.length,
            })}
          />
          <Collapse in={stepsOpen}>
            <Box className="pt-2">
              <ProgressSteps
                steps={steps}
                label={t("journey-title")}
                working={working}
                stateWords={{
                  done: t("journey-state-done"),
                  current: t("journey-state-current"),
                  next: t("journey-state-next"),
                  stopped: t("journey-state-stopped"),
                }}
              />
            </Box>
          </Collapse>
        </Box>

        {now.working.length > 0 ? (
          <Box component="section" aria-labelledby="case-now-working" className="flex flex-col gap-2">
            <Box className="flex flex-wrap items-center gap-2">
              <Typography id="case-now-working" variant="subtitle2" component="h3" className="mb-0">
                {t("case-now-title-working")}
              </Typography>
              <StatusChip
                tone="info"
                label={t("case-now-count-working", { count: now.working.length })}
                icon={<NiLoader size="small" className="animate-spin motion-reduce:animate-none" />}
              />
            </Box>
            <Box className="border-accent-4/30 bg-accent-4-light/5 flex flex-col gap-3 rounded-2xl border p-3">
              {now.working.map((line) => (
                <StateLine
                  key={line.id}
                  tone="waiting"
                  status={
                    line.slow
                      ? t("case-now-slow")
                      : line.since
                        ? t("case-now-since", { time: clock(line.since) })
                        : undefined
                  }
                  action={line.section ? way({ ...line, owner: "one" }, t("case-now-see")) : undefined}
                >
                  {say(line)}
                </StateLine>
              ))}
            </Box>
          </Box>
        ) : null}

        {!journey.ended ? (
          <Box component="section" aria-labelledby="case-now-blocking" className="flex flex-col gap-2">
            <Box className="flex flex-wrap items-center gap-2">
              <Typography id="case-now-blocking" variant="subtitle2" component="h3" className="mb-0">
                {t("case-now-title-blocking")}
              </Typography>
              {(["firm", "client", "one", "platform"] as const).map((owner) => {
                const count = now.blocking.filter((line) => line.owner === owner).length;
                return count > 0 ? (
                  <StatusChip key={owner} tone={OWNER_TONE[owner]} label={t(OWNER_COUNT_KEY[owner], { count })} />
                ) : null;
              })}
            </Box>
            {now.blocking.length === 0 ? (
              <StateLine tone="done" emphasis>
                {t(working ? "case-now-nothing-working" : "case-now-nothing")}
              </StateLine>
            ) : (
              <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-3">
                {now.blocking.map((line) => (
                  <StateLine
                    key={line.id}
                    tone={line.tone}
                    status={<StatusChip tone={OWNER_TONE[line.owner]} label={whose(line)} />}
                    action={
                      line.ask ? ask(line) : way(line, line.owner === "firm" ? t("case-now-do") : t("case-now-see"))
                    }
                  >
                    {say(line)}
                  </StateLine>
                ))}
              </Box>
            )}
          </Box>
        ) : null}

        {recent.length > 0 ? (
          <Box component="section" aria-labelledby="case-now-recent" className="flex flex-col gap-2">
            <Typography id="case-now-recent" variant="subtitle2" component="h3" className="mb-0">
              {t("case-now-title-recent")}
            </Typography>
            {recent.map((event) => {
              const section = sectionOfEvent(event.kind);
              return (
                <StateLine
                  key={event.id}
                  tone="done"
                  status={ago(event.at)}
                  action={
                    section ? (
                      <Button variant="text" color="grey" size="small" onClick={() => goToSection(section)}>
                        {t("case-now-see")}
                      </Button>
                    ) : undefined
                  }
                >
                  {eventKeyOf(event) ? t(eventKeyOf(event) as string) : t("case-now-event-other")}
                </StateLine>
              );
            })}
          </Box>
        ) : null}
      </CardContent>
    </Card>
  );
}
