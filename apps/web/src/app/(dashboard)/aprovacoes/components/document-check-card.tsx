"use client";

import type { DecisionKind } from "./approval-card";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  TextField,
  Typography,
} from "@mui/material";

import CheckSuggestion from "@/components/product/check-suggestion";
import { decideApproval } from "@/lib/ai/actions";
import { type ApprovalDocument, approvalErrorKey, type PendingApproval } from "@/lib/ai/approvals";
import { openCaseFile } from "@/lib/cases/actions";
import { DOCUMENT_KIND_KEY, isDocumentKind } from "@/lib/cases/cases";
import { decidedOutput, readCheckAnswer, sameOutput } from "@/lib/cases/document-check";
import { PHOTO_PROBLEM_KEY } from "@/lib/cases/document-quality";
import { FUNCTION_LABEL_KEY } from "@/lib/firm/roles";

/**
 * The AI's check of a document, waiting in the queue. The person came to
 * decide the document itself, so the card speaks of the document: open the
 * file, read what the AI found, then accept it (with the legs of the trip it
 * read, or without them) or refuse it with the reason the client will read.
 * Whatever the person decides is the approved answer of the check, measured
 * as a correction when it differs from the suggestion. Turning the
 * suggestion down leaves the document for a person on the case.
 */
export default function DocumentCheckCard({
  approval,
  document,
  canDecide,
  blocked,
  onDecided,
}: {
  approval: PendingApproval;
  document: ApprovalDocument;
  canDecide: boolean;
  blocked: boolean;
  onDecided: (kind: DecisionKind) => void;
}) {
  const t = useTranslations("product");
  const answer = readCheckAnswer(approval.output);
  const [mode, setMode] = useState<"view" | "refuse" | "dismiss">("view");
  const [keepLegs, setKeepLegs] = useState(true);
  const [reason, setReason] = useState(answer?.decision === "recusar" ? answer.reason : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const titleId = `approval-${approval.id}`;
  const kind = isDocumentKind(document.kind) ? t(DOCUMENT_KIND_KEY[document.kind]) : document.kind;
  const approvers = new Intl.ListFormat("pt-BR", { style: "long", type: "disjunction" }).format(
    approval.approverFunctions.map((firmFunction) => t(FUNCTION_LABEL_KEY[firmFunction])),
  );

  const decide = async (input: Parameters<typeof decideApproval>[0]) => {
    if (busy) return;
    setBusy(true);
    setErrorCode(null);
    const result = await decideApproval(input);
    setBusy(false);
    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }
    onDecided(result.code === "rejected" ? "rejected" : result.edited ? "approved-edited" : "approved");
  };

  // What the person decided, as the answer of the check: sent only when it differs from the model's.
  const approveWith = (finalOutput: Record<string, unknown>) =>
    decide({
      approvalId: approval.id,
      decision: "approved",
      finalOutput: sameOutput(finalOutput, approval.output) ? null : finalOutput,
    });

  const openFile = async () => {
    setBusy(true);
    setErrorCode(null);
    const link = await openCaseFile(document.fileId);
    setBusy(false);
    if (link.ok) window.open(link.url, "_blank", "noopener,noreferrer");
    else setErrorCode("file_unavailable");
  };

  const reasonOk = reason.trim().length >= 4;
  const noteOk = note.trim().length > 0;
  const hasLegs = (answer?.legs.length ?? 0) > 0;

  return (
    <Card component="article" aria-labelledby={titleId}>
      <CardContent className="flex flex-col gap-5">
        <Box className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between md:gap-4">
          <Box className="flex min-w-0 flex-col gap-1">
            <Typography id={titleId} variant="h5" component="h3" className="mb-0">
              {document.personName ? t("approvals-check-title-person", { kind, person: document.personName }) : kind}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {document.caseSeq
                ? t("approvals-check-case", { task: approval.taskName, seq: document.caseSeq })
                : approval.taskName}
            </Typography>
          </Box>
          <Typography variant="body2" className="text-text-secondary flex-none">
            {t("approvals-received", { when: approval.receivedLabel })}
          </Typography>
        </Box>

        <Box className="flex flex-row flex-wrap gap-2">
          <Button variant="outlined" color="grey" size="small" onClick={() => void openFile()} disabled={busy}>
            {t("approvals-check-open-file")}
          </Button>
          <Button variant="text" color="grey" size="small" href={`/casos/${document.caseId}`} LinkComponent={Link}>
            {t("approvals-check-open-case")}
          </Button>
        </Box>

        {answer ? (
          <CheckSuggestion answer={answer} />
        ) : (
          <Typography variant="body1" className="text-text-secondary">
            {t("approvals-field-empty")}
          </Typography>
        )}

        {document.quality && document.quality.problems.length > 0 ? (
          // What the rule measured of the photo where it arrived, as the case says it: read beside what the AI
          // found, and deciding nothing.
          <Typography variant="body2" className="text-text-primary">
            {[
              t("case-document-photo-poor", {
                problems: document.quality.problems.map((item) => t(PHOTO_PROBLEM_KEY[item])).join(" · "),
              }),
              document.quality.insisted ? t("case-document-photo-insisted") : null,
            ]
              .filter(Boolean)
              .join(" ")}
          </Typography>
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
            {errorCode === "file_unavailable" ? t("approvals-check-file-error") : t(approvalErrorKey(errorCode))}
          </Alert>
        ) : null}

        {!canDecide ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("approvals-who-decides", { functions: approvers })}
          </Typography>
        ) : mode === "view" ? (
          <Box className="flex flex-col gap-3">
            {hasLegs ? (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={keepLegs}
                    onChange={(event) => setKeepLegs(event.target.checked)}
                    disabled={busy || blocked}
                  />
                }
                label={t("approvals-check-keep-legs")}
              />
            ) : null}
            <Box className="flex flex-row flex-wrap gap-2">
              {/* An answer the screen cannot read (instructions of another shape) can only be turned down. */}
              {answer ? (
                <>
                  <Button
                    variant="contained"
                    onClick={() => void approveWith(decidedOutput(approval.output, { accept: true, keepLegs }))}
                    disabled={busy || blocked}
                  >
                    {busy ? t("approvals-working") : t("approvals-check-accept")}
                  </Button>
                  <Button variant="outlined" color="grey" onClick={() => setMode("refuse")} disabled={busy || blocked}>
                    {t("approvals-check-refuse")}
                  </Button>
                </>
              ) : null}
              <Button variant="text" color="grey" onClick={() => setMode("dismiss")} disabled={busy || blocked}>
                {t("approvals-check-dismiss")}
              </Button>
            </Box>
          </Box>
        ) : mode === "refuse" ? (
          <Box className="flex flex-col gap-3">
            <TextField
              fullWidth
              multiline
              minRows={2}
              size="small"
              id={`${titleId}-reason`}
              label={t("case-document-refuse-reason")}
              helperText={t("case-document-refuse-help")}
              value={reason}
              disabled={busy}
              autoFocus
              slotProps={{ htmlInput: { maxLength: 500 } }}
              onChange={(event) => setReason(event.target.value)}
            />
            <Box className="flex flex-row flex-wrap gap-2">
              <Button
                variant="contained"
                onClick={() => void approveWith(decidedOutput(approval.output, { accept: false, reason }))}
                disabled={busy || blocked || !reasonOk}
              >
                {busy ? t("approvals-working") : t("approvals-check-refuse")}
              </Button>
              <Button variant="text" color="grey" onClick={() => setMode("view")} disabled={busy}>
                {t("approvals-cancel")}
              </Button>
            </Box>
          </Box>
        ) : (
          <Box className="flex flex-col gap-3">
            <TextField
              fullWidth
              multiline
              minRows={2}
              size="small"
              id={`${titleId}-note`}
              label={t("approvals-reject-note-label")}
              helperText={t("approvals-check-dismiss-help")}
              value={note}
              disabled={busy}
              autoFocus
              slotProps={{ htmlInput: { maxLength: 2000 } }}
              onChange={(event) => setNote(event.target.value)}
            />
            <Box className="flex flex-row flex-wrap gap-2">
              <Button
                variant="contained"
                onClick={() => void decide({ approvalId: approval.id, decision: "rejected", note: note.trim() })}
                disabled={busy || blocked || !noteOk}
              >
                {busy ? t("approvals-working") : t("approvals-check-dismiss")}
              </Button>
              <Button variant="text" color="grey" onClick={() => setMode("view")} disabled={busy}>
                {t("approvals-cancel")}
              </Button>
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
