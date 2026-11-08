"use client";

import CasesView from "../casos/components/cases-view";
import type { ControladoriaState } from "./load-controladoria";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useTransition } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import EmptyState from "@/components/product/empty-state";
import MetricBars from "@/components/product/metric-bars";
import ModuleScope from "@/components/product/module-scope";
import NumberCard from "@/components/product/number-card";
import PageHeader from "@/components/product/page-header";
import type { TileTone } from "@/components/product/tile-tone";
import NiArchive from "@/icons/nexture/ni-archive";
import NiChartBar from "@/icons/nexture/ni-chart-bar";
import NiFlag from "@/icons/nexture/ni-flag";
import NiFolder from "@/icons/nexture/ni-folder";
import NiFolderPlus from "@/icons/nexture/ni-folder-plus";
import NiPause from "@/icons/nexture/ni-pause";
import NiRefresh from "@/icons/nexture/ni-refresh";
import NiScale from "@/icons/nexture/ni-scale";
import NiTimeline from "@/icons/nexture/ni-timeline";
import NiUsers from "@/icons/nexture/ni-users";
import { JOURNEY_STEP_KEY, OPEN_STEPS } from "@/lib/cases/journey";
import type { CaseFilter, CourtView } from "@/lib/cases/list";
import { type CaseCardKey, oversightCards, spanText } from "@/lib/cases/numbers";
import { scopedHref } from "@/lib/modules/offer";
import { countText, deltaText, isHoped } from "@/lib/numbers/compare";

const STOCK_CARD: Partial<Record<CaseCardKey, { label: string; hint: string; tone: TileTone; icon: ReactNode }>> = {
  going: {
    label: "controladoria-number-going",
    hint: "controladoria-number-going-hint",
    tone: "primary",
    icon: <NiFolder size="medium" />,
  },
  opened: {
    label: "controladoria-number-opened",
    hint: "cases-number-opened-hint",
    tone: "accent-1",
    icon: <NiFolderPlus size="medium" />,
  },
  filed: {
    label: "controladoria-number-filed",
    hint: "cases-number-filed-hint",
    tone: "accent-4",
    icon: <NiScale size="medium" />,
  },
  archived: {
    label: "controladoria-number-archived",
    hint: "controladoria-number-archived-hint",
    tone: "secondary",
    icon: <NiArchive size="medium" />,
  },
};

/** The court's numbers: what moved, what is quiet, what was never read. Each opens the list it counts. */
const COURT_CARD: Record<CourtView, { label: string; hint: string; tone: TileTone; icon: ReactNode }> = {
  "mov-hoje": {
    label: "cases-filter-moved-today",
    hint: "cases-filter-moved-today-hint",
    tone: "accent-1",
    icon: <NiTimeline size="medium" />,
  },
  "mov-7": {
    label: "cases-filter-moved-7",
    hint: "cases-filter-moved-7-hint",
    tone: "accent-1",
    icon: <NiTimeline size="medium" />,
  },
  "mov-30": {
    label: "cases-filter-moved-30",
    hint: "cases-filter-moved-30-hint",
    tone: "accent-1",
    icon: <NiTimeline size="medium" />,
  },
  "nunca-capturados": {
    label: "cases-filter-never-read",
    hint: "cases-filter-never-read-hint",
    tone: "accent-4",
    icon: <NiFlag size="medium" />,
  },
  "parado-30": {
    label: "cases-filter-quiet-30",
    hint: "cases-filter-quiet-30-hint",
    tone: "accent-3",
    icon: <NiPause size="medium" />,
  },
  "parado-45": {
    label: "cases-filter-quiet-45",
    hint: "cases-filter-quiet-45-hint",
    tone: "accent-3",
    icon: <NiPause size="medium" />,
  },
  "parado-90": {
    label: "cases-filter-quiet-90",
    hint: "cases-filter-quiet-90-hint",
    tone: "accent-3",
    icon: <NiPause size="medium" />,
  },
};

/** What moved first, then what was never read, then what is quiet. */
const COURT_ORDER: readonly CourtView[] = [
  "mov-hoje",
  "mov-7",
  "mov-30",
  "nunca-capturados",
  "parado-30",
  "parado-45",
  "parado-90",
];

/**
 * The firm's cases as a whole, for a partner, the controladoria and who manages the firm: how many are going and at
 * which step, what came in, went to court and was archived in the month, what the court moved and what is quiet, and
 * under them the list each number opens, with its views and "Exportar". It only shows: whoever acts opens a case, and
 * ONE moves the cases. It is read when it opens and on "Atualizar", and says when.
 */
