"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Alert, Box, Button, Grid, Typography } from "@mui/material";

import CasesProgressCard, { type CasesProgress } from "@/components/cases/cases-progress-card";
import EmptyState from "@/components/product/empty-state";
import { QuickActionTile } from "@/components/product/home-tiles";
import ModuleIcon from "@/components/product/module-icon";
import OneWorkLine from "@/components/product/one-work-line";
import PageHeader from "@/components/product/page-header";
import StatusChip from "@/components/product/status-chip";
import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import NextureIcons, { type IconName } from "@/icons/icon-registry";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiInbox from "@/icons/nexture/ni-inbox";
import NiLock from "@/icons/nexture/ni-lock";
import NiMessages from "@/icons/nexture/ni-messages";
import NiPuzzle from "@/icons/nexture/ni-puzzle";
import NiScale from "@/icons/nexture/ni-scale";
import type { ComingModule, ContractedModule, LockedModule } from "@/lib/modules/offer";
import { scopedHref } from "@/lib/modules/offer";
import type { OneWorkTotals } from "@/lib/one-work/work";
import { cn } from "@/lib/utils";

/** A place only this module has (its definition's `firmArea`, or the test chat), as the area offers it. */
export type ModuleShortcut = { id: string; href: string; icon: IconName; labelKey: string; descriptionKey: string };

export type ModuleAreaState =
  | {
      kind: "ready";
      firm: string;
      module: ContractedModule;
      /** What only this module has. */
      shortcuts: ModuleShortcut[];
      /**
       * Where the module's cases are along their way and the latest few, as the home says the firm's (the list of them
       * is `/casos` under the module, which the card opens); null when it could not be read.
       */
      progress: CasesProgress | null;
      /** What ONE did in the module's cases this month (0120, 0121), for its line; null when it could not be read. */
      oneWork: OneWorkTotals | null;
    }
  | { kind: "soon"; module: ComingModule }
  | { kind: "locked"; module: LockedModule }
  | { kind: "not-found" }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

/**
 * The module's share of the firm's work: the pages of the work under the module, each listing only what is of a
 * case of it. In the order of the main menu.
 */
const WORK: { path: string; label: string; hint: string; tone: TileTone; icon: React.ReactNode }[] = [
  {
    path: "/atendimento",
    label: "module-area-work-inbox",
    hint: "module-area-work-inbox-hint",
    tone: "primary",
    icon: <NiMessages size="large" />,
  },
  {
    path: "/protocolo",
    label: "module-area-work-filing",
    hint: "module-area-work-filing-hint",
    tone: "accent-4",
    icon: <NiScale size="large" />,
  },
  {
    path: "/publicacoes",
    label: "module-area-work-publications",
    hint: "module-area-work-publications-hint",
    tone: "accent-3",
    icon: <NiInbox size="large" />,
  },
  {
    path: "/prazos",
    label: "module-area-work-deadlines",
    hint: "module-area-work-deadlines-hint",
    tone: "accent-3",
    icon: <NiCalendarClock size="large" />,
  },
  {
    path: "/agenda",
    label: "module-area-work-hearings",
    hint: "module-area-work-hearings-hint",
    tone: "primary",
    icon: <NiCalendar size="large" />,
  },
];

const day = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value))
    : "";

/**
 * A module's area. Somebody comes here to work one module and nothing of another: the way into the module's share of
 * each page of the firm's work and the places only this module has, then where the module's cases are and the latest
 * of them (the same card as the home's, each step opening the list of `/casos` under the module: the area never
 * repeats that list, 2026-11-09). Success is finding the module's work in one place; the firm's pages stay for who
 * works every module at once (the controladoria, a partner).
 */
