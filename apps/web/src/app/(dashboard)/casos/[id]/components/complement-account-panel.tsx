"use client";

import type { CaseState } from "../case-types";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, TextField, Typography } from "@mui/material";

import SidePanel from "@/components/product/side-panel";
import NiMessagePlus from "@/icons/nexture/ni-message-plus";
import { openInterviewQuestions, QUESTION_LABEL_KEY } from "@/lib/cases/interview";
import { answerInterviewQuestion, completeStatement } from "@/lib/cases/statement-actions";
import { complementText, statementErrorKey, statementsToComplement } from "@/lib/cases/statements";

type Ready = Extract<CaseState, { kind: "ready" }>;

/** The panel's own words for what it or the database refused; any other, the case's. */
const PROBLEM_KEY: Record<string, string> = {
  complement_empty: "complement-empty",
  too_many: "complement-too-many",
  nothing_to_answer: "complement-nothing",
};

/** One field of the panel: a question of the interview, or one an account's order of the facts asks. */
type Field = { key: string; label: string; group: string | null };

/**
 * What the client's account left out, answered by the firm (the owner, 2026-11-25): who attends the client writes here
 * what the client told the firm (on the phone, at the office), each question still open in its own field, and ONE goes
 * on with the answers. With the interview open, its questions (`answer_case_interview`, 0095); before it, the questions
 * each account's order of the facts asked, which join that account as the client's answer on the link does
 * (`complete_case_statement`, 0297) and ONE orders it again with everything. A field left empty stays asked of the
 * client.
 */
export default function ComplementAccountPanel({
  state,
  onClose,
  onChanged,
}: {
  state: Ready;
  onClose: () => void;
  /**
   * The answers were saved: the screen says so in the account's card and brings itself up to them, its other actions
   * waiting meanwhile (the case's `onChanged`). Without it, the panel asks the screen's reading itself.
   */
  onChanged?: (saved?: boolean) => void;
}) {
  const t = useTranslations("product");
  const router = useRouter();
  const [fields] = useState<Field[]>(() => {
    const interview = openInterviewQuestions(state.interview);
    if (interview.length > 0) {
      return interview.map((question) => ({
        key: `q:${question}`,
        label: t(QUESTION_LABEL_KEY[question]),
        group: null,
      }));
    }
    const accounts = statementsToComplement(state.statements);
    return accounts.flatMap((statement) =>
      statement.questions.map((question, index) => ({
        key: `s:${statement.id}:${index}`,
        label: question,
        group: accounts.length > 1 ? t("complement-account-of", { when: statement.receivedLabel }) : null,
      })),
    );
  });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const typed = fields.filter((field) => (answers[field.key] ?? "").trim().length > 0);

  const save = async () => {
    if (typed.length === 0) return setProblem("complement_empty");
    setBusy(true);
    setProblem(null);
    try {
      // The interview's answers one at a time: each moves it, and the next is asked against it.
      for (const field of typed.filter((entry) => entry.key.startsWith("q:"))) {
        const result = await answerInterviewQuestion(state.case.id, field.key.slice(2), answers[field.key]!.trim());
        if (!result.ok) return setProblem(result.code);
      }
      // An account's answers together, as the client answers them on the link: ONE orders it again once.
      const byStatement = new Map<string, { question: string; answer: string }[]>();
      for (const field of typed.filter((entry) => entry.key.startsWith("s:"))) {
        const statementId = field.key.split(":")[1];
        byStatement.set(statementId, [
          ...(byStatement.get(statementId) ?? []),
          { question: field.label, answer: answers[field.key]! },
        ]);
      }
      for (const [statementId, pairs] of byStatement) {
        const result = await completeStatement(state.case.id, statementId, complementText(pairs));
        if (!result.ok) return setProblem(result.code);
      }
      if (onChanged) onChanged();
      else router.refresh();
      onClose();
    } catch {
      setProblem("unavailable");
    } finally {
      setBusy(false);
    }
  };

  let lastGroup: string | null = null;
  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("complement-cancel")}
      icon={<NiMessagePlus size="medium" />}
      tone="primary"
      busy={busy}
      title={t("complement-title")}
      description={t("complement-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || fields.length === 0}>
            {busy ? t("complement-saving") : t("complement-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("complement-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {t(PROBLEM_KEY[problem] ?? statementErrorKey(problem))}
          </Alert>
        ) : null}
        {fields.length === 0 ? (
          <Alert severity="info" className="neutral">
            {t("complement-none")}
          </Alert>
        ) : (
          fields.map((field) => {
            const heading = field.group && field.group !== lastGroup ? field.group : null;
            lastGroup = field.group;
            return (
              <Box key={field.key} className="flex flex-col gap-2">
                {heading ? (
                  <Typography variant="subtitle2" component="h3">
                    {heading}
                  </Typography>
                ) : null}
                <TextField
                  id={`complement-${field.key}`}
                  label={field.label}
                  value={answers[field.key] ?? ""}
                  onChange={(event) => setAnswers((current) => ({ ...current, [field.key]: event.target.value }))}
                  disabled={busy}
                  multiline
                  minRows={2}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 2000 } }}
                />
              </Box>
            );
          })
        )}
      </Box>
    </SidePanel>
  );
}
