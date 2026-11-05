"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import OutcomeDialog from "@/components/product/outcome-dialog";
import StateLine from "@/components/product/state-line";
import NiFlag from "@/icons/nexture/ni-flag";
import NiLink from "@/icons/nexture/ni-link";
import NiRobot from "@/icons/nexture/ni-robot";
import { setCaseStatus } from "@/lib/cases/actions";
import { CASE_STATUSES, caseErrorKey, type CaseStatus, CLIENT_STAGES, STATUS_KEY } from "@/lib/cases/cases";

/** What moving a case to a stage by hand changes, each a consequence in its words (the owner's audit, 2026-11-05). */
export function stageConsequences(from: CaseStatus, to: CaseStatus): ("link" | "one" | "ended" | "court")[] {
  if (from === to) return [];
  const out: ("link" | "one" | "ended" | "court")[] = [];
  if (CLIENT_STAGES.includes(from) && !CLIENT_STAGES.includes(to)) out.push("link");
  if (to === "filed" || to === "closed" || to === "declined") out.push("one");
  if (to === "closed" || to === "declined") out.push("ended");
  if (to === "filed") out.push("court");
  return out;
}

const CONSEQUENCE_KEY: Record<ReturnType<typeof stageConsequences>[number], string> = {
  link: "case-stage-consequence-link",
  one: "case-stage-consequence-one",
  ended: "case-stage-consequence-ended",
  court: "case-stage-consequence-court",
};

const CONSEQUENCE_ICON = {
  link: <NiLink size="medium" />,
  one: <NiRobot size="medium" />,
  ended: <NiFlag size="medium" />,
  court: <NiFlag size="medium" />,
};

/**
 * Moves a case to another stage by hand: the exception, since ONE moves the stage itself when it creates the
 * lawsuits and when a filing's receipt is attached. The dialog says what each destination changes before the click
 * (the client's link stops taking papers, ONE stops carrying the case, the court's reading and the notices stop),
 * and the outcome is said in front of the person once it is done. Closing or declining it asks why: the timeline
 * keeps the reason.
 */
export default function StageDialog({
  caseId,
  status,
  onClose,
  onChanged,
}: {
  caseId: string;
  status: CaseStatus;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [next, setNext] = useState<CaseStatus>(status);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<CaseStatus | null>(null);
  const ending = next === "closed" || next === "declined";
  const ready = next !== status && (!ending || reason.trim().length >= 8);
  const consequences = stageConsequences(status, next);

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    const result = await setCaseStatus(caseId, next, ending ? reason : null);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.code);
      return;
    }
    setDone(next);
  };

  if (done) {
    return (
      <OutcomeDialog
        open
        tone={done === "closed" || done === "declined" ? "info" : "done"}
        title={t("case-stage-done", { status: t(STATUS_KEY[done]) })}
        lines={stageConsequences(status, done).map((key) => ({
          key,
          icon: CONSEQUENCE_ICON[key],
          text: t(CONSEQUENCE_KEY[key]),
        }))}
        closeLabel={t("case-stage-done-close")}
        onClose={onChanged}
      />
    );
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth aria-labelledby="case-stage-dialog">
      <DialogHeader
        id="case-stage-dialog"
        title={t("case-stage-title")}
        onClose={onClose}
        closeLabel={t("cases-close")}
      />
      <DialogContent>
        <Box className="flex flex-col gap-4 pt-1">
          <Typography variant="body2" className="text-text-secondary">
            {t("case-stage-intro")}
          </Typography>
          <TextField
            select
            fullWidth
            size="small"
            id="case-stage"
            label={t("case-stage-label")}
            value={next}
            disabled={busy}
            onChange={(event) => setNext(event.target.value as CaseStatus)}
          >
            {CASE_STATUSES.map((value) => (
              <MenuItem key={value} value={value}>
                {t(STATUS_KEY[value])}
              </MenuItem>
            ))}
          </TextField>
          {consequences.length > 0 ? (
            <Box className="flex flex-col gap-2">
              {consequences.map((key) => (
                <StateLine key={key} tone="attention">
                  {t(CONSEQUENCE_KEY[key])}
                </StateLine>
              ))}
            </Box>
          ) : null}
          {ending && (
            <TextField
              fullWidth
              multiline
              minRows={3}
              size="small"
              id="case-stage-reason"
              label={t("case-stage-reason")}
              helperText={t("case-stage-reason-help")}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
          {problem && (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t(caseErrorKey(problem))}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          {t("cases-cancel")}
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || !ready}>
          {busy ? t("cases-working") : t("case-stage-submit")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
