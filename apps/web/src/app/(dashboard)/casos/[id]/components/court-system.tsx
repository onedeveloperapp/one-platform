"use client";

import type { CaseProceeding, CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, TextField, Typography } from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import StatusChip from "@/components/product/status-chip";
import { decideCourtSystem } from "@/lib/cases/actions";
import { caseErrorKey } from "@/lib/cases/cases";

type Ready = Extract<CaseState, { kind: "ready" }>;

const SYSTEM_KEY: Record<string, string> = {
  projudi: "case-system-projudi",
  eproc: "case-system-eproc",
  pje: "case-system-pje",
  esaj: "case-system-esaj",
  outro: "case-system-outro",
};

const day = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));

/**
 * The court system of a planned lawsuit (migration 0066): ONE names it from the platform's table of each court's
 * systems, says it may have erred and what to check, and the firm approves it or not. The approval is the firm's
 * decision, said with who and when; not approving says why, for the platform to check the court's acts, and the
 * lawsuit's package waits meanwhile. The firm never picks a system.
 *
 * Closest catalog shape: the bordered box of a lawsuit's facts, with a pastel `StatusChip` naming the state, as
 * `CourtCourse` shows the course under the same lawsuit; nothing existing carried a fact ONE proposes beside the
 * firm's approval of it.
 */
export default function CourtSystem({
  state,
  proceeding,
  writable,
  onChanged,
}: {
  state: Ready;
  proceeding: CaseProceeding;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (proceeding.status !== "planned") return null;

  const row = state.courtSystems.find((item) => item.court === proceeding.court && item.kind === proceeding.kind);
  const label = proceeding.system
    ? SYSTEM_KEY[proceeding.system]
      ? t(SYSTEM_KEY[proceeding.system])
      : proceeding.system
    : null;
  const nameOf = (userId: string | null) =>
    (userId ? state.team.find((member) => member.userId === userId)?.name : null) || null;
  const mayDecide = writable && state.decidesCourtSystem && proceeding.system !== null;

  const decide = async (approve: boolean) => {
    setBusy(true);
    setProblem(null);
    const result = await decideCourtSystem({
      caseId: state.case.id,
      proceedingId: proceeding.id,
      approve,
      reason: approve ? null : reason,
    });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.code);
      return;
    }
    setRefusing(false);
    setReason("");
    onChanged();
  };

  if (!label) {
    return (
      <Box className="border-grey-100 flex flex-col gap-1 rounded-xl border px-3 py-2">
        <Typography variant="body2" className="font-semibold">
          {t("case-proceeding-system")}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {t("case-proceeding-system-none")}
        </Typography>
      </Box>
    );
  }

  const approval = proceeding.systemApproval;
  const refusal = proceeding.systemRefusal;
  const chip = refusal
    ? { tone: "attention" as const, label: t("case-proceeding-system-chip-refused") }
    : approval
      ? { tone: "positive" as const, label: t("case-proceeding-system-chip-approved") }
      : { tone: "attention" as const, label: t("case-proceeding-system-chip-waiting") };

  return (
    <Box className="border-grey-100 flex flex-col gap-2 rounded-xl border px-3 py-2">
      <Box className="flex flex-wrap items-center justify-between gap-2">
        <Typography variant="body2" className="font-semibold">
          {t("case-proceeding-system")}: {label}
        </Typography>
        <StatusChip tone={chip.tone} label={chip.label} />
      </Box>
      <Typography variant="body2">
        {proceeding.systemByOne
          ? row?.confirmed
            ? t("case-proceeding-system-one-confirmed")
            : t("case-proceeding-system-one")
          : t("case-proceeding-system-firm")}
      </Typography>
      {proceeding.systemByOne && (
        <Typography variant="body2" className="text-text-secondary">
          {t("case-proceeding-system-may-err")}
        </Typography>
      )}
      {approval && (
        <Typography variant="body2" className="text-text-secondary">
          {nameOf(approval.by)
            ? t("case-proceeding-system-approved", { name: nameOf(approval.by) ?? "", date: day(approval.at) })
            : t("case-proceeding-system-approved-firm", { date: day(approval.at) })}
        </Typography>
      )}
      {refusal && (
        <>
          <Typography variant="body2">
            {nameOf(refusal.by)
              ? t("case-proceeding-system-refused", {
                  name: nameOf(refusal.by) ?? "",
                  date: day(refusal.at),
                  reason: refusal.reason,
                })
              : t("case-proceeding-system-refused-firm", { date: day(refusal.at), reason: refusal.reason })}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("case-proceeding-system-refused-wait")}
          </Typography>
        </>
      )}
      {!approval && !refusal && (
        <Typography variant="body2" className="text-text-secondary">
          {mayDecide ? t("case-proceeding-system-waits") : t("case-proceeding-system-who")}
        </Typography>
      )}
      {problem && !refusing && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(caseErrorKey(problem))}
        </Alert>
      )}
      {mayDecide && !approval && (
        <Box className="flex flex-wrap gap-2">
          <Button variant="contained" size="small" disabled={busy} onClick={() => void decide(true)}>
            {busy && !refusing ? t("cases-working") : t("case-proceeding-system-approve")}
          </Button>
          {!refusal && (
            <Button variant="text" color="grey" size="small" disabled={busy} onClick={() => setRefusing(true)}>
              {t("case-proceeding-system-refuse")}
            </Button>
          )}
        </Box>
      )}

      <Dialog
        open={refusing}
        onClose={busy ? undefined : () => setRefusing(false)}
        maxWidth="xs"
        fullWidth
        aria-labelledby={`court-system-refuse-${proceeding.id}`}
      >
        <DialogHeader
          id={`court-system-refuse-${proceeding.id}`}
          title={t("case-proceeding-system-refuse-title")}
          onClose={() => setRefusing(false)}
          closeLabel={t("cases-close")}
        />
        <DialogContent>
          <Box className="flex flex-col gap-3 pt-1">
            <Typography variant="body2">{t("case-proceeding-system-refuse-body", { system: label })}</Typography>
            <TextField
              fullWidth
              multiline
              minRows={3}
              size="small"
              id={`court-system-reason-${proceeding.id}`}
              label={t("case-proceeding-system-refuse-reason")}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
              error={problem === "reason_required"}
              helperText={
                problem === "reason_required" ? t(caseErrorKey(problem)) : t("case-proceeding-system-refuse-help")
              }
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            {problem && problem !== "reason_required" && (
              <Alert severity="error" className="neutral bg-background-paper/60!">
                {t(caseErrorKey(problem))}
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={() => setRefusing(false)} disabled={busy}>
            {t("cases-cancel")}
          </Button>
          <Button variant="contained" onClick={() => void decide(false)} disabled={busy}>
            {busy ? t("cases-working") : t("case-proceeding-system-refuse-submit")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
