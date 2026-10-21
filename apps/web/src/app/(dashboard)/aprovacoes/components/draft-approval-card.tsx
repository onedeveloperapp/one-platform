"use client";

import type { DecisionKind } from "./approval-card";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, TextField, Typography } from "@mui/material";

import { decideApproval } from "@/lib/ai/actions";
import { type ApprovalDraft, approvalErrorKey, type PendingApproval } from "@/lib/ai/approvals";
import { caseLabel } from "@/lib/cases/cases";
import { FUNCTION_LABEL_KEY } from "@/lib/firm/roles";

const KIND_KEY: Record<string, string> = {
  juizado: "case-proceeding-kind-juizado",
  comum: "case-proceeding-kind-comum",
};

/**
 * A text the AI wrote for a piece, waiting in the queue: its first, or one
 * it rewrote as a lawyer asked when sending the text back. A piece is read,
 * corrected, sent back and approved where it is written, on its case, with
 * what it cites beside it and as its document will say it: so this card
 * leads there, and approves nothing. What it shows is what the AI was asked
 * when the text is a rewriting, how the AI's own text starts and what the AI
 * asked a lawyer to check; when a lawyer already wrote on it, the card says
 * the piece went on from there. Turning the text down takes the reason,
 * here as on the case; a rewriting turned down leaves the text there was
 * before it.
 */
export default function DraftApprovalCard({
  approval,
  draft,
  canDecide,
  blocked,
  onDecided,
}: {
  approval: PendingApproval;
  draft: ApprovalDraft;
  canDecide: boolean;
  blocked: boolean;
  onDecided: (kind: DecisionKind) => void;
}) {
  const t = useTranslations("product");
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const titleId = `approval-${approval.id}`;
  // A rewriting whose worker has not said yet that it is there: the draft still shows the text before it.
  const arriving = draft.answerVersion === null && draft.version >= 1;
  const wroteOn = draft.answerVersion !== null && draft.version > draft.answerVersion;
  const rewriting = draft.request !== null || arriving;
  // What the AI said of its text is read from the version it became, where the marks a rewriting is handed
  // over under have their words back. The answer itself is shown only for a first text, which has none.
  const answered = Array.isArray(approval.output.observacoes)
    ? approval.output.observacoes.filter((item): item is string => typeof item === "string")
    : [];
  const notes = draft.answerVersion !== null ? draft.notes : rewriting ? [] : answered;
  const excerpt = !rewriting && typeof approval.output.texto === "string" ? approval.output.texto : "";
  // What turning it down does to the text of the case, said before the person confirms.
  const rejectHelp = !rewriting
    ? null
    : arriving
      ? t("approvals-draft-reject-cancels")
      : wroteOn
        ? t("approvals-draft-reject-keeps")
        : t("draft-reject-revision-help");
  const approvers = new Intl.ListFormat("pt-BR", { style: "long", type: "disjunction" }).format(
    approval.approverFunctions.map((firmFunction) => t(FUNCTION_LABEL_KEY[firmFunction])),
  );
  const where = [
    draft.caseSeq !== null ? caseLabel(draft.caseSeq) : null,
    KIND_KEY[draft.proceedingKind ?? ""] ? t(KIND_KEY[draft.proceedingKind ?? ""]) : null,
    t("approvals-draft-template", { name: draft.templateName }),
  ]
    .filter(Boolean)
    .join(" · ");

  const stopRejecting = () => {
    setRejecting(false);
    setNote("");
  };

  const reject = async () => {
    if (busy) return;
    setBusy(true);
    setErrorCode(null);
    try {
      const result = await decideApproval({ approvalId: approval.id, decision: "rejected", note });
      if (result.ok) onDecided("rejected");
      else setErrorCode(result.code);
    } catch {
      setErrorCode("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card component="article" aria-labelledby={titleId}>
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between md:gap-4">
          <Box className="flex min-w-0 flex-col gap-1">
            <Typography id={titleId} variant="h5" component="h3" className="mb-0">
              {approval.taskName}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {where}
            </Typography>
          </Box>
          <Typography variant="body2" className="text-text-secondary flex-none">
            {t("approvals-received", { when: approval.receivedLabel })}
          </Typography>
        </Box>

        {draft.request ? (
          <Box className="flex flex-col gap-1">
            <Typography variant="subtitle2" component="h4" className="mb-0">
              {draft.request.askedBy
                ? t("approvals-draft-request-by", { name: draft.request.askedBy })
                : t("approvals-draft-request")}
            </Typography>
            <Typography variant="body2" className="break-words whitespace-pre-wrap">
              {draft.request.note}
            </Typography>
          </Box>
        ) : null}

        {notes.length > 0 ? (
          <Box className="flex flex-col gap-1">
            <Typography variant="subtitle2" component="h4" className="mb-0">
              {t("draft-notes-title")}
            </Typography>
            <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
              {notes.map((item, index) => (
                <Typography key={index} component="li" variant="body2">
                  {item}
                </Typography>
              ))}
            </Box>
          </Box>
        ) : null}

        {excerpt ? (
          <Box className="flex flex-col gap-1">
            <Typography variant="subtitle2" component="h4" className="mb-0">
              {t("approvals-draft-excerpt")}
            </Typography>
            <Typography variant="body1" className="text-text-secondary line-clamp-6 break-words whitespace-pre-line">
              {excerpt}
            </Typography>
          </Box>
        ) : null}

        <Typography variant="body2" className="text-text-secondary">
          {arriving
            ? t("approvals-draft-arriving")
            : wroteOn
              ? t("approvals-draft-edited", { version: draft.version })
              : t(rewriting ? "approvals-draft-where-rewritten" : "approvals-draft-where")}
        </Typography>

        {errorCode ? (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            onClose={() => setErrorCode(null)}
            closeText={t("draft-close")}
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

        {rejecting ? (
          <TextField
            label={t(rewriting ? "draft-reject-revision-note-label" : "draft-reject-note-label")}
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 2000))}
            disabled={busy}
            multiline
            minRows={2}
            fullWidth
            autoFocus
            helperText={rejectHelp ?? undefined}
          />
        ) : null}

        <Box className="flex flex-row flex-wrap gap-2">
          {rejecting ? (
            <>
              <Button
                variant="contained"
                onClick={() => void reject()}
                disabled={busy || blocked || note.trim().length < 3}
              >
                {busy
                  ? t("approvals-working")
                  : t(rewriting ? "draft-reject-revision-confirm" : "draft-reject-confirm")}
              </Button>
              <Button variant="text" color="grey" onClick={stopRejecting} disabled={busy}>
                {t("draft-keep")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="contained" href={`/casos/${draft.caseId}#case-drafts`} LinkComponent={Link}>
                {t("approvals-draft-open")}
              </Button>
              {canDecide ? (
                <Button variant="text" color="grey" onClick={() => setRejecting(true)} disabled={busy || blocked}>
                  {t(rewriting ? "draft-reject-revision" : "draft-reject")}
                </Button>
              ) : null}
            </>
          )}
        </Box>
        {!canDecide ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("approvals-who-decides", { functions: approvers })}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}
