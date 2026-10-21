"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import HearingDialog from "@/components/hearings/hearing-dialog";
import DialogHeader from "@/components/product/dialog-header";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import { caseLabel } from "@/lib/cases/cases";
import { setHearingStatus } from "@/lib/hearings/actions";
import type { Colleague, HearingRow } from "@/lib/hearings/facts";
import {
  HEARING_OUTCOMES,
  hearingErrorKey,
  type HearingOutcome,
  type HearingStatus,
  isHearingZone,
  KIND_KEY,
  MODE_KEY,
  momentIn,
  OUTCOME_KEY,
  OUTCOME_SAID_KEY,
  STATUS_KEY,
  ZONE_KEY,
} from "@/lib/hearings/hearings";

const STATUS_TONE: Record<HearingStatus, StatusTone> = {
  scheduled: "primary",
  held: "positive",
  cancelled: "neutral",
};

const CALENDAR_KEY = {
  synced: "hearing-calendar-synced",
  pending: "hearing-calendar-pending",
  failed: "hearing-calendar-failed",
} as const;
const CALENDAR_TONE: Record<keyof typeof CALENDAR_KEY, StatusTone> = {
  synced: "neutral",
  pending: "info",
  failed: "attention",
};

const KIND_LABEL_KEY: Record<string, string> = {
  juizado: "hearing-lawsuit-juizado",
  comum: "hearing-lawsuit-comum",
};

/**
 * One hearing: what it is and when, in the zone the court says it (Brasília
 * goes unsaid), of which case and lawsuit, how and where (the link opens),
 * who attends, how its event stands in the firm's calendar, and the one
 * thing it needs next: changed or cancelled until it starts; from its start,
 * what came of it; and once it lasted as long as a hearing is taken to
 * last, a word that its time passed with nothing said of it.
 *
 * Closest component: the card of a deadline (`components/deadlines/
 * deadline-card.tsx`), an article with a state, a day and its actions; a
 * hearing has a place and a way instead of a count.
 */
