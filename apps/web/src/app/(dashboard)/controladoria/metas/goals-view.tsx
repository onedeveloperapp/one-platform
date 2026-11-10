"use client";

import GoalPanel from "./goal-panel";
import { goalWords } from "./goal-words";
import type { GoalsState } from "./load-goals";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Alert, Box, Button, Card, CardContent, LinearProgress, Link, Typography } from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import ListBar, { type ListView } from "@/components/product/list-bar";
import ModuleScope from "@/components/product/module-scope";
import PageHeader from "@/components/product/page-header";
import QuickActions from "@/components/product/quick-actions";
import StatusChip from "@/components/product/status-chip";
import NiArchive from "@/icons/nexture/ni-archive";
import NiChartBar from "@/icons/nexture/ni-chart-bar";
import NiFlag from "@/icons/nexture/ni-flag";
import NiPen from "@/icons/nexture/ni-pen";
import NiRefresh from "@/icons/nexture/ni-refresh";
import NiUsers from "@/icons/nexture/ni-users";
import {
  type ClosingGoal,
  firstView,
  GOAL_VIEWS,
  goalCounts,
  goalErrorKey,
  goalPhase,
  goalProgress,
  goalsOfView,
  type GoalView,
  isGoalView,
  viewOfPeriod,
} from "@/lib/controladoria/goals";
import { archiveClosingGoal } from "@/lib/controladoria/goals-actions";
import { countText } from "@/lib/numbers/compare";

const VIEW_KEY: Record<GoalView, string> = {
  "em-vigor": "goals-view-now",
  proximas: "goals-view-next",
  encerradas: "goals-view-past",
  arquivadas: "goals-view-archived",
};
const EMPTY_KEY: Record<GoalView, { title: string; body: string }> = {
  "em-vigor": { title: "goals-empty-now-title", body: "goals-empty-now-body" },
  proximas: { title: "goals-empty-next-title", body: "goals-empty-next-body" },
  encerradas: { title: "goals-empty-past-title", body: "goals-empty-past-body" },
  arquivadas: { title: "goals-empty-archived-title", body: "goals-empty-archived-body" },
};

/**
 * The firm's closing goals (migration 0113), the first registration in the pattern of phase 0: the list with its bar
 * (in force, next, ended, archived) and "Nova meta"; a goal created and changed in the side panel, by its period;
 * archived with its reason, and brought back. While no rule says what a closing is, the list says the count is not on
 * and each goal says what it asks.
 */
