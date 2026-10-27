"use client";

import type { CaseComplaint, CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Grid,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import DialogHeader from "@/components/product/dialog-header";
import EmptyState from "@/components/product/empty-state";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import NiFlag from "@/icons/nexture/ni-flag";
import { caseErrorKey } from "@/lib/cases/cases";
import { opensOnArrival } from "@/lib/cases/sections";
import { removeAdminComplaint, saveAdminComplaint } from "@/lib/cases/statement-actions";
import {
  answerDueOn,
  CHANNEL_KEY,
  CHANNEL_URL,
  COMPLAINT_CHANNELS,
  COMPLAINT_OUTCOMES,
  type ComplaintChannel,
  type ComplaintOutcome,
  complaintOverdue,
  OUTCOME_KEY,
} from "@/lib/cases/statements";
import { formatDayBr } from "@flyee/rules/person";

type Ready = Extract<CaseState, { kind: "ready" }>;

const OUTCOME_TONE: Record<ComplaintOutcome, StatusTone> = {
  pending: "info",
  answered: "neutral",
  settled: "positive",
  no_answer: "attention",
};

/**
 * The complaint made to the airline before suing: on ANAC's platform for
 * passengers, on consumidor.gov.br, at a Procon or with the airline itself.
 * ONE does not file it: the client (or a lawyer with their power of
 * attorney) does, on the channel's own site, and the firm records here the
 * protocol, the dates and what came of it, which the dossier then shows as
 * the attempt to settle. A case has one or two of these: a short list, and a
 * dialog to record each.
 */
export default function ComplaintCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [editing, setEditing] = useState<CaseComplaint | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const remove = async (complaint: CaseComplaint) => {
    setBusy(complaint.id);
    setProblem(null);
    try {
      const result = await removeAdminComplaint(state.case.id, complaint.id);
      if (!result.ok) setProblem(result.code);
      else onChanged();
    } catch {
      setProblem("unavailable");
    } finally {
      setBusy(null);
    }
  };

  const anyOverdue = state.complaints.some((complaint) => complaintOverdue(complaint, state.today));

  return (
    <CollapsibleCard
      id="case-complaints"
      title={t("case-complaints-title")}
      summary={
        state.complaints.length === 0
          ? t("case-complaints-empty-title")
          : state.complaints
              .map((complaint) => `${t(CHANNEL_KEY[complaint.channel])}: ${t(OUTCOME_KEY[complaint.outcome])}`)
              .join(" · ")
      }
      chip={anyOverdue ? <StatusChip tone="attention" label={t("case-complaint-overdue")} /> : null}
      description={t("case-complaints-body")}
      action={
        writable && state.complaints.length > 0 ? (
          <Button variant="outlined" color="grey" size="small" onClick={() => setEditing("new")}>
            {t("case-complaints-add")}
          </Button>
        ) : null
      }
      defaultOpen={opensOnArrival(state.case.status, "complaints", anyOverdue)}
    >
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(caseErrorKey(problem))}
        </Alert>
      )}

      {state.complaints.length === 0 ? (
        <EmptyState
          titleAs="h3"
          icon={<NiFlag />}
          title={t("case-complaints-empty-title")}
          description={t("case-complaints-empty-body")}
          action={writable ? { label: t("case-complaints-add"), onClick: () => setEditing("new") } : undefined}
          className="py-8"
        />
      ) : (
        <Box className="flex flex-col gap-2">
          {state.complaints.map((complaint) => {
            const overdue = complaintOverdue(complaint, state.today);
            return (
              <Box key={complaint.id} className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
                <Box className="flex flex-wrap items-start justify-between gap-2">
                  <Box className="flex min-w-0 flex-col">
                    <Typography variant="body1" className="font-semibold">
                      {t(CHANNEL_KEY[complaint.channel])}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary break-all">
                      {[
                        complaint.protocol ? t("case-complaint-protocol-line", { protocol: complaint.protocol }) : null,
                        complaint.filedOn
                          ? t("case-complaint-filed-line", { day: formatDayBr(complaint.filedOn) ?? "" })
                          : null,
                        complaint.answeredOn
                          ? t("case-complaint-answered-line", { day: formatDayBr(complaint.answeredOn) ?? "" })
                          : complaint.answerDueOn
                            ? t("case-complaint-due-line", { day: formatDayBr(complaint.answerDueOn) ?? "" })
                            : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Typography>
                  </Box>
                  <StatusChip
                    tone={overdue ? "attention" : OUTCOME_TONE[complaint.outcome]}
                    label={overdue ? t("case-complaint-overdue") : t(OUTCOME_KEY[complaint.outcome])}
                  />
                </Box>
                {complaint.notes ? (
                  <Typography variant="body1" className="text-text-primary whitespace-pre-wrap">
                    {complaint.notes}
                  </Typography>
                ) : null}
                {writable && (
                  <Box className="flex flex-wrap gap-2 pt-1">
                    <Button
                      variant="outlined"
                      color="grey"
                      size="small"
                      disabled={busy !== null}
                      onClick={() => setEditing(complaint)}
                    >
                      {t("case-complaint-edit")}
                    </Button>
                    <Button
                      variant="text"
                      color="grey"
                      size="small"
                      disabled={busy !== null}
                      onClick={() => void remove(complaint)}
                    >
                      {t("case-complaint-remove")}
                    </Button>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {editing && (
        <ComplaintDialog
          state={state}
          complaint={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </CollapsibleCard>
  );
}

function ComplaintDialog({
  state,
  complaint,
  onClose,
  onSaved,
}: {
  state: Ready;
  complaint: CaseComplaint | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [channel, setChannel] = useState<ComplaintChannel>(complaint?.channel ?? "anac_passageiro");
  const [protocol, setProtocol] = useState(complaint?.protocol ?? "");
  const [filedOn, setFiledOn] = useState(complaint?.filedOn ?? "");
  const [dueOn, setDueOn] = useState(complaint?.answerDueOn ?? "");
  const [dueTouched, setDueTouched] = useState(Boolean(complaint?.answerDueOn));
  const [answeredOn, setAnsweredOn] = useState(complaint?.answeredOn ?? "");
  const [outcome, setOutcome] = useState<ComplaintOutcome>(complaint?.outcome ?? "pending");
  const [notes, setNotes] = useState(complaint?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // The day an answer is due, proposed from the channel's own days until the person writes another.
  const proposedDue = answerDueOn(filedOn || null, state.complaintAnswerDays[channel]);
  const due = dueTouched ? dueOn : (proposedDue ?? "");
  const site = CHANNEL_URL[channel];

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await saveAdminComplaint({
        caseId: state.case.id,
        complaintId: complaint?.id ?? null,
        fields: { channel, protocol, filed_on: filedOn, answer_due_on: due, answered_on: answeredOn, outcome, notes },
      });
      if (!result.ok) {
        setProblem(result.code);
        return;
      }
      onSaved();
    } catch {
      setProblem("unavailable");
    } finally {
      setBusy(false);
    }
  };

  const day = (id: string, label: string, value: string, change: (next: string) => void, help?: string) => (
    <TextField
      fullWidth
      size="small"
      type="date"
      id={id}
      label={label}
      value={value}
      helperText={help}
      disabled={busy}
      slotProps={{ inputLabel: { shrink: true } }}
      onChange={(event) => change(event.target.value)}
    />
  );

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="case-complaint-dialog">
      <DialogHeader
        id="case-complaint-dialog"
        title={complaint ? t("case-complaint-edit-title") : t("case-complaints-add")}
        onClose={onClose}
        closeLabel={t("cases-close")}
      />
      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DialogContent>
          <Grid container spacing={2} className="pt-1">
            <Grid size={12}>
              <TextField
                select
                fullWidth
                size="small"
                id="case-complaint-channel"
                label={t("case-complaint-channel")}
                value={channel}
                disabled={busy}
                helperText={
                  site ? t("case-complaint-channel-site", { site: site.replace(/^https:\/\/(www\.)?/, "") }) : undefined
                }
                onChange={(event) => setChannel(event.target.value as ComplaintChannel)}
              >
                {COMPLAINT_CHANNELS.map((value) => (
                  <MenuItem key={value} value={value}>
                    {t(CHANNEL_KEY[value])}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                size="small"
                id="case-complaint-protocol"
                label={t("case-complaint-protocol")}
                value={protocol}
                disabled={busy}
                slotProps={{ htmlInput: { maxLength: 80 } }}
                onChange={(event) => setProtocol(event.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              {day("case-complaint-filed", t("case-complaint-filed"), filedOn, setFiledOn)}
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              {day(
                "case-complaint-due",
                t("case-complaint-due"),
                due,
                (next) => {
                  setDueTouched(true);
                  setDueOn(next);
                },
                !dueTouched && proposedDue ? t("case-complaint-due-proposed") : undefined,
              )}
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              {day("case-complaint-answered", t("case-complaint-answered"), answeredOn, setAnsweredOn)}
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select
                fullWidth
                size="small"
                id="case-complaint-outcome"
                label={t("case-complaint-outcome")}
                value={outcome}
                disabled={busy}
                onChange={(event) => setOutcome(event.target.value as ComplaintOutcome)}
              >
                {COMPLAINT_OUTCOMES.map((value) => (
                  <MenuItem key={value} value={value}>
                    {t(OUTCOME_KEY[value])}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                multiline
                minRows={2}
                size="small"
                id="case-complaint-notes"
                label={t("case-complaint-notes")}
                helperText={t("case-complaint-notes-help")}
                value={notes}
                disabled={busy}
                slotProps={{ htmlInput: { maxLength: 2000 } }}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Grid>
            {problem && (
              <Grid size={12}>
                <Alert severity="error" className="neutral bg-background-paper/60!">
                  {t(caseErrorKey(problem))}
                </Alert>
              </Grid>
            )}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("cases-cancel")}
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? t("cases-working") : t("cases-save")}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
