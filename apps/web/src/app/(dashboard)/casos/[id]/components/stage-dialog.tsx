"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, MenuItem, TextField } from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import { setCaseStatus } from "@/lib/cases/actions";
import { CASE_STATUSES, caseErrorKey, type CaseStatus, STATUS_KEY } from "@/lib/cases/cases";

/** Moves a case to another stage. Closing or declining it asks why: the timeline keeps the reason. */
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
  const ending = next === "closed" || next === "declined";
  const ready = next !== status && (!ending || reason.trim().length >= 8);

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    const result = await setCaseStatus(caseId, next, ending ? reason : null);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.code);
      return;
    }
    onChanged();
  };

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
