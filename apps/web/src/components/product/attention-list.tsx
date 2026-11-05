"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Box, Card, CardContent, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
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
  /** The count in words (3 casos), said in its pill; the number alone when not given. */
  countLabel?: string;
  /** The icon of the kind of thing (a deadline's clock, a publication's inbox), at `size="medium"`. */
  icon?: ReactNode;
};

export type AttentionGroup = { key: string; title: string; tone: AttentionTone; items: AttentionItem[] };

const ICON: Record<AttentionTone, string> = {
  danger: "bg-error-light/10 text-error",
  attention: "bg-accent-3-light/10 text-accent-3",
};

/**
 * What holds a firm's cases until somebody of the firm acts, at the top of
 * the screen where a person starts the day: one card, its colour the most
 * urgent of what it holds, and in it, by group, one card per thing (the
 * template's grid of projects, the owner's model of 2026-11-05): the icon of
 * its kind on the group's tint, what it is, its kind named in a pastel badge
 * (never colour alone), of which case and since when in two lines at most,
 * and how many when it stands for more than one, the whole card one click
 * from where it is done.
 *
 * Closest catalog entries: the pending center's drawer (the same lines, in a
 * List of links) and StatTile (one count, one place to go). Neither says, per
 * thing, what it is and where it is put right, which is the job here; the
 * group's hue rides on the icon's tint and the badge, never on the words.
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
              <Typography id={`${id}-${group.key}`} variant="subtitle2" component="h3" className="mb-2">
                {group.title}
              </Typography>
              <Box component="ul" className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2">
                {group.items.map((item) => (
                  <Box component="li" key={item.id} className="flex">
                    <Box
                      component={Link}
                      href={item.href}
                      className="border-grey-100 hover:border-grey-200 hover:bg-grey-25 flex w-full flex-col gap-2 rounded-2xl border p-4 no-underline outline-offset-2 transition-colors focus-visible:outline-2"
                    >
                      <Box className="flex flex-row items-start gap-3">
                        <Box
                          aria-hidden
                          className={cn(
                            "flex h-9 w-9 flex-none items-center justify-center rounded-xl",
                            ICON[group.tone],
                          )}
                        >
                          {item.icon ?? <NiExclamationSquare size="medium" />}
                        </Box>
                        <Typography
                          variant="body1"
                          className="text-text-primary min-w-0 flex-1 self-center font-semibold"
                        >
                          {item.title}
                        </Typography>
                        <StatusChip tone={group.tone} label={item.tag} className="flex-none" />
                      </Box>
                      {item.detail ? (
                        <Typography variant="body2" className="text-text-secondary line-clamp-2">
                          {item.detail}
                        </Typography>
                      ) : null}
                      {item.count && item.count > 1 ? (
                        <Box className="flex flex-row">
                          <Typography
                            variant="body2"
                            component="span"
                            className={cn("rounded-full px-2.5 py-0.5 font-semibold", ICON[group.tone])}
                          >
                            {item.countLabel ?? item.count}
                          </Typography>
                        </Box>
                      ) : null}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
      </CardContent>
    </Card>
  );
}
