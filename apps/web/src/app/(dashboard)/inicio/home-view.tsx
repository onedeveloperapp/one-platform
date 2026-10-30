"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Alert, Box, Button, Grid, Typography } from "@mui/material";

import AttentionList, { type AttentionGroup } from "@/components/product/attention-list";
import EmptyState from "@/components/product/empty-state";
import { QuickActionTile, StatTile } from "@/components/product/home-tiles";
import ModulesStrip from "@/components/product/modules-strip";
import OnboardingChecklistCard from "@/components/product/onboarding-checklist-card";
import PageHeader from "@/components/product/page-header";
import type { TileTone } from "@/components/product/tile-tone";
import NiBuilding from "@/icons/nexture/ni-building";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiClock from "@/icons/nexture/ni-clock";
import NiDocumentCross from "@/icons/nexture/ni-document-cross";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiExclamationSquare from "@/icons/nexture/ni-exclamation-square";
import NiFlag from "@/icons/nexture/ni-flag";
import NiFolder from "@/icons/nexture/ni-folder";
import NiFolderCheck from "@/icons/nexture/ni-folder-check";
import NiInbox from "@/icons/nexture/ni-inbox";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiMessageCross from "@/icons/nexture/ni-message-cross";
import NiMessages from "@/icons/nexture/ni-messages";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiPaperclip from "@/icons/nexture/ni-paperclip";
import NiPuzzle from "@/icons/nexture/ni-puzzle";
import NiRefresh from "@/icons/nexture/ni-refresh";
import NiScale from "@/icons/nexture/ni-scale";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiTimeline from "@/icons/nexture/ni-timeline";
import NiUsers from "@/icons/nexture/ni-users";
import { type PendingGroup, sayPending } from "@/lib/firm/pending";
import { type FirmToday, somethingForMe, type TodayNeed, todayNeeds } from "@/lib/firm/today";
import type { ContractedModule, ModuleOffer } from "@/lib/modules/offer";
import { moduleOf } from "@/lib/modules/registry";
import type { ActivationFacts } from "@/lib/onboarding";
import type { FirmPartnersState } from "@/lib/partners/facts";
import type { FlowKey, OnboardingStateRow } from "@flyee/onboarding";

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
      setup: { flowKey: FlowKey; state: OnboardingStateRow; facts: ActivationFacts } | null;
      /** The modules the firm contracted and the ones to come (0075); null when they could not be read. */
      modules: ModuleOffer | null;
      /** The firm's partnerships with what it has of each (0069, 0075); null when they could not be read. */
      partners: Extract<FirmPartnersState, { kind: "ready" }> | null;
      /** The test chat's page, to who manages the firm while it is on; null otherwise. */
      testChat: string | null;
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
  const moduleSections = ready ? moduleShortcuts(ready, t) : [];
  const needs = ready
    ? todayNeeds(ready.today, {
        triagesPublications: ready.triagesPublications,
        worksDeadlines: ready.worksDeadlines,
        confirmsDeadlines: ready.confirmsDeadlines,
        managesFirm: ready.manager,
      })
    : [];

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={ready?.firstName ? t("today-greeting", { name: ready.firstName }) : t("today-title")}
        crumbs={[{ label: t("today-title") }]}
        description={ready ? t("today-description", { firm: ready.firm.name }) : undefined}
      />
      {ready?.modules ? <ModulesStrip offer={ready.modules} /> : null}

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

          {ready.setup ? (
            <OnboardingChecklistCard
              flowKey={ready.setup.flowKey}
              state={ready.setup.state}
              facts={ready.setup.facts}
              title={t("setup-title")}
            />
          ) : null}

          <Box component="section" aria-labelledby="today-needs" className="flex flex-col gap-4">
            <Typography id="today-needs" variant="h5" component="h2" className="mb-0">
              {t("today-needs-title")}
            </Typography>

            {needs.length > 0 ? (
              <Grid container spacing={2.5}>
                {needs.map((need) => (
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
            ) : null}

            {!somethingForMe(needs) ? (
              ready.today.whatsapp === "none" && ready.manager ? (
                <EmptyState
                  icon={<NiMessages size="large" />}
                  title={t("today-empty-title")}
                  description={t("today-empty-body-connect")}
                  action={{ label: t("today-empty-action-connect"), href: "/settings/connections" }}
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
              )
            ) : null}
          </Box>

          {moduleSections.map((section) => (
            <Box
              key={section.module.key}
              component="section"
              aria-labelledby={`today-module-${section.module.key}`}
              className="flex flex-col gap-4"
            >
              <Box className="flex flex-col gap-1">
                <Typography id={`today-module-${section.module.key}`} variant="h5" component="h2" className="mb-0">
                  {section.module.name}
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {t("today-module-hint")}
                </Typography>
              </Box>
              <Grid container spacing={2.5}>
                {section.tiles.map((tile) => (
                  <Grid key={tile.key} size={{ xs: 12, sm: 6, lg: 3 }}>
                    <QuickActionTile
                      href={tile.href}
                      icon={tile.icon}
                      tone={tile.tone}
                      title={tile.title}
                      description={tile.description}
                    />
                  </Grid>
                ))}
              </Grid>
            </Box>
          ))}
        </>
      ) : null}
    </Box>
  );
}

