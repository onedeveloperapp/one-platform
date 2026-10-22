"use client";

import { type DecisionKind } from "./approval-card";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, Button, Card, CardContent, Typography } from "@mui/material";

import WaitingReplyForm, { type ReplyOutcome } from "@/components/conversations/waiting-reply";
import { type ApprovalConversation, type PendingApproval } from "@/lib/ai/approvals";
import { replyBlock, waitingReplyOf } from "@/lib/conversations/reply";
import { FUNCTION_LABEL_KEY } from "@/lib/firm/roles";

const AUTHOR_KEY: Record<ApprovalConversation["messages"][number]["author"], string> = {
  cliente: "approvals-reply-author-client",
  one: "approvals-reply-author-one",
  escritorio: "approvals-reply-author-firm",
};

/**
 * An answer of ONE to a passenger that waits for a person (migration 0048),
 * as the queue shows it: the last words of the conversation it answers, and
 * the answer, corrected in place and sent, or discarded. The conversation is
 * one click away, where the rest of it is read. Closest to `ApprovalCard`,
 * whose generic fields would let a person change what ONE understood
 * (`intencao`) instead of what it says.
 */
export default function ConversationReplyCard({
  approval,
  conversation,
  canDecide,
  blocked,
  onDecided,
}: {
  approval: PendingApproval;
  conversation: ApprovalConversation;
  canDecide: boolean;
  /** Nobody decides from this session right now (no second factor, a support visit): the screen says why, once. */
  blocked: boolean;
  onDecided: (kind: DecisionKind) => void;
}) {
  const t = useTranslations("product");
  const titleId = `approval-${approval.id}`;
  const waiting = waitingReplyOf(approval.id, approval.output, approval.receivedLabel);
  const approvers = new Intl.ListFormat("pt-BR", { style: "long", type: "disjunction" }).format(
    approval.approverFunctions.map((firmFunction) => t(FUNCTION_LABEL_KEY[firmFunction])),
  );

  const done = (outcome: ReplyOutcome) =>
    onDecided(
      outcome.kind === "discarded"
        ? "rejected"
        : outcome.kind === "not-sent"
          ? "approved-not-sent"
          : outcome.edited
            ? "approved-edited"
            : "approved",
    );

  return (
    <Card component="article" aria-labelledby={titleId}>
      <CardContent className="flex flex-col gap-5">
        <Box className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between md:gap-4">
          <Box className="flex min-w-0 flex-col gap-1">
            <Typography id={titleId} variant="h5" component="h3" className="mb-0">
              {conversation.contact
                ? t("approvals-reply-title", { contact: conversation.contact })
                : t("approvals-reply-title-unnamed")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary max-w-3xl">
              {t("approvals-reply-body")}
            </Typography>
          </Box>
          <Button
            variant="outlined"
            color="grey"
            size="small"
            href={`/atendimento?c=${conversation.id}`}
            LinkComponent={Link}
            className="flex-none self-start"
          >
            {t("approvals-reply-open")}
          </Button>
        </Box>

        {conversation.messages.length > 0 ? (
          <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
            <Typography variant="body2" className="text-text-secondary">
              {t("approvals-reply-recent")}
            </Typography>
            <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
              {conversation.messages.map((message) => (
                <Box component="li" key={message.id} className="flex flex-col gap-0.5">
                  <Typography variant="caption" className="text-text-secondary">
                    {t(AUTHOR_KEY[message.author])} · {message.momentLabel}
                  </Typography>
                  <Typography variant="body1" className="text-text-primary whitespace-pre-wrap">
                    {message.text || t("approvals-reply-no-text")}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        ) : null}

        <WaitingReplyForm
          waiting={waiting}
          idPrefix={titleId}
          block={replyBlock(conversation)}
          decides={
            !canDecide
              ? t("approvals-who-decides", { functions: approvers })
              : blocked
                ? t("reply-blocked-session")
                : null
          }
          onDone={done}
        />
      </CardContent>
    </Card>
  );
}
