"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Box, Card, CardContent, Typography } from "@mui/material";

import { ProgressCounts } from "@/components/product/progress-steps";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiFolder from "@/icons/nexture/ni-folder";
import NiMessageDots from "@/icons/nexture/ni-message-dots";
import NiMoney from "@/icons/nexture/ni-money";
import NiPen from "@/icons/nexture/ni-pen";
import NiScale from "@/icons/nexture/ni-scale";
import NiSendRight from "@/icons/nexture/ni-send-right";
import { JOURNEY_LIST_FILTER, JOURNEY_STEP_KEY, OPEN_STEPS, type OpenStepId } from "@/lib/cases/journey";
import type { JourneyOverview } from "@/lib/cases/journey-read";

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

/**
 * Where the firm's cases are along their way, on the home (the owner, 2026-11-03): the same steps a case shows of
 * itself, from the first conversation to the payment, each with how many cases are at it now and the way to the
 * list of them; under them, how many are in progress, closed and did not go on. It comes after what needs
 * somebody today: the work first, the whole portfolio after.
 */
export default function CasesJourneyCard({ overview }: { overview: JourneyOverview }) {
  const t = useTranslations("product");
  const going = OPEN_STEPS.reduce((sum, step) => sum + overview.steps[step], 0);
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
      </CardContent>
    </Card>
  );
}
