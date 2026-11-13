"use client";

import { ClientSection } from "./client-section";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, TextField, Typography } from "@mui/material";

import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiTextQuote from "@/icons/nexture/ni-text-quote";
import { answerClientInterview } from "@/lib/cases/client-link-actions";
import { type InterviewView, nextStep, questionText } from "@/lib/cases/interview";
import { statementErrorKey } from "@/lib/cases/statements";
import { interviewProgress, QUESTION_SHAPE } from "@flyee/rules/interview";

/**
 * The interview of the client's case on their link (migration 0095): one question per screen, the next only after
 * the one before, each in the shape it takes (a yes or a no, a day and its hour, their words), and "I do not
 * remember" always one click away. The same questions go on WhatsApp: the client answers where they like, and the
 * card shows only what is still owed. Closest catalog entries: the account card beside it, in the same card.
 */
export default function ClientInterview({
  token,
  interview,
  editable,
  onSaved,
}: {
  token: string;
  interview: InterviewView;
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [typed, setTyped] = useState("");
  const [day, setDay] = useState("");
  const [hour, setHour] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const open = interview.status === "open";
  const question = open ? (interview.currentQuestion ?? nextStep(interview.facts).next) : null;
  const { position, total } = interviewProgress(interview.facts);

  const send = async (answer: Parameters<typeof answerClientInterview>[2]) => {
    if (!question) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await answerClientInterview(token, question, answer);
      if (!result.ok) {
        setProblem(result.code);
        return;
      }
      setTyped("");
      setDay("");
      setHour("");
      onSaved();
    } catch {
      setProblem("unavailable");
    } finally {
      setBusy(false);
    }
  };

  const shape = question ? QUESTION_SHAPE[question] : "text";
  return (
    <ClientSection
      id="client-interview"
      icon={<NiTextQuote size="medium" />}
      tone="secondary"
      title={t("client-interview-title")}
      hint={question ? t("client-interview-body") : undefined}
      chip={
        question ? (
          <StatusChip tone="attention" label={t("client-interview-progress", { position, total })} />
        ) : (
          <StatusChip tone="positive" label={t("client-interview-chip-done")} />
        )
      }
    >
      {!question ? (
        <StateLine tone="done" emphasis>
          {t("client-interview-done")}
        </StateLine>
      ) : !editable ? (
        <StateLine tone="info">{t("client-interview-locked")}</StateLine>
      ) : (
        <Box className="flex flex-col gap-3">
          <Typography variant="h6" component="p" className="mb-0">
            {questionText(question, interview.facts)}
          </Typography>
          {shape === "yes_no" && (
            <Box className="flex flex-row flex-wrap gap-2">
              <Button variant="contained" disabled={busy} onClick={() => void send({ yesNo: "sim" })}>
                {t("client-interview-yes")}
              </Button>
              <Button variant="contained" disabled={busy} onClick={() => void send({ yesNo: "nao" })}>
                {t("client-interview-no")}
              </Button>
            </Box>
          )}
          {shape === "moment" && (
            <Box className="flex flex-row flex-wrap gap-3">
              <TextField
                type="date"
                size="small"
                id="client-interview-day"
                label={t("client-interview-day")}
                value={day}
                disabled={busy}
                onChange={(event) => setDay(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                type="time"
                size="small"
                id="client-interview-hour"
                label={t("client-interview-hour")}
                value={hour}
                disabled={busy}
                onChange={(event) => setHour(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Box>
          )}
          {shape !== "yes_no" && (
            <TextField
              fullWidth
              multiline
              minRows={shape === "text" ? 3 : 1}
              maxRows={10}
              size="small"
              id="client-interview-text"
              label={shape === "text" ? t("client-interview-text") : t("client-interview-text-more")}
              value={typed}
              disabled={busy}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
              onChange={(event) => setTyped(event.target.value)}
            />
          )}
          {problem && (
            <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
              {t(statementErrorKey(problem))}
            </Alert>
          )}
          <Box className="flex flex-row flex-wrap gap-2">
            {shape !== "yes_no" && (
              <Button
                variant="contained"
                disabled={busy || (shape === "moment" ? !day : typed.trim().length < 2)}
                onClick={() =>
                  void send({
                    text: typed.trim() || null,
                    moment: shape === "moment" && day ? (hour ? `${day}T${hour}` : day) : null,
                  })
                }
              >
                {busy ? t("client-working") : t("client-interview-send")}
              </Button>
            )}
            <Button variant="text" color="grey" disabled={busy} onClick={() => void send({ unknown: true })}>
              {t("client-interview-unknown")}
            </Button>
          </Box>
        </Box>
      )}
    </ClientSection>
  );
}
