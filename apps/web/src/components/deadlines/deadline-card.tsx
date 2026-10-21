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
  TextField,
  Typography,
} from "@mui/material";

import DeadlineCount from "@/components/deadlines/deadline-count";
import DeadlineDialog from "@/components/deadlines/deadline-dialog";
import DialogHeader from "@/components/product/dialog-header";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import { caseLabel } from "@/lib/cases/cases";
import {
  completeDeadline,
  confirmDeadline,
  dismissDeadline,
  reopenDeadline,
  retryDeadlineCount,
} from "@/lib/deadlines/actions";
import { daysBetween, deadlineErrorKey, type DeadlineStatus, STATUS_KEY, weekdayOf } from "@/lib/deadlines/deadlines";
import type { DeadlineAct, DeadlineRow } from "@/lib/deadlines/facts";
import { formatDayBr } from "@flyee/rules/person";

const STATUS_TONE: Record<DeadlineStatus, StatusTone> = {
  proposed: "attention",
  confirmed: "primary",
  done: "positive",
  dismissed: "neutral",
};

const day = (value: string): string => formatDayBr(value) ?? value;

const KIND_KEY: Record<string, string> = {
  juizado: "deadline-kind-juizado",
  comum: "deadline-kind-comum",
};

/** The words of the dialog that asks why a deadline never was, or what was done. */
const WORDS_KEY = {
  dismiss: {
    title: "deadline-dismiss-title",
    intro: "deadline-dismiss-intro",
    field: "deadline-field-dismiss-reason",
    submit: "deadline-dismiss-submit",
  },
  done: {
    title: "deadline-done-title",
    intro: "deadline-done-intro",
    field: "deadline-field-done-note",
    submit: "deadline-done-submit",
  },
} as const;

const DAY_TITLE_KEY = {
  other: "deadline-day-title-other",
  own: "deadline-day-title-own",
  keep: "deadline-day-title-keep",
} as const;

type Asking =
  | { kind: "day"; reason: "other" | "own" | "keep"; initial: string }
  | { kind: "dismiss" }
  | { kind: "done" }
  | { kind: "edit" }
  | null;

/**
 * One deadline: what is to be done, of which lawsuit, the day it is due and
 * how far that is, how the rule counted it (shown open while it waits for
 * confirmation, since that is what the person who confirms reads), what to
 * look at again and why, and the one thing it needs next. Who runs the
 * deadlines confirms the counted day in one click, or another with the
 * reason, and answers what it was asked to look at again by confirming it
 * again; who works on the lawsuits marks it done, corrects it, asks for its
 * count again or dismisses it.
 *
 * Closest component: a publication's card in `/publicacoes`, an article
 * with its source, its text and its answers; a deadline's text is its count.
 */
