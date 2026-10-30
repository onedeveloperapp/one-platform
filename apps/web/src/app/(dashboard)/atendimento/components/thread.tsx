"use client";

import Composer from "./composer";
import OptOutDialog from "./optout-dialog";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import WaitingReplyForm, { type ReplyOutcome } from "@/components/conversations/waiting-reply";
import MessageBubble from "@/components/product/message-bubble";
import StatusChip from "@/components/product/status-chip";
import NiArrowLeft from "@/icons/nexture/ni-arrow-left";
import { caseLabel } from "@/lib/cases/cases";
import { notSentKey, type ReplyBlock, replyBlock, type WaitingReply } from "@/lib/conversations/reply";
import type { FirmFunction, OrgRole } from "@/lib/firm/roles";
import { scopedHref } from "@/lib/modules/offer";
import { markConversationRead, openMedia, setConversationAgent } from "@/lib/whatsapp/actions";
import {
  composerMode,
  type ConversationSummary,
  eventWords,
  failureHasNoWords,
  failureKey,
  kindKey,
  mayRemoveOptOut,
  statusKey,
  type TemplateOption,
  type ThreadEvent,
  type ThreadMessage,
} from "@/lib/whatsapp/conversations";

/**
 * One conversation: what was said, in order, and the answer being written.
 * The header says what decides the answer (whether the 24 hours are open,
 * whether the person asked to stop) and who answers it: ONE, which a person
 * takes over with a click (or by writing) and gives back, or a person, whom
 * ONE may have called with why. Each message says who wrote it, and what ONE
 * did is told between the messages. The composer offers only what the
 * database will accept.
 */
