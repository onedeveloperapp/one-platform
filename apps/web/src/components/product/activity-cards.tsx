"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Box, ButtonBase, Typography } from "@mui/material";

import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import { cn } from "@/lib/utils";

/** One thing the product did by itself a moment ago, as a compact card. */
export type ActivityItem = {
  key: string;
  /** The icon of what it is about (a lawsuit's scale, a document's clip), at `size="small"`. */
  icon: ReactNode;
  tone: TileTone;
  title: string;
  /** When, in words (há 1 hora). */
  when: string;
  /** What else the record says, each in a few words (4 movimentações novas, 3 vezes, IA do ONE). */
  facts?: string[];
  /** Where it is seen: the whole card moves to its card on the screen, or leads to another screen. */
  action?: { onClick?: () => void; href?: string };
};

/**
 * What the product did by itself a moment ago, one compact outlined card each, a few across (the owner's model of
 * 2026-11-05, made lighter on 2026-11-06 when the top of a case read as noise): the icon of what it is about on its
 * family's tint, what it did, and under it one quiet line with when and what else the record says (how many times, a
 * detail, the AI when it was the AI). The whole card is the way to see it, with a chevron, so no button, pill or
 * author footer competes with the title. Three across from a laptop on, one under the other on a phone.
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
      <Box component="ul" className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const style = TILE_TONE[item.tone];
          const body = (
            <>
              <Box
                aria-hidden
                className={cn("flex h-8 w-8 flex-none items-center justify-center rounded-lg", style.bg, style.text)}
              >
                {item.icon}
              </Box>
              <Box className="flex min-w-0 flex-1 flex-col">
                <Typography variant="body2" component="span" className="text-text-primary font-semibold">
                  {item.title}
                </Typography>
                <Typography variant="caption" component="span" className="text-text-secondary">
                  {/* Each fact whole on its line: "3 vezes" never splits across two. */}
                  {[item.when, ...(item.facts ?? [])].map((fact, index) => (
                    <span key={fact}>
                      {index > 0 ? " · " : null}
                      <span className="whitespace-nowrap">{fact}</span>
                    </span>
                  ))}
                </Typography>
              </Box>
              {item.action ? <NiChevronRightSmall size="small" className="text-text-secondary flex-none" /> : null}
            </>
          );
          const frame =
            "border-grey-100 flex w-full flex-row items-center gap-3 rounded-2xl border px-3 py-2.5 text-left";
          return (
            <Box component="li" key={item.key} className="flex">
              {item.action?.href ? (
                <ButtonBase
                  component={Link}
                  href={item.action.href}
                  className={cn(frame, "hover:bg-grey-25 focus-visible:bg-grey-25")}
                >
                  {body}
                </ButtonBase>
              ) : item.action?.onClick ? (
                <ButtonBase
                  onClick={item.action.onClick}
                  className={cn(frame, "hover:bg-grey-25 focus-visible:bg-grey-25")}
                >
                  {body}
                </ButtonBase>
              ) : (
                <Box className={frame}>{body}</Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