export default function DeadlineCard({
  row,
  today,
  soonDays,
  acts,
  mayConfirm,
  mayWork,
  showCase = true,
  embedded = false,
  onChanged,
}: {
  row: DeadlineRow;
  /** Brasília's today: how far the deadline is is counted from it. */
  today: string;
  /** Within how many days a deadline is due soon: the days the firm's home counts by. */
  soonDays: number;
  acts: readonly DeadlineAct[];
  /** The person confirms deadlines: a partner or the controladoria. */
  mayConfirm: boolean;
  /** The person proposes, corrects, completes and dismisses: who signs or runs the deadlines. */
  mayWork: boolean;
  /** Names the case: not on the case's own screen. */
  showCase?: boolean;
  /** Inside another card (a case's): drawn as a framed part of it, not as a card of its own. */
  embedded?: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [asking, setAsking] = useState<Asking>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [counting, setCounting] = useState(row.status === "proposed");

  const open = row.status === "proposed" || row.status === "confirmed";
  // How far it is, by the day it is urgent by: an earlier count after the confirmation is never shown later.
  const urgentOn = row.urgentOn ?? row.dueOn;
  const away = urgentOn && open ? daysBetween(today, urgentOn) : null;
  // What the database asks a person to look at again: the screen never decides it on its own.
  const changedCount = row.reviewReasons.includes("count_changed");
  const cancelledPending = row.reviewReasons.includes("publication_cancelled");
  const recounting = open && !row.counted && !row.countFailed && row.dueOn !== null;
  const confirmed = row.status === "confirmed";
  const recountingKey = confirmed ? "deadline-recounting-confirmed" : "deadline-recounting";
  // A proposed deadline counted before keeps the day of that count while the new one cannot be made.
  const failedKey = confirmed
    ? "deadline-count-failed-confirmed"
    : row.dueOn
      ? "deadline-count-failed-stale"
      : "deadline-count-failed";
  const cancelledKey = !confirmed
    ? "deadline-publication-cancelled"
    : cancelledPending
      ? "deadline-publication-cancelled-review"
      : "deadline-publication-cancelled-kept";
  const titleId = `deadline-${row.id}`;

  const run = async (action: () => Promise<{ ok: boolean; code: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(t(deadlineErrorKey(result.code)));
        return false;
      }
      onChanged();
      return true;
    } catch {
      setError(t("deadline-error-failed"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const confirmCounted = () => run(() => confirmDeadline({ deadlineId: row.id, revision: row.revision }));
  /** The confirmed day kept: in one click when it is the counted one, otherwise with why. */
  const keepDay = () => {
    if (row.counted && row.computedDueOn !== null && row.computedDueOn === row.dueOn) void confirmCounted();
    else setAsking({ kind: "day", reason: row.countFailed ? "own" : "keep", initial: row.dueOn ?? "" });
  };

  const awayLabel =
    away === null
      ? null
      : away === 0
        ? t("deadline-due-today")
        : away === 1
          ? t("deadline-due-tomorrow")
          : away > 1
            ? t("deadline-due-in", { count: away })
            : t("deadline-due-past", { count: -away });
  const awayTone: StatusTone =
    away === null ? "neutral" : away < 0 ? "danger" : away <= soonDays ? "attention" : "neutral";

  const meta = [
    showCase && row.caseSeq !== null ? caseLabel(row.caseSeq) : null,
    row.cnj,
    row.court,
    row.proceedingKind ? t(KIND_KEY[row.proceedingKind] ?? "deadline-kind-juizado") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const history = [
    row.proposedAuto && row.createdLabel
      ? t("deadline-proposed-auto", { when: row.createdLabel })
      : row.createdBy && row.createdLabel
        ? t("deadline-proposed-by", { name: row.createdBy, when: row.createdLabel })
        : null,
    row.confirmedAuto && row.confirmedLabel
      ? t("deadline-confirmed-auto", { when: row.confirmedLabel })
      : row.confirmedBy && row.confirmedLabel
        ? t("deadline-confirmed-by", { name: row.confirmedBy, when: row.confirmedLabel })
        : null,
    row.status === "done" && row.doneLabel
      ? t("deadline-done-by", { name: row.doneBy ?? t("deadline-someone"), when: row.doneLabel })
      : null,
    row.status === "dismissed" && row.dismissedLabel
      ? t("deadline-dismissed-by", { name: row.dismissedBy ?? t("deadline-someone"), when: row.dismissedLabel })
      : null,
  ].filter(Boolean);

  const body = (
    <>
      <Box className="flex flex-wrap items-start gap-3">
        <Box className="flex min-w-0 flex-1 flex-col gap-1">
          <Typography id={titleId} variant="subtitle2" component="h3" className="mb-0">
            {row.title}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {meta}
          </Typography>
        </Box>
        <StatusChip tone={STATUS_TONE[row.status]} label={t(STATUS_KEY[row.status])} />
        {awayLabel ? <StatusChip tone={awayTone} label={awayLabel} /> : null}
      </Box>

      {row.dueOn ? (
        <Typography variant="h6" component="p" className="mb-0">
          {t("deadline-due-on", { day: day(row.dueOn), weekday: weekdayOf(row.dueOn) })}
        </Typography>
      ) : open && !row.countFailed ? (
        <Typography variant="body2" className="text-text-secondary" role="status">
          {t("deadline-counting-now")}
        </Typography>
      ) : null}

      {recounting ? (
        <Typography variant="body2" className="text-text-secondary" role="status">
          {t(recountingKey)}
        </Typography>
      ) : null}

      {open && row.countFailed ? (
        <Alert
          severity={row.reviewReasons.includes("count_failed") ? "warning" : "info"}
          className="neutral bg-background-paper/60!"
          action={
            mayWork ? (
              <Button
                color="inherit"
                size="small"
                disabled={busy}
                onClick={() => void run(() => retryDeadlineCount(row.id))}
              >
                {t("deadline-action-retry")}
              </Button>
            ) : undefined
          }
        >
          {t(failedKey)}
        </Alert>
      ) : null}

      {row.corrected && row.correctionReason ? (
        <Typography variant="body2" className="text-text-secondary">
          {row.confirmedAgainst
            ? t("deadline-corrected", { counted: day(row.confirmedAgainst), reason: row.correctionReason })
            : t("deadline-corrected-own", { reason: row.correctionReason })}
        </Typography>
      ) : null}

      {open && row.publicationActive === false ? (
        <Alert
          severity={cancelledPending ? "warning" : "info"}
          className="neutral bg-background-paper/60!"
          action={
            cancelledPending && confirmed && mayConfirm && row.dueOn ? (
              <Button color="inherit" size="small" disabled={busy} onClick={keepDay}>
                {t("deadline-action-keep", { day: day(row.dueOn) })}
              </Button>
            ) : undefined
          }
        >
          {t(cancelledKey)}
        </Alert>
      ) : null}

      {changedCount && row.computedDueOn && row.dueOn ? (
        <Alert
          severity="warning"
          className="neutral bg-background-paper/60!"
          action={
            mayConfirm ? (
              <Box className="flex flex-col gap-1">
                <Button color="inherit" size="small" disabled={busy} onClick={() => void confirmCounted()}>
                  {t("deadline-action-confirm", { day: day(row.computedDueOn) })}
                </Button>
                <Button
                  color="inherit"
                  size="small"
                  disabled={busy}
                  onClick={() => setAsking({ kind: "day", reason: "keep", initial: row.dueOn ?? "" })}
                >
                  {t("deadline-action-keep", { day: day(row.dueOn) })}
                </Button>
              </Box>
            ) : undefined
          }
        >
          {t("deadline-count-changed", { counted: day(row.computedDueOn), due: day(row.dueOn) })}
        </Alert>
      ) : null}

      {row.count ? (
        counting ? (
          <Box className="flex flex-col gap-2">
            <DeadlineCount count={row.count} checked={row.calendarChecked} />
            {row.status !== "proposed" ? (
              <Box>
                <Button variant="text" color="grey" size="small" className="-ml-2" onClick={() => setCounting(false)}>
                  {t("deadline-hide-count")}
                </Button>
              </Box>
            ) : null}
          </Box>
        ) : (
          <Box>
            <Button variant="text" color="grey" size="small" className="-ml-2" onClick={() => setCounting(true)}>
              {t("deadline-show-count")}
            </Button>
          </Box>
        )
      ) : null}

      {row.status === "done" && row.doneNote ? (
        <Typography variant="body2">{t("deadline-done-note", { note: row.doneNote })}</Typography>
      ) : null}
      {row.status === "dismissed" && row.dismissReason ? (
        <Typography variant="body2">{t("deadline-dismiss-reason", { reason: row.dismissReason })}</Typography>
      ) : null}

      {history.length > 0 ? (
        <Typography variant="body2" className="text-text-secondary">
          {history.join(" · ")}
        </Typography>
      ) : null}

      {error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      ) : null}

      <Box className="border-grey-100 flex flex-wrap items-center gap-2 border-t pt-3">
        {row.status === "proposed" && mayConfirm && row.counted && row.computedDueOn ? (
          <>
            <Button variant="contained" size="small" disabled={busy} onClick={() => void confirmCounted()}>
              {t("deadline-action-confirm", { day: day(row.computedDueOn) })}
            </Button>
            <Button
              variant="outlined"
              color="grey"
              size="small"
              disabled={busy}
              onClick={() => setAsking({ kind: "day", reason: "other", initial: row.computedDueOn ?? "" })}
            >
              {t("deadline-action-confirm-other")}
            </Button>
          </>
        ) : null}
        {open && mayConfirm && row.countFailed ? (
          <Button
            variant="contained"
            size="small"
            disabled={busy}
            onClick={() => setAsking({ kind: "day", reason: "own", initial: "" })}
          >
            {t("deadline-action-confirm-own")}
          </Button>
        ) : null}
        {row.status === "confirmed" && mayWork ? (
          <Button variant="contained" size="small" disabled={busy} onClick={() => setAsking({ kind: "done" })}>
            {t("deadline-action-done")}
          </Button>
        ) : null}
        {open && mayWork ? (
          <>
            <Button
              variant="text"
              color="grey"
              size="small"
              disabled={busy}
              onClick={() => setAsking({ kind: "edit" })}
            >
              {t("deadline-action-edit")}
            </Button>
            {row.status === "proposed" ? (
              <Button
                variant="text"
                color="grey"
                size="small"
                disabled={busy}
                onClick={() => setAsking({ kind: "done" })}
              >
                {t("deadline-action-done")}
              </Button>
            ) : null}
            <Button
              variant="text"
              color="grey"
              size="small"
              disabled={busy}
              onClick={() => setAsking({ kind: "dismiss" })}
            >
              {t("deadline-action-dismiss")}
            </Button>
          </>
        ) : null}
        {!open && mayWork ? (
          <Button
            variant="text"
            color="grey"
            size="small"
            disabled={busy}
            onClick={() => void run(() => reopenDeadline(row.id))}
          >
            {t("deadline-action-reopen")}
          </Button>
        ) : null}
        {showCase && row.caseId ? (
          <Button variant="text" color="primary" size="small" href={`/casos/${row.caseId}`} LinkComponent={Link}>
            {t("deadline-open-case")}
          </Button>
        ) : null}
      </Box>
    </>
  );

  const dialogs = (
    <>
      {asking?.kind === "day" ? (
        <DayDialog
          reason={asking.reason}
          counted={row.counted ? row.computedDueOn : null}
          initial={asking.initial}
          onClose={() => setAsking(null)}
          onConfirm={(dueOn, reason) =>
            run(() => confirmDeadline({ deadlineId: row.id, revision: row.revision, dueOn, reason })).then((done) => {
              if (done) setAsking(null);
              return done;
            })
          }
          error={error}
          busy={busy}
        />
      ) : null}
      {asking?.kind === "dismiss" || asking?.kind === "done" ? (
        <WordsDialog
          kind={asking.kind}
          onClose={() => setAsking(null)}
          onConfirm={(words) =>
            run(() =>
              asking.kind === "dismiss"
                ? dismissDeadline({ deadlineId: row.id, reason: words })
                : completeDeadline({ deadlineId: row.id, note: words || null }),
            ).then((done) => {
              if (done) setAsking(null);
              return done;
            })
          }
          error={error}
          busy={busy}
        />
      ) : null}
      {asking?.kind === "edit" ? (
        <DeadlineDialog
          editing={{
            deadlineId: row.id,
            title: row.title,
            act: row.act,
            trigger: row.trigger,
            triggerOn: row.triggerOn,
            days: row.days,
            counting: row.counting,
            availableOn: row.publicationAvailableOn,
            proceedingKind: row.proceedingKind,
          }}
          acts={acts}
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

/** A day of the person's own, with why: another day than the counted one, a day for a deadline nobody could count, or the confirmed day kept after the count changed. */
function DayDialog({
  reason,
  counted,
  initial,
  onClose,
  onConfirm,
  error,
  busy,
}: {
  reason: "other" | "own" | "keep";
  counted: string | null;
  initial: string;
  onClose: () => void;
  onConfirm: (dueOn: string, reason: string) => Promise<boolean>;
  error: string | null;
  busy: boolean;
}) {
  const t = useTranslations("product");
  const [chosen, setChosen] = useState(initial);
  const [why, setWhy] = useState("");
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(chosen) && why.trim().length >= 8;
  const later = counted !== null && /^\d{4}-\d{2}-\d{2}$/.test(chosen) && chosen > counted;
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="deadline-day-dialog">
      <DialogHeader
        id="deadline-day-dialog"
        title={t(DAY_TITLE_KEY[reason])}
        onClose={onClose}
        closeLabel={t("deadline-close")}
      />
      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void onConfirm(chosen, why.trim());
        }}
      >
        <DialogContent className="flex flex-col gap-3">
          <Typography variant="body2" className="text-text-secondary">
            {counted ? t("deadline-day-intro-counted", { counted: day(counted) }) : t("deadline-day-intro-own")}
          </Typography>
          <TextField
            size="small"
            type="date"
            id="deadline-day"
            label={t("deadline-field-due-on")}
            value={chosen}
            disabled={busy}
            onChange={(event) => setChosen(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          {later ? (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              {t("deadline-day-later")}
            </Alert>
          ) : null}
          <TextField
            size="small"
            id="deadline-day-reason"
            label={t("deadline-field-reason")}
            value={why}
            disabled={busy}
            multiline
            minRows={2}
            onChange={(event) => setWhy(event.target.value.slice(0, 1000))}
            helperText={t("deadline-field-reason-help")}
          />
          {error ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {error}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("deadline-cancel")}
          </Button>
          <Button type="submit" variant="contained" disabled={busy || !valid}>
            {t("deadline-day-submit")}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

/** Why a deadline never was (required), or a note of what was done (optional). */
function WordsDialog({
  kind,
  onClose,
  onConfirm,
  error,
  busy,
}: {
  kind: "dismiss" | "done";
  onClose: () => void;
  onConfirm: (words: string) => Promise<boolean>;
  error: string | null;
  busy: boolean;
}) {
  const t = useTranslations("product");
  const [words, setWords] = useState("");
  const valid = kind === "done" || words.trim().length >= 8;
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="deadline-words-dialog">
      <DialogHeader
        id="deadline-words-dialog"
        title={t(WORDS_KEY[kind].title)}
        onClose={onClose}
        closeLabel={t("deadline-close")}
      />
      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void onConfirm(words.trim());
        }}
      >
        <DialogContent className="flex flex-col gap-3">
          <Typography variant="body2" className="text-text-secondary">
            {t(WORDS_KEY[kind].intro)}
          </Typography>
          <TextField
            size="small"
            id="deadline-words"
            label={t(WORDS_KEY[kind].field)}
            value={words}
            disabled={busy}
            multiline
            minRows={2}
            onChange={(event) => setWords(event.target.value.slice(0, 1000))}
          />
          {error ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {error}
            </Alert>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("deadline-cancel")}
          </Button>
          <Button type="submit" variant="contained" disabled={busy || !valid}>
            {t(WORDS_KEY[kind].submit)}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
