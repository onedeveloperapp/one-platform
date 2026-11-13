"use client";

import { ClientSection } from "./client-section";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Alert, Box, Button, TextField, Typography } from "@mui/material";

import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiTextQuote from "@/icons/nexture/ni-text-quote";
import { ACCOUNT_TOPIC_KEY, ACCOUNT_TOPICS, type AccountState } from "@/lib/cases/account";
import type { ClientStatement } from "@/lib/cases/client-link";
import {
  answerClientChronology,
  completeClientStatement,
  finishClientStatement,
  startClientStatement,
  writeClientStatement,
} from "@/lib/cases/client-link-actions";
import { chronologyLines, STATEMENT_AUDIO_ACCEPT, statementAudioMime, statementErrorKey } from "@/lib/cases/statements";
import { uploadToSignedUrl } from "@/lib/files/browser-upload";

const MIN_TEXT = 40;
const MIN_NOTE = 10;
const MIN_ANSWER = 2;

/**
 * Where the client tells what happened, in their own words: written here, or
 * an audio from their phone, with the points the firm needs listed before
 * they start (0090: a piece written from an account that misses them comes
 * back incomplete). And where they read the order of the facts the firm
 * understood from it, to confirm it or say what is wrong, and answer what it
 * says is missing. What waits for their answer comes first. Answering is
 * open for as long as the link is; telling something new ends when the case
 * moves on (`editable`).
 */
