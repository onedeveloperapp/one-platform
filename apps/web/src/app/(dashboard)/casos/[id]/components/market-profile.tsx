"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, Typography } from "@mui/material";

import StateLine from "@/components/product/state-line";
import UsageMeter from "@/components/product/usage-meter";
import { type LawsuitMarket, readLawsuitMarket } from "@/lib/jurimetrics/actions";
import { brl, MARKET_PROBLEM_KEY, type MarketNumbers } from "@/lib/jurimetrics/profile";

/**
 * How a lawsuit's unit and its judge usually decide (migration 0190, phase 5): the market's public decisions, each
 * number with its sample and nothing of fewer than five said as a rate or a median, beside the whole court. Read when
 * asked; only to prepare the piece and to project, never to choose a judge.
 */
export default function MarketProfile({ proceedingId }: { proceedingId: string }) {
  const t = useTranslations("product");
  const [read, setRead] = useState<LawsuitMarket | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      setRead(await readLawsuitMarket(proceedingId));
    } catch {
      setRead({ ok: false, code: "failed" });
    } finally {
      setBusy(false);
    }
  };
  if (!read) {
    return (
      <Box>
        <Button variant="text" color="grey" size="small" className="-ml-2" disabled={busy} onClick={() => void load()}>
          {busy ? t("cases-working") : t("market-show")}
        </Button>
      </Box>
    );
  }
  if (!read.ok) return <StateLine tone="info">{t("market-error")}</StateLine>;
  return (
    <Box className="border-grey-100 bg-grey-25 flex flex-col gap-3 rounded-xl border p-3">
      {read.unit ? (
        <Numbers title={t("market-unit-title", { unit: read.unit })} numbers={read.unitNumbers} />
      ) : (
        <Typography variant="body2" className="text-text-secondary">
          {t("market-no-unit")}
        </Typography>
      )}
      {read.judge ? (
        <Numbers title={t("market-judge-title", { judge: read.judge })} numbers={read.judgeNumbers} />
      ) : null}
      <Numbers title={t("market-court-title")} numbers={read.courtNumbers} />
      <Typography variant="caption" className="text-text-secondary">
        {t("market-note")}
      </Typography>
    </Box>
  );
}

/** One set of the market's numbers: the success rate and the extinctions as meters, the medians by problem. */
function Numbers({ title, numbers }: { title: string; numbers: MarketNumbers | null }) {
  const t = useTranslations("product");
  if (!numbers) return null;
  const lost = Math.max(numbers.merits - numbers.won, 0);
  return (
    <Box className="flex flex-col gap-1.5">
      <Typography variant="subtitle2" component="h4">
        {title}
      </Typography>
      {numbers.decisions === 0 ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("market-none-read")}
        </Typography>
      ) : (
        <>
          {numbers.successPercent === null ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("market-success-few", { merits: numbers.merits, min: numbers.minSample })}
            </Typography>
          ) : (
            <UsageMeter
              headline={t("market-success-headline", { percent: numbers.successPercent })}
              caption={t("market-success-caption", { merits: numbers.merits })}
              ariaLabel={t("market-success-headline", { percent: numbers.successPercent })}
              segments={[
                {
                  key: "won",
                  label: t("market-won"),
                  value: numbers.won,
                  display: String(numbers.won),
                  tone: "primary",
                },
                { key: "lost", label: t("market-lost"), value: lost, display: String(lost), tone: "empty" },
              ]}
            />
          )}
          {numbers.moral
            .filter((item) => item.medianCents !== null)
            .map((item) => (
              <Typography key={item.problem} variant="body2" className="text-text-secondary">
                {t("market-moral", {
                  problem: t(MARKET_PROBLEM_KEY[item.problem] ?? "market-problem-other"),
                  value: brl(item.medianCents ?? 0),
                  count: item.n,
                })}
              </Typography>
            ))}
          {numbers.priorComplaintPercent !== null && numbers.priorComplaint > 0 ? (
            <UsageMeter
              headline={t("market-prior-headline", { percent: numbers.priorComplaintPercent })}
              caption={t("market-prior-caption")}
              ariaLabel={t("market-prior-headline", { percent: numbers.priorComplaintPercent })}
              segments={[
                {
                  key: "extinct",
                  label: t("market-prior-extinct"),
                  value: numbers.priorComplaint,
                  display: String(numbers.priorComplaint),
                  tone: "attention",
                },
                {
                  key: "rest",
                  label: t("market-prior-rest"),
                  value: numbers.decisions - numbers.priorComplaint,
                  display: String(numbers.decisions - numbers.priorComplaint),
                  tone: "empty",
                },
              ]}
            />
          ) : null}
          <Typography variant="caption" className="text-text-secondary">
            {t("market-sample", { count: numbers.decisions, from: numbers.from ?? "", to: numbers.to ?? "" })}
          </Typography>
        </>
      )}
    </Box>
  );
}
