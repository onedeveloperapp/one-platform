"use client";

import type { CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
} from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import InfoHint from "@/components/product/info-hint";
import QuickActions from "@/components/product/quick-actions";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import NiCalendar from "@/icons/nexture/ni-calendar";
import { decideOralArgument, recordJudgmentSession, withdrawJudgmentSession } from "@/lib/courts/session-actions";
import { type JudgmentSession, oralStanding, sessionErrorKey, sessionToShow } from "@/lib/courts/sessions";

type Ready = Extract<CaseState, { kind: "ready" }>;

const longDay = (day: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );

/** Today and the hour now in Brasília: what the limit to register is measured against. */
function nowInBrasilia(): { today: string; now: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const of = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { today: `${of("year")}-${of("month")}-${of("day")}`, now: `${of("hour")}:${of("minute")}` };
}

/**
 * The session of judgment of a lawsuit's appeal and the registration for oral argument (migration 0219): ONE puts the
 * session the pauta sets on the firm's agenda and counts until when a lawyer registers to argue, by the court's rule;
 * the lawyer registers in the court's system and says so here, or says the firm will not argue. A session ONE did
 * not read is recorded by hand, the exception; one taken off the pauta is withdrawn with why. The client hears
 * nothing of it. Shown once the lawsuit has an appeal, or a session.
 */
export default function JudgmentSessionBlock({
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
  const [problem, setProblem] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [withdrawing, setWithdrawing] = useState<JudgmentSession | null>(null);
  const session = sessionToShow(state.sessions, proceedingId);
  const path = state.judgmentPaths.find((item) => item.proceedingId === proceedingId) ?? null;
  const appealed =
    path?.decision === "recurso_inominado" ||
    path?.decision === "apelacao" ||
    (state.outcomes ?? []).some(
      (fact) => fact.proceedingId === proceedingId && fact.kind === "recurso" && !fact.corrected,
    );
  if (!session && !appealed) return null;
  const lawyer = writable && state.lawyer && !state.supportVisit;

  const run = async (work: () => Promise<{ ok: boolean; code?: string }>): Promise<string | null> => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await work();
      if (!result.ok) {
        const code = result.code ?? "failed";
        setProblem(code);
        return code;
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

  const record = writable
    ? { key: "record", label: t("session-record"), disabled: busy, onClick: () => setRecording(true) }
    : null;

  const sessionLine = () => {
    if (!session) {
      // ONE's work: the session comes with its pauta. Recording it by hand stays the exception.
      return (
        <StateLine
          tone="waiting"
          action={record ? <QuickActions label={t("session-actions")} actions={[record]} /> : undefined}
        >
          {t("session-waiting")}
        </StateLine>
      );
    }
    if (session.status === "withdrawn") {
      return (
        <StateLine
          tone="info"
          action={record ? <QuickActions label={t("session-actions")} actions={[record]} /> : undefined}
        >
          {t("session-withdrawn", { day: longDay(session.startsOn), reason: session.withdrawReason ?? "" })}
        </StateLine>
      );
    }
    const virtual = session.kind === "virtual";
    const words = session.startsAt
      ? t(virtual ? "session-virtual-at" : "session-presencial-at", {
          day: longDay(session.startsOn),
          time: session.startsAt,
        })
      : t(virtual ? "session-virtual" : "session-presencial", { day: longDay(session.startsOn) });
    return (
      <StateLine
        tone="info"
        action={
          writable ? (
            <QuickActions
              label={t("session-actions")}
              actions={[
                ...(record ? [record] : []),
                {
                  key: "withdraw",
                  label: t("session-withdraw"),
                  disabled: busy,
                  onClick: () => setWithdrawing(session),
                },
              ]}
            />
          ) : undefined
        }
      >
        {words}
      </StateLine>
    );
  };

  const oralLine = () => {
    if (!session || session.status !== "scheduled") return null;
    const { today, now } = nowInBrasilia();
    const standing = oralStanding(session, today, now);
    // The act that sets the limit, behind the "i" beside its line.
    const basis = session.limitBasis ? (
      <InfoHint label={t("session-basis", { basis: session.limitBasis })} className="ml-1 align-middle" />
    ) : null;
    const limit =
      session.limitOn && session.limitHour
        ? t("session-limit-at", { day: longDay(session.limitOn), time: session.limitHour })
        : session.limitOn
          ? t("session-limit-opening", { day: longDay(session.limitOn) })
          : "";
    switch (standing) {
      case "registered":
      case "declined": {
        const registered = standing === "registered";
        return (
          <StateLine
            tone={registered ? "done" : "info"}
            action={
              lawyer ? (
                <QuickActions
                  label={t("session-actions")}
                  actions={[
                    {
                      key: "undo",
                      label: t("session-oral-undo"),
                      disabled: busy,
                      onClick: () => void run(() => decideOralArgument(state.case.id, session.id, null)),
                    },
                  ]}
                />
              ) : undefined
            }
          >
            {t(registered ? "session-oral-registered" : "session-oral-declined", {
              who: session.oralBy ?? "",
            })}
          </StateLine>
        );
      }
      case "counting":
        return <StateLine tone="waiting">{t("session-oral-counting")}</StateLine>;
      case "uncounted": {
        // A limit counted from the pauta's publication, of a session a person recorded (0226): ONE has no day to count from.
        const noPublication = session.limitError === "no_publication";
        return (
          <StateLine tone="attention">
            {t(noPublication ? "session-oral-no-publication" : "session-oral-uncounted")}
          </StateLine>
        );
      }
      case "passed":
        return (
          <StateLine tone="info">
            {t("session-oral-passed", { limit })}
            {basis}
          </StateLine>
        );
      case "open":
        return (
          <StateLine
            tone="attention"
            action={
              lawyer ? (
                <QuickActions
                  label={t("session-actions")}
                  actions={[
                    {
                      key: "registered",
                      label: t("session-oral-mark-registered"),
                      disabled: busy,
                      onClick: () => void run(() => decideOralArgument(state.case.id, session.id, "registered")),
                    },
                    {
                      key: "declined",
                      label: t("session-oral-mark-declined"),
                      disabled: busy,
                      onClick: () => void run(() => decideOralArgument(state.case.id, session.id, "declined")),
                    },
                  ]}
                />
              ) : undefined
            }
          >
            {t("session-oral-open", { limit })}
            {basis}
          </StateLine>
        );
    }
  };

  return (
    <Box className="flex flex-col gap-1">
      {sessionLine()}
      {oralLine()}
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(sessionErrorKey(problem))}
        </Alert>
      ) : null}
      {recording ? (
        <RecordPanel
          caseId={state.case.id}
          proceedingId={proceedingId}
          onClose={() => setRecording(false)}
          onSaved={() => {
            setRecording(false);
            onChanged();
          }}
        />
      ) : null}
      {withdrawing ? (
        <ConfirmActionDialog
          title={t("session-withdraw-title", { day: longDay(withdrawing.startsOn) })}
          consequences={[t("session-withdraw-consequence")]}
          requireReason
          reasonLabel={t("session-withdraw-reason")}
          reasonMinLength={3}
          confirmLabel={t("session-withdraw")}
          cancelLabel={t("cases-cancel")}
          busyLabel={t("cases-working")}
          onConfirm={async (reason) => {
            const refused = await run(() => withdrawJudgmentSession(state.case.id, withdrawing.id, reason));
            return refused ? t(sessionErrorKey(refused)) : null;
          }}
          onClose={() => setWithdrawing(null)}
        />
      ) : null}
    </Box>
  );
}

