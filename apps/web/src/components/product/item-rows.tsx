"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Box, Button, Collapse, Typography, useMediaQuery } from "@mui/material";

import StateLine, { type StateTone } from "@/components/product/state-line";
import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import { cn } from "@/lib/utils";

/** One thing of a list, as one line: what it is, where it stands, its one action, and what opens in it. */
export type ItemRow = {
  key: string;
  icon: ReactNode;
  /** The tint of its icon, by what it is. */
  tone: TileTone;
  /** A tint of its own, for a state no family tint carries (a thing cancelled): classes of the icon's tile. */
  tint?: string;
  title: ReactNode;
  /** One quiet line under the title: when, from where, whose. */
  detail?: ReactNode;
  /** Where it stands, in its state's colour and words, on the right. */
  state?: { tone: StateTone; text: ReactNode };
  /** The one thing the line asks for, done in place (a button). */
  action?: ReactNode;
  /** The line's one thing is in what opens: a button of these words opens it ("Triar"), in place of `action`. */
  opener?: string;
  /** What opens in the line: the whole thing, with everything it allows. None, and the line does not open. */
  content?: () => ReactNode;
  /** The name of the line's opener: "Abrir a publicação de 07/11". */
  openLabel?: string;
};

export type ItemSection = {
  key: string;
  title: string;
  rows: ItemRow[];
  /** What asks for the person's action: tinted, and opened first when the person arrives for it. */
  ask?: boolean;
  /** How many lines show before "Mostrar os outros"; all when absent. */
  shown?: number;
};

/**
 * A card's list as one line per thing (the owner's canvas "ONE · Publicações no caso", 2026-11-10): what asks for
 * the person's action first, in a section of its own, each line saying what is missing and holding its one button;
 * what the product is doing, as lines that wait; what is settled, below, the newest first, a few in sight and the
 * rest one click away. A line opens in place on what it holds (the whole publication, the document with its
 * buttons), one at a time: opening another closes it. What opened once stays mounted, so a note being typed, or a
 * panel it opened, is not lost when it closes. A person who arrives for the card (`arrival`: the card's address,
 * as the top of the record's "Resolver" sets it) finds the first line that asks for them open.
 *
 * Closest catalog entries: `StateLine`, whose line it carries on the right, and `CollapsibleCard`, whose disclosure
 * it repeats per line (the opener stretched over the line, what sits beside it standing above it). Neither lists
 * things that open one at a time and sort by what asks for action.
 */
