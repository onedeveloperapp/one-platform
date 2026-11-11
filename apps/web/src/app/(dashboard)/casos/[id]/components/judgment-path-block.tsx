"use client";

import type { CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Typography } from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import QuickActions from "@/components/product/quick-actions";
import StateLine from "@/components/product/state-line";
import { decideJudgmentPath, recordJudgmentAnswer } from "@/lib/cases/judgment-path-actions";
import { appealOf, DECISION_KEY, type JudgmentDecision, optionsAfter, recommendPath } from "@/lib/cases/judgment-paths";

type Ready = Extract<CaseState, { kind: "ready" }>;

/**
 * What may follow a lawsuit's judgment (migration 0185, `caminhos-v1`): the options with what an appeal costs the
 * client, ONE's recommendation (what was asked against what was granted, which may err), the client's word on the
 * costs, and the lawyer's decision, with the second factor. The deadlines ONE proposed from the judgment follow it.
 */
export default function JudgmentPathBlock({
  state,
  proceedingId,
  writable,
  onChanged,
}: {
  state: Ready;
  proceedingId: string;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState(false);
  const [deciding, setDeciding] = useState<JudgmentDecision | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const path = state.judgmentPaths.find((item) => item.proceedingId === proceedingId) ?? null;
  const lawsuit = state.proceedings.find((item) => item.id === proceedingId);
  const fact = state.outcomes?.find((item) => item.id === path?.factId) ?? null;
  if (!path || !lawsuit || !fact) return null;
  const requested = lawsuit.parties.reduce((sum, partyId) => sum + (state.rules.claims[partyId] ?? 0), 0);
  const recommended = recommendPath({
    kind: lawsuit.kind,
    result: fact.result,
    requestedCents: requested || null,
    grantedCents: fact.cents,
  });
  const freeJustice = (state.freeJustice ?? []).some((need) => lawsuit.parties.includes(need.partyId) && need.asks);
  const appeal = optionsAfter(lawsuit.kind, freeJustice, fact.cents !== null).find(
    (option) => option.option === appealOf(lawsuit.kind),
  );
  const costsKey = appeal?.costs?.preparo ? "judgment-path-costs" : "judgment-path-costs-free";
  const recommendedKey = DECISION_KEY[recommended];
  const run = async (work: () => Promise<{ ok: boolean; code?: string }>): Promise<string | null> => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await work();
      if (!result.ok) {
        setProblem(result.code ?? "failed");
        return result.code ?? "failed";
      }
      onChanged();
      return null;
    } catch {
      setProblem("failed");
      return "failed";
    } finally {
      setBusy(false);
    }
  };
  const consequenceKey =
    deciding === "aceitar" ? "judgment-path-accept-consequence" : "judgment-path-appeal-consequence";
  const options: JudgmentDecision[] = ["aceitar", "embargos_declaracao", appealOf(lawsuit.kind)];
  const clientKey =
    path.clientAgrees === null
      ? "judgment-path-client-waiting"
      : path.clientAgrees
        ? "judgment-path-client-agrees"
        : "judgment-path-client-refuses";

  return (
    <Box className="flex flex-col gap-1">
      {path.decision ? (
        <StateLine tone="done">{t("judgment-path-decided", { decision: t(DECISION_KEY[path.decision]) })}</StateLine>
      ) : (
        <StateLine
          tone="attention"
          action={
            writable && state.lawyer && !state.supportVisit ? (
              <QuickActions
                label={t("judgment-path-actions")}
                actions={[
                  ...options.map((option) => ({
                    key: option,
                    label: t(DECISION_KEY[option]),
                    disabled: busy,
                    onClick: () => setDeciding(option),
                  })),
                  {
                    key: "client-yes",
                    label: t("judgment-path-record-yes"),
                    disabled: busy,
                    onClick: () => void run(() => recordJudgmentAnswer(state.case.id, path.id, true, "telefone")),
                  },
                ]}
              />
            ) : undefined
          }
        >
          {t("judgment-path-recommend", { option: t(recommendedKey) })}
        </StateLine>
      )}
      <StateLine tone="info">{t(costsKey)}</StateLine>
      <StateLine tone={path.clientAgrees === null ? "waiting" : "info"}>{t(clientKey)}</StateLine>
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t("judgment-path-error")}
        </Alert>
      ) : null}
      {deciding ? (
        <ConfirmActionDialog
          title={t("judgment-path-decide-title", { option: t(DECISION_KEY[deciding]) })}
          consequences={[t(consequenceKey), t("judgment-path-second-factor")]}
          requireReason={false}
          confirmLabel={t(DECISION_KEY[deciding])}
          cancelLabel={t("cases-cancel")}
          busyLabel={t("cases-working")}
          onConfirm={async (reason) => {
            const refused = await run(() => decideJudgmentPath(state.case.id, path.id, deciding, reason));
            return refused ? t("judgment-path-error") : null;
          }}
          onClose={() => setDeciding(null)}
        />
      ) : null}
      <Typography variant="caption" className="text-text-secondary">
        {t("judgment-path-may-err")}
      </Typography>
    </Box>
  );
}
