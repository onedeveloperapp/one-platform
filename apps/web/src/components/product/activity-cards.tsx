"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Box, Button, Typography } from "@mui/material";

import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import { cn } from "@/lib/utils";

/** One thing the product did by itself a moment ago, as a card. */
export type ActivityItem = {
  key: string;
  /** The icon of what it is about (a lawsuit's scale, a document's clip), at `size="medium"`. */
  icon: ReactNode;
  tone: TileTone;
  title: string;
  /** One line more, when the record has it (how many movements, of which lawsuit). */
  detail?: string;
  /** When, in words (há 1 hora). */
  when: string;
  /** Who did it, as the card's author: the product, or its AI. */
  actor: { icon: ReactNode; label: string };
  /** How many times it happened, in words, when the card stands for more than one. */
  count?: string;
  /** Where it is seen: a button that moves to its card, or a link to another screen. */
  action?: { label: string; name?: string; onClick?: () => void; href?: string };
};

/**
 * What the product did by itself a moment ago, one outlined card per thing (the template's projects card and its
 * post card, the owner's model of 2026-11-05): the icon of what it is about on its family's tint, what it did, when
 * in a pill on the right, a line more when the record has one, and at its foot who did it, as a post's author, with
 * how many times and the way to see it as pastel pills. Three across from a laptop on, one under the other on a
 * phone.
 *
 * Closest catalog entries: `StateLine` (one line of a state, with a status and an action: what this replaced, which
 * read as a list of checks with "Ver" drifting at the right edge) and the "Timeline de atividade" template (a long
 * history where the order is the meaning). Neither gives each of the few latest things a card of its own that says
 * what it was about at a glance, which is the job here.
 */
export default function ActivityCards({ id, title, items }: { id: string; title: string; items: ActivityItem[] }) {
  if (items.length === 0) return null;
  return (
    <Box component="section" aria-labelledby={id} className="flex flex-col gap-2">
      <Typography id={id} variant="subtitle2" component="h3" className="mb-0">
        {title}
      </Typography>
      <Box component="ul" className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const style = TILE_TONE[item.tone];
          return (
            <Box component="li" key={item.key} className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
              <Box className="flex flex-row items-start gap-3">
                <Box
                  aria-hidden
                  className={cn("flex h-9 w-9 flex-none items-center justify-center rounded-xl", style.bg, style.text)}
                >
                  {item.icon}
                </Box>
                <Typography variant="body1" className="min-w-0 flex-1 self-center font-semibold">
                  {item.title}
                </Typography>
                <Typography
                  variant="body2"
                  component="span"
                  className="bg-grey-50 text-text-secondary flex-none rounded-full px-2.5 py-0.5 whitespace-nowrap"
                >
                  {item.when}
                </Typography>
              </Box>
              {item.detail ? (
                <Typography variant="body2" className="text-text-secondary">
                  {item.detail}
                </Typography>
              ) : null}
              <Box className="mt-auto flex flex-row flex-wrap items-center justify-between gap-2">
                <Box className="flex flex-row items-center gap-2">
                  <Box
                    aria-hidden
                    className="bg-primary-light/10 text-primary flex h-7 w-7 items-center justify-center rounded-full"
                  >
                    {item.actor.icon}
                  </Box>
                  <Typography variant="body2" className="text-text-secondary">
                    {item.actor.label}
                  </Typography>
                </Box>
                <Box className="flex flex-row items-center gap-2">
                  {item.count ? (
                    <Typography
                      variant="body2"
                      component="span"
                      className="bg-grey-50 text-text-secondary rounded-full px-2.5 py-0.5 whitespace-nowrap"
                    >
                      {item.count}
                    </Typography>
                  ) : null}
                  {item.action ? (
                    item.action.href ? (
                      <Button
                        variant="pastel"
                        color="primary"
                        size="small"
                        href={item.action.href}
                        LinkComponent={Link}
                        aria-label={item.action.name}
                      >
                        {item.action.label}
                      </Button>
                    ) : (
                      <Button
                        variant="pastel"
                        color="primary"
                        size="small"
                        onClick={item.action.onClick}
                        aria-label={item.action.name}
                      >
                        {item.action.label}
                      </Button>
                    )
                  ) : null}
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
