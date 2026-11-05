"use client";

import CasesJourneyCard, { type RecentCases } from "./cases-journey-card";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { Alert, Box, Button, Grid, Typography } from "@mui/material";

import AttentionList, { type AttentionGroup } from "@/components/product/attention-list";
import EmptyState from "@/components/product/empty-state";
import { StatTile } from "@/components/product/home-tiles";
import ModulesQuickAccess from "@/components/product/modules-quick-access";
import OnboardingChecklistCard from "@/components/product/onboarding-checklist-card";
import PageHeader from "@/components/product/page-header";
import type { TileTone } from "@/components/product/tile-tone";
import { useLiveRead } from "@/components/product/use-live-read";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiClock from "@/icons/nexture/ni-clock";
import NiDocumentCross from "@/icons/nexture/ni-document-cross";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiExclamationSquare from "@/icons/nexture/ni-exclamation-square";
import NiFlag from "@/icons/nexture/ni-flag";
import NiFolderCheck from "@/icons/nexture/ni-folder-check";
import NiInbox from "@/icons/nexture/ni-inbox";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiMessageCross from "@/icons/nexture/ni-message-cross";
import NiMessages from "@/icons/nexture/ni-messages";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiPaperclip from "@/icons/nexture/ni-paperclip";
import NiRefresh from "@/icons/nexture/ni-refresh";
import NiRobot from "@/icons/nexture/ni-robot";
import NiScale from "@/icons/nexture/ni-scale";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiTimeline from "@/icons/nexture/ni-timeline";
import NiUsers from "@/icons/nexture/ni-users";
import type { WaitingDecisions } from "@/lib/ai/decisions";
import type { JourneyOverview } from "@/lib/cases/journey-read";
import { readHomePulse } from "@/lib/cases/pulse-actions";
import { homeTiles, type PendingGroup, sayPending, withDecisions } from "@/lib/firm/pending";
import { type FirmToday, somethingForMe, type TodayNeed, todayNeeds } from "@/lib/firm/today";
import type { ModuleOffer } from "@/lib/modules/offer";
import type { ActivationFacts } from "@/lib/onboarding";
import type { FlowKey, OnboardingStateRow, OnboardingStep } from "@flyee/onboarding";

/**
 * What the home renders from. `no-firm` is the platform operator, who works
 * in no firm (the gate sends them to the consoles before this is drawn);
 * `unavailable` is a clone without Supabase; `error` is a read that failed,
 * which is never shown as a day with nothing to do.
 */
export type HomeState =
  | {
      kind: "ready";
      firstName: string;
      firm: { name: string };
      manager: boolean;
      today: FirmToday;
      /** What holds a case until somebody of the firm acts (late, then waiting on the firm); null when unread. */
      attention: PendingGroup[] | null;
      /** The person says what a publication is: what the courts published is theirs to work on. */
      triagesPublications: boolean;
      /** The person works on deadlines: who signs, or runs them. */
      worksDeadlines: boolean;
      /** The person confirms deadlines: a partner or the controladoria. */
      confirmsDeadlines: boolean;
      /** The firm's setup, for who manages it. Null for everybody else, and when it could not be read. */
      setup: {
        flowKey: FlowKey;
        state: OnboardingStateRow;
        facts: ActivationFacts;
        /** The setup of each module the firm contracted (0081), its title in words. */
        moduleSteps: OnboardingStep[];
      } | null;
      /**
       * No case ever reached the firm: ONE waits for the first, which a module brings and ONE opens. Said as ONE's,
       * never as a step the firm owes (the owner, 2026-11-03). False when the facts could not be read.
       */
      waitsFirstCase: boolean;
      /** A partner or a lawyer with no registration at the bar: ONE reads none of their publications. */
      ownRegistrationMissing: boolean;
      /** ONE's modules for the firm (0075, 0078); null when they could not be read. */
      modules: ModuleOffer | null;
      /** How many of the firm's cases are at each step of their way (0082); null when it could not be read. */
      journey: JourneyOverview | null;
      /** The latest cases in progress (`firm_cases`, the latest moved first); null when it could not be read. */
      recent: RecentCases | null;
      /** The mark of what the home shows (0096, `firm_pulse`): what it follows while open; null when unreadable. */
      pulse: string | null;
      /** The decisions that wait, each placed where it is decided; null when unread (then counted as before). */
      decisions: WaitingDecisions | null;
    }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

