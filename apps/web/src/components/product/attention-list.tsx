"use client";

import Link from "next/link";

import { Box, Card, CardContent, List, ListItemButton, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import NiExclamationSquare from "@/icons/nexture/ni-exclamation-square";
import { cn } from "@/lib/utils";

/** How urgent a group of the list is: past its time (red, a risk), or waiting on somebody to act. */
export type AttentionTone = "danger" | "attention";

/** One thing that holds a case until somebody acts: what kind of thing, what, of which case, and where it is done. */
export type AttentionItem = {
  id: string;
  href: string;
  /** The kind of thing, in a word or two (Prazo, Valor do pedido, Assinatura). */
  tag: string;
  title: string;
  detail?: string;
  /** How many things the line stands for; shown when more than one. */
  count?: number;
};

export type AttentionGroup = { key: string; title: string; tone: AttentionTone; items: AttentionItem[] };

const BAR: Record<AttentionTone, string> = {
  danger: "border-l-error",
  attention: "border-l-accent-3",
};

const ICON: Record<AttentionTone, string> = {
  danger: "bg-error-light/10 text-error",
  attention: "bg-accent-3-light/10 text-accent-3",
};

/**
 * What holds a firm's cases until somebody of the firm acts, at the top of
 * the screen where a person starts the day: one card, its colour the most
 * urgent of what it holds, each line one thing with its kind named (a pastel
 * badge, never colour alone), what it is, of which case and since when, one
 * click from where it is done.
 *
 * Closest catalog entries: the pending center's drawer (the same lines, in a
 * List of links) and StatTile (one count, one place to go). Neither says, per
 * thing, what it is and where it is put right, which is the job here; the bar
 * at the left of each line is the TILE_TONE hue on a bar, never on the words.
 */
export default function AttentionList({
  id,
  title,
  description,
  total,
  groups,
}: {
  id: string;
  title: string;
  description?: string;
  /** The count said beside the title, in words (3 itens). */
  total: string;
  groups: AttentionGroup[];
}) {
  const tone: AttentionTone = groups.some((group) => group.tone === "danger" && group.items.length > 0)
    ? "danger"
    : "attention";

  return (
    <Card component="section" aria-labelledby={id}>
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-row items-start gap-3">
          <Box className={cn("flex h-12 w-12 flex-none items-center justify-center rounded-2xl", ICON[tone])}>
            <NiExclamationSquare size="large" />
          </Box>
          <Box className="flex min-w-0 flex-1 flex-col gap-1">
            <Box className="flex flex-row flex-wrap items-center gap-2">
              <Typography id={id} variant="h5" component="h2" className="mb-0">
                {title}
              </Typography>
              <StatusChip tone={tone} label={total} />
            </Box>
            {description ? (
              <Typography variant="body2" className="text-text-secondary">
                {description}
              </Typography>
            ) : null}
          </Box>
        </Box>

        {groups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <Box key={group.key} component="section" aria-labelledby={`${id}-${group.key}`}>
              <Typography id={`${id}-${group.key}`} variant="subtitle2" component="h3" className="mb-1">
                {group.title}
              </Typography>
              <List disablePadding className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <ListItemButton
                    key={item.id}
                    component={Link}
                    href={item.href}
                    className={cn("rounded-r-lg border-l-4 py-2 pr-2 pl-3", BAR[group.tone])}
                  >
                    <Box className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                      <StatusChip tone={group.tone} label={item.tag} className="self-start sm:self-center" />
                      <Box className="flex min-w-0 flex-col">
                        <Typography variant="body1">{item.title}</Typography>
                        {item.detail ? (
                          <Typography variant="body2" className="text-text-secondary">
                            {item.detail}
                          </Typography>
                        ) : null}
                      </Box>
                    </Box>
                    {item.count && item.count > 1 ? (
                      <Typography variant="subtitle2" component="span" className="ml-3">
                        {item.count}
                      </Typography>
                    ) : null}
                    <NiChevronRightSmall size="medium" className="text-text-secondary ml-2 flex-none" />
                  </ListItemButton>
                ))}
              </List>
            </Box>
          ))}
      </CardContent>
    </Card>
  );
}
