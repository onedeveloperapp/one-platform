"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import DeadlineCount from "@/components/deadlines/deadline-count";
import SidePanel from "@/components/product/side-panel";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import { previewDeadline, proposeDeadline, updateDeadline } from "@/lib/deadlines/actions";
import { COUNTING_KEY, deadlineErrorKey, isDeadlineField, weekdayOf } from "@/lib/deadlines/deadlines";
import type { DeadlineAct } from "@/lib/deadlines/facts";
import {
  DEADLINE_COUNTINGS,
  type DeadlineCounting,
  type DeadlineResult,
  type DeadlineTrigger,
} from "@flyee/rules/deadlines";
import { formatDayBr } from "@flyee/rules/person";

/** What a new deadline is of: a publication (it may run from the day the DJEN made it available) or a filed lawsuit. */
export type DeadlineSubject =
  | { kind: "publication"; publicationId: string; availableOn: string; proceedingKind: string | null }
  | { kind: "lawsuit"; proceedingId: string; proceedingKind: string | null };

/** A deadline whose inputs a person corrects. */
export type DeadlineEditing = {
  deadlineId: string;
  title: string;
  act: string | null;
  trigger: DeadlineTrigger;
  triggerOn: string;
  days: number;
  counting: DeadlineCounting;
  /** The day the DJEN made its publication available, when it came from one. */
  availableOn: string | null;
  proceedingKind: string | null;
};

/** How long the form waits after the last change before it asks for the count again. */
const PREVIEW_DELAY_MS = 400;
const OTHER_ACT = "";

/** The fields the form shows an error beside; the database's word on any other is said above the buttons. */
const FIELDS_WITH_INPUT = new Set(["title", "days", "trigger_on"]);

/** What a refusal of a field with no input of its own is called. */
const FIELD_ERROR_KEY: Record<string, string> = {
  act: "deadline-error-field-act",
  trigger: "deadline-error-field-trigger",
  counting: "deadline-error-field-counting",
};

type Preview =
  | { state: "idle" }
  | { state: "counting" }
  | { state: "ready"; result: DeadlineResult }
  | { state: "error"; code: string; field?: string };

/**
 * Where a person says what a deadline is: the act (from the list of the
 * terms the law gives, or another), how many days and how they count, and
 * from what day. The count is shown as it is typed, as the backend will
 * count it, with what it could not know: the person sends it to be
 * confirmed knowing the day. Correcting a deadline is the same form: a
 * change of what it is counted from sends it back to be counted and
 * confirmed, and a change of its words alone keeps both. An act the operator
 * took off the list is offered only to the deadline that already has it.
 *
 * It opens in the panel at the side of the page (`SidePanel`, the screen pattern of 2026-11-07), as every
 * registration does, with the count under the fields. Opened from the "Adicionar" of the top, it has no lawsuit
 * yet: `lead` asks for the case and the lawsuit first, and the fields show once there is one.
 */
