"use client";

import { GROUP_TONE } from "../../cases-types";
import { caseFacts } from "../case-facts";
import type { CaseState } from "../case-types";
import { CaseActionProvider, useCaseActions } from "./case-action";
import CaseAtWork from "./case-at-work";
import ClientLinkCard from "./client-link-card";
import ComplaintCard from "./complaint-card";
import DeadlinesCard from "./deadlines-card";
import DocumentsCard from "./documents-card";
import DossierCard from "./dossier-card";
import DraftsCard from "./drafts-card";
import FeesCard from "./fees-card";
import FilingCard from "./filing-card";
import HearingsCard from "./hearings-card";
import JourneyCard from "./journey-card";
import MoneyCard from "./money-card";
import NoticesCard from "./notices-card";
import OutcomeCard from "./outcome-card";
import PeopleCard from "./people-card";
import ProceedingsCard from "./proceedings-card";
import PublicationsCard from "./publications-card";
import RulesCard from "./rules-card";
import SignaturesCard from "./signatures-card";
import StageDialog from "./stage-dialog";
import StatementsCard from "./statements-card";
import SummaryCard from "./summary-card";
import TimelineCard from "./timeline-card";
import TripCard from "./trip-card";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, Box, Button, Grid } from "@mui/material";

import {
  type CardLook,
  type CardMark,
  CollapsibleGroup,
  CollapsibleGroupToggle,
} from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import PageHeader from "@/components/product/page-header";
import QuickActions from "@/components/product/quick-actions";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import { useFresh } from "@/components/product/use-fresh";
import { useLiveRead } from "@/components/product/use-live-read";
import NiAnnouncement from "@/icons/nexture/ni-announcement";
import NiBell from "@/icons/nexture/ni-bell";
import NiBriefcase from "@/icons/nexture/ni-briefcase";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiChange from "@/icons/nexture/ni-change";
import NiClipboard from "@/icons/nexture/ni-clipboard";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiFolder from "@/icons/nexture/ni-folder";
import NiInbox from "@/icons/nexture/ni-inbox";
import NiLink from "@/icons/nexture/ni-link";
import NiMessageDots from "@/icons/nexture/ni-message-dots";
import NiPen from "@/icons/nexture/ni-pen";
import NiPlane from "@/icons/nexture/ni-plane";
import NiScale from "@/icons/nexture/ni-scale";
import NiSendRight from "@/icons/nexture/ni-send-right";
import NiTimeline from "@/icons/nexture/ni-timeline";
import NiUsers from "@/icons/nexture/ni-users";
import { caseHolder, caseLabel, groupOf, STATUS_KEY } from "@/lib/cases/cases";
import { SECTION_ANCHOR } from "@/lib/cases/now";
import { readCasePulse } from "@/lib/cases/pulse-actions";
import { CASE_SECTIONS, type CaseSection } from "@/lib/cases/sections";
import { sayPending } from "@/lib/firm/pending";
import { caseKindLabelKey } from "@/lib/modules/registry";
import { setPublicationJudgment } from "@/lib/publications/actions";

/** The head of each card: what it is, as an icon of its family's tint. */
const LOOKS: Record<CaseSection, CardLook> = {
  people: { icon: <NiUsers size="medium" /> },
  trip: { icon: <NiPlane size="medium" /> },
  statements: { icon: <NiMessageDots size="medium" /> },
  documents: { icon: <NiFolder size="medium" /> },
  complaints: { icon: <NiAnnouncement size="medium" />, tone: "accent-2" },
  signatures: { icon: <NiPen size="medium" /> },
  rules: { icon: <NiScale size="medium" />, tone: "secondary" },
  proceedings: { icon: <NiBriefcase size="medium" />, tone: "secondary" },
  deadlines: { icon: <NiCalendarClock size="medium" />, tone: "accent-2" },
  hearings: { icon: <NiCalendar size="medium" />, tone: "accent-2" },
  publications: { icon: <NiInbox size="medium" />, tone: "accent-2" },
  drafts: { icon: <NiDocumentFull size="medium" />, tone: "secondary" },
  filing: { icon: <NiSendRight size="medium" />, tone: "secondary" },
  link: { icon: <NiLink size="medium" />, tone: "accent-1" },
  notices: { icon: <NiBell size="medium" />, tone: "accent-1" },
  summary: { icon: <NiClipboard size="medium" />, tone: "accent-1" },
  dossier: { icon: <NiDocumentCheck size="medium" />, tone: "accent-1" },
  timeline: { icon: <NiTimeline size="medium" />, tone: "accent-1" },
};

