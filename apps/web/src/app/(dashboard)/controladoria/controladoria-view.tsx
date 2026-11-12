"use client";

import CaseBoard from "./case-board";
import GoalsCard from "./goals-card";
import type { ControladoriaState } from "./load-controladoria";
import PortfolioPanel from "./portfolio-panel";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import CountList, { CountRows } from "@/components/product/count-list";
import EmptyState from "@/components/product/empty-state";
import InfoHint from "@/components/product/info-hint";
import MetricBars from "@/components/product/metric-bars";
import ModuleScope from "@/components/product/module-scope";
import NumberCard from "@/components/product/number-card";
import PageHeader from "@/components/product/page-header";
import SectionTitle from "@/components/product/section-title";
import StatusChip from "@/components/product/status-chip";
import type { TileTone } from "@/components/product/tile-tone";
import IllustrationDocumentation from "@/icons/illustrations/illustration-documentation";
import IllustrationLaunch from "@/icons/illustrations/illustration-launch";
import NiAi from "@/icons/nexture/ni-ai";
import NiArchive from "@/icons/nexture/ni-archive";
import NiArrowInDown from "@/icons/nexture/ni-arrow-in-down";
import NiBuilding from "@/icons/nexture/ni-building";
import NiChartBar from "@/icons/nexture/ni-chart-bar";
import NiFlag from "@/icons/nexture/ni-flag";
import NiFolder from "@/icons/nexture/ni-folder";
import NiFolderPlus from "@/icons/nexture/ni-folder-plus";
import NiPause from "@/icons/nexture/ni-pause";
import NiRefresh from "@/icons/nexture/ni-refresh";
import NiScale from "@/icons/nexture/ni-scale";
import NiSettings from "@/icons/nexture/ni-settings";
import NiTimeline from "@/icons/nexture/ni-timeline";
import NiUser from "@/icons/nexture/ni-user";
import NiUsers from "@/icons/nexture/ni-users";
import { type CaseFilter, type CourtView, stepView } from "@/lib/cases/list";
import { type CaseCardKey, oversightCards, spanText } from "@/lib/cases/numbers";
import { type Holder, HOLDER_VIEW, HOLDERS } from "@/lib/cases/standing";
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
    tone: "primary",
    icon: <NiTimeline size="medium" />,
  },
  "mov-7": {
    label: "cases-filter-moved-7",
    hint: "cases-filter-moved-7-hint",
    tone: "primary",
    icon: <NiTimeline size="medium" />,
  },
  "mov-30": {
    label: "cases-filter-moved-30",
    hint: "cases-filter-moved-30-hint",
    tone: "primary",
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

/** What the page says of test cases it holds with real ones (0114), and the one click that changes it. */
const TESTS_LINE = {
  "left-out": { line: "controladoria-tests-left-out", action: "controladoria-tests-include" },
  included: { line: "controladoria-tests-included", action: "controladoria-tests-exclude" },
};

/**
 * Who has the cases, by the name of the view each opens, with its icon and its colour: the client in the colour of the
 * board's hiring, the court in the court's.
 */
const HOLDER_LOOK: Record<Holder, { label: string; hint: string; tone: TileTone; icon: ReactNode }> = {
  firm: {
    label: "cases-filter-with-firm",
    hint: "cases-filter-with-firm-hint",
    tone: "accent-4",
    icon: <NiBuilding size="medium" />,
  },
  client: {
    label: "cases-filter-with-client",
    hint: "cases-filter-with-client-hint",
    tone: "accent-1",
    icon: <NiUser size="medium" />,
  },
  one: {
    label: "cases-filter-with-one",
    hint: "cases-filter-with-one-hint",
    tone: "secondary",
    icon: <NiAi size="medium" />,
  },
  court: {
    label: "cases-filter-in-court",
    hint: "cases-filter-in-court-hint",
    tone: "primary",
    icon: <NiScale size="medium" />,
  },
  platform: {
    label: "cases-filter-with-platform",
    hint: "cases-filter-with-platform-hint",
    tone: "accent-2",
    icon: <NiSettings size="medium" />,
  },
};

/** What moved, then what is quiet, then what was never read: the court's card shows the first three on its left. */
const COURT_ORDER: readonly CourtView[] = [
  "mov-hoje",
  "mov-7",
  "mov-30",
  "parado-30",
  "parado-45",
  "parado-90",
  "nunca-capturados",
];

/**
 * The firm's cases as a whole, for a partner, the controladoria and who manages the firm (the owner, 2026-11-09): the
 * numbers of the month first, then the board by step right under them (where the cases are, how long, which
 * stagnated), then the details (who has them, the court, the goals, the modules). It never repeats the list of
 * cases: each number, each line and each column opens `/casos` with the same cut (the module, the test cases left
 * out), so the list has the size the number says, and "Exportar" is there. It only shows: whoever acts opens a case,
 * and ONE moves the cases. It is read when it opens and on "Atualizar", and says when.
 */
export default function ControladoriaView({ state }: { state: ControladoriaState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [taking, setTaking] = useState(false);

  const ready = state.kind === "ready" ? state : null;
  const module = ready?.module?.key ?? null;
  const numbers = ready?.numbers ?? null;
  const counts = ready?.counts ?? null;
  // The test cases asked in stay asked in through the page's links (0114).
  const testes = ready?.testCases.state === "included" ? "1" : null;
  // Each number opens the one list of the cases, `/casos`, with the page's cut: its module and, where the page left
  // the test cases out, the list too (`?testes=fora`), so the list has the size the number says.
  const listOf = (view: CaseFilter | null) =>
    scopedHref("/casos", module, { ver: view, testes: ready?.testCases.state === "left-out" ? "fora" : null });

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("controladoria-title")}
        crumbs={[{ label: t("cases-home"), href: "/inicio" }, { label: t("controladoria-title") }]}
        description={t("controladoria-description")}
        action={
          ready ? (
            <Box className="flex flex-col items-end gap-1">
              <Box className="flex flex-wrap justify-end gap-2">
                {/* Taking what is the firm's is a right it must find in plain sight, never kept in a menu. */}
                {ready.takesPortfolio ? (
                  <Button
                    variant="outlined"
                    color="grey"
                    size="small"
                    startIcon={<NiArrowInDown size="small" />}
                    onClick={() => setTaking(true)}
                  >
                    {t("portfolio-action")}
                  </Button>
                ) : null}
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
              </Box>
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
          <ModuleScope path="/controladoria" modules={ready.modules} current={module} keep={{ testes }} />

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
                  href={scopedHref("/controladoria", module, { testes: ready.testCases.counted ? null : "1" })}
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
                      href={listOf(card.view)}
                    />
                  </Grid>
                );
              })}
            </Grid>
          ) : null}

          {/* Where the cases are, right under the numbers (the owner, 2026-11-09): each column opens its list. With no
              case going, one drawing says so instead of a row of empty columns. */}
          <Box component="section" aria-labelledby="controladoria-board" className="flex flex-col gap-3">
            {ready.board && ready.board.some((column) => column.cases > 0) ? (
              <CaseBoard
                headingId="controladoria-board"
                title={t("controladoria-board-title")}
                description={t("controladoria-board-body")}
                columns={ready.board}
                stock={ready.stock}
                module={module}
                tests={ready.testCases.counted}
                listOf={(step) => listOf(stepView(step))}
              />
            ) : (
              <>
                <SectionTitle
                  id="controladoria-board"
                  title={t("controladoria-board-title")}
                  description={t("controladoria-board-body")}
                />
                {ready.board ? (
                  <Card>
                    <CardContent>
                      <EmptyState
                        layout="row"
                        framed={false}
                        titleAs="h3"
                        illustration={<IllustrationLaunch />}
                        title={t("controladoria-board-none-title")}
                        description={t("controladoria-board-none-body")}
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <Alert severity="warning" className="neutral bg-background-paper/60!">
                    {t("controladoria-board-unread")}
                  </Alert>
                )}
              </>
            )}
          </Box>

          {/* The details, in rows whose cards share their height (the owner, 2026-11-12, who found the cards out of
              line): who has the cases beside the court's numbers, then the goals, beside each module's stock where the
              firm has more than one. */}
          <Box className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {ready.stock ? (
              <CountList
                id="controladoria-holders"
                icon={<NiUsers size="medium" />}
                tone="accent-2"
                title={t("controladoria-holders-title")}
                description={t("controladoria-holders-body")}
                items={[
                  ...HOLDERS.filter((holder) => holder !== "platform" || (ready.stock?.holders.platform ?? 0) > 0).map(
                    (holder) => ({
                      key: holder,
                      href: listOf(HOLDER_VIEW[holder]),
                      icon: HOLDER_LOOK[holder].icon,
                      tone: HOLDER_LOOK[holder].tone,
                      label: t(HOLDER_LOOK[holder].label),
                      hint: t(HOLDER_LOOK[holder].hint),
                      value: countText(ready.stock?.holders[holder] ?? 0),
                    }),
                  ),
                  {
                    key: "stagnant",
                    href: listOf("estagnados"),
                    icon: <NiPause size="medium" />,
                    tone: "accent-3",
                    label: t("cases-filter-stagnant"),
                    hint: t("cases-filter-stagnant-hint"),
                    value: countText(ready.stock?.stagnant ?? 0),
                  },
                ]}
              />
            ) : (
              <Box>
                <Alert severity="warning" className="neutral bg-background-paper/60!">
                  {t("controladoria-stock-unread")}
                </Alert>
              </Box>
            )}
            <Card component="section" aria-labelledby="controladoria-court" className="@container lg:col-span-2">
              <CardContent className="flex h-full flex-col gap-4">
                {/* Where the environment reads no court, a chip says so, with what it means behind its "i". */}
                <CardTitle
                  id="controladoria-court"
                  icon={<NiScale size="medium" />}
                  tone="primary"
                  title={t("controladoria-court-title")}
                  description={ready.courtRead ? t("controladoria-court-body") : undefined}
                  chip={
                    ready.courtRead ? undefined : (
                      <Box className="flex items-center gap-0.5">
                        <StatusChip tone="neutral" label={t("controladoria-court-test-env")} />
                        <InfoHint
                          label={t("controladoria-court-not-read")}
                          placement="bottom-start"
                          className="self-center"
                        />
                      </Box>
                    )
                  }
                />
                {counts && counts.filed > 0 ? (
                  // What moved on the left, what is quiet and what was never read on the right, row by row.
                  <CountRows
                    split={3}
                    items={COURT_ORDER.map((view) => ({
                      key: view,
                      href: listOf(view),
                      icon: COURT_CARD[view].icon,
                      tone: COURT_CARD[view].tone,
                      label: t(COURT_CARD[view].label),
                      hint: t(COURT_CARD[view].hint),
                      value: countText(counts[view]),
                    }))}
                  />
                ) : (
                  // Nothing in court yet: a drawing says so, never a blank.
                  <Box className="flex flex-1 items-center">
                    <EmptyState
                      layout="row"
                      framed={false}
                      titleAs="h3"
                      illustration={<IllustrationDocumentation />}
                      title={t("controladoria-court-none")}
                      description={t("controladoria-court-none-body")}
                    />
                  </Box>
                )}
              </CardContent>
            </Card>

            <GoalsCard
              goals={ready.goals}
              modules={ready.modules}
              scope={ready.module}
              className={ready.byModule ? "lg:col-span-2" : "lg:col-span-3"}
            />
            {ready.byModule ? (
              <Card component="section" aria-labelledby="controladoria-modules">
                <CardContent className="flex flex-col gap-4">
                  <CardTitle
                    id="controladoria-modules"
                    icon={<NiFolder size="medium" />}
                    tone="secondary"
                    title={t("controladoria-modules-title")}
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
          </Box>

          {ready.takesPortfolio ? (
            <PortfolioPanel
              open={taking}
              onClose={() => setTaking(false)}
              firm={ready.firmName}
              tests={ready.testCases.counted}
              testsLeftOut={ready.testCases.state === "left-out" ? ready.testCases.count : 0}
              factor={ready.factor}
            />
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
