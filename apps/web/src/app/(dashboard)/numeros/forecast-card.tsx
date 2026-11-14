"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Box, Card, CardContent, Skeleton, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import MetricBars from "@/components/product/metric-bars";
import NumberCard from "@/components/product/number-card";
import RatioGauge from "@/components/product/ratio-gauge";
import SectionTitle from "@/components/product/section-title";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiMoney from "@/icons/nexture/ni-money";
import NiTelescope from "@/icons/nexture/ni-telescope";
import { type FirmForecast, readFirmForecast } from "@/lib/jurimetrics/actions";
import { brl } from "@/lib/jurimetrics/profile";

type Read = { state: "loading" } | { state: "error" } | { state: "ready"; forecast: FirmForecast | null };

/**
 * The firm's forecast (0250, approved by the owner on 2026-11-14): the open lawsuits the market can forecast, what
 * their clients may expect in all (the clients' money, never the firm's revenue), by band of chance and by airline;
 * and how the forecast came out, each lawsuit's forecast when it was filed beside its judgment, once there are five.
 * It says whether it counts the test cases. A failed read is said as such.
 */
export default function FirmForecastCard({ tests }: { tests: boolean }) {
  const [read, setRead] = useState<Read>({ state: "loading" });
  useEffect(() => {
    let live = true;
    readFirmForecast(tests)
      .then((forecast) => live && setRead({ state: "ready", forecast }))
      .catch(() => live && setRead({ state: "error" }));
    return () => {
      live = false;
    };
  }, [tests]);

  if (read.state === "loading") return <Skeleton variant="rounded" height={260} />;
  return (
    <FirmForecastView
      tests={tests}
      forecast={read.state === "ready" ? read.forecast : null}
      failed={read.state === "error"}
    />
  );
}

/** The firm's forecast drawn from what the database answered, apart from its reading. */
export function FirmForecastView({
  tests,
  forecast: answer,
  failed,
}: {
  tests: boolean;
  forecast: FirmForecast | null;
  failed: boolean;
}) {
  const t = useTranslations("product");
  const head = (
    <CardTitle
      id="numbers-forecast"
      icon={<NiTelescope size="medium" />}
      title={t("numbers-forecast-title")}
      description={t("numbers-forecast-description")}
      chip={
        <StatusChip tone="neutral" label={tests ? t("numbers-forecast-tests-in") : t("numbers-forecast-tests-out")} />
      }
    />
  );
  if (failed || !answer) {
    const words = failed ? t("numbers-forecast-error") : t("numbers-forecast-none");
    return (
      <Card component="section" aria-labelledby="numbers-forecast">
        <CardContent className="flex flex-col gap-3">
          {head}
          <StateLine tone={failed ? "failed" : "info"}>{words}</StateLine>
        </CardContent>
      </Card>
    );
  }
  const forecast = answer;
  const { accuracy } = forecast;
  return (
    <Card component="section" aria-labelledby="numbers-forecast">
      <CardContent className="flex flex-col gap-4">
        {head}
        {forecast.withForecast === 0 ? (
          <StateLine tone="info">{t("numbers-forecast-none")}</StateLine>
        ) : (
          <Box className="@container">
            <Box className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
              <Box className="flex flex-col gap-3">
                <Box className="grid grid-cols-2 gap-3">
                  <NumberCard
                    icon={<NiTelescope size="medium" />}
                    tone="primary"
                    label={t("numbers-forecast-lawsuits")}
                    value={String(forecast.withForecast)}
                    hint={
                      forecast.withoutForecast > 0
                        ? t("numbers-forecast-without", { count: forecast.withoutForecast })
                        : undefined
                    }
                  />
                  <NumberCard
                    icon={<NiMoney size="medium" />}
                    tone="accent-2"
                    label={t("numbers-forecast-expected")}
                    value={brl(forecast.expectedCents)}
                    hint={t("numbers-forecast-expected-hint")}
                  />
                </Box>
                <SectionTitle
                  id="numbers-forecast-bands"
                  title={t("numbers-forecast-bands")}
                  as="h3"
                  variant="subtitle1"
                />
                <MetricBars
                  spacing="dense"
                  items={[
                    {
                      key: "high",
                      label: t("numbers-forecast-band-high"),
                      value: forecast.bands.high,
                      tone: "primary",
                    },
                    { key: "mid", label: t("numbers-forecast-band-mid"), value: forecast.bands.mid, tone: "secondary" },
                    { key: "low", label: t("numbers-forecast-band-low"), value: forecast.bands.low, tone: "attention" },
                  ]}
                />
                {forecast.airlines.length > 0 ? (
                  <>
                    <SectionTitle
                      id="numbers-forecast-airlines"
                      title={t("numbers-forecast-airlines")}
                      as="h3"
                      variant="subtitle1"
                    />
                    <MetricBars
                      spacing="dense"
                      items={forecast.airlines.map((item) => ({
                        key: item.airline ?? "none",
                        label: item.name ?? item.airline ?? t("numbers-forecast-airline-none"),
                        value: item.lawsuits,
                        hint: t("numbers-forecast-airline-expected", { value: brl(item.expectedCents) }),
                      }))}
                    />
                  </>
                ) : null}
              </Box>

              <Box className="border-grey-100 flex flex-col gap-3 rounded-xl border p-4">
                <SectionTitle
                  id="numbers-forecast-accuracy"
                  title={t("numbers-forecast-accuracy")}
                  description={t("numbers-forecast-accuracy-hint")}
                  as="h3"
                  variant="subtitle1"
                />
                {accuracy.judged >= accuracy.minSample ? (
                  <>
                    <Box className="flex flex-row items-center gap-4">
                      <RatioGauge
                        value={accuracy.asForecast}
                        total={accuracy.judged}
                        tone="accent-2"
                        size={88}
                        label={t("numbers-forecast-accuracy-gauge", {
                          count: accuracy.asForecast,
                          total: accuracy.judged,
                        })}
                      />
                      <Box className="flex flex-col gap-1">
                        <Typography variant="subtitle2" className="text-text-primary">
                          {t("numbers-forecast-accuracy-line", { count: accuracy.asForecast, total: accuracy.judged })}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          {t("numbers-forecast-accuracy-rule")}
                        </Typography>
                      </Box>
                    </Box>
                    {accuracy.forecastPercent !== null && accuracy.wonPercent !== null ? (
                      <StateLine tone="info" icon={<NiCheckSquare size="small" />}>
                        {t("numbers-forecast-accuracy-won", {
                          forecast: accuracy.forecastPercent,
                          won: accuracy.wonPercent,
                        })}
                      </StateLine>
                    ) : null}
                  </>
                ) : (
                  <StateLine tone="waiting">
                    {t("numbers-forecast-accuracy-few", { count: accuracy.judged, min: accuracy.minSample })}
                  </StateLine>
                )}
              </Box>
            </Box>
          </Box>
        )}
        <Typography variant="caption" className="text-text-secondary">
          {t("numbers-forecast-foot")}
        </Typography>
      </CardContent>
    </Card>
  );
}
