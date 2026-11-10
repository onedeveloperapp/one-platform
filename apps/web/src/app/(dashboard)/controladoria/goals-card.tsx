"use client";

import { goalWords } from "./metas/goal-words";
import NextLink from "next/link";
import { useTranslations } from "next-intl";

import { Alert, Box, Button, Card, CardContent, LinearProgress, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import EmptyState from "@/components/product/empty-state";
import IllustrationPerformance from "@/icons/illustrations/illustration-performance";
import NiFlag from "@/icons/nexture/ni-flag";
import { type ClosingGoals, goalProgress, goalsOfView } from "@/lib/controladoria/goals";
import { type ModuleCard, scopedHref } from "@/lib/modules/offer";

/** How many goals in force the card shows; the rest are one click away, in the goals' own list. */
const SHOWN = 4;

/**
 * The closing goals in force, on the controladoria (migration 0113): each with its period, the part of the cases it is
 * of and what it asks, with its progress once the closings are counted (until then the card says the count is not on);
 * the goals' own list, where they are registered, one click away.
 */
export default function GoalsCard({
  goals,
  modules,
  scope,
}: {
  goals: ClosingGoals | null;
  modules: ModuleCard[];
  scope: ModuleCard | null;
}) {
  const t = useTranslations("product");
  const { periodOf, scopeOf } = goalWords(t, modules, scope);
  const module = scope?.key ?? null;
  const inForce = goals ? goalsOfView(goals.goals, "em-vigor", goals.today) : [];
  const more = Math.max(0, inForce.length - SHOWN);

  return (
    <Card component="section" aria-labelledby="controladoria-goals">
      <CardContent className="flex flex-col gap-4">
        <CardTitle
          id="controladoria-goals"
          icon={<NiFlag size="medium" />}
          title={t("goals-card-title")}
          actions={
            <Button
              component={NextLink}
              href={scopedHref("/controladoria/metas", module)}
              variant="text"
              color="grey"
              size="small"
            >
              {more > 0 ? t("goals-card-see-more", { count: more }) : t("goals-card-see")}
            </Button>
          }
        />
        {!goals ? (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {t("goals-card-unread")}
          </Alert>
        ) : inForce.length === 0 ? (
          // No goal in force: a drawing and what a goal is, with the way to make one for who may (never a blank band).
          <EmptyState
            layout="row"
            framed={false}
            titleAs="h3"
            illustration={<IllustrationPerformance />}
            title={t("goals-card-none")}
            description={t("goals-empty-now-body")}
            action={
              goals.mayManage
                ? { label: t("goals-new"), href: scopedHref("/controladoria/metas", module, { nova: "1" }) }
                : undefined
            }
          />
        ) : (
          <>
            {!goals.counting || goals.testsCounted ? (
              <Typography variant="body2" className="text-text-secondary">
                {t(goals.counting ? "goals-tests-counted" : "goals-not-counting")}
              </Typography>
            ) : null}
            <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
              {inForce.slice(0, SHOWN).map((goal) => {
                const progress = goalProgress(goal);
                return (
                  <Box
                    component="li"
                    key={goal.id}
                    className="border-grey-100 flex flex-wrap items-center gap-x-4 gap-y-2 border-b pb-3 last:border-b-0 last:pb-0"
                  >
                    <Box className="flex min-w-0 flex-1 flex-col">
                      <Typography variant="body2" className="font-semibold">
                        {periodOf(goal)}
                      </Typography>
                      <Typography variant="caption" className="text-text-secondary">
                        {scopeOf(goal)}
                      </Typography>
                    </Box>
                    <Box className="flex w-full flex-col gap-1 sm:w-56">
                      <Typography variant="body2">{t("goals-target", { count: goal.target })}</Typography>
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
                );
              })}
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}
