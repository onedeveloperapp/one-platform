"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, FormControl, FormHelperText, FormLabel, Input, Typography } from "@mui/material";

import { decideApproval } from "@/lib/ai/actions";
import { approvalErrorKey } from "@/lib/ai/approvals";
import {
  approvedOutput,
  DISCARD_NOTE,
  REPLY_BLOCK_KEY,
  REPLY_MAX,
  type ReplyBlock,
  replyReady,
  type WaitingReply,
} from "@/lib/conversations/reply";

/** What became of an answer the person decided here. */
export type ReplyOutcome =
  | { kind: "sent"; edited: boolean }
  | { kind: "discarded" }
  | { kind: "not-sent"; code: string };

/**
 * An answer of ONE to a passenger that waits for a person (migration 0048):
 * read, corrected in place and sent with "Enviar", which approves it as ONE's
 * answer approved by this person; or discarded. It is the same in the
 * conversation, where the person reads what the passenger wrote, and in the
 * firm's queue. Who cannot decide reads it, and `decides` says who does
 * instead of offering buttons that would be refused; an answer that cannot
 * go as the conversation stands says why, and is only discarded.
 */
export default function WaitingReplyForm({
  waiting,
  idPrefix,
  block,
  decides,
  onDone,
}: {
  waiting: WaitingReply;
  /** Makes the ids of the field unique on the page. */
  idPrefix: string;
  /** Why the answer cannot go now, when it cannot. */
  block: ReplyBlock;
  /** Null when this person decides here; else the words that say who does, or why nobody does from this session. */
  decides: string | null;
  onDone: (outcome: ReplyOutcome) => void;
}) {
  const t = useTranslations("product");
  const [text, setText] = useState(waiting.reply);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<"send" | "discard" | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const fieldId = `${idPrefix}-reply`;
  const ready = replyReady(text);

  const decide = async (decision: "approved" | "rejected") => {
    if (busy) return;
    if (decision === "approved") {
      setTouched(true);
      if (!ready || block) return;
    }
    setBusy(decision === "approved" ? "send" : "discard");
    setErrorCode(null);
    try {
      const result = await decideApproval(
        decision === "approved"
          ? { approvalId: waiting.approvalId, decision, finalOutput: approvedOutput(waiting, text) }
          : { approvalId: waiting.approvalId, decision, note: DISCARD_NOTE },
      );
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }
      if (decision === "rejected") onDone({ kind: "discarded" });
      else if (result.notSent) onDone({ kind: "not-sent", code: result.notSent });
      else onDone({ kind: "sent", edited: result.edited });
    } catch {
      // A request that failed on the way: the buttons come back, with what was typed.
      setErrorCode("failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
      <Box className="flex flex-col gap-0.5">
        <Typography variant="subtitle2" component="p" className="mb-0">
          {t("reply-waiting-title")}
        </Typography>
        <Typography variant="caption" className="text-text-secondary">
          {t("reply-waiting-received", { when: waiting.receivedLabel })}
        </Typography>
      </Box>

      {waiting.callPerson ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("reply-call-person", { reason: waiting.callPerson })}
        </Alert>
      ) : null}

      {decides ? (
        <>
          <Typography variant="body1" className="text-text-primary whitespace-pre-wrap">
            {waiting.reply || t("reply-empty")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {decides}
          </Typography>
        </>
      ) : (
        <>
          <FormControl fullWidth className="outlined" variant="standard" error={touched && !ready}>
            <FormLabel component="label" htmlFor={fieldId}>
              {t("reply-label")}
            </FormLabel>
            <Input
              id={fieldId}
              multiline
              minRows={2}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onBlur={() => setTouched(true)}
              disabled={busy !== null}
              inputProps={{ maxLength: REPLY_MAX }}
              aria-describedby={`${fieldId}-help`}
            />
            <FormHelperText id={`${fieldId}-help`}>
              {touched && !ready ? t("reply-required") : t("reply-help")}
            </FormHelperText>
          </FormControl>

          {block ? (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              {t(REPLY_BLOCK_KEY[block])}
            </Alert>
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

          <Box className="flex flex-row flex-wrap gap-2">
            <Button
              variant="contained"
              onClick={() => void decide("approved")}
              disabled={busy !== null || block !== null}
            >
              {busy === "send" ? t("reply-working") : t("reply-send")}
            </Button>
            <Button variant="text" color="grey" onClick={() => void decide("rejected")} disabled={busy !== null}>
              {busy === "discard" ? t("reply-working") : t("reply-discard")}
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
}