export default function HearingCard({
  row,
  now,
  durationMinutes,
  colleagues,
  mayWork,
  showCase = true,
  embedded = false,
  onChanged,
}: {
  row: HearingRow;
  /** The moment the server read the hearings: what "its time came" is measured from. */
  now: string;
  /** How long a hearing is taken to last (the setting's). */
  durationMinutes: number;
  colleagues: readonly Colleague[];
  /** The person writes hearings: who signs, or runs the deadlines. */
  mayWork: boolean;
  showCase?: boolean;
  /** Inside another card (a case's): drawn as a framed part of it. */
  embedded?: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [asking, setAsking] = useState<"edit" | "held" | "cancelled" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = momentIn(row.startsAt, row.timeZone);
  const zoneWords =
    row.timeZone !== "America/Sao_Paulo" && isHearingZone(row.timeZone) ? t(ZONE_KEY[row.timeZone]) : null;
  const starts = new Date(row.startsAt).getTime();
  const read = new Date(now).getTime();
  // From its start what came of it may be said; once it lasted, its time passed.
  const started = starts <= read;
  const passed = starts + Math.max(durationMinutes, 1) * 60_000 <= read;
  const titleId = `hearing-${row.id}`;

  const reopen = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await setHearingStatus({ hearingId: row.id, status: "scheduled" });
      if (!result.ok) setError(t(hearingErrorKey(result.code)));
      else onChanged();
    } catch {
      setError(t("hearing-error-failed"));
    } finally {
      setBusy(false);
    }
  };

  const meta = [
    showCase && row.caseSeq !== null ? caseLabel(row.caseSeq) : null,
    row.clientName,
    row.proceedingKind ? t(KIND_LABEL_KEY[row.proceedingKind] ?? "hearing-lawsuit-juizado") : null,
    row.cnj,
    row.court,
    row.comarca,
  ]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <>
      <Box className="flex flex-wrap items-start gap-3">
        <Box className="flex min-w-0 flex-1 flex-col gap-1">
          <Typography id={titleId} variant="subtitle2" component="h3" className="mb-0">
            {t(KIND_KEY[row.kind])}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {meta}
          </Typography>
        </Box>
        <StatusChip tone={STATUS_TONE[row.status]} label={t(STATUS_KEY[row.status])} />
        {row.calendarState ? (
          <StatusChip tone={CALENDAR_TONE[row.calendarState]} label={t(CALENDAR_KEY[row.calendarState])} />
        ) : null}
        {row.clientUnwarned ? <StatusChip tone="attention" label={t("hearing-client-unwarned")} /> : null}
      </Box>

      <Typography variant="h6" component="p" className="mb-0">
        {t("hearing-when", { weekday: when.weekday, day: when.day, time: when.time })}
        {zoneWords ? (
          <Typography component="span" variant="body2" className="text-text-secondary ml-2">
            {zoneWords}
          </Typography>
        ) : null}
      </Typography>

      <Box className="flex flex-col gap-1">
        <Typography variant="body2">{t(MODE_KEY[row.mode])}</Typography>
        {row.place ? <Typography variant="body2">{t("hearing-place", { place: row.place })}</Typography> : null}
        {row.link ? (
          <Typography variant="body2" className="break-all">
            {t("hearing-link")}{" "}
            <a href={row.link} target="_blank" rel="noreferrer noopener">
              {row.link}
            </a>
          </Typography>
        ) : null}
        {row.attendee ? (
          <Typography variant="body2">{t("hearing-attendee", { name: row.attendee })}</Typography>
        ) : row.status === "scheduled" ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("hearing-attendee-missing")}
          </Typography>
        ) : null}
        {row.notes ? (
          <Typography variant="body2" className="text-text-secondary">
            {row.notes}
          </Typography>
        ) : null}
        {row.createdAuto && row.createdLabel ? (
          <Typography variant="body2" className="text-text-secondary">
            {t(row.revision > 1 ? "hearing-created-auto-changed" : "hearing-created-auto", { when: row.createdLabel })}
          </Typography>
        ) : null}
      </Box>

      {row.publicationCancelPending && row.status === "scheduled" ? (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          {t("hearing-publication-cancelled")}
        </Alert>
      ) : null}

      {row.status === "held" ? (
        <Typography variant="body2">
          {row.outcome ? t(OUTCOME_SAID_KEY[row.outcome]) : t("hearing-outcome-none")}
          {row.outcomeNote ? ` ${row.outcomeNote}` : ""}
        </Typography>
      ) : null}
      {row.status === "cancelled" && row.outcomeNote ? (
        <Typography variant="body2">{t("hearing-cancel-reason", { reason: row.outcomeNote })}</Typography>
      ) : null}
      {row.status === "scheduled" && passed ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("hearing-ask-outcome")}
        </Alert>
      ) : null}

      {error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      ) : null}

      <Box className="border-grey-100 flex flex-wrap items-center gap-2 border-t pt-3">
        {mayWork && row.status === "scheduled" && started ? (
          <Button variant="contained" size="small" disabled={busy} onClick={() => setAsking("held")}>
            {t("hearing-action-held")}
          </Button>
        ) : null}
        {mayWork && row.status === "scheduled" && !started ? (
          <Button variant="outlined" color="grey" size="small" disabled={busy} onClick={() => setAsking("edit")}>
            {t("hearing-action-edit")}
          </Button>
        ) : null}
        {mayWork && row.status === "scheduled" ? (
          <Button variant="text" color="grey" size="small" disabled={busy} onClick={() => setAsking("cancelled")}>
            {t("hearing-action-cancel")}
          </Button>
        ) : null}
        {mayWork && row.status !== "scheduled" ? (
          <Button variant="text" color="grey" size="small" disabled={busy} onClick={() => void reopen()}>
            {t("hearing-action-reopen")}
          </Button>
        ) : null}
        {showCase ? (
          <Button variant="text" color="primary" size="small" href={`/casos/${row.caseId}`} LinkComponent={Link}>
            {t("hearing-open-case")}
          </Button>
        ) : null}
      </Box>
    </>
  );

  const dialogs = (
    <>
      {asking === "edit" ? (
        <HearingDialog
          editing={row}
          colleagues={colleagues}
          onClose={() => setAsking(null)}
          onSaved={() => {
            setAsking(null);
            onChanged();
          }}
        />
      ) : null}
      {asking === "held" || asking === "cancelled" ? (
        <OutcomeDialog
          hearingId={row.id}
          status={asking}
          onClose={() => setAsking(null)}
          onSaved={() => {
            setAsking(null);
            onChanged();
          }}
        />
      ) : null}
    </>
  );

  return embedded ? (
    <Box
      component="article"
      aria-labelledby={titleId}
      className="border-grey-100 flex flex-col gap-3 rounded-lg border p-3"
    >
      {body}
      {dialogs}
    </Box>
  ) : (
    <Card component="article" aria-labelledby={titleId}>
      <CardContent className="flex flex-col gap-3">{body}</CardContent>
      {dialogs}
    </Card>
  );
}

