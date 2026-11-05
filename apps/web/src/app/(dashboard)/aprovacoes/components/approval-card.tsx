"use client";

import AnswerFields from "./answer-fields";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  FormHelperText,
  FormLabel,
  Input,
  Typography,
} from "@mui/material";

import { decideApproval } from "@/lib/ai/actions";
import {
  type AnswerEdits,
  applyEdits,
  approvalErrorKey,
  blankEdits,
  hasEdits,
  type PendingApproval,
} from "@/lib/ai/approvals";
import { openCaseFile } from "@/lib/cases/actions";
import { caseLabel } from "@/lib/cases/cases";
import { CHRONOLOGY_TASK } from "@/lib/cases/statements";
import { FUNCTION_LABEL_KEY } from "@/lib/firm/roles";

export type DecisionKind = "approved" | "approved-edited" | "rejected" | "returned" | "approved-not-sent";

/** The fewest characters that say what to change. */
const REQUEST_MIN = 10;

/**
 * One suggestion of the AI waiting for a person. The whole job happens on the
 * card: read what was suggested, then approve it as it is, correct the text
 * and approve the corrected version, reject it and say why, or, where the
 * task can be asked again, send it back with what to change: the AI answers
 * again reading the note, and what it answers waits here like this one did.
 * Nothing here takes effect before one of them.
 *
 * Who cannot decide (another function of the firm, a support visit, a session
 * without the second factor) still reads the suggestion, and the card says
 * who decides instead of offering buttons that would be refused.
 */
