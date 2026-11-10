"use client";

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
  Typography,
} from "@mui/material";

import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import NiScale from "@/icons/nexture/ni-scale";
import { freeJusticeErrorKey, type FreeJusticeNeed } from "@/lib/cases/free-justice";
import { recordFreeJusticeAnswer } from "@/lib/cases/free-justice-actions";

const day = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(
        new Date(iso),
      )
    : "";

/**
 * Free justice in the civil court (migration 0125): each claimant of the lawsuit planned there, whether they ask for
 * it (answered on the link by who gives their word, or recorded by the firm with how), and where the declaration of
 * who asks stands. The piece and the filing wait for every answer; anybody of the firm records one given some other
 * way. In the small-claims court nothing is asked, so nothing shows.
 */
export default function FreeJusticeAnswers({
  caseId,
  needs,
  writable,
  onChanged,
}: {
  caseId: string;
  needs: FreeJusticeNeed[] | null;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [recording, setRecording] = useState<string | null>(null);
  if (!needs || needs.length === 0) return null;
  const open = needs.find((need) => need.partyId === recording) ?? null;

  const line = (need: FreeJusticeNeed) => {
    const when = { date: day(need.recordedAt) };
    switch (need.standing) {
      case "no_guardian":
        return <StateLine tone="attention">{t("free-justice-no-guardian", { name: need.name })}</StateLine>;
      case "waiting":
        return <StateLine tone="waiting">{t("free-justice-waiting")}</StateLine>;
      case "declined":
        return <StateLine tone="info">{t("free-justice-declined", when)}</StateLine>;
      case "issuing":
        return <StateLine tone="waiting">{t("free-justice-issuing", when)}</StateLine>;
      case "signing":
        return <StateLine tone="waiting">{t("free-justice-signing", when)}</StateLine>;
      case "signed":
        return <StateLine tone="done">{t("free-justice-signed", when)}</StateLine>;
    }
  };

  return (
    <Box className="border-grey-100 flex flex-col gap-3 border-t pt-5">
      <Typography variant="subtitle2" component="h3" className="mb-0">
        {t("free-justice-title")}
      </Typography>
      <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
        {needs.map((need) => (
          <Box
            component="li"
            key={need.partyId}
            className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <Box className="flex min-w-0 flex-1 flex-col gap-1">
              <Typography variant="body1">
                {need.minor && need.answererName
                  ? t("free-justice-person-minor", { name: need.name, guardian: need.answererName })
                  : need.name}
              </Typography>
              {line(need)}
              {need.note ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("free-justice-how", { note: need.note })}
                </Typography>
              ) : null}
              {need.asks && need.income ? <StateLine tone="info">{t("free-justice-income")}</StateLine> : null}
            </Box>
            {writable && need.answererId ? (
              <Box>
                <Button variant="text" color="grey" size="small" onClick={() => setRecording(need.partyId)}>
                  {need.asks === null ? t("free-justice-record") : t("free-justice-change")}
                </Button>
              </Box>
            ) : null}
          </Box>
        ))}
      </Box>
      {open ? (
        <AnswerPanel
          caseId={caseId}
          need={open}
          onClose={() => setRecording(null)}
          onSaved={() => {
            setRecording(null);
            onChanged();
          }}
          onStale={onChanged}
        />
      ) : null}
    </Box>
  );
}

/** The firm records an answer given some other way than the link, saying how. */
function AnswerPanel({
  caseId,
  need,
  onClose,
  onSaved,
  onStale,
}: {
  caseId: string;
  need: FreeJusticeNeed;
  onClose: () => void;
  onSaved: () => void;
  onStale: () => void;
}) {
  const t = useTranslations("product");
  const [asks, setAsks] = useState<"yes" | "no" | "">(need.asks === null ? "" : need.asks ? "yes" : "no");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    if (asks === "" || note.trim().length < 8) return setProblem("how_required");
    setBusy(true);
    setProblem(null);
    try {
      const result = await recordFreeJusticeAnswer(caseId, need.partyId, asks === "yes", note, need.answerId);
      if (result.ok) onSaved();
      else {
        setProblem(result.code);
        // Another answer came since the screen was read: the case is read again and the panel keeps what was typed.
        if (result.code === "answer_changed") onStale();
      }
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("free-justice-cancel")}
      icon={<NiScale size="medium" />}
      tone="primary"
      busy={busy}
      title={t("free-justice-panel-title", { name: need.name })}
      description={t("free-justice-panel-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? t("free-justice-saving") : t("free-justice-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("free-justice-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {t(freeJusticeErrorKey(problem))}
          </Alert>
        ) : null}
        <FormControl component="fieldset">
          <FormLabel component="legend" id="free-justice-asks" className="mb-1">
            {need.minor && need.answererName
              ? t("free-justice-question-minor", { name: need.name, guardian: need.answererName })
              : t("free-justice-question", { name: need.name })}
          </FormLabel>
          <RadioGroup
            aria-labelledby="free-justice-asks"
            name="asks"
            value={asks}
            onChange={(event) => setAsks(event.target.value as "yes" | "no")}
          >
            <FormControlLabel value="yes" control={<Radio />} label={t("free-justice-option-yes")} />
            <FormControlLabel value="no" control={<Radio />} label={t("free-justice-option-no")} />
          </RadioGroup>
        </FormControl>
        <TextField
          label={t("free-justice-note")}
          value={note}
          multiline
          minRows={2}
          onChange={(event) => setNote(event.target.value.slice(0, 500))}
          helperText={t("free-justice-note-help")}
        />
        <StateLine tone="info">{t("free-justice-risk")}</StateLine>
      </Box>
    </SidePanel>
  );
}
