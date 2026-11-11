"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Alert, Button } from "@mui/material";

import type { SecondFactorState } from "@/lib/ai/approvals";

/**
 * Why a page of the firm's settings is read only now, with the way out where there is one: a support visit, a person
 * who does not decide for the firm, or a session with no second factor (activated in Segurança, or confirmed and back
 * to `next`). Nothing when the person may change what the page holds. One notice for every page whose choices are
 * who decides for the firm's (0078): `/settings/autonomia`, `/settings/regras` and each module's settings.
 */
export default function DecidesNotice({
  decides,
  supportVisit,
  secondFactor,
  next,
}: {
  decides: boolean;
  supportVisit: boolean;
  secondFactor: SecondFactorState;
  /** The page the second factor confirmed comes back to. */
  next: string;
}) {
  const t = useTranslations("product");
  if (supportVisit) {
    return (
      <Alert severity="info" className="neutral bg-background-paper/60!">
        {t("autonomy-support-visit")}
      </Alert>
    );
  }
  if (!decides) {
    return (
      <Alert severity="info" className="neutral bg-background-paper/60!">
        {t("autonomy-partner-only")}
      </Alert>
    );
  }
  if (secondFactor === "missing") {
    return (
      <Alert
        severity="warning"
        className="neutral bg-background-paper/60!"
        action={
          <Button color="inherit" size="small" href="/settings/security" LinkComponent={Link}>
            {t("autonomy-second-factor-missing-action")}
          </Button>
        }
      >
        {t("autonomy-second-factor-missing")}
      </Alert>
    );
  }
  if (secondFactor === "challenge") {
    return (
      <Alert
        severity="warning"
        className="neutral bg-background-paper/60!"
        action={
          <Button
            color="inherit"
            size="small"
            href={`/auth/two-factor?next=${encodeURIComponent(next)}`}
            LinkComponent={Link}
          >
            {t("autonomy-second-factor-challenge-action")}
          </Button>
        }
      >
        {t("autonomy-second-factor-challenge")}
      </Alert>
    );
  }
  return null;
}
