"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button } from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import type { Fact } from "@/components/product/fact-grid";
import InfoHint from "@/components/product/info-hint";
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

type Words = ReturnType<typeof useTranslations>;

/** The rule's word on the problem: the outcome with its reasons, or what it still needs to decide. */
function qualificationSaid(t: Words, qualification: CaseQualification): string {
  const reasons = qualification.reasons.map((reason) => t(REASON_KEY[reason])).join(" ");
  const missing = qualification.missing
    .map((item) => (MISSING_KEY[item] ? t(MISSING_KEY[item]) : null))
    .filter(Boolean)
    .join(", ");
  // A rule that could not decide yet says what it needs, never a reason it has not reached.
  const pending = qualification.outcome === "pending";
  const needs = pending && missing ? t("qualification-needs", { missing }) : "";
  return [t(OUTCOME_KEY[qualification.outcome]), pending ? needs : reasons].filter(Boolean).join(" ");
}

/** The problem qualifies, or a lawyer went on with it: settled, a fact of the card, never a line that asks. */
export const qualificationSettled = (qualification: CaseQualification | null | undefined): boolean =>
  Boolean(qualification && (qualification.released || qualification.outcome === "qualifies"));

/**
 * The settled qualification as a fact of the card (the owner's canvas of 2026-11-24): the rule's word, or the
 * lawyer's who went on, with ONE's reading behind the "i".
 */
export function qualificationFact(t: Words, qualification: CaseQualification): Fact {
  const said = qualificationSaid(t, qualification);
  return {
    key: "qualification",
    label: t("qualification-title"),
    value: qualification.released ? t("qualification-released", { reason: qualification.released.reason }) : said,
    hint: qualification.released ? `${said} ${t("qualification-hint")}` : t("qualification-hint"),
  };
}

/**
 * Whether the case's problem qualifies (migration 0147), while it is still open: what the rule needs to decide, or
 * its word that the problem does not qualify (or is left to a person), as one line of what the card asks, with what
 * holds behind the "i" and, for a partner or a lawyer, going on with the case anyway, with the reason. Once it
 * qualifies or a lawyer went on, it is a fact of the card (`qualificationFact`). Nothing shows before ONE ran the
 * rule.
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
  if (!qualification || qualificationSettled(qualification)) return null;

  const holds = qualification.outcome === "not_qualified" || qualification.outcome === "review";
  const next = qualification.outcome === "review" ? t("qualification-review-next") : t("qualification-holds");
  // What the rule still needs comes from the legs of the trip: the line leads to the card where they are completed.
  const needsTrip =
    qualification.outcome === "pending" && qualification.missing.some((item) => Boolean(MISSING_KEY[item]));

  return (
    <>
      <StateLine
        tone={TONE[qualification.outcome]}
        action={
          needsTrip ? (
            <Button variant="outlined" color="grey" size="small" href="#case-trip">
              {t("qualification-needs-action")}
            </Button>
          ) : holds && mayRelease ? (
            <Button variant="outlined" size="small" onClick={() => setAsking(true)}>
              {t("qualification-release")}
            </Button>
          ) : undefined
        }
      >
        <Box component="span" className="inline-flex flex-wrap items-center gap-1">
          {qualificationSaid(t, qualification)}
          <InfoHint label={holds ? `${next} ${t("qualification-hint")}` : t("qualification-hint")} />
        </Box>
      </StateLine>
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
    </>
  );
}