/** How each need reads on its tile: its words (`product` namespace), its tint and its icon. */
const NEED: Record<TodayNeed["key"], { label: string; hint: string; tone: TileTone; icon: React.ReactNode }> = {
  // What has a clock takes the accent the app uses for "look at this"; red stays for failure.
  overdue: {
    label: "today-need-overdue",
    hint: "today-need-overdue-hint",
    tone: "accent-3",
    icon: <NiClock size="large" />,
  },
  due: {
    label: "today-need-due",
    hint: "today-need-due-hint",
    tone: "accent-3",
    icon: <NiCalendarClock size="large" />,
  },
  confirm: {
    label: "today-need-confirm",
    hint: "today-need-confirm-hint",
    tone: "primary",
    icon: <NiListCheck size="large" />,
  },
  hearings: {
    label: "today-need-hearings",
    hint: "today-need-hearings-hint",
    tone: "primary",
    icon: <NiCalendar size="large" />,
  },
  unwarned: {
    label: "today-need-unwarned",
    hint: "today-need-unwarned-hint",
    tone: "accent-4",
    icon: <NiMessageCross size="large" />,
  },
  unresolved: {
    label: "today-need-unresolved",
    hint: "today-need-unresolved-hint",
    tone: "accent-4",
    icon: <NiCalendar size="large" />,
  },
  calendar: {
    label: "today-need-calendar",
    hint: "today-need-calendar-hint",
    tone: "accent-4",
    icon: <NiCalendar size="large" />,
  },
  untimed: {
    label: "today-need-untimed",
    hint: "today-need-untimed-hint",
    tone: "accent-3",
    icon: <NiDocumentFull size="large" />,
  },
  unwritten: {
    label: "today-need-unwritten",
    hint: "today-need-unwritten-hint",
    tone: "accent-3",
    icon: <NiCalendar size="large" />,
  },
  recheck: {
    label: "today-need-recheck",
    hint: "today-need-recheck-hint",
    tone: "accent-4",
    icon: <NiExclamationSquare size="large" />,
  },
  closing: {
    label: "today-need-closing",
    hint: "today-need-closing-hint",
    tone: "accent-3",
    icon: <NiClock size="large" />,
  },
  waiting: {
    label: "today-need-waiting",
    hint: "today-need-waiting-hint",
    tone: "primary",
    icon: <NiMessages size="large" />,
  },
  approvals: {
    label: "today-need-approvals",
    hint: "today-need-approvals-hint",
    tone: "secondary",
    icon: <NiListCheck size="large" />,
  },
  clients: {
    label: "today-need-clients",
    hint: "today-need-clients-hint",
    tone: "primary",
    icon: <NiFolderCheck size="large" />,
  },
  civil: {
    label: "today-need-civil",
    hint: "today-need-civil-hint",
    tone: "accent-4",
    icon: <NiScale size="large" />,
  },
  documents: {
    label: "today-need-documents",
    hint: "today-need-documents-hint",
    tone: "secondary",
    icon: <NiPaperclip size="large" />,
  },
  cancelled: {
    label: "today-need-cancelled",
    hint: "today-need-cancelled-hint",
    tone: "accent-3",
    icon: <NiDocumentCross size="large" />,
  },
  publications: {
    label: "today-need-publications",
    hint: "today-need-publications-hint",
    tone: "accent-3",
    icon: <NiInbox size="large" />,
  },
  checks: {
    label: "today-need-checks",
    hint: "today-need-checks-hint",
    tone: "accent-4",
    icon: <NiShieldCheck size="large" />,
  },
  reading: {
    label: "today-need-reading",
    hint: "today-need-reading-hint",
    tone: "accent-4",
    icon: <NiRefresh size="large" />,
  },
  moved: {
    label: "today-need-moved",
    hint: "today-need-moved-hint",
    tone: "secondary",
    icon: <NiTimeline size="large" />,
  },
  drafts: {
    label: "today-need-drafts",
    hint: "today-need-drafts-hint",
    tone: "primary",
    icon: <NiDocumentFull size="large" />,
  },
  filings: {
    label: "today-need-filings",
    hint: "today-need-filings-hint",
    tone: "accent-3",
    icon: <NiScale size="large" />,
  },
  contested: {
    label: "today-need-contested",
    hint: "today-need-contested-hint",
    tone: "accent-3",
    icon: <NiMicrophone size="large" />,
  },
  complaints: {
    label: "today-need-complaints",
    hint: "today-need-complaints-hint",
    tone: "accent-4",
    icon: <NiFlag size="large" />,
  },
  failed: {
    label: "today-need-failed",
    hint: "today-need-failed-hint",
    tone: "accent-3",
    icon: <NiMessageCross size="large" />,
  },
  queue: {
    label: "today-need-queue",
    hint: "today-need-queue-hint",
    tone: "accent-4",
    icon: <NiListCheck size="large" />,
  },
};

