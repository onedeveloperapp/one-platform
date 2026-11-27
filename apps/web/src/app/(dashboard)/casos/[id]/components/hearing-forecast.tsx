"use client";

import { useCaseForecast } from "./use-forecast";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Typography } from "@mui/material";

import CurrencyField from "@/components/product/fields/currency-field";
import SectionTitle from "@/components/product/section-title";
import StateLine from "@/components/product/state-line";
import ValueRange from "@/components/product/value-range";
import { type CaseForecast, type Forecast, hasForecast, offerPlace, shareWords } from "@/lib/jurimetrics/forecast";
import { brl } from "@/lib/jurimetrics/profile";

const PLACE_KEY = {
  unit: "forecast-place-unit",
  place: "forecast-place-place",
  comarca: "forecast-place-comarca",
  court: "forecast-place-court",
} as const;

/**
 * The forecast made preparation, under the next hearing (0250, approved by the owner on 2026-11-14): what the airline
 * does at that place (its settlements, the lawsuits extinguished and why), what going on with the lawsuit is worth on
 * average, and where an offer falls among what the court usually sets. ONE places the offer and recommends nothing:
 * the client decides, with the lawyer. A lawsuit with no forecast draws nothing.
 */
export default function HearingForecast({
  proceedingId,
  version,
  airlines,
}: {
  proceedingId: string;
  version: string;
  airlines: { iata: string; name: string }[];
}) {
  const read = useCaseForecast(proceedingId, version);
  if (read.state !== "ready" || !hasForecast(read.read)) return null;
  return <HearingForecastView read={read.read} airlines={airlines} />;
}