export default function Thread({
  conversation,
  messages,
  olderHidden,
  cases,
  events,
  waitingReply,
  templates,
  me,
  firmName,
  supportVisit,
  manager,
  module = null,
  onChanged,
}: {
  conversation: ConversationSummary;
  messages: ThreadMessage[];
  olderHidden: boolean;
  /** The cases of the person with this number, the latest first. */
  cases: { id: string; seq: number }[];
  /** What ONE did in the conversation and who took it over, in order. */
  events: ThreadEvent[];
  /** The answer of ONE that waits for a person's "Enviar" here, and whether this person decides it. */
  waitingReply: { reply: WaitingReply; mayDecide: boolean } | null;
  templates: TemplateOption[];
  me: { role: OrgRole; firmFunction: FirmFunction };
  firmName: string;
  supportVisit: boolean;
  manager: boolean;
  /** The module the inbox is under (0078): the way back and a new case stay under it. */
  module?: string | null;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const log = useRef<HTMLDivElement | null>(null);
  const [optOut, setOptOut] = useState<"record" | "remove" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState(false);
  const [replyNote, setReplyNote] = useState<{ severity: "success" | "warning"; text: string } | null>(null);

  const replyDone = (outcome: ReplyOutcome) => {
    setReplyNote(
      outcome.kind === "sent"
        ? { severity: "success", text: t("reply-sent") }
        : outcome.kind === "discarded"
          ? { severity: "success", text: t("reply-discarded") }
          : { severity: "warning", text: t(notSentKey(outcome.code)) },
    );
    onChanged();
  };
  const block: ReplyBlock = replyBlock(conversation);

  const changeAgent = async (agent: "one" | "person") => {
    setAgentBusy(true);
    setAgentError(false);
    const result = await setConversationAgent(conversation.id, agent).catch(() => ({ ok: false }));
    setAgentBusy(false);
    if (!result.ok) setAgentError(true);
    else onChanged();
  };

  // The messages and what happened between them, in the order they happened. What happened in the same moment as
  // a message comes first: the case opened before the message that tells it, the conversation taken over before
  // the words of who took it.
  const timeline = [
    ...messages.map((message) => ({ type: "message" as const, at: message.at, message })),
    ...events.map((event) => ({ type: "event" as const, at: event.at, event })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.type === b.type ? 0 : a.type === "event" ? -1 : 1));

  const lastId = messages.length > 0 ? messages[messages.length - 1].id : null;

  // The newest message is what somebody came to read. Only the thread moves: the page stays where it is.
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [lastId]);

  // Opening the conversation is reading it. A support visit leaves it as it found it.
  const unread = conversation.unread;
  const conversationId = conversation.id;
  useEffect(() => {
    if (unread === 0 || supportVisit) return;
    void markConversationRead(conversationId).then((result) => {
      if (result.ok) onChanged();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, unread, supportVisit]);

  const mode = composerMode({
    supportVisit,
    numberActive: conversation.numberActive,
    windowOpen: conversation.windowOpen,
    optedOut: conversation.optedOut,
  });

  const open = async (fileId: string) => {
    setMediaError(false);
    const link = await openMedia(fileId);
    if (!link.ok) {
      setMediaError(true);
      return;
    }
    // The link answers as a download, so the conversation stays where it is.
    window.location.assign(link.url);
  };

  return (
    <Card component="section" aria-labelledby="inbox-thread">
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-col gap-2">
          <Button
            href={scopedHref("/atendimento", module)}
            LinkComponent={Link}
            variant="text"
            color="grey"
            size="small"
            startIcon={<NiArrowLeft size="medium" />}
            className="self-start lg:hidden"
          >
            {t("inbox-back")}
          </Button>
          <Box className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between md:gap-4">
            <Box className="flex min-w-0 flex-col">
              <Typography id="inbox-thread" variant="h5" component="h2" className="mb-0 truncate">
                {conversation.name}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {conversation.phoneLabel}
              </Typography>
            </Box>
            <Box className="flex flex-row flex-wrap gap-1.5">
              {!conversation.numberActive ? (
                <StatusChip label={t("inbox-number-off")} tone="attention" />
              ) : conversation.windowOpen && conversation.windowClosesLabel ? (
                <StatusChip label={t("inbox-window-open", { when: conversation.windowClosesLabel })} tone="positive" />
              ) : (
                <StatusChip label={t("inbox-window-closed")} tone="neutral" />
              )}
              {conversation.optedOut ? <StatusChip label={t("inbox-opted-out")} tone="attention" /> : null}
              {conversation.test ? <StatusChip label={t("inbox-test-chip")} tone="info" /> : null}
            </Box>
          </Box>
          <Box className="flex flex-row flex-wrap items-center gap-2">
            <StatusChip
              label={conversation.agent === "one" ? t("inbox-agent-one") : t("inbox-agent-person")}
              tone={conversation.agent === "one" ? "primary" : "neutral"}
            />
            {!supportVisit ? (
              conversation.agent === "one" ? (
                <Button
                  variant="outlined"
                  color="grey"
                  size="small"
                  disabled={agentBusy}
                  onClick={() => void changeAgent("person")}
                >
                  {t("inbox-agent-take")}
                </Button>
              ) : (
                <Button
                  variant="outlined"
                  color="primary"
                  size="small"
                  disabled={agentBusy}
                  onClick={() => void changeAgent("one")}
                >
                  {t("inbox-agent-give-back")}
                </Button>
              )
            ) : null}
          </Box>
          {conversation.calledReason ? (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              {t("inbox-called", { reason: conversation.calledReason })}
            </Alert>
          ) : null}
          {agentError ? (
            <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setAgentError(false)}>
              {t("inbox-agent-error")}
            </Alert>
          ) : null}
          <Box className="flex flex-row flex-wrap gap-2">
            {cases.slice(0, 3).map((item) => (
              <Button
                key={item.id}
                href={`/casos/${item.id}`}
                LinkComponent={Link}
                variant="outlined"
                color="grey"
                size="small"
              >
                {t("inbox-case-open", { label: caseLabel(item.seq) })}
              </Button>
            ))}
            {!supportVisit && (
              <Button
                href={scopedHref("/casos", module, { conversa: conversation.id })}
                LinkComponent={Link}
                variant="text"
                size="small"
              >
                {t("inbox-case-new")}
              </Button>
            )}
          </Box>
        </Box>

        <Box
          ref={log}
          className="border-grey-100 max-h-[55vh] min-h-48 overflow-y-auto border-y py-4"
          tabIndex={0}
          role="log"
          aria-label={t("inbox-thread-label", { name: conversation.name })}
        >
          {olderHidden ? (
            <Typography variant="body2" className="text-text-secondary mb-4 text-center">
              {t("inbox-older-hidden")}
            </Typography>
          ) : null}
          <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
            {timeline.map((item) => {
              if (item.type === "event") {
                const words = eventWords(item.event);
                return (
                  <Box
                    component="li"
                    key={`event-${item.event.id}`}
                    className="flex flex-col items-center gap-0.5 px-4 text-center"
                  >
                    <Typography variant="body2" className="text-text-secondary">
                      {t(words.key, words.paperKey ? { ...words.values, paper: t(words.paperKey) } : words.values)}
                      {item.event.caseId &&
                      ["case_opened", "document_joined", "statement_joined"].includes(item.event.kind) ? (
                        <>
                          {" · "}
                          <Link href={`/casos/${item.event.caseId}`} className="text-primary">
                            {t("inbox-event-open-case")}
                          </Link>
                        </>
                      ) : null}
                    </Typography>
                    <Typography variant="caption" className="text-text-secondary">
                      {item.event.momentLabel}
                    </Typography>
                  </Box>
                );
              }
              const message = item.message;
              const fromFirm = message.direction === "out";
              const failed = message.status === "failed";
              // Not sent, or nobody can tell: the two are never shown under the same word.
              const unconfirmed = failed && message.errorCode === "unconfirmed";
              return (
                <MessageBubble
                  key={message.id}
                  side={message.direction}
                  sideLabel={fromFirm ? t("inbox-said-firm") : t("inbox-said-person", { name: conversation.name })}
                  note={
                    message.origin === "app"
                      ? t("inbox-note-app")
                      : message.origin === "history"
                        ? t("inbox-note-history")
                        : message.templateName
                          ? t("inbox-template-label", { name: message.templateName })
                          : undefined
                  }
                  meta={
                    <>
                      <span>{message.momentLabel}</span>
                      {!fromFirm ? <span>{t("inbox-by-client")}</span> : null}
                      {fromFirm && message.aiRun ? (
                        <span>
                          {message.authorName
                            ? t("inbox-by-one-approved", { name: message.authorName })
                            : t("inbox-by-one-ai")}
                        </span>
                      ) : fromFirm && message.byOne ? (
                        <span>{t("inbox-by-one")}</span>
                      ) : fromFirm && message.authorName ? (
                        <span>{t("inbox-by", { name: message.authorName })}</span>
                      ) : null}
                      {fromFirm ? (
                        <StatusChip
                          label={unconfirmed ? t("inbox-status-unconfirmed") : t(statusKey(message.status))}
                          tone={unconfirmed ? "attention" : failed ? "danger" : "neutral"}
                        />
                      ) : null}
                    </>
                  }
                >
                  {message.body ? message.body : <em>{t(kindKey(message.kind))}</em>}
                  {message.media.state === "stored" && message.media.fileId ? (
                    <Box className="mt-2">
                      <Button
                        size="small"
                        variant="outlined"
                        color="grey"
                        onClick={() => void open(message.media.fileId as string)}
                      >
                        {message.media.filename
                          ? t("inbox-media-open-named", { name: message.media.filename })
                          : t("inbox-media-open")}
                      </Button>
                    </Box>
                  ) : null}
                  {message.media.state === "pending" ? (
                    <Typography variant="body2" className="text-text-secondary mt-1">
                      {t("inbox-media-pending")}
                    </Typography>
                  ) : null}
                  {message.media.state === "failed" ? (
                    <Typography variant="body2" className="text-text-secondary mt-1">
                      {t("inbox-media-failed")}
                    </Typography>
                  ) : null}
                  {failed ? (
                    <Typography variant="body2" className="text-text-primary mt-1">
                      {failureHasNoWords(message.errorCode)
                        ? t("inbox-failure-other", { code: message.errorCode ?? "" })
                        : t(failureKey(message.errorCode))}
                    </Typography>
                  ) : null}
                </MessageBubble>
              );
            })}
          </Box>
        </Box>

        {mediaError ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setMediaError(false)}>
            {t("inbox-media-open-error")}
          </Alert>
        ) : null}

        {notice ? (
          <Alert
            severity="success"
            role="status"
            className="neutral bg-background-paper/60!"
            onClose={() => setNotice(null)}
          >
            {notice}
          </Alert>
        ) : null}

        {replyNote ? (
          <Alert
            severity={replyNote.severity}
            role="status"
            className="neutral bg-background-paper/60!"
            onClose={() => setReplyNote(null)}
          >
            {replyNote.text}
          </Alert>
        ) : null}

        {waitingReply ? (
          <WaitingReplyForm
            key={waitingReply.reply.approvalId}
            waiting={waitingReply.reply}
            idPrefix={`thread-${conversation.id}`}
            block={block}
            decides={supportVisit ? t("reply-support") : waitingReply.mayDecide ? null : t("reply-not-yours")}
            onDone={replyDone}
          />
        ) : null}

        {conversation.agent === "one" && (mode === "text" || mode === "template") ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("inbox-one-answers-hint")}
          </Typography>
        ) : null}

        <Composer
          mode={mode}
          conversation={conversation}
          templates={templates}
          firmName={firmName}
          manager={manager}
          onSent={onChanged}
        />

        {!supportVisit ? (
          <Box className="flex flex-row flex-wrap gap-2">
            {conversation.optedOut ? (
              mayRemoveOptOut(me.role, me.firmFunction) ? (
                <Button variant="text" color="grey" size="small" onClick={() => setOptOut("remove")}>
                  {t("inbox-optout-remove")}
                </Button>
              ) : null
            ) : (
              <Button variant="text" color="grey" size="small" onClick={() => setOptOut("record")}>
                {t("inbox-optout-record")}
              </Button>
            )}
          </Box>
        ) : null}
      </CardContent>

      {optOut ? (
        <OptOutDialog
          key={optOut}
          direction={optOut}
          conversation={conversation}
          onClose={() => setOptOut(null)}
          onDone={(message) => {
            setOptOut(null);
            setNotice(message);
            onChanged();
          }}
        />
      ) : null}
    </Card>
  );
}
