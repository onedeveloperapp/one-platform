"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Alert, Box, Card, CardContent, Typography } from "@mui/material";

import FactGrid, { type Fact } from "@/components/product/fact-grid";
import StateLine from "@/components/product/state-line";
import { CLIENT_PATH, type ClientPathStage, type ClientStanding } from "@/lib/cases/client-standing";
import { cn } from "@/lib/utils";
import { formatDayBr } from "@flyee/rules/person";

const PATH_KEY: Record<ClientPathStage, string> = {
  papers: "client-path-papers",
  signature: "client-path-signature",
  action: "client-path-action",
  court: "client-path-court",
  result: "client-path-result",
};

/** The five points of the case, the ones passed in green, the one of now in the firm's colour. */
function CasePath({ stage }: { stage: ClientPathStage }) {
  const t = useTranslations("product");
  const now = CLIENT_PATH.indexOf(stage);
  const passed = t("client-path-done");
  const current = t("client-path-now");
  return (
    <Box component="ol" aria-label={t("client-path-label")} className="m-0 grid list-none grid-cols-5 gap-1 p-0">
      {CLIENT_PATH.map((point, index) => (
        <Box
          component="li"
          key={point}
          aria-current={index === now ? "step" : undefined}
          className="flex min-w-0 flex-col gap-1.5"
        >
          <span
            aria-hidden
            className={cn(
              "h-1.5 rounded-full",
              index < now ? "bg-success" : index === now ? "bg-primary" : "bg-grey-100",
            )}
          />
          <Typography
            variant="caption"
            className={cn(
              "leading-4 break-words",
              index === now ? "text-text-primary font-bold" : "text-text-secondary",
            )}
          >
            {t(PATH_KEY[point])}
            <span className="sr-only">{index < now ? ` ${passed}` : index === now ? ` ${current}` : ""}</span>
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * The head of the client's page (the owner, 2026-11-13): whose page it is, the case's facts under their names, the
 * path of the case with where it is now, and one line of whose turn it is: the client's with how many steps follow,
 * the firm's since the client finished, the court's since the first lawsuit was filed, or nobody's once it ended.
 */
export default function ClientHead({
  firm,
  facts,
  standing,
  notice,
}: {
  firm: string;
  facts: Fact[];
  standing: ClientStanding;
  /** What the page must say before anything else (the agency's data to confirm). */
  notice?: ReactNode;
}) {
  const t = useTranslations("product");
  const papers = standing.stage === "papers" || standing.stage === "signature";
  const since = standing.since ? (formatDayBr(standing.since.slice(0, 10)) ?? "") : "";
  const line =
    standing.turn === "client" ? (
      <StateLine tone="attention" emphasis>
        {t("client-standing-client", { count: standing.steps.length })}
      </StateLine>
    ) : standing.turn === "court" ? (
      <StateLine tone="info" emphasis>
        {since ? t("client-standing-court", { date: since }) : t("client-standing-court-plain")}
      </StateLine>
    ) : standing.turn === "closed" ? (
      <StateLine tone="done" emphasis>
        {t("client-standing-closed")}
      </StateLine>
    ) : (
      <StateLine tone="waiting" emphasis>
        {papers ? t("client-standing-firm-papers") : t("client-standing-firm-action")}
      </StateLine>
    );
  return (
    <Card component="header">
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-col gap-0.5">
          <Typography variant="body2" className="text-text-secondary font-semibold break-words">
            {firm}
          </Typography>
          <Typography variant="h4" component="h1" className="mb-0">
            {t("client-head-title")}
          </Typography>
        </Box>
        <FactGrid facts={facts} pairs />
        <CasePath stage={standing.stage} />
        {line}
        {notice ? (
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {notice}
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