export default function ItemRows({
  sections,
  arrival,
}: {
  sections: ItemSection[];
  /** The addresses that bring a person to this list: on arrival there, the first line that asks for them opens. */
  arrival?: readonly string[];
}) {
  const t = useTranslations("product");
  const base = useId();
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [openKey, setOpenKey] = useState<string | null>(null);
  // What opened once stays mounted, closed: what is typed in it, and a panel it opened, live on.
  const [mounted, setMounted] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const open = (key: string | null) => {
    setOpenKey(key);
    if (key) setMounted((current) => (current.has(key) ? current : new Set([...current, key])));
  };

  // Arriving for the card: the first line that asks for the person, and opens, is open. Only the address decides: a
  // line that comes to ask later opens when the person comes for it again.
  const asking =
    sections.find((section) => section.ask && section.rows.some((row) => row.content))?.rows.find((row) => row.content)
      ?.key ?? null;
  const firstAsking = useRef<string | null>(asking);
  useEffect(() => {
    firstAsking.current = asking;
  }, [asking]);
  const addresses = (arrival ?? []).join("|");
  useEffect(() => {
    if (!addresses) return;
    const follow = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      const first = firstAsking.current;
      if (hash && addresses.split("|").includes(hash) && first) {
        setOpenKey(first);
        setMounted((current) => (current.has(first) ? current : new Set([...current, first])));
      }
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [addresses]);

  return (
    <Box className="flex flex-col gap-4">
      {sections
        .filter((section) => section.rows.length > 0)
        .map((section) => {
          const headingId = `${base}-${section.key}`;
          const all = expanded.has(section.key);
          const limit = section.shown ?? section.rows.length;
          // The line open stays in sight even past the limit.
          const visible = all
            ? section.rows
            : section.rows.filter((row, index) => index < limit || row.key === openKey);
          const hidden = section.rows.length - visible.length;
          return (
            <Box key={section.key} component="section" aria-labelledby={headingId} className="flex flex-col gap-2">
              <Typography id={headingId} variant="subtitle2" component="h3" className="mb-0">
                {t("item-rows-section", { title: section.title, count: section.rows.length })}
              </Typography>
              <Box
                component="ul"
                className="border-grey-100 m-0 flex list-none flex-col overflow-hidden rounded-2xl border p-0"
              >
                {visible.map((row) => {
                  const isOpen = openKey === row.key;
                  const bodyId = `${base}-${row.key}-body`;
                  const tile = row.tint ?? cn(TILE_TONE[row.tone].bg, TILE_TONE[row.tone].text);
                  return (
                    <Box
                      component="li"
                      key={row.key}
                      className={cn(
                        "border-grey-100 border-t first:border-t-0",
                        section.ask && "bg-accent-3-light/5",
                        isOpen && "bg-grey-25",
                      )}
                    >
                      <Box className="relative flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:gap-3 sm:px-4">
                        <Box className="flex min-w-0 flex-1 flex-row items-center gap-3">
                          <span
                            aria-hidden
                            className={cn("flex h-9 w-9 flex-none items-center justify-center rounded-xl", tile)}
                          >
                            {row.icon}
                          </span>
                          <Box className="flex min-w-0 flex-1 flex-col">
                            <Typography variant="body2" component="p" className="text-text-primary mb-0 font-semibold">
                              {row.title}
                            </Typography>
                            {row.detail ? (
                              <Typography variant="body2" className="text-text-secondary">
                                {row.detail}
                              </Typography>
                            ) : null}
                          </Box>
                          {row.content ? (
                            // The opener, stretched over the whole line: any point of it opens or closes it; what
                            // sits beside it (the state, the action) stands above it.
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-controls={bodyId}
                              aria-label={row.openLabel}
                              onClick={() => open(isOpen ? null : row.key)}
                              className="text-text-secondary hover:bg-grey-50 hover:text-text-primary focus-visible:after:ring-primary dark:focus-visible:after:ring-primary-light flex size-8 flex-none cursor-pointer items-center justify-center rounded-full outline-hidden transition-colors after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:after:ring-2 sm:order-last"
                            >
                              <NiChevronDownSmall
                                size="small"
                                className={cn(
                                  "transition-transform motion-reduce:transition-none",
                                  isOpen && "rotate-180",
                                )}
                              />
                            </button>
                          ) : null}
                        </Box>
                        {row.state || row.action || (row.opener && row.content) ? (
                          <Box className="relative z-[1] flex flex-col gap-2 pl-12 sm:flex-row sm:items-center sm:gap-3 sm:pl-0">
                            {row.state ? (
                              <Box className="min-w-0 sm:max-w-80">
                                <StateLine tone={row.state.tone}>{row.state.text}</StateLine>
                              </Box>
                            ) : null}
                            {row.opener && row.content && !isOpen ? (
                              <Box className="flex-none">
                                <Button variant="outlined" color="grey" size="small" onClick={() => open(row.key)}>
                                  {row.opener}
                                </Button>
                              </Box>
                            ) : row.action ? (
                              <Box className="flex-none">{row.action}</Box>
                            ) : null}
                          </Box>
                        ) : null}
                      </Box>
                      {row.content ? (
                        <Collapse in={isOpen} timeout={reduceMotion ? 0 : "auto"}>
                          <Box id={bodyId} className="px-3 pb-4 sm:pr-4 sm:pl-16">
                            {mounted.has(row.key) ? row.content() : null}
                          </Box>
                        </Collapse>
                      ) : null}
                    </Box>
                  );
                })}
                {hidden > 0 || (all && limit < section.rows.length) ? (
                  <Box component="li" className="border-grey-100 border-t">
                    <Button
                      variant="text"
                      color="primary"
                      size="small"
                      className="m-1"
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (all) next.delete(section.key);
                          else next.add(section.key);
                          return next;
                        })
                      }
                    >
                      {all ? t("item-rows-fewer") : t("item-rows-more", { count: hidden })}
                    </Button>
                  </Box>
                ) : null}
              </Box>
            </Box>
          );
        })}
    </Box>
  );
}
