"use client";

import { GROUP_TONE } from "../../cases-types";
import { caseFacts } from "../case-facts";
import type { CaseState } from "../case-types";
import AreaCard from "./area-card";
import { CaseActionProvider, useCaseActions } from "./case-action";
import CaseAtWork from "./case-at-work";
import CaseTabsBar, { TAB_HINT_KEY } from "./case-tabs-bar";
import ClientLinkCard from "./client-link-card";
import ComplaintCard from "./complaint-card";
import DeadlinesCard from "./deadlines-card";
import DocumentsCard from "./documents-card";
import DossierCard from "./dossier-card";
import DraftsCard from "./drafts-card";
import FeesCard from "./fees-card";
import FilingCard from "./filing-card";
import { ForecastSummary } from "./forecast-card";
import HearingsCard from "./hearings-card";
import IntermediatePiecesCard from "./intermediate-pieces-card";
import JourneyCard, { markTrail } from "./journey-card";
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
import { useCaseTab } from "./use-case-tab";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, Box, Button, Typography } from "@mui/material";

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
import { type LiveRead, useLiveRead } from "@/components/product/use-live-read";
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
import { lookAtCaseNow } from "@/lib/cases/advance-actions";
import { CASE_TABS, type CaseTab, SECTION_TAB, tabMarks } from "@/lib/cases/case-tabs";
import { caseHolder, caseLabel, groupOf, STATUS_KEY } from "@/lib/cases/cases";
import { SECTION_ANCHOR } from "@/lib/cases/now";
import { readCasePulse } from "@/lib/cases/pulse-read";
import { CASE_SECTIONS, type CaseSection } from "@/lib/cases/sections";
import { sayPending } from "@/lib/firm/pending";
import { caseKindLabelKey } from "@/lib/modules/registry";
import { setPublicationJudgment } from "@/lib/publications/actions";

