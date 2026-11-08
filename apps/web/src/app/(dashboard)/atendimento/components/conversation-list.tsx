"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, Card, CardContent, List, ListItem, ListItemButton, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import EmptyState from "@/components/product/empty-state";
import StatusChip from "@/components/product/status-chip";
import NiMessages from "@/icons/nexture/ni-messages";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/whatsapp/conversations";
import type { InboxSort } from "@/lib/whatsapp/inbox-list";

/**
 * The conversations of a view, in its order. Each row answers what somebody
 * scanning the list needs: who it is, what was said last, and whether it
 * still waits for the firm (unread, the person spoke last, ONE called a
 * person, an answer of ONE waits to go). The head says which view it is and
 * how many it holds; a view longer than what the list shows says so, never
 * reads as the whole of it.
 */
export default function ConversationList({
  title,
  conversations,
  total,
  sort,
  searching,
  stale,
  selectedId,
  hrefOf,
  empty,
}: {
  /** The view's name, or the search's. */
  title: string;
  conversations: ConversationSummary[];
  /** How many the view (or the search) holds, beyond the ones shown. */
  total: number;
  sort: InboxSort;
  searching: boolean;
  /** The list shown is not yet the one the bar asks for (another view, or a search on its way). */
  stale: boolean;
  selectedId: string | null;
  hrefOf: (id: string) => string;
  /** What an empty list says, with its one way forward; null while the list is on its way. */
  empty: { title: string; description: string; action?: { label: string; onClick: () => void } } | null;
}) {
  const t = useTranslations("product");
  const shown = conversations.length;
  const countKey = searching ? "inbox-list-found" : "inbox-list-count";
  const cappedKey = sort === "oldest" ? "inbox-list-capped-oldest" : "inbox-list-capped";
  const description = shown < total ? t(cappedKey, { shown, total }) : t(countKey, { count: total });

  return (
    <Card component="section" aria-labelledby="inbox-list" aria-busy={stale || undefined}>
      <CardContent className="flex flex-col gap-3">
        <CardTitle
          id="inbox-list"
          icon={<NiMessages size="medium" />}
          title={title}
          description={stale ? t("inbox-list-loading") : shown > 0 ? description : undefined}
        />
        {shown === 0 ? (
          empty ? (
            <EmptyState
              icon={<NiMessages size="large" />}
              title={empty.title}
              description={empty.description}
              action={empty.action}
            />
          ) : null
        ) : (
          <List
            disablePadding
            className={cn("-mx-2 flex flex-col gap-0.5 transition-opacity", stale ? "opacity-60" : null)}
          >
            {conversations.map((conversation) => {
              const preview =
                conversation.preview && conversation.lastDirection === "out"
                  ? t("inbox-preview-out", { text: conversation.preview })
                  : conversation.preview;
              return (
                <ListItem key={conversation.id} disablePadding>
                  <ListItemButton
                    href={hrefOf(conversation.id)}
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
                        {conversation.replyWaiting ? (
                          <StatusChip label={t("inbox-reply-chip")} tone="attention" />
                        ) : null}
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
        )}
      </CardContent>
    </Card>
  );
}