/** A moment as a clock says it, in Brasília: 14:32. */
const clockOf = (at: number) =>
  new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(
    new Date(at),
  );

/** What ONE is doing in each card, in a word on its head. */
const WORKING_KEY: Partial<Record<CaseSection, string>> = {
  people: "case-card-working-reading",
  documents: "case-card-working-checking",
  statements: "case-card-working-ordering",
  signatures: "case-card-working-sending",
  link: "case-card-working-sending",
  drafts: "case-card-working-writing",
  filing: "case-card-working-filing",
  deadlines: "case-card-working-reading",
  hearings: "case-card-working-reading",
  publications: "case-card-working-triaging",
};

/**
 * One case. Somebody of the firm comes here to know where the case stands and to do what only they do. So it
 * opens with where it is along its way, who it is with, what ONE is doing at this moment, what holds it and whose
 * turn each thing is (the owner's audit, 2026-11-05), and the cards below hold the work, each saying on its head
 * whether something there waits for the firm or ONE works there now. The screen follows the database by itself
 * while it is open: what ONE does and what the client sends shows with no reload.
 */
export default function CaseView({ state: read }: { state: CaseState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [staging, setStaging] = useState(false);
  // The case as it was last read whole: a read that fails (the database, or the session read again) must not take
  // the screen away from a person who is in the middle of a text.
  const [lastReady, setLastReady] = useState(read.kind === "ready" ? read : null);
  if (read.kind === "ready" && read !== lastReady) setLastReady(read);
  // A read that failed is no answer about the case: what the person had stays. A case that is not there, or a
  // person no longer of a firm, is an answer, and shows.
  const failed = read.kind === "error" || read.kind === "unavailable";
  const stale = failed && lastReady !== null;
  const state: CaseState = failed && lastReady ? lastReady : read;
  const ready = state.kind === "ready" ? state : null;

  // What happens in the case now, read from what the screen read (pure).
  const facts = useMemo(() => (ready ? caseFacts(ready) : null), [ready]);

  // One action at a time (the owner's canvas, 2026-11-10): what the person does locks the case's other controls
  // until the screen shows what came of it; a change made outside is read again saying so, with nothing locked.
  const actedRef = useRef<() => void>(() => {});
  const actions = useCaseActions({ acted: useCallback(() => actedRef.current(), []) });

  const live = useLiveRead({
    stamp: ready?.pulse?.stamp ?? null,
    read: useCallback(async () => {
      if (!ready) return null;
      const answer = await readCasePulse(ready.case.id);
      return answer.ok ? answer.pulse.stamp : null;
    }, [ready]),
    // ONE at work there now (a work already late is still followed, at the slower pace).
    busy: facts?.now.working.some((line) => !line.slow) ?? false,
    onChange: actions.follow,
  });
  // After a person's write the pulse is asked often for a while, since ONE goes on from it.
  useEffect(() => {
    actedRef.current = live.acted;
  }, [live.acted]);

  // A write a card made on its own: the screen reads again, the case's controls waiting until it shows.
  const refresh = actions.reload;

  // What the top knows of each card, by its id: something there waits for the firm or failed, or for the client,
  // and what ONE does there now.
  const marks = useMemo(() => {
    const out: Record<string, CardMark> = {};
    for (const section of CASE_SECTIONS) {
      const mark = facts?.now.sections[section];
      const state = facts?.cards[section];
      if (!mark && !state) continue;
      out[SECTION_ANCHOR[section]] = {
        firm: mark?.firm ?? false,
        failed: mark?.failed ?? false,
        client: mark?.client ?? false,
        working: mark?.working ? t(WORKING_KEY[section] ?? "case-card-working") : null,
        state: state ? { tone: state.tone, label: sayPending(t, state.text) } : null,
      };
    }
    return out;
  }, [facts, t]);
  const looks = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(LOOKS).map(([section, look]) => [SECTION_ANCHOR[section as CaseSection], look]),
      ),
    [],
  );
  const words = useMemo(
    () => ({ firm: t("case-card-mark-firm"), failed: t("case-card-mark-failed"), client: t("case-card-mark-client") }),
    [t],
  );

  // While an action runs, every control of the cards waits, and pointing at one says why.
  const lock = actions.running ? t("case-action-wait", { doing: actions.running.doing }) : null;
  // What came of the action, in the card where the person acted, for a while.
  const note = actions.note;
  const notes = useMemo(() => {
    const out: Record<string, ReactNode> = {};
    if (note) {
      out[SECTION_ANCHOR[note.section]] = (
        <Box role="status">
          <StateLine tone="done" emphasis status={t("case-action-done-at", { time: clockOf(note.at) })}>
            {note.text}
          </StateLine>
        </Box>
      );
    }
    return out;
  }, [note, t]);
  // The cards whose state changed with the latest reading are marked for a moment (the one the person acted in says
  // it in its own line).
  const fresh = useFresh(
    useMemo(() => Object.fromEntries(Object.entries(marks).map(([id, mark]) => [id, JSON.stringify(mark)])), [marks]),
    3000,
  );
  const flash = useMemo(() => {
    const acted = note ? SECTION_ANCHOR[note.section] : null;
    return new Set([...fresh].filter((id) => id !== acted));
  }, [fresh, note]);

  const onJudgment = useCallback(
    async (publicationId: string, judgment: boolean) => {
      const result = await setPublicationJudgment(publicationId, judgment);
      if (result.ok) refresh();
    },
    [refresh],
  );

  if (state.kind !== "ready" || !facts) {
    return (
      <Box className="flex flex-col gap-6">
        <PageHeader
          title={t("cases-title")}
          crumbs={[
            { label: t("cases-home"), href: "/inicio" },
            { label: t("cases-title"), href: "/casos" },
          ]}
        />
        {state.kind === "unavailable" && (
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("settings-unavailable")}
          </Alert>
        )}
        {state.kind === "error" && (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={
              <Button color="inherit" size="small" onClick={() => router.refresh()}>
                {t("cases-retry")}
              </Button>
            }
          >
            {t("case-load-error")}
          </Alert>
        )}
        {state.kind === "not-found" && (
          <EmptyState
            icon={<NiFolder size="large" />}
            title={t("case-not-found-title")}
            description={t("case-not-found-body")}
            action={{ label: t("case-back-to-list"), href: "/casos" }}
          />
        )}
        {state.kind === "no-firm" && (
          <EmptyState
            icon={<NiUsers size="large" />}
            title={t("cases-no-firm-title")}
            description={t("cases-no-firm-body")}
            action={{ label: t("cases-no-firm-action"), href: "/admin" }}
          />
        )}
      </Box>
    );
  }

  const current = state.case;
  const kindKey = caseKindLabelKey(current.incident);
  const writable = !state.supportVisit;
  // Whoever answers for the case: the first adult claimant, or else a guardian of the minors, never a minor.
  const holderParty = caseHolder(state.parties, state.today);

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("case-title", { label: caseLabel(current.seq), name: holderParty?.person.full_name ?? "" })}
        crumbs={[
          { label: t("cases-home"), href: "/inicio" },
          { label: t("cases-title"), href: "/casos" },
          { label: caseLabel(current.seq) },
        ]}
        detail={kindKey ? t(kindKey) : undefined}
        action={
          <Box className="flex flex-wrap items-center gap-2">
            <StatusChip tone={GROUP_TONE[groupOf(current.status)]} label={t(STATUS_KEY[current.status])} />
            {writable ? (
              <QuickActions
                label={t("case-more-actions")}
                actions={[
                  {
                    key: "stage",
                    label: t("case-stage-change"),
                    icon: <NiChange size="medium" />,
                    onClick: () => setStaging(true),
                    disabled: actions.running !== null,
                  },
                ]}
              />
            ) : null}
          </Box>
        }
      />

      {stale && (
        <Alert
          severity="warning"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={() => router.refresh()}>
              {t("cases-retry")}
            </Button>
          }
        >
          {t("case-stale")}
        </Alert>
      )}
      {state.supportVisit && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("cases-support-visit")}
        </Alert>
      )}
      {current.closeReason && (current.status === "closed" || current.status === "declined") && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("case-closed-reason", { reason: current.closeReason })}
        </Alert>
      )}

      <CaseActionProvider value={actions}>
        {/* Where the case stands, who it is with, what ONE is doing now and what holds it: said once, here. It says the
          action under way and a reading of the case, and changes at the same moment as the cards. */}
        <JourneyCard
          state={state}
          journey={facts.journey}
          now={facts.now}
          live={live}
          action={actions.running}
          syncing={actions.syncing}
          onJudgment={onJudgment}
        />

        {/* While ONE works on the case, its actions wait: the notice says what ONE is doing, and the screen comes back
          by itself, read again, when it ends (the screen pattern after ADVBox). */}
        <CaseAtWork caseId={state.case.id} working={facts.now.working} events={state.events} />

        {/* Each card opens by itself when the case's stage is about it or something in it waits for the firm, and
          closes once that is done; the person may open or close every one at once to read the whole case. */}
        <CollapsibleGroup marks={marks} looks={looks} words={words} lock={lock} notes={notes} flash={flash}>
          <CollapsibleGroupToggle className="-mb-3" />
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, lg: 8 }} className="flex flex-col gap-3">
              {/* In the order the case goes: its people and trip, what happened, the papers, the lawsuits, the court. */}
              <PeopleCard state={state} writable={writable} onChanged={refresh} />
              <TripCard state={state} writable={writable} onChanged={refresh} />
              <StatementsCard state={state} writable={writable} onChanged={refresh} />
              <DocumentsCard state={state} writable={writable} onChanged={refresh} />
              <SignaturesCard state={state} writable={writable} onChanged={refresh} />
              <RulesCard state={state} writable={writable} onChanged={refresh} />
              <ProceedingsCard state={state} writable={writable} onChanged={refresh} />
              <DraftsCard state={state} writable={writable} onChanged={refresh} />
              <FilingCard state={state} writable={writable} onChanged={refresh} />
              <HearingsCard state={state} writable={writable} onChanged={refresh} />
              <PublicationsCard state={state} writable={writable} onChanged={refresh} />
              <OutcomeCard state={state} writable={writable} onChanged={refresh} />
              <MoneyCard state={state} />
              <FeesCard state={state} writable={writable} onChanged={refresh} />
              <DeadlinesCard state={state} writable={writable} onChanged={refresh} />
              <ComplaintCard state={state} writable={writable} onChanged={refresh} />
            </Grid>

            <Grid size={{ xs: 12, lg: 4 }} className="flex flex-col gap-3">
              <ClientLinkCard
                state={state}
                holderPersonId={holderParty?.person.person_id ?? null}
                writable={writable}
                onChanged={refresh}
              />
              <NoticesCard state={state} writable={writable} onChanged={refresh} />
              <SummaryCard state={state} writable={writable} onChanged={refresh} />
              <DossierCard state={state} writable={writable} onChanged={refresh} />
              <TimelineCard state={state} />
            </Grid>
          </Grid>
        </CollapsibleGroup>
      </CaseActionProvider>

      {staging && (
        <StageDialog
          caseId={current.id}
          status={current.status}
          onClose={() => setStaging(false)}
          onChanged={() => {
            setStaging(false);
            refresh();
          }}
        />
      )}
    </Box>
  );
}
