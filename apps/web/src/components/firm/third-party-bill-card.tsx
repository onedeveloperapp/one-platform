"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Card, CardContent, FormControlLabel, Radio, RadioGroup, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiHome from "@/icons/nexture/ni-home";
import { setThirdPartyBill, type ThirdPartyBillPolicy } from "@/lib/firm/third-party-bill-actions";

/** How many filing packages of the month carry a bill in somebody else's name (0123), of how many. */
export type ThirdPartyMonth = { packages: number; thirdParty: number };

const ERROR_KEY: Record<string, string> = {
  not_allowed: "third-party-error-not-allowed",
  support_visit: "third-party-error-support",
};

/**
 * Whether the firm accepts a proof of address in somebody else's name (migration 0123): with the client's declaration
 * of residence, which ONE issues and sends to sign and which goes to the court with the bill (the plan's choice, the
 * default), or asking every client for one in their own name. Who decides for the firm chooses, and reads how many
 * filing packages of the month carry such a bill (a sign the CNJ's Recomendação 159/2024 names); anybody else reads
 * how the firm works.
 */
export default function ThirdPartyBillCard({
  policy,
  decides,
  supportVisit,
  month,
  onSaved,
}: {
  policy: ThirdPartyBillPolicy;
  decides: boolean;
  supportVisit: boolean;
  /** Only for who decides for the firm; null otherwise or when it could not be read. */
  month: ThirdPartyMonth | null;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [choice, setChoice] = useState<ThirdPartyBillPolicy>(policy);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const mayChange = decides && !supportVisit;
  const chipKey = choice === "accept" ? "third-party-chip-accept" : "third-party-chip-refuse";

  const choose = async (next: ThirdPartyBillPolicy) => {
    if (next === choice || !mayChange) return;
    const before = choice;
    setChoice(next);
    setBusy(true);
    setProblem(null);
    try {
      const result = await setThirdPartyBill(next);
      if (result.ok) onSaved();
      else {
        setChoice(before);
        setProblem(result.code);
      }
    } catch {
      setChoice(before);
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card id="conta-de-terceiro" component="section" aria-labelledby="third-party-title">
      <CardContent className="flex flex-col gap-4">
        <CardTitle
          id="third-party-title"
          icon={<NiHome size="medium" />}
          tone="accent-1"
          title={t("third-party-title")}
          description={t("third-party-body")}
          chip={<StatusChip tone={choice === "accept" ? "positive" : "neutral"} label={t(chipKey)} />}
        />
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
            {t(ERROR_KEY[problem] ?? "third-party-error-failed")}
          </Alert>
        ) : null}
        <RadioGroup
          aria-labelledby="third-party-title"
          name="third-party-bill"
          value={choice}
          onChange={(event) => void choose(event.target.value as ThirdPartyBillPolicy)}
        >
          <FormControlLabel
            value="accept"
            disabled={!mayChange || busy}
            control={<Radio />}
            label={
              <Box className="flex flex-col py-1">
                <Typography variant="body2" className="font-semibold">
                  {t("third-party-accept")}
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {t("third-party-accept-help")}
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            value="refuse"
            disabled={!mayChange || busy}
            control={<Radio />}
            label={
              <Box className="flex flex-col py-1">
                <Typography variant="body2" className="font-semibold">
                  {t("third-party-refuse")}
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {t("third-party-refuse-help")}
                </Typography>
              </Box>
            }
          />
        </RadioGroup>
        <StateLine tone="info">{t("third-party-risk")}</StateLine>
        {month && month.packages > 0 ? (
          <StateLine tone="info">
            {t("third-party-month", { count: month.thirdParty, packages: month.packages })}
          </StateLine>
        ) : null}
        {!mayChange ? (
          <Typography variant="body2" className="text-text-secondary">
            {supportVisit ? t("third-party-error-support") : t("third-party-who")}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}