export default function GoalsView({ state }: { state: GoalsState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const ready = state.kind === "ready" ? state : null;
  const counts = ready ? goalCounts(ready.goals.goals, ready.goals.today) : null;
  const [view, setView] = useState<GoalView>(() => (counts ? firstView(counts) : "em-vigor"));
  const [editing, setEditing] = useState<ClosingGoal | "new" | null>(ready?.create ? "new" : null);
  const [archiving, setArchiving] = useState<ClosingGoal | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const refresh = () => startRefresh(() => router.refresh());
  const mayManage = Boolean(ready?.goals.mayManage) && !ready?.supportVisit;

  const { periodOf, scopeOf } = goalWords(t, ready?.modules ?? [], ready?.scope ?? null);

  const restore = async (goal: ClosingGoal) => {
    setFailed(null);
    let answer: Awaited<ReturnType<typeof archiveClosingGoal>>;
    try {
      answer = await archiveClosingGoal({ id: goal.id, reason: null });
    } catch {
      answer = { ok: false, code: "failed" };
    }
    if (!answer.ok) setFailed(t(goalErrorKey(answer.code)));
    refresh();
  };

  const views: ListView[] = GOAL_VIEWS.map((key) => ({
    key,
    label: t(VIEW_KEY[key]),
    count: counts ? countText(counts[key]) : undefined,
    group: "goals",
  }));
  const shown = ready ? goalsOfView(ready.goals.goals, view, ready.goals.today) : [];

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("goals-title")}
        crumbs={[
          { label: t("cases-home"), href: "/inicio" },
          { label: t("controladoria-title"), href: "/controladoria" },
          { label: t("goals-title") },
        ]}
        description={t("goals-description")}
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
            <Button color="inherit" size="small" startIcon={<NiRefresh size="small" />} onClick={refresh}>
              {t("cases-retry")}
            </Button>
          }
        >
          {t("goals-load-error")}
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

      {ready && counts ? (
        <>
          <ModuleScope path="/controladoria/metas" modules={ready.modules} current={ready.scope?.key ?? null} />

          {!ready.goals.counting || ready.goals.testsCounted ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t(ready.goals.counting ? "goals-tests-counted" : "goals-not-counting")}
            </Alert>
          ) : null}
          {ready.supportVisit ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("goals-support-visit")}
            </Typography>
          ) : !mayManage ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("goals-who-manages")}
            </Typography>
          ) : null}
          {failed ? (
            <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
              {failed}
            </Alert>
          ) : null}

          <ListBar
            label={t("goals-bar-label")}
            viewsTitle={t("list-views-title")}
            views={views}
            view={view}
            onView={(key) => {
              if (isGoalView(key)) setView(key);
            }}
            create={mayManage ? { label: t("goals-new"), onClick: () => setEditing("new") } : undefined}
          />

          {shown.length === 0 ? (
            <EmptyState
              icon={<NiFlag size="large" />}
              title={t(EMPTY_KEY[view].title)}
              description={t(EMPTY_KEY[view].body)}
              action={
                mayManage && view !== "arquivadas"
                  ? { label: t("goals-new"), onClick: () => setEditing("new") }
                  : undefined
              }
            />
          ) : (
            <Box component="ul" aria-label={t(VIEW_KEY[view])} className="m-0 flex list-none flex-col gap-3 p-0">
              {shown.map((goal) => {
                const archived = goalPhase(goal, ready.goals.today) === "archived";
                const progress = goalProgress(goal);
                const period = periodOf(goal);
                return (
                  <Box component="li" key={goal.id}>
                    <Card>
                      <CardContent className="flex items-start gap-3 sm:items-center">
                        <Box className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-3">
                          <Box className="flex min-w-48 flex-1 flex-col gap-0.5">
                            <Box className="flex flex-wrap items-center gap-2">
                              {mayManage && !archived ? (
                                <Link
                                  component="button"
                                  type="button"
                                  underline="hover"
                                  className="text-text-primary text-left text-base font-semibold"
                                  onClick={() => setEditing(goal)}
                                >
                                  {period}
                                </Link>
                              ) : (
                                <Typography variant="subtitle1" component="h3" className="mb-0 font-semibold">
                                  {period}
                                </Typography>
                              )}
                              {archived ? <StatusChip tone="neutral" label={t("goals-archived")} /> : null}
                            </Box>
                            <Typography variant="body2" className="text-text-secondary">
                              {scopeOf(goal)}
                            </Typography>
                            {archived && goal.archiveReason ? (
                              <Typography variant="caption" className="text-text-secondary">
                                {t("goals-archived-reason", { reason: goal.archiveReason })}
                              </Typography>
                            ) : null}
                          </Box>
                          <Box className="flex w-full flex-col gap-1.5 sm:w-64">
                            <Typography variant="body2" className="font-semibold">
                              {t("goals-target", { count: goal.target })}
                            </Typography>
                            {progress ? (
                              <>
                                <LinearProgress
                                  variant="determinate"
                                  value={progress.percent}
                                  aria-label={t("goals-progress", { done: progress.done, target: progress.target })}
                                />
                                <Typography variant="caption" className="text-text-secondary">
                                  {t("goals-progress", { done: progress.done, target: progress.target })}
                                </Typography>
                              </>
                            ) : null}
                          </Box>
                        </Box>
                        {mayManage ? (
                          <QuickActions
                            label={t("goals-actions", { period: periodOf(goal, true) })}
                            actions={
                              archived
                                ? [
                                    {
                                      key: "restore",
                                      label: t("goals-restore"),
                                      icon: <NiRefresh size="small" />,
                                      onClick: () => void restore(goal),
                                    },
                                  ]
                                : [
                                    {
                                      key: "edit",
                                      label: t("goals-edit"),
                                      icon: <NiPen size="small" />,
                                      onClick: () => setEditing(goal),
                                    },
                                    {
                                      key: "archive",
                                      label: t("goals-archive"),
                                      icon: <NiArchive size="small" />,
                                      onClick: () => setArchiving(goal),
                                    },
                                  ]
                            }
                          />
                        ) : null}
                      </CardContent>
                    </Card>
                  </Box>
                );
              })}
            </Box>
          )}
          {refreshing ? (
            <Typography variant="caption" role="status" className="text-text-secondary">
              {t("goals-refreshing")}
            </Typography>
          ) : null}

          {editing ? (
            <GoalPanel
              goal={editing === "new" ? null : editing}
              today={ready.goals.today}
              modules={ready.modules}
              scope={ready.scope}
              partnerships={ready.partnerships}
              onClose={() => setEditing(null)}
              onSaved={(period) => {
                setEditing(null);
                setView(viewOfPeriod(period.startsOn, period.endsOn, ready.goals.today));
                refresh();
              }}
            />
          ) : null}
          {archiving ? (
            <ConfirmActionDialog
              title={t("goals-archive-title")}
              intro={t("goals-archive-intro", { period: periodOf(archiving, true) })}
              consequences={[t("goals-archive-leaves")]}
              staysTitle={t("goals-archive-stays-title")}
              stays={[t("goals-archive-stays-record"), t("goals-archive-stays-back")]}
              requireReason
              reasonMinLength={3}
              reasonLabel={t("goals-archive-reason")}
              reasonPlaceholder={t("goals-archive-reason-placeholder")}
              confirmLabel={t("goals-archive")}
              cancelLabel={t("goals-cancel")}
              busyLabel={t("goals-archiving")}
              onConfirm={async (reason) => {
                let answer: Awaited<ReturnType<typeof archiveClosingGoal>>;
                try {
                  answer = await archiveClosingGoal({ id: archiving.id, reason });
                } catch {
                  answer = { ok: false, code: "failed" };
                }
                if (!answer.ok) return t(goalErrorKey(answer.code));
                refresh();
                return null;
              }}
              onClose={() => setArchiving(null)}
            />
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