/** A session ONE did not read, recorded by hand: its kind, its day and, when the pauta says it, its hour. */
function RecordPanel({
  caseId,
  proceedingId,
  onClose,
  onSaved,
}: {
  caseId: string;
  proceedingId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [kind, setKind] = useState<"virtual" | "presencial">("virtual");
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setProblem("invalid_data");
    setBusy(true);
    setProblem(null);
    try {
      const result = await recordJudgmentSession(caseId, proceedingId, kind, day, time);
      if (result.ok) onSaved();
      else setProblem(result.code);
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("cases-cancel")}
      icon={<NiCalendar size="medium" />}
      tone="primary"
      busy={busy}
      title={t("session-panel-title")}
      description={t("session-panel-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? t("cases-working") : t("session-panel-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("cases-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {t(sessionErrorKey(problem))}
          </Alert>
        ) : null}
        <FormControl component="fieldset">
          <FormLabel component="legend" id="session-kind" className="mb-1">
            {t("session-panel-kind")}
          </FormLabel>
          <RadioGroup
            aria-labelledby="session-kind"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value === "presencial" ? "presencial" : "virtual")}
          >
            <FormControlLabel value="virtual" control={<Radio />} label={t("session-panel-virtual")} />
            <FormControlLabel value="presencial" control={<Radio />} label={t("session-panel-presencial")} />
          </RadioGroup>
        </FormControl>
        <TextField
          type="date"
          label={t("session-panel-day")}
          value={day}
          onChange={(event) => setDay(event.target.value)}
          required
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          type="time"
          label={t("session-panel-time")}
          helperText={t("session-panel-time-help")}
          value={time}
          onChange={(event) => setTime(event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Box>
    </SidePanel>
  );
}
