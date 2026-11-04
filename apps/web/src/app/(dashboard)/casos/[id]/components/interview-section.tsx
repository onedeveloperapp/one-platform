"use client";

import type { CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, TextField, Typography } from "@mui/material";

import StateLine, { type StateTone } from "@/components/product/state-line";
import {
  interviewRows,
  NOTICE_STANDING_KEY,
  noticeOf,
  QUESTION_LABEL_KEY,
  SKIP_REASON_KEY,
  SOURCE_KEY,
} from "@/lib/cases/interview";
import { answerInterviewQuestion, closeInterview } from "@/lib/cases/statement-actions";
import { statementErrorKey } from "@/lib/cases/statements";
import { interviewProgress, type InterviewQuestion } from "@flyee/rules/interview";

type Ready = Extract<CaseState, { kind: "ready" }>;

const ROW_TONE: Record<"answered" | "unknown" | "skipped" | "asked" | "next", StateTone> = {
  answered: "done",
  unknown: "info",
  skipped: "info",
  asked: "waiting",
  next: "info",
};

/**
 * The passenger's interview on their case (migration 0095): where it stands (ONE asking on WhatsApp, the questions
 * on the client's link, done, or closed by the firm), how the change was told against the 72 hours, and each
 * question with its answer, its "does not remember", why ONE left it out, or that it waits. Who attends the client
 * answers a question for them (what they told on the phone) or corrects an answer; a partner or a lawyer may go on
 * without the rest. Closest catalog entries: the account rows of this card, in the same box and lines.
 */
export default function InterviewSection({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const view = state.interview;
  const [editing, setEditing] = useState<InterviewQuestion | null>(null);
  const [typed, setTyped] = useState("");
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!view) return null;

  const rows = interviewRows(view);
  const progress = interviewProgress(view.facts);
  const settled = rows.filter((row) => row.state === "answered" || row.state === "unknown").length;
  const notice = noticeOf(view.facts);
  const open = view.status === "open";

  const run = async (work: () => Promise<{ ok: boolean; code: string }>, after: () => void) => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await work();
      if (!result.ok) {
        setProblem(result.code);
        return;
      }
      after();
      onChanged();
    } catch {
      setProblem("unavailable");
    } finally {
      setBusy(false);
    }
  };

  const lead =
    view.status === "done"
      ? { tone: "done" as const, words: t("interview-done") }
      : view.status === "closed"
        ? { tone: "info" as const, words: t("interview-closed") }
        : view.inChat
          ? {
              tone: "waiting" as const,
              words: t("interview-open-chat", { position: progress.position, total: progress.total }),
            }
          : { tone: "waiting" as const, words: t("interview-open-link", { done: settled, total: progress.total }) };

  return (
    <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4" id="case-interview">
      <Typography variant="body1" className="font-semibold">
        {t("interview-title")}
      </Typography>
      <StateLine
        tone={lead.tone}
        action={
          writable && state.lawyer && open && !closing ? (
            <Button variant="outlined" color="grey" size="small" disabled={busy} onClick={() => setClosing(true)}>
              {t("interview-close")}
            </Button>
          ) : undefined
        }
      >
        {lead.words}
      </StateLine>
      {closing && (
        <Box className="flex flex-row flex-wrap items-center gap-2">
          <Typography variant="body2" className="text-text-primary">
            {t("interview-close-confirm")}
          </Typography>
          <Button
            variant="contained"
            size="small"
            disabled={busy}
            onClick={() =>
              void run(
                () => closeInterview(state.case.id),
                () => setClosing(false),
              )
            }
          >
            {busy ? t("cases-working") : t("interview-close-yes")}
          </Button>
          <Button variant="text" color="grey" size="small" disabled={busy} onClick={() => setClosing(false)}>
            {t("cases-cancel")}
          </Button>
        </Box>
      )}
      {notice && (
        <StateLine tone={notice === "early" ? "attention" : "info"}>{t(NOTICE_STANDING_KEY[notice])}</StateLine>
      )}
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(statementErrorKey(problem))}
        </Alert>
      )}
      <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row) => {
          const label = t(QUESTION_LABEL_KEY[row.question]);
          const said =
            row.state === "answered"
              ? (row.answer?.answer ?? "")
              : row.state === "unknown"
                ? t("interview-unknown")
                : row.state === "skipped" && row.reason
                  ? t(SKIP_REASON_KEY[row.reason])
                  : row.state === "asked"
                    ? t("interview-asked")
                    : t("interview-next");
          const mayAnswer = writable && view.status !== "closed" && row.state !== "skipped";
          return (
            <Box component="li" key={row.question} className="flex flex-col gap-2">
              <StateLine
                tone={ROW_TONE[row.state]}
                status={row.answer && row.state !== "skipped" ? t(SOURCE_KEY[row.answer.source]) : undefined}
                action={
                  mayAnswer && editing !== row.question ? (
                    <Button
                      variant="text"
                      color="grey"
                      size="small"
                      disabled={busy}
                      onClick={() => {
                        setEditing(row.question);
                        setTyped(row.state === "answered" ? (row.answer?.answer ?? "") : "");
                      }}
                    >
                      {row.state === "answered" ? t("interview-correct") : t("interview-answer-for")}
                    </Button>
                  ) : undefined
                }
              >
                <strong>{label}</strong>
                {said ? `: ${said}` : null}
              </StateLine>
              {editing === row.question && (
                <Box className="flex flex-col gap-2 pl-8">
                  <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={8}
                    size="small"
                    id={`interview-answer-${row.question}`}
                    label={t("interview-answer-label")}
                    helperText={t("interview-answer-help")}
                    value={typed}
                    disabled={busy}
                    autoFocus
                    slotProps={{ htmlInput: { maxLength: 2000 } }}
                    onChange={(event) => setTyped(event.target.value)}
                  />
                  <Box className="flex flex-row flex-wrap gap-2">
                    <Button
                      variant="contained"
                      size="small"
                      disabled={busy || typed.trim().length < 2}
                      onClick={() =>
                        void run(
                          () => answerInterviewQuestion(state.case.id, row.question, typed),
                          () => setEditing(null),
                        )
                      }
                    >
                      {busy ? t("cases-working") : t("interview-answer-save")}
                    </Button>
                    <Button
                      variant="text"
                      color="grey"
                      size="small"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => answerInterviewQuestion(state.case.id, row.question, null),
                          () => setEditing(null),
                        )
                      }
                    >
                      {t("interview-answer-unknown")}
                    </Button>
                    <Button variant="text" color="grey" size="small" disabled={busy} onClick={() => setEditing(null)}>
                      {t("cases-cancel")}
                    </Button>
                  </Box>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
