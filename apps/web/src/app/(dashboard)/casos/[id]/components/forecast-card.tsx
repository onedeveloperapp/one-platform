"use client";

import type { CaseProceeding } from "../case-types";
import { useCaseForecast } from "./use-forecast";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Box, Button, Link, Skeleton, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";

import InfoHint from "@/components/product/info-hint";
import MetricBars, { type MetricBarItem } from "@/components/product/metric-bars";
import RatioGauge from "@/components/product/ratio-gauge";
import SectionTitle from "@/components/product/section-title";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import TrendSparkline from "@/components/product/trend-sparkline";
import ValueRange from "@/components/product/value-range";
import NiTelescope from "@/icons/nexture/ni-telescope";
import {
  type CaseForecast,
  type Forecast,
  type ForecastCut,
  hasForecast,
  monthlyChance,
} from "@/lib/jurimetrics/forecast";
import { brl, MARKET_PROBLEM_KEY } from "@/lib/jurimetrics/profile";

type T = ReturnType<typeof useTranslations<"product">>;

const BASE_TONE = { solida: "positive", media: "info", pequena: "attention" } as const;
const KIND_KEY = { juizado: "forecast-proceeding-juizado", comum: "forecast-proceeding-comum" } as const;
const BASE_KEY = {
  solida: "forecast-base-solida",
  media: "forecast-base-media",
  pequena: "forecast-base-pequena",
} as const;

/** A date the database wrote (YYYY-MM-DD) as a person reads it. */
export const dayWords = (iso: string | null): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
};

/** Where a cut was read, in the words of the case: the judge, the unit, the comarca, the court or every court. */
export function whereWords(t: T, cut: ForecastCut, courts: string[]): string {
  if (cut.level === "judge" && cut.judge) return t("forecast-where-judge", { judge: cut.judge });
  if (cut.level === "unit" && cut.unit) return cut.unit;
  if (cut.level === "comarca" && cut.comarca) return t("forecast-where-comarca", { comarca: cut.comarca });
  if (cut.level === "court" && cut.court) return t("forecast-where-court", { court: cut.court });
  return t("forecast-where-all", { courts: courts.join(", ") });
}

/** What a cut is of: where, against which airline (or every one), and the problem. */
export function cutWords(t: T, forecast: Forecast, airlineName: string | null): string {
  const where = whereWords(t, forecast.cut, forecast.courts);
  const problem = t(MARKET_PROBLEM_KEY[forecast.cut.problem] ?? "market-problem-other");
  if (forecast.cut.airline && airlineName)
    return t("forecast-detail-airline", { where, airline: airlineName, problem });
  return t("forecast-detail-every-airline", { where, problem });
}

/**
 * The forecast of the case (0250, approved by the owner on 2026-11-14): what the market decided in lawsuits like this
 * one, from the cut nearest the case with the sample, for the firm alone, never on the client's page; never to choose
 * a judge, who is read only of a lawsuit already filed. At the side of the case's top since the owner's canvas
 * "ONE · O caso em abas" (2026-11-25): three numbers,
 * the chance as a ring, what usually comes of it per claimant and the base it rests on, and the rest one click away in
 * a panel beside the case, so the top and its tabs fit the first screen. Nothing when the case's lawsuits have nothing
 * to say; a read that failed says so.
 */