export default function ModuleAreaView({ state }: { state: ModuleAreaState }) {
  const t = useTranslations("product");
  const router = useRouter();

  if (state.kind === "ready") return <Area state={state} />;

  const module = state.kind === "soon" || state.kind === "locked" ? state.module : null;
  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={module?.name ?? t("modules-title")}
        crumbs={[
          { label: t("settings-home"), href: "/inicio" },
          { label: t("modules-title"), href: "/modulos" },
          ...(module ? [{ label: module.name }] : []),
        ]}
        description={module?.description ?? undefined}
      />
      {state.kind === "soon" && (
        <EmptyState
          icon={<ModuleIcon name={state.module.icon} />}
          title={t("module-area-soon-title")}
          description={t("module-area-soon-body", { module: state.module.name })}
          action={{ label: t("module-area-see-modules"), href: "/modulos" }}
        />
      )}
      {state.kind === "locked" && (
        <EmptyState
          icon={<NiLock size="large" />}
          title={t("module-area-locked-title")}
          description={t("module-area-locked-body", { module: state.module.name })}
          action={{ label: t("module-area-see-modules"), href: "/modulos" }}
        />
      )}
      {state.kind === "not-found" && (
        <EmptyState
          icon={<NiPuzzle size="large" />}
          title={t("module-area-missing-title")}
          description={t("module-area-missing-body")}
          action={{ label: t("module-area-see-modules"), href: "/modulos" }}
        />
      )}
      {state.kind === "unavailable" && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("settings-unavailable")}
        </Alert>
      )}
      {state.kind === "no-firm" && (
        <EmptyState
          icon={<NiPuzzle size="large" />}
          title={t("cases-no-firm-title")}
          description={t("cases-no-firm-body")}
          action={{ label: t("cases-no-firm-action"), href: "/admin" }}
        />
      )}
      {state.kind === "error" && (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={() => router.refresh()}>
              {t("modules-retry")}
            </Button>
          }
        >
          {t("modules-load-error")}
        </Alert>
      )}
    </Box>
  );
}

function Area({ state }: { state: Extract<ModuleAreaState, { kind: "ready" }> }) {
  const t = useTranslations("product");
  const { module } = state;
  const tone = TILE_TONE.primary;
  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={module.name}
        crumbs={[
          { label: t("settings-home"), href: "/inicio" },
          { label: t("modules-title"), href: "/modulos" },
          { label: module.name },
        ]}
        description={module.description ?? undefined}
      />

      <Box className="flex flex-wrap items-center gap-3">
        <Box
          aria-hidden
          className={cn("flex h-12 w-12 flex-none items-center justify-center rounded-2xl", tone.bg, tone.text)}
        >
          <ModuleIcon name={module.icon} />
        </Box>
        <StatusChip tone="positive" label={t("modules-status-contracted")} />
        <Typography variant="body2" className="text-text-secondary">
          {[
            module.since ? t("modules-since", { date: day(module.since) }) : null,
            module.soldAs === "included" ? t("modules-sold-included") : t("modules-sold-package"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Typography>
      </Box>

      {state.oneWork ? (
        <OneWorkLine totals={state.oneWork} href={scopedHref("/trabalho-do-one", module.key)} scope="module" />
      ) : null}

      <Box component="section" aria-labelledby="module-quick" className="flex flex-col gap-4">
        <Box className="flex flex-col gap-1">
          <Typography id="module-quick" variant="h5" component="h2" className="mb-0">
            {t("module-area-quick-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("module-area-quick-body", { module: module.name })}
          </Typography>
        </Box>
        <Grid container spacing={2.5}>
          {WORK.map((work) => (
            <Grid key={work.path} size={{ xs: 12, sm: 6, lg: 3 }}>
              <QuickActionTile
                href={scopedHref(work.path, module.key)}
                icon={work.icon}
                tone={work.tone}
                title={t(work.label)}
                description={t(work.hint)}
              />
            </Grid>
          ))}
          {state.shortcuts.map((shortcut) => (
            <Grid key={shortcut.id} size={{ xs: 12, sm: 6, lg: 3 }}>
              <QuickActionTile
                href={shortcut.href}
                icon={<NextureIcons icon={shortcut.icon} size="large" />}
                tone="accent-1"
                title={t(shortcut.labelKey)}
                description={t(shortcut.descriptionKey)}
              />
            </Grid>
          ))}
        </Grid>
      </Box>

      {state.progress && state.progress.stock.total + (state.progress.ended ?? 0) > 0 ? (
        <CasesProgressCard
          progress={state.progress}
          module={module.key}
          description={t("module-area-cases-body", { module: module.name })}
        />
      ) : state.progress ? (
        // No case of the module yet is ONE's wait, never the firm's task (the owner, 2026-11-03).
        <EmptyState
          icon={<ModuleIcon name={module.icon} />}
          title={t("module-area-cases-empty-title")}
          description={t("module-area-cases-empty-body", { module: module.name })}
          action={{ label: t("cases-empty-what-one-does"), href: "/settings/autonomia" }}
        />
      ) : (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {t("module-area-cases-error")}
        </Alert>
      )}
    </Box>
  );
}
