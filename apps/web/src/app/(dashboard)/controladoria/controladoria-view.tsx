"use client";

import CasesView from "../casos/components/cases-view";
import CaseBoard from "./case-board";
import GoalsCard from "./goals-card";
import type { ControladoriaState } from "./load-controladoria";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  List,
  ListItem,
  ListItemButton,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";

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
import { JOURNEY_STEP_KEY, type JourneyStepId } from "@/lib/cases/journey";
import type { CaseFilter, CourtView } from "@/lib/cases/list";
import { type CaseCardKey, oversightCards, spanText } from "@/lib/cases/numbers";
import { type Holder, HOLDER_VIEW, HOLDERS, stockSteps } from "@/lib/cases/standing";
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

/** Who has the cases, by the name of the view each opens. */
/** The words of each step of the stock: the way's, but a case paid and not archived yet is at its last one. */
const STOCK_STEP_KEY: Record<JourneyStepId, string> = {
  ...JOURNEY_STEP_KEY,
  closed: "controladoria-stock-step-closing",
};

/** What the page says of test cases it holds with real ones (0114), and the one click that changes it. */
const TESTS_LINE = {
  "left-out": { line: "controladoria-tests-left-out", action: "controladoria-tests-include" },
  included: { line: "controladoria-tests-included", action: "controladoria-tests-exclude" },
};

const HOLDER_VIEW_LABEL: Record<Holder, string> = {
  firm: "cases-filter-with-firm",
  client: "cases-filter-with-client",
  one: "cases-filter-with-one",
  court: "cases-filter-in-court",
  platform: "cases-filter-with-platform",
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
  // The test cases asked in stay asked in through the page's links (0114).
  const testes = ready?.testCases.state === "included" ? "1" : null;
  const hrefOf = (view: CaseFilter | null) => `${scopedHref("/controladoria", module, { ver: view, testes })}#lista`;

  // The cases as a list (with the bar's views) or as the board by step. A number of the page opens the list under it,
  // so arriving at another view shows the list again.
  const [mode, setMode] = useState<"list" | "board">("list");
  const [modeFor, setModeFor] = useState(ready?.cases.filter ?? null);
  if ((ready?.cases.filter ?? null) !== modeFor) {
    setModeFor(ready?.cases.filter ?? null);
    setMode("list");
  }
  const modeSwitch = (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={mode}
      aria-label={t("controladoria-cases-as")}
      onChange={(_, value: "list" | "board" | null) => {
        if (value) setMode(value);
      }}
    >
      <ToggleButton value="list">{t("controladoria-cases-list")}</ToggleButton>
      <ToggleButton value="board">{t("controladoria-cases-board")}</ToggleButton>
    </ToggleButtonGroup>
  );

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
          <ModuleScope path="/controladoria" modules={ready.cases.modules} current={module} keep={{ testes }} />

          {ready.testCases.state === "only" ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("controladoria-tests-only", { count: ready.testCases.count })}
            </Alert>
          ) : null}
          {ready.testCases.state === "left-out" || ready.testCases.state === "included" ? (
            <Alert
              severity="info"
              className="neutral bg-background-paper/60!"
              action={
                <Button
                  component={Link}
                  href={scopedHref("/controladoria", module, {
                    ver: ready.cases.filter,
                    testes: ready.testCases.counted ? null : "1",
                  })}
                  color="inherit"
                  size="small"
                >
                  {t(TESTS_LINE[ready.testCases.state].action)}
                </Button>
              }
            >
              {t(TESTS_LINE[ready.testCases.state].line, { count: ready.testCases.count })}
            </Alert>
          ) : null}

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

          {ready.stock ? (
            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, lg: 7 }}>
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
                      items={stockSteps(ready.stock).map((step) => {
                        const row = ready.stock?.steps.find((item) => item.step === step);
                        const days =
                          row && row.cases > 0
                            ? t("controladoria-stock-step-days", { median: row.medianDays, oldest: row.oldestDays })
                            : null;
                        const stalled =
                          row && row.stagnant > 0
                            ? t("controladoria-stock-step-stagnant", { count: row.stagnant, limit: row.limit ?? 0 })
                            : null;
                        return {
                          key: step,
                          label: t(STOCK_STEP_KEY[step]),
                          value: row?.cases ?? 0,
                          tone: row && row.stagnant > 0 ? ("attention" as const) : ("primary" as const),
                          hint: [days, stalled].filter(Boolean).join(" · ") || undefined,
                        };
                      })}
                    />
                  </CardContent>
                </Card>
              </Grid>
              <Grid size={{ xs: 12, lg: 5 }} className="flex flex-col gap-5">
                <Card component="section" aria-labelledby="controladoria-holders">
                  <CardContent className="flex flex-col gap-3">
                    <CardTitle
                      id="controladoria-holders"
                      icon={<NiUsers size="medium" />}
                      tone="accent-3"
                      title={t("controladoria-holders-title")}
                      description={t("controladoria-holders-body")}
                    />
                    <List disablePadding className="-mx-2">
                      {[
                        ...HOLDERS.filter(
                          (holder) => holder !== "platform" || (ready.stock?.holders.platform ?? 0) > 0,
                        ).map((holder) => ({
                          key: holder,
                          label: t(HOLDER_VIEW_LABEL[holder]),
                          value: ready.stock?.holders[holder] ?? 0,
                          view: HOLDER_VIEW[holder],
                        })),
                        {
                          key: "stagnant",
                          label: t("cases-filter-stagnant"),
                          value: ready.stock?.stagnant ?? 0,
                          view: "estagnados" as CaseFilter,
                        },
                      ].map((item) => (
                        <ListItem key={item.key} disablePadding>
                          <ListItemButton
                            href={hrefOf(item.view)}
                            LinkComponent={Link}
                            className="flex items-center gap-3 rounded-xl px-2 py-1.5"
                          >
                            <Typography variant="body2" component="span" className="min-w-0 flex-1 truncate">
                              {item.label}
                            </Typography>
                            <Typography variant="body2" component="span" className="font-semibold tabular-nums">
                              {countText(item.value)}
                            </Typography>
                          </ListItemButton>
                        </ListItem>
                      ))}
                    </List>
                  </CardContent>
                </Card>
                {ready.byModule ? (
                  <Card component="section" aria-labelledby="controladoria-modules">
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
                ) : null}
              </Grid>
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

          <GoalsCard goals={ready.goals} modules={ready.cases.modules} scope={ready.cases.scope?.module ?? null} />

          <Box id="lista" className="scroll-mt-24">
            {mode === "list" ? (
              <CasesView
                state={ready.cases}
                embedded
                hideNumbers
                heading={{ title: t("controladoria-list-title"), body: t("controladoria-list-body") }}
                headingAction={modeSwitch}
              />
            ) : (
              <Box component="section" aria-labelledby="controladoria-board" className="flex flex-col gap-6">
                <Box className="flex flex-wrap items-end justify-between gap-3">
                  <Box className="flex flex-col gap-1">
                    <Typography id="controladoria-board" variant="h5" component="h2" className="mb-0">
                      {t("controladoria-board-title")}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {t("controladoria-board-body")}
                    </Typography>
                  </Box>
                  {modeSwitch}
                </Box>
                {ready.board ? (
                  <CaseBoard columns={ready.board} module={module} tests={ready.testCases.counted} />
                ) : (
                  <Alert severity="warning" className="neutral bg-background-paper/60!">
                    {t("controladoria-board-unread")}
                  </Alert>
                )}
              </Box>
            )}
          </Box>
        </>
      ) : null}
    </Box>
  );
}