export default function ClientStatements({
  token,
  statements,
  account,
  editable,
  onSaved,
}: {
  token: string;
  statements: ClientStatement[];
  /** Where the case's account stands (`case_account_state`), for the card's chip; null when it could not be read. */
  account?: AccountState | null;
  /** The case still takes what the client sends. */
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [contesting, setContesting] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answeredNow, setAnsweredNow] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // What the order of the facts says is missing, asked first: it is what the firm still needs of the client.
  const asked = statements.filter((statement) => statement.questions.length > 0 && !statement.reordering);
  const toAnswer = statements.filter((statement) => statement.chronology_status === "approved");
  const answered = statements.filter(
    (statement) => statement.chronology_status === "confirmed" || statement.chronology_status === "contested",
  );
  const reordering = statements.filter((statement) => statement.reordering);
  const waiting = statements.filter(
    (statement) => statement.chronology_status === "none" && !statement.uploading && !statement.reordering,
  );

  // Nothing told, nothing to answer and nothing more to send: the section has nothing to say.
  if (!editable && asked.length + toAnswer.length + answered.length + waiting.length + reordering.length === 0) {
    return null;
  }

  const chip =
    account === "missing" ? (
      <StatusChip tone="attention" label={t("client-account-chip-missing")} />
    ) : account === "incomplete" ? (
      <StatusChip tone="attention" label={t("client-account-chip-incomplete")} />
    ) : statements.length > 0 ? (
      <StatusChip tone="positive" label={t("client-account-chip-received")} />
    ) : null;

  const run = async (key: string, work: () => Promise<{ ok: boolean; code: string }>, after?: () => void) => {
    setBusy(key);
    setProblem(null);
    setSent(false);
    setAnsweredNow(false);
    try {
      const result = await work();
      if (!result.ok) {
        setProblem(result.code);
        return;
      }
      after?.();
      onSaved();
    } catch {
      // A request that failed on the way (the network, the server): the button comes back.
      setProblem("failed");
    } finally {
      setBusy(null);
    }
  };

  const sendAudio = (file: File) =>
    run(
      "audio",
      async () => {
        const mime = statementAudioMime(file);
        const started = await startClientStatement(token, { name: file.name, mime, bytes: file.size });
        if (!started.ok) return started;
        const uploaded = await uploadToSignedUrl({
          storagePath: started.storagePath,
          uploadToken: started.uploadToken,
          file,
          contentType: mime,
        });
        if (!uploaded) return { ok: false, code: "not_uploaded" };
        return finishClientStatement(token, started.statementId);
      },
      () => setSent(true),
    );

  const lines = (statement: ClientStatement) => (
    <Box component="ol" className="m-0 flex list-decimal flex-col gap-1 pl-5">
      {chronologyLines(statement.chronology).map((line, index) => (
        <Typography component="li" variant="body1" key={`${index}-${line.slice(0, 24)}`}>
          {line}
        </Typography>
      ))}
    </Box>
  );

  return (
    <ClientSection
      id="client-statements"
      icon={<NiTextQuote size="medium" />}
      tone="primary"
      title={t("client-statements-title")}
      chip={chip}
      hint={editable ? t("client-statements-body") : t("client-statements-body-closed")}
    >
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(statementErrorKey(problem))}
        </Alert>
      )}
      {sent && (
        <Alert
          severity="success"
          role="status"
          className="neutral bg-background-paper/60!"
          onClose={() => setSent(false)}
        >
          {t("client-statements-sent")}
        </Alert>
      )}
      {answeredNow && (
        <StateLine tone="waiting" emphasis>
          {t("client-questions-sent")}
        </StateLine>
      )}

      {asked.map((statement) => {
        const answer = answers[statement.id] ?? "";
        return (
          <Box
            key={`asked-${statement.id}`}
            className="border-accent-3/30 bg-accent-3-light/10 flex flex-col gap-3 rounded-2xl border p-4"
          >
            <StateLine tone="attention">
              <strong>{t("client-questions-title")}</strong> {t("client-questions-body")}
            </StateLine>
            <Box component="ol" className="m-0 flex list-decimal flex-col gap-1 pl-5">
              {statement.questions.map((question, index) => (
                <Typography component="li" variant="body1" key={`${index}-${question.slice(0, 24)}`}>
                  {question}
                </Typography>
              ))}
            </Box>
            <TextField
              fullWidth
              multiline
              minRows={3}
              size="small"
              id={`client-questions-answer-${statement.id}`}
              label={t("client-questions-label")}
              helperText={t("client-questions-help")}
              value={answer}
              disabled={busy !== null}
              slotProps={{ htmlInput: { maxLength: 4000 } }}
              onChange={(event) => setAnswers((current) => ({ ...current, [statement.id]: event.target.value }))}
            />
            <Box>
              <Button
                variant="contained"
                size="small"
                disabled={busy !== null || answer.trim().length < MIN_ANSWER}
                onClick={() =>
                  void run(
                    `asked-${statement.id}`,
                    () => completeClientStatement(token, statement.id, answer),
                    () => {
                      setAnswers((current) => ({ ...current, [statement.id]: "" }));
                      setAnsweredNow(true);
                    },
                  )
                }
              >
                {busy === `asked-${statement.id}` ? t("client-working") : t("client-questions-send")}
              </Button>
            </Box>
          </Box>
        );
      })}

      {toAnswer.map((statement) => (
        <Box key={statement.id} className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
          <Typography variant="body1" className="font-semibold">
            {t("client-chronology-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("client-chronology-body")}
          </Typography>
          {lines(statement)}
          {contesting === statement.id ? (
            <Box className="flex flex-col gap-3">
              <TextField
                fullWidth
                multiline
                minRows={2}
                size="small"
                id={`client-chronology-note-${statement.id}`}
                label={t("client-chronology-note")}
                helperText={t("client-chronology-note-help")}
                value={note}
                disabled={busy !== null}
                autoFocus
                slotProps={{ htmlInput: { maxLength: 2000 } }}
                onChange={(event) => setNote(event.target.value)}
              />
              <Box className="flex flex-row flex-wrap gap-2">
                <Button
                  variant="contained"
                  size="small"
                  disabled={busy !== null || note.trim().length < MIN_NOTE}
                  onClick={() =>
                    void run(
                      statement.id,
                      () => answerClientChronology(token, statement.id, false, note),
                      () => {
                        setContesting(null);
                        setNote("");
                      },
                    )
                  }
                >
                  {busy === statement.id ? t("client-working") : t("client-chronology-send-note")}
                </Button>
                <Button
                  variant="text"
                  color="grey"
                  size="small"
                  disabled={busy !== null}
                  onClick={() => setContesting(null)}
                >
                  {t("client-chronology-back")}
                </Button>
              </Box>
            </Box>
          ) : (
            <Box className="flex flex-row flex-wrap gap-2">
              <Button
                variant="contained"
                size="small"
                disabled={busy !== null}
                onClick={() => void run(statement.id, () => answerClientChronology(token, statement.id, true, null))}
              >
                {busy === statement.id ? t("client-working") : t("client-chronology-confirm")}
              </Button>
              <Button
                variant="outlined"
                color="grey"
                size="small"
                disabled={busy !== null}
                onClick={() => {
                  setContesting(statement.id);
                  setNote("");
                }}
              >
                {t("client-chronology-contest")}
              </Button>
            </Box>
          )}
        </Box>
      ))}

      {answered.map((statement) => (
        <Box key={statement.id} className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
          <Box className="flex flex-wrap items-center justify-between gap-2">
            <Typography variant="body1" className="font-semibold">
              {t("client-chronology-title")}
            </Typography>
            <StatusChip
              tone={statement.chronology_status === "confirmed" ? "positive" : "attention"}
              label={
                statement.chronology_status === "confirmed"
                  ? t("client-chronology-confirmed")
                  : t("client-chronology-contested")
              }
            />
          </Box>
          {lines(statement)}
          {statement.client_note ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("client-chronology-your-note", { note: statement.client_note })}
            </Typography>
          ) : null}
        </Box>
      ))}

      {reordering.length > 0 && <StateLine tone="waiting">{t("client-statements-reordering")}</StateLine>}
      {waiting.length > 0 && (
        <Typography variant="body2" className="text-text-secondary">
          {t("client-statements-waiting", { count: waiting.length })}
        </Typography>
      )}

      {editable && (
        <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
          <Box className="flex flex-col gap-1">
            <Typography variant="body2" className="font-semibold">
              {t("client-statements-guide")}
            </Typography>
            <Box component="ul" className="m-0 flex list-disc flex-col gap-0.5 pl-5">
              {ACCOUNT_TOPICS.map((topic) => (
                <Typography component="li" variant="body2" key={topic}>
                  {t(ACCOUNT_TOPIC_KEY[topic])}
                </Typography>
              ))}
            </Box>
          </Box>
          <TextField
            fullWidth
            multiline
            minRows={4}
            maxRows={14}
            size="small"
            id="client-statement-text"
            label={t("client-statements-text")}
            helperText={t("client-statements-text-help")}
            value={text}
            disabled={busy !== null}
            slotProps={{ htmlInput: { maxLength: 20000 } }}
            onChange={(event) => setText(event.target.value)}
          />
          <input
            ref={input}
            type="file"
            hidden
            accept={STATEMENT_AUDIO_ACCEPT}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void sendAudio(file);
            }}
          />
          <Box className="flex flex-row flex-wrap gap-2">
            <Button
              variant="contained"
              size="small"
              disabled={busy !== null || text.trim().length < MIN_TEXT}
              onClick={() =>
                void run(
                  "text",
                  () => writeClientStatement(token, text),
                  () => {
                    setText("");
                    setSent(true);
                  },
                )
              }
            >
              {busy === "text" ? t("client-working") : t("client-statements-send-text")}
            </Button>
            <Button
              variant="outlined"
              color="grey"
              size="small"
              disabled={busy !== null}
              onClick={() => input.current?.click()}
            >
              {busy === "audio" ? t("client-documents-sending") : t("client-statements-send-audio")}
            </Button>
          </Box>
        </Box>
      )}
    </ClientSection>
  );
}