export default function ControladoriaView({ state }: { state: ControladoriaState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  const ready = state.kind === "ready" ? state : null;
  const module = ready?.cases.scope?.module.key ?? null;
  const numbers = ready?.cases.list.numbers ?? null;
  const counts = ready?.cases.list.counts ?? null;
  const hrefOf = (view: CaseFilter | null) => `${scopedHref("/controladoria", module, { ver: view })}#lista`;

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("controladoria-title")}
        crumbs={[{ label: t("cases-home"), href: "/inicio" }, { label: t("controladoria-title") }]}
        description={t("controladoria-description")}
        action={
          ready ? (
            <Box className="flex flex-col items-end gap-1">
              <Button
                variant="outlined"
                color="grey"
                size="small"
                disabled={refreshing}
                startIcon={<NiRefresh size="small" />}
                onClick={() => startRefresh(() => router.refresh())}
              >
                {t("controladoria-refresh")}
              </Button>
              <Typography variant="caption" role="status" className="text-text-secondary">
                {t("controladoria-read-at", { when: ready.readLabel })}
              </Typography>
            </Box>
          ) : undefined
        }
      />

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
              {t("cases-retry")}
            </Button>
          }
        >
          {t("controladoria-load-error")}
        </Alert>
      ) : null}
      {state.kind === "no-firm" ? (
        <EmptyState
          icon={<NiUsers size="large" />}
          title={t("cases-no-firm-title")}
          description={t("cases-no-firm-body")}
          action={{ label: t("cases-no-firm-action"), href: "/admin" }}
        />
      ) : null}
      {state.kind === "not-allowed" ? (
        <EmptyState
          icon={<NiChartBar size="large" />}
          title={t("controladoria-not-allowed-title")}
          description={t("controladoria-not-allowed-body")}
          action={{ label: t("controladoria-see-cases"), href: "/casos" }}
        />
      ) : null}

      {ready ? (
        <>
          <ModuleScope path="/controladoria" modules={ready.cases.modules} current={module} />

          {numbers ? (
            <Grid container spacing={2.5}>
              {oversightCards(numbers).map((card) => {
                const words = STOCK_CARD[card.key];
                if (!words) return null;
                return (
                  <Grid key={card.key} size={{ xs: 6, lg: 3 }}>
                    <NumberCard
                      icon={words.icon}
                      tone={words.tone}
                      label={t(words.label)}
                      hint={t(words.hint)}
                      value={countText(card.value)}
                      comparison={{
                        delta: deltaText(card.compared),
                        same: t("cases-number-same"),
                        hoped: isHoped(card.compared, card.hope),
                        text: t("cases-number-vs", {
                          span: spanText(numbers, card.span),
                          value: countText(card.before),
                        }),
                      }}
                      href={hrefOf(card.view)}
                    />
                  </Grid>
                );
              })}
            </Grid>
          ) : null}

          {ready.journey ? (
            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, lg: ready.byModule ? 7 : 12 }}>
                <Card component="section" aria-labelledby="controladoria-stock" className="h-full">
                  <CardContent className="flex flex-col gap-4">
                    <CardTitle
                      id="controladoria-stock"
                      icon={<NiChartBar size="medium" />}
                      title={t("controladoria-stock-title")}
                      description={t("controladoria-stock-body")}
                    />
                    <MetricBars
                      spacing="dense"
                      items={OPEN_STEPS.map((step) => ({
                        key: step,
                        label: t(JOURNEY_STEP_KEY[step]),
                        value: ready.journey?.steps[step] ?? 0,
                      }))}
                    />
                  </CardContent>
                </Card>
              </Grid>
              {ready.byModule ? (
                <Grid size={{ xs: 12, lg: 5 }}>
                  <Card component="section" aria-labelledby="controladoria-modules" className="h-full">
                    <CardContent className="flex flex-col gap-4">
                      <CardTitle
                        id="controladoria-modules"
                        icon={<NiFolder size="medium" />}
                        tone="secondary"
                        title={t("controladoria-modules-title")}
                        description={t("controladoria-modules-body")}
                      />
                      <MetricBars
                        spacing="dense"
                        items={ready.byModule.map((item) => ({
                          key: item.module.key,
                          label: item.module.name,
                          value: item.going,
                        }))}
                      />
                    </CardContent>
                  </Card>
                </Grid>
              ) : null}
            </Grid>
          ) : (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              {t("controladoria-stock-unread")}
            </Alert>
          )}

          <Box component="section" aria-labelledby="controladoria-court" className="flex flex-col gap-3">
            <Box className="flex flex-col gap-1">
              <Typography id="controladoria-court" variant="h5" component="h2" className="mb-0">
                {t("controladoria-court-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {ready.courtRead ? t("controladoria-court-body") : t("controladoria-court-not-read")}
              </Typography>
            </Box>
            {counts && counts.filed > 0 ? (
              <Grid container spacing={2.5}>
                {COURT_ORDER.map((view) => (
                  <Grid key={view} size={{ xs: 6, sm: 4, lg: 3 }}>
                    <NumberCard
                      icon={COURT_CARD[view].icon}
                      tone={COURT_CARD[view].tone}
                      label={t(COURT_CARD[view].label)}
                      hint={t(COURT_CARD[view].hint)}
                      value={countText(counts[view])}
                      href={hrefOf(view)}
                    />
                  </Grid>
                ))}
              </Grid>
            ) : (
              <Typography variant="body2" className="text-text-secondary">
                {t("controladoria-court-none")}
              </Typography>
            )}
          </Box>

          <Box id="lista" className="scroll-mt-24">
            <CasesView
              state={ready.cases}
              embedded
              hideNumbers
              heading={{ title: t("controladoria-list-title"), body: t("controladoria-list-body") }}
            />
          </Box>
        </>
      ) : null}
    </Box>
  );
}