export default function DeadlinePanel({
  subject,
  editing,
  existing,
  acts,
  lead,
  panelTitle,
  onClose,
  onSaved,
}: {
  subject?: DeadlineSubject;
  editing?: DeadlineEditing;
  /** The titles of the open deadlines the publication already has (ONE's, or a person's): one more is a choice. */
  existing?: readonly string[];
  acts: readonly DeadlineAct[];
  /** What comes before the fields: the choice of the case and the lawsuit, when the panel opened with none. */
  lead?: ReactNode;
  /** The panel's name, when the entry that opened it calls it otherwise ("Novo prazo" in the "Adicionar"). */
  panelTitle?: string;
  onClose: () => void;
  onSaved: (saved: { dueOn: string | null; counted: boolean }) => void;
}) {
  const t = useTranslations("product");
  const availableOn = editing ? editing.availableOn : subject?.kind === "publication" ? subject.availableOn : null;
  const publicationId = subject?.kind === "publication" ? subject.publicationId : null;
  const proceedingId = subject?.kind === "lawsuit" ? subject.proceedingId : null;
  const deadlineId = editing?.deadlineId ?? null;
  const proceedingKind = editing ? editing.proceedingKind : (subject?.proceedingKind ?? null);
  const currentAct = editing?.act ?? null;
  const offered = useMemo(
    () =>
      acts.filter(
        (act) =>
          act.slug === currentAct ||
          (act.active &&
            (act.proceedingKinds.length === 0 || !proceedingKind || act.proceedingKinds.includes(proceedingKind))),
      ),
    [acts, proceedingKind, currentAct],
  );

  // The acts taken off the list are read too, so the deadline's own is always one of them.
  const [act, setAct] = useState(
    editing?.act && acts.some((item) => item.slug === editing.act) ? editing.act : OTHER_ACT,
  );
  const [title, setTitle] = useState(editing?.title ?? "");
  const [days, setDays] = useState(editing ? String(editing.days) : "");
  const [counting, setCounting] = useState<DeadlineCounting>(editing?.counting ?? "business");
  const [trigger, setTrigger] = useState<DeadlineTrigger>(editing?.trigger ?? (availableOn ? "publication" : "day"));
  const [triggerOn, setTriggerOn] = useState(editing && editing.trigger === "day" ? editing.triggerOn : "");
  const [preview, setPreview] = useState<Preview>({ state: "idle" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field: string | null } | null>(null);
  const asked = useRef(0);

  const dayCount = Number(days);
  const daysValid = Number.isInteger(dayCount) && dayCount >= 1 && dayCount <= 365;
  const startValid = trigger === "publication" ? Boolean(availableOn) : /^\d{4}-\d{2}-\d{2}$/.test(triggerOn);
  const titleValid = title.trim().length >= 2;
  // Opened with no lawsuit (the "Adicionar" of the top): nothing is counted nor sent until one is chosen.
  const waiting = !editing && !subject;

  const chooseAct = (slug: string) => {
    const before = offered.find((item) => item.slug === act);
    const chosen = offered.find((item) => item.slug === slug);
    setAct(slug);
    if (!chosen) return;
    // The name follows the act, unless the person wrote their own.
    if (!title.trim() || title.trim() === before?.name) setTitle(chosen.name);
    setDays(String(chosen.days));
    setCounting(chosen.counting);
  };

  useEffect(() => {
    if (waiting || !daysValid || !startValid) {
      setPreview({ state: "idle" });
      return;
    }
    const mine = asked.current + 1;
    asked.current = mine;
    setPreview({ state: "counting" });
    const timer = setTimeout(async () => {
      let next: Preview;
      try {
        const result = await previewDeadline({
          publicationId,
          proceedingId,
          deadlineId,
          trigger,
          triggerOn: trigger === "day" ? triggerOn : null,
          days: dayCount,
          counting,
        });
        next = result.ok
          ? { state: "ready", result: result.result }
          : { state: "error", code: result.code, field: result.field };
      } catch {
        next = { state: "error", code: "failed" };
      }
      // A count asked before the last change is nobody's.
      if (asked.current === mine) setPreview(next);
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [waiting, publicationId, proceedingId, deadlineId, trigger, triggerOn, dayCount, counting, daysValid, startValid]);

  const submit = async () => {
    if (waiting) return;
    if (!titleValid || !daysValid || !startValid) {
      setProblem({ code: "invalid_data", field: !titleValid ? "title" : !daysValid ? "days" : "trigger_on" });
      return;
    }
    setBusy(true);
    setProblem(null);
    const fields = {
      title: title.trim(),
      act: act || null,
      trigger,
      triggerOn: trigger === "day" ? triggerOn : null,
      days: dayCount,
      counting,
    };
    try {
      const result = deadlineId
        ? await updateDeadline({ ...fields, deadlineId })
        : await proposeDeadline({ ...fields, publicationId, proceedingId });
      if (!result.ok) {
        setProblem({ code: result.code, field: isDeadlineField(result.field) ? result.field : null });
        return;
      }
      onSaved({ dueOn: result.dueOn ?? null, counted: Boolean(result.counted) });
    } catch {
      setProblem({ code: "failed", field: null });
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (field: string) => (problem?.field === field ? t(deadlineErrorKey(problem.code)) : undefined);
  const chosenAct = offered.find((item) => item.slug === act) ?? null;

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("deadline-close")}
      title={panelTitle ?? t(editing ? "deadline-dialog-edit-title" : "deadline-dialog-title")}
      description={t(editing ? "deadline-dialog-edit-intro" : "deadline-dialog-intro")}
      icon={<NiCalendarClock size="medium" />}
      tone="accent-3"
      busy={busy}
      onSubmit={() => void submit()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || waiting}>
            {t(editing ? "deadline-submit-edit" : "deadline-submit-propose")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("deadline-cancel")}
          </Button>
        </>
      }
    >
      {lead}
      {!editing && existing && existing.length > 0 ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("deadline-dialog-existing", { titles: existing.join(", ") })}
        </Alert>
      ) : null}
      {waiting ? null : (
        <>
          <Box className="flex flex-col gap-3">
            <TextField
              select
              fullWidth
              size="small"
              id="deadline-act"
              label={t("deadline-field-act")}
              value={act}
              disabled={busy}
              onChange={(event) => chooseAct(event.target.value)}
              helperText={
                chosenAct
                  ? t("deadline-field-act-basis", { basis: chosenAct.basis, count: chosenAct.days })
                  : t("deadline-field-act-help")
              }
            >
              {offered.map((item) => (
                <MenuItem key={item.slug} value={item.slug}>
                  {item.active ? item.name : t("deadline-field-act-retired", { name: item.name })}
                </MenuItem>
              ))}
              <MenuItem value={OTHER_ACT}>{t("deadline-field-act-other")}</MenuItem>
            </TextField>
            <TextField
              fullWidth
              size="small"
              id="deadline-title"
              label={t("deadline-field-title")}
              value={title}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value.slice(0, 200))}
              error={Boolean(fieldError("title"))}
              helperText={fieldError("title") ?? t("deadline-field-title-help")}
            />
            <Box className="flex gap-2">
              <TextField
                size="small"
                id="deadline-days"
                label={t("deadline-field-days")}
                value={days}
                disabled={busy}
                onChange={(event) => setDays(event.target.value.replace(/\D/g, "").slice(0, 3))}
                error={Boolean(fieldError("days")) || (days !== "" && !daysValid)}
                helperText={
                  fieldError("days") ?? (days !== "" && !daysValid ? t("deadline-error-invalid-days") : undefined)
                }
                slotProps={{ htmlInput: { inputMode: "numeric", autoComplete: "off" } }}
                className="w-32"
              />
              <TextField
                select
                size="small"
                id="deadline-counting"
                label={t("deadline-field-counting")}
                value={counting}
                disabled={busy}
                onChange={(event) => setCounting(event.target.value as DeadlineCounting)}
                className="min-w-0 flex-1"
              >
                {DEADLINE_COUNTINGS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {t(COUNTING_KEY[option])}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            <Box className="flex flex-col gap-1">
              <Typography id="deadline-trigger" variant="body2" className="font-semibold">
                {t("deadline-field-trigger")}
              </Typography>
              {availableOn ? (
                <RadioGroup
                  aria-labelledby="deadline-trigger"
                  value={trigger}
                  onChange={(event) => setTrigger(event.target.value as DeadlineTrigger)}
                >
                  <FormControlLabel
                    value="publication"
                    disabled={busy}
                    control={<Radio size="small" />}
                    label={t("deadline-field-trigger-publication", { day: formatDayBr(availableOn) ?? availableOn })}
                  />
                  <FormControlLabel
                    value="day"
                    disabled={busy}
                    control={<Radio size="small" />}
                    label={t("deadline-field-trigger-day")}
                  />
                </RadioGroup>
              ) : null}
              {trigger === "day" ? (
                <TextField
                  size="small"
                  type="date"
                  id="deadline-trigger-on"
                  label={t("deadline-field-trigger-on")}
                  value={triggerOn}
                  disabled={busy}
                  onChange={(event) => setTriggerOn(event.target.value)}
                  error={Boolean(fieldError("trigger_on"))}
                  helperText={fieldError("trigger_on") ?? t("deadline-field-trigger-on-help")}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              ) : null}
            </Box>
          </Box>
          <Box
            component="section"
            aria-labelledby="deadline-preview"
            aria-live="polite"
            className="border-grey-100 flex flex-col gap-2 rounded-lg border p-3"
          >
            <Typography id="deadline-preview" variant="subtitle2" component="h3" className="mb-0">
              {t("deadline-preview-title")}
            </Typography>
            {preview.state === "idle" ? (
              <Typography variant="body2" className="text-text-secondary">
                {t("deadline-preview-idle")}
              </Typography>
            ) : null}
            {preview.state === "counting" ? (
              <Box className="flex items-center gap-2">
                <CircularProgress size={18} aria-hidden />
                <Typography variant="body2" className="text-text-secondary">
                  {t("deadline-preview-counting")}
                </Typography>
              </Box>
            ) : null}
            {preview.state === "error" ? (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {t(deadlineErrorKey(preview.code))}
              </Alert>
            ) : null}
            {preview.state === "ready" ? (
              <>
                <Typography variant="h6" component="p" className="mb-0">
                  {t("deadline-due-on", {
                    day: formatDayBr(preview.result.dueOn) ?? preview.result.dueOn,
                    weekday: weekdayOf(preview.result.dueOn),
                  })}
                </Typography>
                <DeadlineCount count={preview.result} />
              </>
            ) : null}
          </Box>
        </>
      )}
      {problem && (!problem.field || !FIELDS_WITH_INPUT.has(problem.field)) ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {t(
            problem.field && problem.code === "invalid_data" && FIELD_ERROR_KEY[problem.field]
              ? FIELD_ERROR_KEY[problem.field]
              : deadlineErrorKey(problem.code),
          )}
        </Alert>
      ) : null}
    </SidePanel>
  );
}
