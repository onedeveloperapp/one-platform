"use client";

import type { CaseState } from "../case-types";
import { useCaseAction } from "./case-action";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import DialogHeader from "@/components/product/dialog-header";
import QuickActions from "@/components/product/quick-actions";
import StateLine from "@/components/product/state-line";
import { pieceFactsErrorKey } from "@/lib/cases/piece-facts";
import { recordPieceFacts, waivePieceFacts } from "@/lib/cases/piece-facts-actions";
import { formatDayBr } from "@flyee/rules/person";

type Ready = Extract<CaseState, { kind: "ready" }>;
const HOWS = ["telefone", "whatsapp", "presencial", "email"] as const;

/**
 * Where the client's check of the facts of a lawsuit's piece stands (migration 0182): ONE writing them, asked, the
 * client's confirmation, what the client said is wrong, gone on without; with the way to record the client's word as
 * they told it, and, for a partner or a lawyer, to go on without it, saying why. The filing waits for it.
 */
export default function PieceFactsLine({
  state,
  draftIds,
  writable,
}: {
  state: Ready;
  draftIds: string[];
  writable: boolean;
}) {
  const t = useTranslations("product");
  const action = useCaseAction("drafts");
  const [recording, setRecording] = useState(false);
  const [waiving, setWaiving] = useState(false);
  const [confirmed, setConfirmed] = useState<"yes" | "no">("yes");
  const [note, setNote] = useState("");
  const [how, setHow] = useState<(typeof HOWS)[number]>("telefone");
  const [problem, setProblem] = useState<string | null>(null);
  const check = state.pieceFacts?.checks.find((item) => draftIds.includes(item.draftId)) ?? null;
  if (!check || check.status === "superseded") return null;
  const day = formatDayBr(check.askedAt ?? check.answeredAt ?? null) ?? "";
  const words = {
    record: {
      doing: t("case-action-piece-facts-record-doing"),
      done: t("case-action-piece-facts-record-done"),
      failed: t("case-action-piece-facts-record-failed"),
    },
    waive: {
      doing: t("case-action-piece-facts-waive-doing"),
      done: t("case-action-piece-facts-waive-done"),
      failed: t("case-action-piece-facts-waive-failed"),
    },
  };
  const open = check.status === "asked" || check.status === "failed" || check.status === "corrected";
  const confirmedKey = check.via === "link" ? "piece-facts-confirmed-link" : "piece-facts-confirmed-firm";
  const correctedKey =
    check.draftStatus === "proposed" ? "piece-facts-corrected-rewrite" : "piece-facts-corrected-reopen";
  const line =
    check.status === "writing"
      ? { tone: "waiting" as const, text: t("piece-facts-writing") }
      : check.status === "asked"
        ? { tone: "waiting" as const, text: t("piece-facts-asked", { day }) }
        : check.status === "confirmed"
          ? { tone: "done" as const, text: t(confirmedKey) }
          : check.status === "corrected"
            ? {
                tone: "attention" as const,
                text: t(correctedKey, { note: check.note ?? "" }),
              }
            : check.status === "waived"
              ? { tone: "info" as const, text: t("piece-facts-waived", { reason: check.reason ?? "" }) }
              : { tone: "attention" as const, text: t("piece-facts-failed") };

  const record = () =>
    action.run(`piece-facts-record-${check.id}`, words.record, async () => {
      setProblem(null);
      const result = await recordPieceFacts({
        caseId: state.case.id,
        checkId: check.id,
        confirmed: confirmed === "yes",
        note,
        how,
      });
      if (!result.ok) setProblem(result.code);
      else setRecording(false);
      return result.ok;
    });

  return (
    <Box className="flex flex-col gap-2">
      <StateLine
        tone={line.tone}
        action={
          writable && open && !state.supportVisit ? (
            <QuickActions
              label={t("piece-facts-actions")}
              actions={[
                ...(check.status === "asked"
                  ? [{ key: "record", label: t("piece-facts-record"), onClick: () => setRecording(true) }]
                  : []),
                ...(state.lawyer
                  ? [{ key: "waive", label: t("piece-facts-waive"), onClick: () => setWaiving(true) }]
                  : []),
              ]}
            />
          ) : undefined
        }
      >
        {line.text}
      </StateLine>
      {check.status === "asked" && check.facts ? (
        <Typography variant="body2" className="text-text-secondary whitespace-pre-wrap">
          {check.facts}
        </Typography>
      ) : null}
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(pieceFactsErrorKey(problem))}
        </Alert>
      ) : null}
      {recording ? (
        <Dialog open onClose={() => setRecording(false)} maxWidth="sm" fullWidth aria-labelledby="piece-facts-record">
          <DialogHeader
            id="piece-facts-record"
            title={t("piece-facts-record")}
            onClose={() => setRecording(false)}
            closeLabel={t("cases-close")}
          />
          <DialogContent className="flex flex-col gap-4">
            <RadioGroup
              aria-label={t("piece-facts-record")}
              value={confirmed}
              onChange={(event) => setConfirmed(event.target.value as "yes" | "no")}
            >
              <FormControlLabel value="yes" control={<Radio />} label={t("piece-facts-record-yes")} />
              <FormControlLabel value="no" control={<Radio />} label={t("piece-facts-record-no")} />
            </RadioGroup>
            {confirmed === "no" ? (
              <TextField
                multiline
                minRows={3}
                label={t("piece-facts-record-note")}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                slotProps={{ htmlInput: { maxLength: 2000 } }}
              />
            ) : null}
            <TextField
              select
              label={t("piece-facts-record-how")}
              value={how}
              onChange={(event) => setHow(event.target.value as (typeof HOWS)[number])}
            >
              {HOWS.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(`piece-facts-how-${value}`)}
                </MenuItem>
              ))}
            </TextField>
          </DialogContent>
          <DialogActions>
            <Button variant="text" color="grey" onClick={() => setRecording(false)}>
              {t("cases-cancel")}
            </Button>
            <Button variant="contained" disabled={action.busy} onClick={() => void record()}>
              {t("piece-facts-record-save")}
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}
      {waiving ? (
        <ConfirmActionDialog
          title={t("piece-facts-waive-title")}
          consequences={[t("piece-facts-waive-consequence"), t("piece-facts-waive-second-factor")]}
          requireReason
          confirmLabel={t("piece-facts-waive")}
          cancelLabel={t("cases-cancel")}
          busyLabel={t("cases-working")}
          onConfirm={async (reason) => {
            let refused: string | null = null;
            await action.run(`piece-facts-waive-${check.id}`, words.waive, async () => {
              const result = await waivePieceFacts(state.case.id, check.draftId, reason ?? "");
              if (!result.ok) refused = result.code;
              return result.ok;
            });
            return refused ? t(pieceFactsErrorKey(refused)) : null;
          }}
          onClose={() => setWaiving(false)}
        />
      ) : null}
    </Box>
  );
}
