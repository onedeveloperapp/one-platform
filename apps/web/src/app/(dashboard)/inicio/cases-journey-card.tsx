"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Box, Button, Card, CardContent, Typography } from "@mui/material";

import { ProgressCounts, ProgressList, type ProgressListRow } from "@/components/product/progress-steps";
import NiArrowRight from "@/icons/nexture/ni-arrow-right";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiFolder from "@/icons/nexture/ni-folder";
import NiMessageDots from "@/icons/nexture/ni-message-dots";
import NiMoney from "@/icons/nexture/ni-money";
import NiPen from "@/icons/nexture/ni-pen";
import NiScale from "@/icons/nexture/ni-scale";
import NiSendRight from "@/icons/nexture/ni-send-right";
import { caseLabel } from "@/lib/cases/cases";
import {
  JOURNEY_LIST_FILTER,
  JOURNEY_STEP_KEY,
  JOURNEY_STEPS,
  OPEN_STEPS,
  type OpenStepId,
  stepOf,
} from "@/lib/cases/journey";
import type { JourneyOverview } from "@/lib/cases/journey-read";
import type { CaseListRow } from "@/lib/cases/list";
import { caseKindLabelKey } from "@/lib/modules/registry";

const STEP_ICON: Record<OpenStepId, ReactNode> = {
  intake: <NiMessageDots size="small" />,
  documents: <NiFolder size="small" />,
  signature: <NiPen size="small" />,
  drafting: <NiDocumentFull size="small" />,
  filing: <NiSendRight size="small" />,
  hearing: <NiCalendar size="small" />,
  judgment: <NiScale size="small" />,
  payment: <NiMoney size="small" />,
};

/** The latest cases in progress, the latest moved first. */
export type RecentCases = { rows: CaseListRow[] };

/**
 * Where the firm's cases are along their way, on the home (the owner, 2026-11-03): the same steps a case shows of
 * itself, from the first conversation to the payment, each with how many cases are at it now and the way to the
 * list of them; under them, the latest cases in progress, one line each with the step it is at and its way in
 * small, and the way to all of them; then how many are in progress, closed and did not go on. It comes after what
 * needs somebody today: the work first, the whole portfolio after.
 */
export default function CasesJourneyCard({
  overview,
  recent,
}: {
  overview: JourneyOverview;
  recent: RecentCases | null;
}) {
  const t = useTranslations("product");
  const going = OPEN_STEPS.reduce((sum, step) => sum + overview.steps[step], 0);
  const rows: ProgressListRow[] = (recent?.rows ?? []).map((row) => {
    // In court, the step its lawsuits show, as the list of cases says it.
    const step = stepOf(row.status, row.court ?? { held: false, decided: false, paid: false }) ?? "intake";
    const at = JOURNEY_STEPS.indexOf(step);
    const kindKey = caseKindLabelKey(row.incident);
    return {
      key: row.id,
      href: `/casos/${row.id}`,
      title: row.client ? `${caseLabel(row.seq)} · ${row.client}` : caseLabel(row.seq),
      detail:
        [kindKey ? t(kindKey) : null, row.agency ? t("journey-recent-agency", { agency: row.agency }) : null]
          .filter(Boolean)
          .join(" · ") || null,
      step: t(JOURNEY_STEP_KEY[step]),
      steps: JOURNEY_STEPS.length,
      reached: at,
      state: "progress",
      label: t("journey-bar-label", {
        label: t(JOURNEY_STEP_KEY[step]),
        position: at + 1,
        total: JOURNEY_STEPS.length,
      }),
    };
  });
  return (
    <Card component="section" aria-labelledby="home-journey-title">
      <CardContent className="flex flex-col gap-5">
        <Box className="flex flex-col gap-1">
          <Typography id="home-journey-title" variant="h5" component="h2" className="mb-0">
            {t("journey-overview-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("journey-overview-body")}
          </Typography>
        </Box>
        <ProgressCounts
          label={t("journey-overview-title")}
          steps={OPEN_STEPS.map((step) => ({
            key: step,
            label: t(JOURNEY_STEP_KEY[step]),
            icon: STEP_ICON[step],
            count: overview.steps[step],
            href: `/casos?ver=${JOURNEY_LIST_FILTER[step]}`,
            countLabel: t("journey-overview-step", { label: t(JOURNEY_STEP_KEY[step]), count: overview.steps[step] }),
          }))}
        />
        {rows.length > 0 ? (
          <Box className="flex flex-col gap-1">
            <Typography id="home-journey-recent" variant="subtitle2" component="h3" className="mb-0">
              {t("journey-recent-title")}
            </Typography>
            <ProgressList label={t("journey-recent-title")} rows={rows} />
          </Box>
        ) : null}
        <Box className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Typography variant="body2" className="text-text-secondary">
            {t("journey-overview-going", { count: going })}
            {" · "}
            <Link href="/casos?ver=ended" className="link-primary link-underline-hover">
              {t("journey-overview-closed", { count: overview.closed })}
            </Link>
            {overview.declined > 0 ? (
              <>
                {" · "}
                {t("journey-overview-declined", { count: overview.declined })}
              </>
            ) : null}
          </Typography>
          {going > 0 ? (
            <Box className="-ml-2 sm:ml-0">
              <Button
                component={Link}
                href="/casos"
                variant="text"
                color="primary"
                size="small"
                endIcon={<NiArrowRight size="small" />}
              >
                {t("journey-recent-all")}
              </Button>
            </Box>
          ) : null}
        </Box>
      </CardContent>
    </Card>
  );
}