export default function ApprovalCard({
  approval,
  canDecide,
  blocked,
  onDecided,
  onCase = false,
}: {
  approval: PendingApproval;
  /** Decided on its own case (the order of the facts on the card of what happened): no way to the case it is on. */
  onCase?: boolean;
  /** The person's function is one of those the task names. */
  canDecide: boolean;
  /** Nobody decides from this session right now (no second factor, a support visit): the screen says why, once. */
  blocked: boolean;
  onDecided: (kind: DecisionKind) => void;
}) {
  const t = useTranslations("product");
  const [mode, setMode] = useState<"view" | "edit" | "reject" | "return">("view");
  const [edits, setEdits] = useState<AnswerEdits>({});
  const [blank, setBlank] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [noteTouched, setNoteTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  // The audio a transcription is heard against: a link of a minute, opened beside the queue.
  const listen = async (fileId: string) => {
    if (opening) return;
    setOpening(true);
    try {
      const link = await openCaseFile(fileId);
      if (link.ok) window.open(link.url, "_blank", "noopener,noreferrer");
      else setErrorCode("failed");
    } catch {
      setErrorCode("failed");
    } finally {
      setOpening(false);
    }
  };

  const titleId = `approval-${approval.id}`;
  // A proposal of a statement that was sent back as many times as the setting allows is corrected or turned down.
  const noMoreReturns = approval.statement !== null && approval.statement.returnsLeft === 0;
  // A refusal says why in any words; a request to change says what, in words enough to be one.
  const returning = mode === "return";
  const noteOk = returning ? note.trim().length >= REQUEST_MIN : note.trim().length > 0;

  const backToView = () => {
    setMode("view");
    setEdits({});
    setBlank([]);
    setNote("");
    setNoteTouched(false);
    setErrorCode(null);
  };

  const decide = async (input: Parameters<typeof decideApproval>[0]) => {
    if (busy) return;
    setBusy(true);
    setErrorCode(null);
    let result: Awaited<ReturnType<typeof decideApproval>>;
    try {
      result = await decideApproval(input);
    } catch {
      // A request that failed on the way (the network, the server): the buttons come back, with what was typed.
      setErrorCode("failed");
      return;
    } finally {
      setBusy(false);
    }
    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }
    // What was recorded is what the database says: it is the one that compares
    // the approved answer with what the model gave.
    onDecided(
      result.code === "rejected"
        ? "rejected"
        : result.code === "returned"
          ? "returned"
          : result.edited
            ? "approved-edited"
            : "approved",
    );
  };

  const approve = () => decide({ approvalId: approval.id, decision: "approved" });

  const approveCorrected = () => {
    const empty = blankEdits(approval.output, edits);
    setBlank(empty);
    if (empty.length > 0) return;
    // Opened the correction and changed nothing: it is an approval as it came.
    if (!hasEdits(approval.output, edits)) return void approve();
    void decide({ approvalId: approval.id, decision: "approved", finalOutput: applyEdits(approval.output, edits) });
  };

  const reject = () => {
    setNoteTouched(true);
    if (!noteOk) return;
    void decide({ approvalId: approval.id, decision: "rejected", note: note.trim() });
  };

  const sendBack = () => {
    setNoteTouched(true);
    if (!noteOk) return;
    void decide({ approvalId: approval.id, decision: "returned", note: note.trim() });
  };

  // "Sociedade ou Advocacia": whoever holds one of them decides.
  const approvers = new Intl.ListFormat("pt-BR", { style: "long", type: "disjunction" }).format(
    approval.approverFunctions.map((firmFunction) => t(FUNCTION_LABEL_KEY[firmFunction])),
  );

  return (
    <Shell titleId={titleId} onCase={onCase}>
      <Box className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between md:gap-4">
        <Box className="flex min-w-0 flex-col gap-1">
          <Typography id={titleId} variant="h5" component="h3" className="mb-0">
            {approval.taskName}
          </Typography>
          {approval.taskDescription ? (
            <Typography variant="body2" className="text-text-secondary max-w-3xl">
              {approval.taskDescription}
            </Typography>
          ) : null}
        </Box>
        <Typography variant="body2" className="text-text-secondary flex-none">
          {t("approvals-received", { when: approval.receivedLabel })}
        </Typography>
      </Box>

      {approval.statement ? (
        <Box className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
          <Box className="flex flex-wrap items-center justify-between gap-2">
            <Typography variant="subtitle2" component="p" className="mb-0 min-w-0">
              {[
                approval.statement.caseSeq !== null ? caseLabel(approval.statement.caseSeq) : null,
                approval.statement.personName,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Typography>
            <Box className="flex flex-row flex-wrap gap-2">
              {approval.statement.audioFileId ? (
                <Button
                  variant="outlined"
                  color="grey"
                  size="small"
                  disabled={opening}
                  onClick={() => void listen(approval.statement?.audioFileId as string)}
                >
                  {t("approvals-statement-listen")}
                </Button>
              ) : null}
              {onCase ? null : (
                <Button
                  variant="text"
                  color="grey"
                  size="small"
                  href={`/casos/${approval.statement.caseId}`}
                  LinkComponent={Link}
                >
                  {t("approvals-statement-open-case")}
                </Button>
              )}
            </Box>
          </Box>
          {approval.statement.text ? (
            <>
              <Typography variant="body2" className="text-text-secondary">
                {t("approvals-statement-account")}
              </Typography>
              <Typography
                variant="body1"
                className="text-text-primary max-h-72 overflow-y-auto whitespace-pre-wrap"
                tabIndex={0}
              >
                {approval.statement.text}
              </Typography>
            </>
          ) : null}
          {approval.statement.clientNote && approval.task === CHRONOLOGY_TASK ? (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              <Typography variant="body2" component="p" className="mb-1 font-semibold">
                {t("approvals-statement-contested")}
              </Typography>
              <Typography variant="body2" component="p" className="whitespace-pre-wrap">
                {approval.statement.clientNote}
              </Typography>
              {approval.statement.previousChronology ? (
                <>
                  <Typography variant="body2" component="p" className="mt-2 mb-1 font-semibold">
                    {t("approvals-statement-previous")}
                  </Typography>
                  <Typography variant="body2" component="p" className="whitespace-pre-wrap">
                    {approval.statement.previousChronology}
                  </Typography>
                </>
              ) : null}
            </Alert>
          ) : null}
          {approval.statement.firmNote && approval.task === CHRONOLOGY_TASK ? (
            // This proposal answers one the firm sent back: what was asked is read beside it.
            <Alert severity="info" className="neutral bg-background-paper/60!">
              <Typography variant="body2" component="p" className="mb-1 font-semibold">
                {t("approvals-statement-returned")}
              </Typography>
              <Typography variant="body2" component="p" className="whitespace-pre-wrap">
                {approval.statement.firmNote}
              </Typography>
              {approval.statement.returnedProposal ? (
                <>
                  <Typography variant="body2" component="p" className="mt-2 mb-1 font-semibold">
                    {t("approvals-statement-returned-proposal")}
                  </Typography>
                  <Typography variant="body2" component="p" className="whitespace-pre-wrap">
                    {approval.statement.returnedProposal}
                  </Typography>
                </>
              ) : null}
            </Alert>
          ) : null}
        </Box>
      ) : null}

      <Box className="flex flex-col gap-3">
        <Typography variant="subtitle2" component="p" className="mb-0">
          {mode === "edit" ? t("approvals-answer-editing") : t("approvals-answer-title")}
        </Typography>
        <AnswerFields
          idPrefix={titleId}
          output={approval.output}
          editing={mode === "edit"}
          edits={edits}
          onEdit={(key, text) => {
            setEdits((current) => ({ ...current, [key]: text }));
            setBlank((current) => current.filter((entry) => entry !== key));
          }}
          blank={blank}
          disabled={busy}
        />
      </Box>

      {mode === "reject" || returning ? (
        <FormControl fullWidth className="outlined" variant="standard" error={noteTouched && !noteOk}>
          <FormLabel component="label" htmlFor={`${titleId}-note`}>
            {t(returning ? "approvals-return-note-label" : "approvals-reject-note-label")}
          </FormLabel>
          <Input
            id={`${titleId}-note`}
            multiline
            minRows={2}
            value={note}
            autoFocus
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => setNoteTouched(true)}
            disabled={busy}
            inputProps={{ maxLength: 2000 }}
            aria-describedby={`${titleId}-note-help`}
          />
          <FormHelperText id={`${titleId}-note-help`}>
            {returning
              ? noteTouched && !noteOk
                ? t("approvals-error-request-required")
                : t("approvals-return-note-help")
              : noteTouched && !noteOk
                ? t("approvals-error-note-required")
                : t("approvals-reject-note-help")}
          </FormHelperText>
        </FormControl>
      ) : null}

      {errorCode ? (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          action={
            errorCode === "second_factor_required" ? (
              <Button color="inherit" size="small" href="/settings/security" LinkComponent={Link}>
                {t("approvals-second-factor-setup")}
              </Button>
            ) : undefined
          }
        >
          {t(approvalErrorKey(errorCode))}
        </Alert>
      ) : null}

      {!canDecide ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("approvals-who-decides", { functions: approvers })}
        </Typography>
      ) : mode === "view" ? (
        <Box className="flex flex-row flex-wrap gap-2">
          <Button variant="contained" onClick={() => void approve()} disabled={busy || blocked}>
            {busy ? t("approvals-working") : t("approvals-approve")}
          </Button>
          <Button variant="outlined" color="grey" onClick={() => setMode("edit")} disabled={busy || blocked}>
            {t("approvals-edit")}
          </Button>
          {approval.revisable && !noMoreReturns ? (
            <Button variant="outlined" color="grey" onClick={() => setMode("return")} disabled={busy || blocked}>
              {t("approvals-return")}
            </Button>
          ) : null}
          <Button variant="text" color="grey" onClick={() => setMode("reject")} disabled={busy || blocked}>
            {t("approvals-reject")}
          </Button>
          {approval.revisable && noMoreReturns ? (
            <Typography variant="body2" className="text-text-secondary w-full">
              {t("approvals-return-no-more")}
            </Typography>
          ) : null}
        </Box>
      ) : mode === "edit" ? (
        <Box className="flex flex-row flex-wrap gap-2">
          <Button variant="contained" onClick={approveCorrected} disabled={busy || blocked}>
            {busy ? t("approvals-working") : t("approvals-approve-edited")}
          </Button>
          <Button variant="text" color="grey" onClick={backToView} disabled={busy}>
            {t("approvals-cancel")}
          </Button>
        </Box>
      ) : returning ? (
        <Box className="flex flex-row flex-wrap gap-2">
          <Button variant="contained" onClick={sendBack} disabled={busy || blocked}>
            {busy ? t("approvals-working") : t("approvals-return-confirm")}
          </Button>
          <Button variant="text" color="grey" onClick={backToView} disabled={busy}>
            {t("approvals-cancel")}
          </Button>
        </Box>
      ) : (
        <Box className="flex flex-row flex-wrap gap-2">
          <Button variant="contained" onClick={reject} disabled={busy || blocked}>
            {busy ? t("approvals-working") : t("approvals-reject-confirm")}
          </Button>
          <Button variant="text" color="grey" onClick={backToView} disabled={busy}>
            {t("approvals-cancel")}
          </Button>
        </Box>
      )}
    </Shell>
  );
}

/** The card of the list, or, on its case, a framed part of the card it is decided on. */
function Shell({ titleId, onCase, children }: { titleId: string; onCase: boolean; children: ReactNode }) {
  return onCase ? (
    <Box
      component="article"
      aria-labelledby={titleId}
      className="border-grey-100 flex flex-col gap-5 rounded-2xl border p-4"
    >
      {children}
    </Box>
  ) : (
    <Card component="article" aria-labelledby={titleId}>
      <CardContent className="flex flex-col gap-5">{children}</CardContent>
    </Card>
  );
}
