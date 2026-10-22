"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, Card, CardContent, List, ListItem, ListItemButton, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import type { ConversationSummary } from "@/lib/whatsapp/conversations";

/**
 * Who wrote to the firm, most recent first. Each row answers what somebody
 * scanning the list needs: who it is, what was said last, and whether it
 * still waits for the firm (unread, or the person spoke last).
 */
export default function ConversationList({
  conversations,
  selectedId,
}: {
  conversations: ConversationSummary[];
  selectedId: string | null;
}) {
  const t = useTranslations("product");

  return (
    <Card component="section" aria-labelledby="inbox-list">
      <CardContent className="flex flex-col gap-3">
        <Typography id="inbox-list" variant="h5" component="h2" className="mb-0">
          {t("inbox-list-title", { count: conversations.length })}
        </Typography>
        <List disablePadding className="-mx-2 flex flex-col gap-0.5">
          {conversations.map((conversation) => {
            const preview =
              conversation.preview && conversation.lastDirection === "out"
                ? t("inbox-preview-out", { text: conversation.preview })
                : conversation.preview;
            return (
              <ListItem key={conversation.id} disablePadding>
                <ListItemButton
                  href={`/atendimento?c=${conversation.id}`}
                  LinkComponent={Link}
                  selected={conversation.id === selectedId}
                  aria-current={conversation.id === selectedId ? "true" : undefined}
                  className="flex flex-col items-stretch gap-1 rounded-2xl px-3 py-2.5"
                >
                  <Box className="flex flex-row items-baseline gap-2">
                    <Typography variant="subtitle2" component="span" className="min-w-0 flex-1 truncate">
                      {conversation.name}
                    </Typography>
                    {conversation.lastLabel ? (
                      <Typography variant="body2" component="span" className="text-text-secondary flex-none">
                        {conversation.lastLabel}
                      </Typography>
                    ) : null}
                  </Box>
                  {preview ? (
                    <Typography variant="body2" component="span" className="text-text-secondary truncate">
                      {preview}
                    </Typography>
                  ) : null}
                  {conversation.unread > 0 ||
                  conversation.waiting ||
                  conversation.optedOut ||
                  conversation.test ||
                  conversation.calledReason ||
                  conversation.replyWaiting ? (
                    <Box className="flex flex-row flex-wrap gap-1.5">
                      {conversation.calledReason ? (
                        <StatusChip label={t("inbox-called-chip")} tone="attention" />
                      ) : null}
                      {conversation.replyWaiting ? <StatusChip label={t("inbox-reply-chip")} tone="attention" /> : null}
                      {conversation.test ? <StatusChip label={t("inbox-test-chip")} tone="info" /> : null}
                      {conversation.unread > 0 ? (
                        <StatusChip label={t("inbox-unread", { count: conversation.unread })} tone="attention" />
                      ) : conversation.waiting ? (
                        <StatusChip label={t("inbox-waiting")} tone="info" />
                      ) : null}
                      {conversation.optedOut ? <StatusChip label={t("inbox-opted-out")} tone="neutral" /> : null}
                    </Box>
                  ) : null}
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </CardContent>
    </Card>
  );
}
