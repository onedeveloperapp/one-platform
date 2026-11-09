"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Box, Button, Card, CardContent, Typography } from "@mui/material";

import { ProgressCounts, ProgressList, type ProgressListRow } from "@/components/product/progress-steps";
import NiArchive from "@/icons/nexture/ni-archive";
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
import { JOURNEY_STEPS, type JourneyStepId } from "@/lib/cases/journey";
import { type CaseListRow, stepOfRow, stepView } from "@/lib/cases/list";
import { type CaseStock, STOCK_STEP_KEY, stockSteps } from "@/lib/cases/standing";
import { scopedHref } from "@/lib/modules/offer";
import { caseKindLabelKey } from "@/lib/modules/registry";

const STEP_ICON: Record<JourneyStepId, ReactNode> = {
  intake: <NiMessageDots size="small" />,
  documents: <NiFolder size="small" />,
  signature: <NiPen size="small" />,
  drafting: <NiDocumentFull size="small" />,
  filing: <NiSendRight size="small" />,
  hearing: <NiCalendar size="small" />,
  judgment: <NiScale size="small" />,
  payment: <NiMoney size="small" />,
  closed: <NiArchive size="small" />,
};

/** What the card reads: the stock of its scope, the cases that ended, the latest few in progress. */
export type CasesProgress = {
  stock: CaseStock;
  /** The cases that ended (closed or that did not go on), as the list's view of them counts; null when unread. */
  ended: number | null;
  /** The latest cases in progress, the latest moved first. */
  recent: CaseListRow[];
};

/**
 * Where a firm's cases are along their way, read by the rule of the top of the case (`firm_case_stock`, 0111) and so
 * the same as the controladoria's board: how many cases are at each step, each step opening the list of those cases
 * in `/casos` (0116), so the list has the size the step says; the latest few in progress; how many are going and how
 * many ended. A summary: the list of every case is one click further, in `/casos`.
 */
export default function CasesProgressCard({
  progress,
  module = null,
  description,
}: {
  progress: CasesProgress;
  /** The module the card is of (a module's area); every link then opens the list under it. */
  module?: string | null;
  description: string;
}) {
  const t = useTranslations("product");
  const { stock, ended, recent } = progress;
  const steps = stockSteps(stock);
  const count = (step: JourneyStepId) => stock.steps.find((item) => item.step === step)?.cases ?? 0;
  const rows: ProgressListRow[] = recent.map((row) => {
    const step = stepOfRow(row) ?? "intake";
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
      step: t(STOCK_STEP_KEY[step]),
      steps: JOURNEY_STEPS.length,
      reached: at,
      state: "progress",
      label: t("journey-bar-label", { label: t(STOCK_STEP_KEY[step]), position: at + 1, total: JOURNEY_STEPS.length }),
    };
  });
  return (
    <Card component="section" aria-labelledby="cases-progress-title">
      <CardContent className="flex flex-col gap-5">
        <Box className="flex flex-col gap-1">
          <Typography id="cases-progress-title" variant="h5" component="h2" className="mb-0">
            {t("journey-overview-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {description}
          </Typography>
        </Box>
        <ProgressCounts
          label={t("journey-overview-title")}
          steps={steps.map((step) => ({
            key: step,
            label: t(STOCK_STEP_KEY[step]),
            icon: STEP_ICON[step],
            count: count(step),
            href: scopedHref("/casos", module, { ver: stepView(step) }),
            countLabel: t("journey-overview-step", { label: t(STOCK_STEP_KEY[step]), count: count(step) }),
          }))}
        />
        {rows.length > 0 ? (
          <Box className="flex flex-col gap-1">
            <Typography variant="subtitle2" component="h3" className="mb-0">
              {t("journey-recent-title")}
            </Typography>
            <ProgressList label={t("journey-recent-title")} rows={rows} />
          </Box>
        ) : null}
        <Box className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Typography variant="body2" className="text-text-secondary">
            {t("journey-overview-going", { count: stock.total })}
            {ended !== null && ended > 0 ? (
              <>
                {" · "}
                <Link
                  href={scopedHref("/casos", module, { ver: "ended" })}
                  className="link-primary link-underline-hover"
                >
                  {t("journey-overview-closed", { count: ended })}
                </Link>
              </>
            ) : null}
          </Typography>
          {stock.total > 0 ? (
            <Box className="-ml-2 sm:ml-0">
              <Button
                component={Link}
                href={scopedHref("/casos", module)}
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