/** What the hearing's block draws from the lawsuit's forecast, apart from its reading. */
export function HearingForecastView({
  read,
  airlines,
}: {
  read: CaseForecast & { forecast: Forecast };
  airlines: { iata: string; name: string }[];
}) {
  const t = useTranslations("product");
  const [offer, setOffer] = useState("");
  const proceedingId = read.proceedingId;
  const { forecast, hearing, expectedCents, claimants } = read;
  const airline = airlines.find((item) => item.iata === read.airline)?.name ?? null;
  const offerCents = Number.isFinite(Number(offer)) && Number(offer) > 0 ? Math.round(Number(offer) * 100) : null;
  // An offer for several claimants is placed by what each one would get.
  const each = offerCents !== null ? Math.round(offerCents / Math.max(claimants, 1)) : null;
  const place = offerPlace(forecast.moral.values, each);
  const share = place ? shareWords(place.atOrAbove, place.of) : null;
  const median = forecast.moral.median;
  const settles = hearing && hearing.decisions > 0 ? hearing.acordo / hearing.decisions : null;
  const absent = hearing?.reasons.ausencia_autor ?? 0;
  const forClaimants = claimants > 1 ? t("forecast-hearing-expected-claimants", { count: claimants }) : null;

  return (
    <Box className="border-grey-100 flex flex-col gap-3 rounded-xl border p-3">
      <SectionTitle
        id={`hearing-forecast-${proceedingId}`}
        title={t("forecast-hearing-title")}
        description={t("forecast-hearing-hint")}
        as="h4"
        variant="subtitle2"
      />
      <Box className="@container">
        <Box className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
          {hearing ? (
            <Box className="flex flex-col gap-1">
              <Typography variant="caption" className="text-text-secondary font-semibold">
                {airline ? t("forecast-hearing-settle-title", { airline }) : t("forecast-hearing-settle-title-any")}
              </Typography>
              <Typography variant="h5" component="p" className="mb-0 tabular-nums">
                {`${Math.round((settles ?? 0) * 100)}%`}
              </Typography>
              <Typography variant="body2" className="text-text-primary">
                {t("forecast-hearing-settle", {
                  count: hearing.acordo,
                  total: hearing.decisions,
                  place: t(PLACE_KEY[hearing.level], { kind: read.kind ?? "other" }),
                })}
              </Typography>
              {settles !== null && settles < 0.03 ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("forecast-hearing-settle-rare")}
                </Typography>
              ) : null}
            </Box>
          ) : null}
          {hearing ? (
            <Box className="flex flex-col gap-1">
              <Typography variant="caption" className="text-text-secondary font-semibold">
                {t("forecast-hearing-extinct-title")}
              </Typography>
              <Typography variant="h5" component="p" className="mb-0 tabular-nums">
                {`${hearing.decisions > 0 ? Math.round((100 * hearing.extinto) / hearing.decisions) : 0}%`}
              </Typography>
              <Typography variant="body2" className="text-text-primary">
                {t("forecast-hearing-extinct", {
                  count: hearing.extinto,
                  total: hearing.decisions,
                  place: t(PLACE_KEY[hearing.level], { kind: read.kind ?? "other" }),
                })}
              </Typography>
              {absent > 0 ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("forecast-hearing-absent", { count: absent })}
                </Typography>
              ) : null}
            </Box>
          ) : null}
          {expectedCents !== null && median !== null ? (
            <Box className="flex flex-col gap-1">
              <Typography variant="caption" className="text-text-secondary font-semibold">
                {t("forecast-hearing-expected-title")}
              </Typography>
              <Typography variant="h5" component="p" className="text-primary mb-0 tabular-nums">
                {brl(expectedCents)}
              </Typography>
              <Typography variant="body2" className="text-text-primary">
                {t("forecast-hearing-expected-how", { percent: forecast.chancePercent ?? 0, median: brl(median) })}
                {forClaimants ? ` ${forClaimants}` : ""}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("forecast-hearing-expected-left")}
              </Typography>
            </Box>
          ) : null}
        </Box>
      </Box>

      {median !== null &&
      forecast.moral.p25 !== null &&
      forecast.moral.p75 !== null &&
      forecast.moral.values.length > 0 ? (
        <Box className="bg-grey-25 flex flex-col gap-2 rounded-lg p-3">
          <SectionTitle
            id={`hearing-offer-${proceedingId}`}
            title={t("forecast-offer-title")}
            description={t("forecast-offer-hint")}
            as="h4"
            variant="subtitle2"
          />
          <Box className="flex flex-row flex-wrap items-end gap-4">
            <CurrencyField
              id={`hearing-offer-value-${proceedingId}`}
              label={t("forecast-offer-label")}
              currencySymbol="R$"
              size="small"
              value={offer}
              onChange={(event) => setOffer(event.target.value)}
              className="w-56"
            />
            <ValueRange
              className="min-w-64 flex-1"
              low={forecast.moral.p25}
              median={median}
              high={forecast.moral.p75}
              marker={each !== null ? { cents: each, label: t("forecast-offer-marker") } : null}
              format={brl}
              caption={t("forecast-value-band")}
              ariaLabel={t("forecast-value-aria", {
                median: brl(median),
                low: brl(forecast.moral.p25),
                high: brl(forecast.moral.p75),
              })}
            />
          </Box>
          {place && each !== null ? (
            <Box className="flex flex-col gap-1">
              <StateLine tone={place.atOrAbove * 2 > place.of ? "attention" : "info"}>
                {place.atOrAbove === place.of
                  ? t("forecast-offer-below-all", { total: place.of, value: brl(each) })
                  : share && place.atOrAbove * 2 > place.of
                    ? t("forecast-offer-below", {
                        part: share.part,
                        of: share.of,
                        count: place.atOrAbove,
                        total: place.of,
                        value: brl(each),
                      })
                    : t("forecast-offer-share", { count: place.atOrAbove, total: place.of, value: brl(each) })}
              </StateLine>
              {claimants > 1 ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("forecast-offer-each", { count: claimants, value: brl(each) })}
                </Typography>
              ) : null}
              {expectedCents !== null && offerCents !== null && offerCents !== expectedCents ? (
                <Typography variant="body2" className="text-text-secondary">
                  {offerCents < expectedCents
                    ? t("forecast-offer-less", { value: brl(expectedCents - offerCents), expected: brl(expectedCents) })
                    : t("forecast-offer-more", {
                        value: brl(offerCents - expectedCents),
                        expected: brl(expectedCents),
                      })}
                </Typography>
              ) : null}
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