type Ready = Extract<HomeState, { kind: "ready" }>;
type Shortcut = {
  key: string;
  href: string;
  icon: React.ReactNode;
  tone: TileTone;
  title: string;
  description: string;
};
type Words = (key: string, values?: Record<string, string | number>) => string;

/**
 * The quick ways into each module the firm contracted: for a module with a partner (the passenger module's travel
 * agency), the partner agencies and the cases that came from them, with what the firm has of them; and, once, the
 * test chat while it is on and the firm's modules. A module with nothing to go to has no section.
 */
function moduleShortcuts(ready: Ready, t: Words): { module: ContractedModule; tiles: Shortcut[] }[] {
  return (ready.modules?.contracted ?? []).flatMap((module, index) => {
    const tiles: Shortcut[] = [];
    if ((moduleOf(module.key)?.partnerArea.length ?? 0) > 0) {
      const links = (ready.partners?.partnerships ?? []).filter((link) => link.module === module.key);
      const active = links.filter((link) => link.status === "active").length;
      const invited = (ready.partners?.invitations ?? []).some((invitation) => invitation.module === module.key);
      const going = links.reduce((sum, link) => sum + (link.facts?.casesGoing ?? 0), 0);
      const total = links.reduce((sum, link) => sum + (link.facts?.casesTotal ?? 0), 0);
      const awaiting = links.reduce((sum, link) => sum + (link.facts?.awaitingClient ?? 0), 0);
      tiles.push({
        key: "partners",
        href: "/settings/parceiros",
        icon: <NiBuilding size="large" />,
        tone: "primary",
        title: t("today-module-partners"),
        description: !ready.partners
          ? t("today-module-partners-unread")
          : active > 0
            ? t("today-module-partners-active", { count: active })
            : invited
              ? t("today-module-partners-invited")
              : ready.manager
                ? t("today-module-partners-invite")
                : t("today-module-partners-none"),
      });
      if (total > 0) {
        tiles.push({
          key: "agency-cases",
          href: "/casos?ver=agencia",
          icon: <NiFolder size="large" />,
          tone: "secondary",
          title: t("today-module-agency-cases"),
          description:
            awaiting > 0
              ? t("today-module-agency-cases-awaiting", { count: awaiting })
              : t("today-module-agency-cases-going", { count: going }),
        });
      }
    }
    if (index === 0) {
      if (ready.testChat) {
        tiles.push({
          key: "test-chat",
          href: ready.testChat,
          icon: <NiMessages size="large" />,
          tone: "accent-1",
          title: t("today-module-test-chat"),
          description: t("today-module-test-chat-hint"),
        });
      }
      tiles.push({
        key: "modules",
        href: "/settings/modulos",
        icon: <NiPuzzle size="large" />,
        tone: "accent-2",
        title: t("today-module-modules"),
        description: t("today-module-modules-hint"),
      });
    }
    return tiles.length > 0 ? [{ module, tiles }] : [];
  });
}