/** How long after the top says ONE owes the case a look the screen asks for it, and how often at most. */
const LOOK_AFTER_MS = 1_500;
const LOOKS_A_MINUTE = 5;

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
  pieces: { icon: <NiDocumentFull size="medium" />, tone: "secondary" },
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
  // The screen's own pulse, reached by the actions before it exists: until then nothing is known of the database,
  // and an action reads the screen again as it always did.
  const liveRef = useRef<Pick<LiveRead, "acted" | "latest" | "shows">>({
    acted: () => {},
    latest: async () => null,
    shows: () => false,
  });
  // The case's trail as the screen reads it: an action that changes it brings the person to it.
  const trail = useMemo(
    () =>
      facts
        ? JSON.stringify([
            facts.journey.current,
            facts.journey.ended,
            facts.journey.steps.map((step) => `${step.id}:${step.state}`),
            facts.now.holder,
            facts.now.working.map((line) => line.id),
            facts.now.blocking.map((line) => line.id),
          ])
        : "",
    [facts],
  );
  const actions = useCaseActions({
    acted: useCallback(() => liveRef.current.acted(), []),
    latest: useCallback(() => liveRef.current.latest(), []),
    shows: useCallback((mark: string) => liveRef.current.shows(mark), []),
    // Each reading the server hands the screen is a new object: the actions count them to know their own arrived.
    drawing: read,
    trail,
  });

  const caseId = ready?.case.id ?? null;
  const live = useLiveRead({
    stamp: ready?.pulse?.stamp ?? null,
    read: useCallback(async () => {
      if (!caseId) return null;
      const answer = await readCasePulse(caseId);
      return answer.ok ? answer.pulse.stamp : null;
    }, [caseId]),
    // ONE at work there now (a work already late is still followed, at the slower pace).
    busy: facts?.now.working.some((line) => !line.slow) ?? false,
    onChange: actions.follow,
  });
  // After a person's write the pulse is asked often for a while, since ONE goes on from it; and the action asks it
  // at once, to read the screen again only when the database is past what the action's own answer drew.
  useEffect(() => {
    liveRef.current = { acted: live.acted, latest: live.latest, shows: live.shows };
  }, [live.acted, live.latest, live.shows]);

  // A write a card made on its own (a dialog saved): the card says "Alteração salva" at once, and the screen brings
  // itself up to it, the case's controls waiting until it shows. Each card reports under its own id; one that reads
  // the case again after a refusal says so (`onChanged(false)`), and nothing is said as saved.
  const reload = actions.reload;
  const changed = useMemo(() => {
    const made = new Map<string, (saved?: boolean) => void>();
    return (anchor: string) => {
      const known = made.get(anchor);
      if (known) return known;
      const report = (saved?: boolean) => reload(anchor, saved !== false);
      made.set(anchor, report);
      return report;
    };
  }, [reload]);
  // A write of the top itself (whether a decision is the judgment, the stage changed by hand): no card to say it in.
  const refresh = useCallback(() => reload(null, true), [reload]);

  // ONE or the client moved the case along its way while the person looks at it: the trail marks itself for a
  // moment, and the screen stays where the person is. A step that changed with nothing said of it read as a screen
  // that had been wrong until then. What the person's own action moved is said, and gone to, by the action itself;
  // the lines under the steps mark themselves ("Novo").
  const wayKey = facts
    ? JSON.stringify([
        facts.journey.current,
        facts.journey.ended,
        facts.journey.steps.map((step) => `${step.id}:${step.state}`),
        facts.now.holder,
      ])
    : "";
  const wayShown = useRef(wayKey);
  const acting = actions.running !== null;
  useEffect(() => {
    if (wayShown.current === wayKey) return;
    const arrived = wayShown.current === "";
    wayShown.current = wayKey;
    if (!arrived && !acting) markTrail();
  }, [wayKey, acting]);

  // A look ONE owes the case never waits for the clock while somebody is on it. The top says "o ONE olha de novo em
  // instantes" as soon as the database wakes the case, and the look itself was left to the clock's next round, up to
  // five minutes later, whenever the action that woke it scheduled nothing. Asked once for each state of the case, a
  // moment after it shows (an action that does schedule the look has had it claimed by then), a few times a minute at
  // most, never in a support visit; the screen then asks its pulse often, to show ONE at it.
  const lookDue = facts?.now.working.some((line) => line.id === "advance:due") ?? false;
  const shownStamp = ready?.pulse?.stamp ?? null;
  const visiting = ready?.supportVisit ?? true;
  const lookAsked = useRef<{ stamp: string | null; at: number[] }>({ stamp: null, at: [] });
  const liveActed = live.acted;
  useEffect(() => {
    if (!lookDue || !caseId || !shownStamp || visiting || lookAsked.current.stamp === shownStamp) return;
    const timer = window.setTimeout(() => {
      const now = Date.now();
      const recent = lookAsked.current.at.filter((at) => now - at < 60_000);
      if (recent.length >= LOOKS_A_MINUTE) return;
      lookAsked.current = { stamp: shownStamp, at: [...recent, now] };
      void lookAtCaseNow(caseId)
        .then((answer) => {
          if (answer.ok) liveActed();
        })
        .catch(() => undefined);
    }, LOOK_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [lookDue, caseId, shownStamp, visiting, liveActed]);

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
      out[note.anchor] = (
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
    const acted = note ? note.anchor : null;
    return new Set([...fresh].filter((id) => id !== acted));
  }, [fresh, note]);

  // The tab the screen is on, and the card a link sent the person to (`useCaseTab`).
  const params = useSearchParams();
  const { tab, pick } = useCaseTab({
    asked: params.get("aba"),
    blocking: facts?.now.blocking ?? [],
    step: facts?.journey.current ?? "intake",
  });
  // What waits in each tab, and the tabs whose cards changed a moment ago.
  const marksOfTabs = useMemo(() => tabMarks(facts?.now.blocking ?? [], facts?.now.working ?? []), [facts]);
  const flashedTabs = useMemo(() => {
    const tabOf = new Map(CASE_SECTIONS.map((section) => [SECTION_ANCHOR[section], SECTION_TAB[section]]));
    return new Set([...flash].flatMap((anchor) => (tabOf.has(anchor) ? [tabOf.get(anchor) as CaseTab] : [])));
  }, [flash]);

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
  // A case of an area of the firm (0274): no trip, no passenger's rules, no complaint to an airline.
  const ofArea = Boolean(current.area);
  const writable = !state.supportVisit;
  // Whoever answers for the case: the first adult claimant, or else a guardian of the minors, never a minor.
  const holderParty = caseHolder(state.parties, state.today);
  // The cards of each tab, in the order the work is done in it.
  const panels: Record<CaseTab, ReactNode> = {
    cliente: (
      <>
        <PeopleCard state={state} writable={writable} onChanged={changed("case-people")} />
        {ofArea ? (
          <AreaCard state={state} writable={writable} onChanged={changed("case-area")} />
        ) : (
          <TripCard state={state} writable={writable} onChanged={changed("case-trip")} />
        )}
        <StatementsCard state={state} writable={writable} onChanged={changed("case-statements")} />
        <ClientLinkCard
          state={state}
          holderPersonId={holderParty?.person.person_id ?? null}
          writable={writable}
          onChanged={changed("case-link")}
        />
        <NoticesCard state={state} writable={writable} onChanged={changed("case-notices")} />
      </>
    ),
    documentos: (
      <>
        <DocumentsCard state={state} writable={writable} onChanged={changed("case-documents")} />
        <SignaturesCard state={state} writable={writable} onChanged={changed("case-signatures")} />
        <DossierCard state={state} writable={writable} onChanged={changed("case-dossier")} />
      </>
    ),
    acao: (
      <>
        {ofArea ? null : <RulesCard state={state} writable={writable} onChanged={changed("case-rules")} />}
        {ofArea ? null : <ComplaintCard state={state} writable={writable} onChanged={changed("case-complaints")} />}
        <ProceedingsCard state={state} writable={writable} onChanged={changed("case-proceedings")} />
        <DraftsCard state={state} writable={writable} onChanged={changed("case-drafts")} />
        <FilingCard state={state} writable={writable} onChanged={changed("case-filing")} />
      </>
    ),
    processo: (
      <>
        <PublicationsCard state={state} writable={writable} onChanged={changed("case-publications")} />
        <DeadlinesCard state={state} writable={writable} onChanged={changed("case-deadlines")} />
        <HearingsCard state={state} writable={writable} onChanged={changed("case-hearings")} />
        <IntermediatePiecesCard state={state} writable={writable} onChanged={changed("case-pieces")} />
        <OutcomeCard state={state} writable={writable} onChanged={changed("case-outcome")} />
      </>
    ),
    dinheiro: (
      <>
        <MoneyCard state={state} onChanged={changed("case-money")} />
        <FeesCard state={state} writable={writable} onChanged={changed("case-fees")} />
      </>
    ),
    historico: (
      <>
        {ofArea ? null : <SummaryCard state={state} writable={writable} onChanged={changed("case-summary")} />}
        <TimelineCard state={state} />
      </>
    ),
  };

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("case-title", { label: caseLabel(current.seq), name: holderParty?.person.full_name ?? "" })}
        crumbs={[
          { label: t("cases-home"), href: "/inicio" },
          { label: t("cases-title"), href: "/casos" },
          { label: caseLabel(current.seq) },
        ]}
        detail={ofArea ? (current.area?.typeName ?? undefined) : kindKey ? t(kindKey) : undefined}
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
            // Read again as any change made outside is: the top says "Atualizando o caso" while it comes.
            <Button color="inherit" size="small" onClick={() => void actions.follow()}>
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
          onAccount={changed("case-statements")}
          aside={ofArea ? null : <ForecastSummary proceedings={state.proceedings} airlines={state.airlines} />}
        />

        {/* While ONE works on the case, its actions wait: the notice says what ONE is doing, and the screen comes back
          by itself, read again, when it ends (the screen pattern after ADVBox). */}
        <CaseAtWork caseId={state.case.id} working={facts.now.working} events={state.events} last={actions.last} />

        {/* The cards in six tabs, in the order of the case's way; each tab says what waits in it. */}
        <CaseTabsBar tab={tab} marks={marksOfTabs} flashed={flashedTabs} onPick={pick} />

        {/* Each card opens by itself when the case's stage is about it or something in it waits for the firm, and
          closes once that is done; the person may open or close every one at once to read the whole case. */}
        <CollapsibleGroup marks={marks} looks={looks} words={words} lock={lock} notes={notes} flash={flash}>
          <Box className="-mt-3 flex flex-wrap items-center justify-between gap-2">
            <Typography variant="body2" className="text-text-secondary">
              {t(TAB_HINT_KEY[tab])}
            </Typography>
            <CollapsibleGroupToggle />
          </Box>
          {CASE_TABS.map((key) => (
            <Box
              key={key}
              role="tabpanel"
              id={`case-panel-${key}`}
              aria-labelledby={`case-tab-${key}`}
              data-case-tab={key}
              hidden={tab !== key}
              className="-mt-3 flex flex-col gap-3"
            >
              {panels[key]}
            </Box>
          ))}
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
