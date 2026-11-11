"use client";

import { readFirmUsage } from "../actions-usage";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Card, CardContent, Grid, Skeleton, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import UsageMeter from "@/components/product/usage-meter";
import NiChartBar from "@/icons/nexture/ni-chart-bar";
import { type UsageMetric, type UsagePanel, usagePercent } from "@/lib/billing-usage";

const METRIC_KEY: Record<UsageMetric, string> = {
  processos_ativos: "billing-usage-processos_ativos",
  assentos: "billing-usage-assentos",
  whatsapp_numeros: "billing-usage-whatsapp_numeros",
};

/**
 * What the firm uses of its tier (migration 0202), for who manages its account or decides for it: each metric now
 * against the tier's ceiling, with the month's highest, the alerts of the month, and whether the flight monitor is on.
 * ONE never stops a firm's work at a ceiling: the card says what is near and where to change the tier.
 */
export default function UsageCard({ orgId }: { orgId: string }) {
  const t = useTranslations("product");
  const locale = useLocale();
  const [panel, setPanel] = useState<UsagePanel | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void readFirmUsage(orgId)
      .then((read) => {
        if (!live) return;
        if (read.ok) setPanel(read.panel);
        else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [orgId]);

  if (panel === null) return null;
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(new Date(iso));
  const near = panel?.metrics.some((line) => (usagePercent(line) ?? 0) >= 80) ?? false;

  return (
    <Grid size={12}>
      <Card component="section" id="consumo" aria-labelledby="billing-usage-title">
        <CardContent className="flex flex-col gap-4">
          <CardTitle
            id="billing-usage-title"
            icon={<NiChartBar size="medium" />}
            title={t("billing-usage-title")}
            description={t("billing-usage-hint")}
            detail={panel?.plan ? t("billing-usage-plan", { plan: panel.plan.name }) : undefined}
            chip={near ? <StatusChip tone="attention" label={t("billing-usage-near")} /> : undefined}
          />
          {failed ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t("billing-usage-failed")}
            </Alert>
          ) : panel === undefined ? (
            <Skeleton variant="rounded" height={120} />
          ) : (
            <>
              {!panel.plan ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("billing-usage-no-plan")}
                </Typography>
              ) : null}
              <Grid container spacing={3}>
                {panel.metrics.map((line) => {
                  const percent = usagePercent(line);
                  return (
                    <Grid key={line.metric} size={{ xs: 12, md: 4 }}>
                      <Box className="flex flex-col gap-1">
                        <Typography variant="subtitle2" component="h3">
                          {t(METRIC_KEY[line.metric])}
                        </Typography>
                        {line.ceiling ? (
                          <UsageMeter
                            headline={t("billing-usage-of", { now: line.now, ceiling: line.ceiling })}
                            caption={t("billing-usage-peak", { peak: line.peak })}
                            ariaLabel={t(METRIC_KEY[line.metric])}
                            segments={[
                              {
                                key: "used",
                                label: t("billing-usage-used"),
                                value: Math.min(line.now, line.ceiling),
                                display: String(line.now),
                                tone: (percent ?? 0) >= 80 ? "attention" : "primary",
                              },
                              {
                                key: "left",
                                label: t("billing-usage-left"),
                                value: Math.max(line.ceiling - line.now, 0),
                                display: String(Math.max(line.ceiling - line.now, 0)),
                                tone: "empty",
                              },
                            ]}
                          />
                        ) : (
                          <Typography variant="body2" className="text-text-secondary">
                            {t("billing-usage-no-ceiling", { now: line.now })}
                          </Typography>
                        )}
                      </Box>
                    </Grid>
                  );
                })}
              </Grid>
              {panel.alerts.map((alert) => (
                <StateLine key={`${alert.metric}:${alert.percent}`} tone="attention">
                  {t(alert.percent >= 100 ? "billing-usage-alert-full" : "billing-usage-alert", {
                    percent: alert.percent,
                    what: t(METRIC_KEY[alert.metric]),
                    day: day(alert.at),
                  })}
                </StateLine>
              ))}
              <StateLine tone={panel.flightMonitor ? "done" : "info"}>
                {panel.flightMonitor ? t("billing-usage-flight-on") : t("billing-usage-flight-off")}
              </StateLine>
            </>
          )}
        </CardContent>
      </Card>
    </Grid>
  );
}
