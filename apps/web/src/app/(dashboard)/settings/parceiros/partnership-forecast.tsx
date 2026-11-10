"use client";

import { useTranslations } from "next-intl";

import { Box, Grid, Typography } from "@mui/material";

import MetricBars from "@/components/product/metric-bars";
import TrendSparkline from "@/components/product/trend-sparkline";
import type { PartnershipForecast as Forecast, PartnershipPassengers } from "@/lib/partners/partner";

/** A day as the screen says it ("02/11/2026"), from "YYYY-MM-DD", never moved by a time zone. */
const dayOf = (value: string) => {
  const [year, month, date] = value.split("-");
  return `${date}/${month}/${year}`;
};

/**
 * What the firm foresees of a partnership (the owner, 2026-11-03): how many of the agency's passengers agreed that
 * ONE follows their flights, and from when; how many trips ONE follows now and fly in the next days; how many legs
 * are in the air; and how many passengers were told of a problem and have not answered, each a case that may come.
 * In numbers; a passenger's data reach the firm with their yes to the agreement (0171), as a lead in Pessoas. Above
 * them, the agency's passengers by the firm's numbers: registered, without agreement, leads and cases.
 */
export default function PartnershipForecast({
  forecast,
  passengers = null,
  days,
}: {
  forecast: Forecast;
  passengers?: PartnershipPassengers | null;
  days: number;
}) {
  const t = useTranslations("product");
  const soon = forecast.days.reduce((sum, day) => sum + day.trips, 0);
  return (
    <Box component="section" aria-label={t("partners-forecast-title")} className="flex flex-col gap-3">
      <Box className="flex flex-col gap-1">
        <Typography variant="subtitle2" component="h3" className="mb-0">
          {t("partners-forecast-title")}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {t("partners-forecast-body")}
        </Typography>
      </Box>
      {passengers && passengers.registered > 0 ? (
        <MetricBars
          whole={false}
          spacing="dense"
          items={[
            { key: "registered", label: t("partners-passengers-registered"), value: passengers.registered },
            { key: "unagreed", label: t("partners-passengers-unagreed"), value: passengers.unagreed },
            {
              key: "leads",
              label: t("partners-passengers-leads"),
              hint: t("partners-passengers-leads-hint"),
              value: passengers.leads,
            },
            { key: "converted", label: t("partners-passengers-converted"), value: passengers.converted },
          ]}
        />
      ) : null}
      {forecast.agreed === 0 && forecast.followed === 0 ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("partners-forecast-none")}
        </Typography>
      ) : (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <MetricBars
              whole={false}
              spacing="dense"
              items={[
                {
                  key: "agreed",
                  label: t("partners-forecast-agreed"),
                  hint: forecast.agreedSince
                    ? t("partners-forecast-agreed-since", { date: dayOf(forecast.agreedSince) })
                    : undefined,
                  value: forecast.agreed,
                },
                { key: "followed", label: t("partners-forecast-followed"), value: forecast.followed },
                { key: "soon", label: t("partners-forecast-soon", { days }), value: soon },
                { key: "in-air", label: t("partners-forecast-in-air"), value: forecast.inAir },
                {
                  key: "alerted",
                  label: t("partners-forecast-alerted"),
                  hint: t("partners-forecast-alerted-hint"),
                  value: forecast.alerted,
                },
              ]}
            />
          </Grid>
          {forecast.agreedWeeks.length > 0 && (
            <Grid size={{ xs: 12, md: 6 }}>
              <TrendSparkline
                label={t("partners-forecast-weeks")}
                data={forecast.agreedWeeks.map((week) => week.agreed)}
                caption={t("partners-forecast-weeks-caption", { weeks: forecast.agreedWeeks.length })}
              />
            </Grid>
          )}
        </Grid>
      )}
    </Box>
  );
}