/**
 * The firm's home. Somebody opens it at the start of the day to know what
 * needs them and to go there: success is nothing waiting. So it is a handful
 * of counts, each one a way into where the work is done, and for a firm still
 * being set up, what is missing. A day with nothing waiting says so, and says
 * where to go next.
 */
export default function HomeView({ state }: { state: HomeState }) {
  const t = useTranslations("product");
  const router = useRouter();

  const ready = state.kind === "ready" ? state : null;

  // The home follows the firm while it is open (the owner, 2026-11-05): what ONE did, what a client sent, what a
  // colleague decided, read again when the mark of what it shows changes, with no reload.
  const live = useLiveRead({
    stamp: ready?.pulse ?? null,
    read: useCallback(async () => {
      const answer = await readHomePulse();
      return answer.ok ? answer.pulse : null;
    }, []),
    busy: false,
    onChange: useCallback(() => router.refresh(), [router]),
  });
  const attention: AttentionGroup[] = (ready?.attention ?? []).map((group) => {
    const late = group.key === "late";
    return {
      key: group.key,
      title: t(late ? "today-attention-late" : "today-attention-waits"),
      tone: late ? "danger" : "attention",
      items: group.items.map((item) => ({
        id: item.id,
        href: item.href,
        tag: sayPending(t, item.tag),
        title: sayPending(t, item.label),
        detail: item.detail ? sayPending(t, item.detail) : undefined,
        count: item.count,
      })),
    };
  });
  const attentionTotal = (ready?.attention ?? []).reduce((sum, group) => sum + group.total, 0);
  const needs = ready
    ? withDecisions(
        todayNeeds(ready.today, {
          triagesPublications: ready.triagesPublications,
          worksDeadlines: ready.worksDeadlines,
          confirmsDeadlines: ready.confirmsDeadlines,
          managesFirm: ready.manager,
        }),
        ready.decisions,
      )
    : [];
  // Each thing once (the owner, 2026-11-04): what the list of what holds a case names is never a tile too. While that
  // list could not be read, every need is a tile, so nothing goes unseen.
  const tiles = ready?.attention ? homeTiles(needs, ready.attention) : needs;
  // Nothing waits only when the list was read and holds nothing, and no need is this person's: never beside the list
  // of what holds a case, nor beside the error that says it could not be read.
  const nothingWaits = Boolean(ready?.attention) && attentionTotal === 0 && !somethingForMe(needs);
  // The setup's list already asks the registration at the bar while its step is open: the reminder waits for it.
  const setupAsksRegistration = Boolean(
    ready?.setup &&
      !ready.setup.state.dismissed &&
      !ready.setup.state.completedAt &&
      ready.setup.facts.oab_signer !== true,
  );

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={ready?.firstName ? t("today-greeting", { name: ready.firstName }) : t("today-title")}
        crumbs={[{ label: t("today-title") }]}
        description={
          ready
            ? [
                t("today-description", { firm: ready.firm.name }),
                live.live && live.checkedAt
                  ? t("today-live", {
                      time: new Intl.DateTimeFormat("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "America/Sao_Paulo",
                      }).format(new Date(live.checkedAt)),
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" ")
            : undefined
        }
      />
      {ready?.modules ? <ModulesQuickAccess offer={ready.modules} /> : null}

      {state.kind === "unavailable" ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("settings-unavailable")}
        </Alert>
      ) : null}

      {state.kind === "error" ? (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={() => router.refresh()}>
              {t("today-retry")}
            </Button>
          }
        >
          {t("today-load-error")}
        </Alert>
      ) : null}

      {state.kind === "no-firm" ? (
        <EmptyState
          icon={<NiUsers size="large" />}
          title={t("today-no-firm-title")}
          description={t("today-no-firm-body")}
          action={{ label: t("today-no-firm-action"), href: "/admin" }}
        />
      ) : null}

      {ready ? (
        <>
          {ready.today.whatsapp === "disconnected" ? (
            <Alert
              severity="warning"
              className="neutral bg-background-paper/60!"
              action={
                ready.manager ? (
                  <Button color="inherit" size="small" href="/settings/connections" LinkComponent={Link}>
                    {t("today-whatsapp-reconnect")}
                  </Button>
                ) : undefined
              }
            >
              {ready.manager ? t("today-whatsapp-disconnected-manager") : t("today-whatsapp-disconnected-member")}
            </Alert>
          ) : null}

          {ready.attention === null ? (
            <Alert
              severity="error"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" onClick={() => router.refresh()}>
                  {t("today-retry")}
                </Button>
              }
            >
              {t("today-attention-error")}
            </Alert>
          ) : attentionTotal > 0 ? (
            <AttentionList
              id="today-attention"
              title={t("today-attention-title")}
              description={t("today-attention-body")}
              total={t("today-attention-count", { count: attentionTotal })}
              groups={attention}
            />
          ) : null}

          {ready.ownRegistrationMissing && !setupAsksRegistration ? (
            // Set aside in their own setup: the DJEN is read by the registrations of the firm's people.
            <Alert
              severity="warning"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" href="/configurar?passo=oab" LinkComponent={Link}>
                  {t("today-own-oab-action")}
                </Button>
              }
            >
              {t("today-own-oab-missing")}
            </Alert>
          ) : null}

          {ready.setup ? (
            <OnboardingChecklistCard
              flowKey={ready.setup.flowKey}
              state={ready.setup.state}
              facts={ready.setup.facts}
              moduleSteps={ready.setup.moduleSteps}
              title={t("setup-title")}
            />
          ) : null}

          {tiles.length > 0 ? (
            <Box component="section" aria-labelledby="today-needs" className="flex flex-col gap-4">
              <Typography id="today-needs" variant="h5" component="h2" className="mb-0">
                {ready.attention ? t("today-follow-title") : t("today-needs-title")}
              </Typography>
              <Grid container spacing={2.5}>
                {tiles.map((need) => (
                  <Grid key={need.key} size={{ xs: 12, sm: 6, lg: 3 }}>
                    <StatTile
                      href={need.href}
                      icon={NEED[need.key].icon}
                      tone={NEED[need.key].tone}
                      label={t(NEED[need.key].label)}
                      hint={t(NEED[need.key].hint)}
                      value={need.count}
                    />
                  </Grid>
                ))}
              </Grid>
            </Box>
          ) : null}

          {nothingWaits ? (
            <Box component="section" aria-label={t("today-needs-title")}>
              {ready.today.whatsapp === "none" && ready.manager ? (
                <EmptyState
                  icon={<NiMessages size="large" />}
                  title={t("today-empty-title")}
                  description={t("today-empty-body-connect")}
                  action={{ label: t("today-empty-action-connect"), href: "/settings/connections" }}
                />
              ) : ready.waitsFirstCase && ready.today.whatsapp !== "none" ? (
                // The firm gave ONE what it needs: the first case is ONE's to receive and carry, never the firm's step.
                <EmptyState
                  icon={<NiRobot size="large" />}
                  title={t("today-one-waits-title")}
                  description={t("today-one-waits-body")}
                  action={{ label: t("today-one-waits-action"), href: "/settings/autonomia" }}
                />
              ) : (
                <EmptyState
                  icon={<NiListCheck size="large" />}
                  title={t("today-empty-title")}
                  description={
                    ready.today.whatsapp === "none" ? t("today-empty-body-no-whatsapp") : t("today-empty-body")
                  }
                  action={
                    ready.today.whatsapp === "none"
                      ? { label: t("today-empty-action-team"), href: "/settings/team" }
                      : { label: t("today-empty-action-inbox"), href: "/atendimento" }
                  }
                />
              )}
            </Box>
          ) : null}

          {/* The whole portfolio after the day's work: shown once the firm has a case, of any stage. */}
          {ready.journey &&
          ready.journey.closed +
            ready.journey.declined +
            Object.values(ready.journey.steps).reduce((a, b) => a + b, 0) >
            0 ? (
            <CasesJourneyCard overview={ready.journey} recent={ready.recent} />
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