const OUTCOME_TITLE_KEY = { held: "hearing-held-title", cancelled: "hearing-cancelled-title" } as const;
const OUTCOME_INTRO_KEY = { held: "hearing-held-intro", cancelled: "hearing-cancelled-intro" } as const;
const OUTCOME_FIELD_KEY = { held: "hearing-field-held-note", cancelled: "hearing-field-cancel-reason" } as const;
const OUTCOME_SUBMIT_KEY = { held: "hearing-held-submit", cancelled: "hearing-cancelled-submit" } as const;

/** What came of a hearing (held, with what came of it), or why it was cancelled (required). */
function OutcomeDialog({
  hearingId,
  status,
  onClose,
  onSaved,
}: {
  hearingId: string;
  status: "held" | "cancelled";
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [outcome, setOutcome] = useState<HearingOutcome | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const valid = status === "held" || note.trim().length >= 8;
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await setHearingStatus({ hearingId, status, outcome: outcome || null, note: note.trim() || null });
      if (!result.ok) {
        setProblem(t(hearingErrorKey(result.code)));
        return;
      }
      onSaved();
    } catch {
      setProblem(t("hearing-error-failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="hearing-outcome-dialog">
      <DialogHeader
        id="hearing-outcome-dialog"
        title={t(OUTCOME_TITLE_KEY[status])}
        onClose={onClose}
        closeLabel={t("hearing-close")}
      />
      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void submit();
        }}
      >
        <DialogContent className="flex flex-col gap-3">
          <Typography variant="body2" className="text-text-secondary">
            {t(OUTCOME_INTRO_KEY[status])}
          </Typography>
          {status === "held" ? (
            <RadioGroup
              aria-label={t("hearing-field-outcome")}
              value={outcome}
              onChange={(event) => setOutcome(event.target.value as HearingOutcome)}
            >
              {HEARING_OUTCOMES.map((option) => (
                <FormControlLabel
                  key={option}
                  value={option}
                  disabled={busy}
                  control={<Radio size="small" />}
                  label={t(OUTCOME_KEY[option])}
                />
              ))}
            </RadioGroup>
          ) : null}
          <TextField
            size="small"
            id="hearing-outcome-note"
            label={t(OUTCOME_FIELD_KEY[status])}
            value={note}
            disabled={busy}
            multiline
            minRows={2}
            onChange={(event) => setNote(event.target.value.slice(0, 1000))}
          />
          {problem ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {problem}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("hearing-cancel")}
          </Button>
          <Button type="submit" variant="contained" disabled={busy || !valid}>
            {t(OUTCOME_SUBMIT_KEY[status])}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