export function ForecastSummary({
  proceedings,
  airlines,
}: {
  proceedings: CaseProceeding[];
  airlines: { iata: string; name: string }[];
}) {
  const t = useTranslations("product");
  const open = useMemo(() => proceedings.filter((item) => item.status !== "closed" && item.court), [proceedings]);
  const [picked, setPicked] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  const current = open.find((item) => item.id === picked) ?? open[0] ?? null;
  const version = current ? `${current.status}|${current.unit ?? ""}|${current.cnj ?? ""}` : "";
  const read = useCaseForecast(current?.id ?? null, version);
  if (!current) return null;
  if (read.state === "loading") return <Skeleton variant="rounded" height={150} />;
  if (read.state === "error") {
    return (
      <Box component="section" aria-labelledby="case-forecast" className="flex flex-col gap-2">
        <Typography id="case-forecast" variant="subtitle2" component="h3" className="mb-0">
          {t("forecast-title")}
        </Typography>
        <StateLine tone="failed">{t("forecast-error")}</StateLine>
      </Box>
    );
  }
  if (!hasForecast(read.read)) return null;
  const forecastRead = read.read;
  const forecast = forecastRead.forecast;
  const airlineName = airlines.find((item) => item.iata === forecastRead.airline)?.name ?? forecastRead.airline;
  const toggle =
    open.length > 1 ? (
      <ToggleButtonGroup
        exclusive
        size="small"
        value={current.id}
        onChange={(_, value) => value && setPicked(value)}
        aria-label={t("forecast-proceedings")}
      >
        {open.map((item) => (
          <ToggleButton key={item.id} value={item.id}>
            {t(KIND_KEY[item.kind])}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    ) : null;
  const moral = forecast.moral;
  return (
    <Box component="section" aria-labelledby="case-forecast" className="flex flex-col gap-3">
      <Box className="flex flex-wrap items-center justify-between gap-2">
        <Box className="flex items-center gap-1">
          <Typography id="case-forecast" variant="subtitle2" component="h3" className="mb-0">
            {t("forecast-title")}
          </Typography>
          <InfoHint label={t("forecast-description")} />
        </Box>
        <StatusChip tone={BASE_TONE[forecast.base]} label={t(BASE_KEY[forecast.base], { count: forecast.decisions })} />
      </Box>
      {toggle}
      <Box className="flex flex-row items-center gap-3">
        <RatioGauge
          value={forecast.won}
          total={forecast.merits}
          size={56}
          label={t("forecast-chance-gauge", { percent: forecast.chancePercent ?? 0 })}
        />
        <Box className="flex min-w-0 flex-col">
          <Typography variant="h6" component="p" className="text-primary mb-0 tabular-nums">
            {t("forecast-summary-chance", { percent: forecast.chancePercent ?? 0 })}
          </Typography>
          <Typography variant="caption" className="text-text-secondary">
            {t("forecast-chance-merits", { won: forecast.won, merits: forecast.merits })}
          </Typography>
        </Box>
      </Box>
      {moral.median !== null ? (
        <Box className="flex flex-col">
          <Typography variant="body2">
            <strong className="tabular-nums">{brl(moral.median)}</strong> {t("forecast-summary-value")}
          </Typography>
          {moral.p25 !== null && moral.p75 !== null ? (
            <Typography variant="caption" className="text-text-secondary">
              {t("forecast-summary-band", { low: brl(moral.p25), high: brl(moral.p75) })}
            </Typography>
          ) : null}
        </Box>
      ) : null}
      <Button variant="text" size="small" className="self-start" onClick={() => setPanel(true)}>
        {t("forecast-see-all")}
      </Button>
      {panel ? (
        <SidePanel
          onClose={() => setPanel(false)}
          closeLabel={t("forecast-close")}
          title={t("forecast-title")}
          description={cutWords(t, forecast, airlineName)}
          icon={<NiTelescope size="medium" />}
          wide
        >
          <Box className="flex flex-col gap-4">
            <StatusChip
              tone={BASE_TONE[forecast.base]}
              label={t(BASE_KEY[forecast.base], { count: forecast.decisions })}
              className="self-start"
            />
            {toggle}
            <ForecastBody read={forecastRead} forecast={forecast} airlineName={airlineName} />
          </Box>
        </SidePanel>
      ) : null}
    </Box>
  );
}

function ForecastBody({
  read,
  forecast,
  airlineName,
}: {
  read: CaseForecast;
  forecast: Forecast;
  airlineName: string | null;
}) {
  const t = useTranslations("product");
  const trend = monthlyChance(forecast.months);
  const used = forecast.cut.level;
  return (
    <Box className="flex flex-col gap-4">
      <Box className="@container">
        <Box className="grid grid-cols-1 gap-3 @2xl:grid-cols-3">
          <Box className="border-grey-100 flex flex-row items-center gap-4 rounded-xl border p-4">
            <RatioGauge
              value={forecast.won}
              total={forecast.merits}
              size={104}
              label={t("forecast-chance-gauge", { percent: forecast.chancePercent ?? 0 })}
            />
            <Box className="flex min-w-0 flex-col gap-1">
              <Typography variant="subtitle1" component="h3" className="mb-0">
                {t("forecast-chance-title")}
              </Typography>
              <Typography variant="h4" component="p" className="text-primary mb-0 tabular-nums">
                {`${forecast.chancePercent}%`}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("forecast-chance-merits", { won: forecast.won, merits: forecast.merits })}
              </Typography>
              {forecast.outcomes.parcial > forecast.outcomes.procedente ? (
                <Typography variant="body2" className="text-text-primary">
                  {t("forecast-chance-partial", {
                    partial: forecast.outcomes.parcial,
                    full: forecast.outcomes.procedente,
                  })}
                </Typography>
              ) : null}
            </Box>
          </Box>

          <Box className="border-grey-100 flex flex-col gap-2 rounded-xl border p-4">
            <Typography variant="subtitle1" component="h3" className="mb-0">
              {t("forecast-value-title")}
            </Typography>
            {forecast.moral.median !== null && forecast.moral.p25 !== null && forecast.moral.p75 !== null ? (
              <>
                <Box className="flex flex-row flex-wrap items-baseline gap-x-2">
                  <Typography variant="h4" component="p" className="text-primary mb-0 tabular-nums">
                    {brl(forecast.moral.median)}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary">
                    {t("forecast-value-unit")}
                  </Typography>
                </Box>
                <ValueRange
                  low={forecast.moral.p25}
                  median={forecast.moral.median}
                  high={forecast.moral.p75}
                  format={brl}
                  caption={t("forecast-value-band")}
                  ariaLabel={t("forecast-value-aria", {
                    median: brl(forecast.moral.median),
                    low: brl(forecast.moral.p25),
                    high: brl(forecast.moral.p75),
                  })}
                />
                <Typography variant="caption" className="text-text-secondary">
                  {t("forecast-value-count", { count: forecast.moral.n })}
                </Typography>
              </>
            ) : (
              <Typography variant="body2" className="text-text-secondary">
                {t("forecast-value-few")}
              </Typography>
            )}
          </Box>

          <Box className="border-grey-100 flex flex-col gap-3 rounded-xl border p-4">
            <Typography variant="subtitle1" component="h3" className="mb-0">
              {t("forecast-ends-title")}
            </Typography>
            <MetricBars
              spacing="dense"
              total={forecast.decisions}
              items={
                [
                  {
                    key: "parcial",
                    label: t("forecast-ends-parcial"),
                    value: forecast.outcomes.parcial,
                    tone: "primary",
                  },
                  {
                    key: "procedente",
                    label: t("forecast-ends-procedente"),
                    value: forecast.outcomes.procedente,
                    tone: "secondary",
                  },
                  {
                    key: "improcedente",
                    label: t("forecast-ends-improcedente"),
                    value: forecast.outcomes.improcedente,
                    tone: "empty",
                  },
                  {
                    key: "extinto",
                    label: t("forecast-ends-extinto"),
                    value: forecast.outcomes.extinto,
                    tone: "attention",
                  },
                  {
                    key: "acordo",
                    label: t("forecast-ends-acordo"),
                    value: forecast.outcomes.acordo,
                    tone: "secondary",
                  },
                ].filter((item) => item.value > 0 || item.key === "acordo") as MetricBarItem[]
              }
            />
          </Box>
        </Box>
        <Box className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
          {read.levels.length > 1 ? (
            <Box className="border-grey-100 flex flex-col gap-3 rounded-xl border p-4">
              <SectionTitle
                id="case-forecast-levels"
                title={t("forecast-levels-title")}
                description={t("forecast-levels-hint")}
                as="h3"
                variant="subtitle1"
              />
              <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                {read.levels.map((row) => (
                  <Box component="li" key={row.level} className="flex flex-row items-center gap-3">
                    {row.chancePercent !== null ? (
                      <RatioGauge
                        value={row.won}
                        total={row.merits}
                        size={44}
                        tone={row.level === used ? "primary" : "secondary"}
                        label={t("forecast-chance-gauge", { percent: row.chancePercent })}
                      />
                    ) : null}
                    <Box className="flex min-w-0 flex-1 flex-col">
                      <Typography variant="subtitle2" className="text-text-primary">
                        {levelWords(t, row.level, row.cut, airlineName)}
                        {row.level === used ? (
                          <Typography component="span" variant="caption" className="text-text-secondary ms-2">
                            {t("forecast-level-used")}
                          </Typography>
                        ) : null}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary">
                        {row.median !== null
                          ? t("forecast-level-detail", { won: row.won, merits: row.merits, value: brl(row.median) })
                          : t("forecast-level-detail-novalue", { won: row.won, merits: row.merits })}
                      </Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          ) : null}

          {trend.length >= 3 ? (
            <Box className="border-grey-100 rounded-xl border p-4">
              <TrendSparkline
                label={t("forecast-trend-title")}
                data={trend.map((item) => item.percent)}
                plotType="line"
                formatValue={(value) => `${value}%`}
                caption={t("forecast-trend-caption", {
                  first: trend[0].percent,
                  last: trend[trend.length - 1].percent,
                })}
              />
            </Box>
          ) : null}
        </Box>
      </Box>

      {read.stage === "before" ? <StateLine tone="info">{t("forecast-before")}</StateLine> : null}

      <Box className="border-grey-100 flex flex-row flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3">
        <Typography variant="caption" className="text-text-secondary flex-1">
          {t("forecast-foot", { count: forecast.decisions, from: dayWords(forecast.from), to: dayWords(forecast.to) })}
        </Typography>
        <Link href="/numeros#numbers-market" variant="body2" underline="hover" className="font-semibold">
          {t("forecast-see-units")}
        </Link>
      </Box>
    </Box>
  );
}

/** A level's name beside the forecast: who judges, the unit, the comarca or the court, with the airline when cut by it. */
function levelWords(t: T, level: string, cut: ForecastCut, airlineName: string | null): string {
  const airline = cut.airline && airlineName ? t("forecast-level-airline", { airline: airlineName }) : "";
  if (level === "judge" && cut.judge) return t("forecast-level-judge", { judge: cut.judge, airline });
  if (level === "unit") return t("forecast-level-unit", { airline });
  if (level === "comarca" && cut.comarca) return t("forecast-level-comarca", { comarca: cut.comarca, airline });
  if (level === "court" && cut.court) return t("forecast-level-court", { court: cut.court, airline });
  return t("forecast-level-all", { airline });
}
