"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, Typography } from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import SectionTitle from "@/components/product/section-title";
import StateLine, { type StateTone } from "@/components/product/state-line";
import type { CaseQualification } from "@/lib/cases/qualification";
import { MISSING_KEY, OUTCOME_KEY, REASON_KEY } from "@/lib/cases/qualification";
import { releaseQualification } from "@/lib/cases/rule-actions";

const TONE: Record<CaseQualification["outcome"], StateTone> = {
  qualifies: "done",
  not_qualified: "attention",
  pending: "waiting",
  review: "attention",
};

/**
 * Whether the case's problem qualifies (migration 0147): the rule's word, said
 * as ONE's that may err, with its reasons; what it still needs to decide; and,
 * for a partner or a lawyer, going on with a case it did not qualify (or left
 * to a person), with the reason. Nothing shows before ONE ran the rule.
 */
export default function QualificationBlock({
  caseId,
  qualification,
  mayRelease,
  onChanged,
}: {
  caseId: string;
  qualification: CaseQualification | null | undefined;
  /** A partner or a lawyer of the firm, outside a support visit. */
  mayRelease: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [asking, setAsking] = useState(false);
  if (!qualification) return null;

  const reasons = qualification.reasons.map((reason) => t(REASON_KEY[reason])).join(" ");
  const missing = qualification.missing
    .map((item) => (MISSING_KEY[item] ? t(MISSING_KEY[item]) : null))
    .filter(Boolean)
    .join(", ");
  const holds = qualification.outcome === "not_qualified" || qualification.outcome === "review";
  // A rule that could not decide yet says what it needs, never a reason it has not reached.
  const pending = qualification.outcome === "pending";
  const needs = pending && missing ? t("qualification-needs", { missing }) : "";
  const said = [t(OUTCOME_KEY[qualification.outcome]), pending ? needs : reasons].filter(Boolean).join(" ");
  const next = qualification.outcome === "review" ? t("qualification-review-next") : t("qualification-holds");

  return (
    <Box className="flex flex-col gap-2">
      <SectionTitle
        id="case-qualification-title"
        as="h3"
        variant="subtitle2"
        title={t("qualification-title")}
        description={t("qualification-hint")}
      />
      <StateLine tone={qualification.released ? "done" : TONE[qualification.outcome]}>{said}</StateLine>
      {qualification.released ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("qualification-released", { reason: qualification.released.reason })}
        </Typography>
      ) : holds ? (
        <Typography variant="body2" className="text-text-secondary">
          {next}
        </Typography>
      ) : null}
      {holds && !qualification.released && mayRelease ? (
        <Box>
          <Button variant="outlined" size="small" onClick={() => setAsking(true)}>
            {t("qualification-release")}
          </Button>
        </Box>
      ) : null}
      {asking ? (
        <ConfirmActionDialog
          title={t("qualification-release-title")}
          intro={t("qualification-release-intro")}
          consequences={[t("qualification-release-carries"), t("qualification-release-record")]}
          reasonLabel={t("qualification-release-reason")}
          confirmLabel={t("qualification-release-confirm")}
          cancelLabel={t("qualification-release-cancel")}
          onClose={() => setAsking(false)}
          onConfirm={async (reason) => {
            const result = await releaseQualification({ caseId, reason }).catch(() => ({
              ok: false as const,
              code: "failed",
            }));
            if (!result.ok) {
              return t(
                result.code === "not_allowed"
                  ? "qualification-release-not-allowed"
                  : result.code === "reason_required"
                    ? "qualification-release-reason-required"
                    : "qualification-release-failed",
              );
            }
            setAsking(false);
            onChanged();
            return null;
          }}
        />
      ) : null}
    </Box>
  );
}
