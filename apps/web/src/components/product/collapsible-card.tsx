"use client";

import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { Box, Button, Card, CardContent, Collapse, Typography, useMediaQuery } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import NiCheck from "@/icons/nexture/ni-check";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiClock from "@/icons/nexture/ni-clock";
import NiCrossSquare from "@/icons/nexture/ni-cross-square";
import NiExclamationSquare from "@/icons/nexture/ni-exclamation-square";
import NiLoader from "@/icons/nexture/ni-loader";
import { cn } from "@/lib/utils";

/** An order given to every card of a screen at once: open them all, or close them all. */
type Command = { seq: number; open: boolean };

/**
 * What the screen knows of a card from the top of it (the owner's audit, 2026-11-05): something there waits for
 * the firm, failed, or waits for the client, and what ONE is doing there now, in words. The card says it on its
 * head, opens by itself when something comes to wait for the firm there, and closes by itself once it is done,
 * when it was not the person who opened it.
 */
export type CardMark = {
  firm: boolean;
  failed: boolean;
  client: boolean;
  working: string | null;
  /**
   * Where the card stands, in a word or two with its tone (the owner, 2026-11-05): done, ONE at work there, waiting
   * for the client, asking the firm, failed, or nothing yet. Said on its head as a badge and in the colour of its
   * icon, so a closed card reads as where it stands.
   */
  state?: { tone: CardTone; label: string } | null;
};

/** How a card stands, as its head says it. */
export type CardTone = "done" | "working" | "client" | "firm" | "failed" | "idle";

/** The badge of each state: its tint, and the mark before its words (the words always say the state too). */
const STATE_CHIP: Record<
  CardTone,
  { tone: "positive" | "info" | "attention" | "danger" | "neutral"; icon: ReactNode }
> = {
  done: { tone: "positive", icon: <NiCheck size="small" /> },
  working: { tone: "info", icon: <NiLoader size="small" className="animate-spin motion-reduce:animate-none" /> },
  client: { tone: "info", icon: <NiClock size="small" /> },
  firm: { tone: "attention", icon: <NiExclamationSquare size="small" /> },
  failed: { tone: "danger", icon: <NiCrossSquare size="small" /> },
  idle: { tone: "neutral", icon: null },
};

/** The icon of a card in the colour of where it stands, with the state's own mark in its corner. */
const STATE_TILE: Record<Exclude<CardTone, "idle">, { tile: string; badge: string; icon: ReactNode }> = {
  done: { tile: "bg-success/10 text-success", badge: "bg-success text-text-contrast", icon: <NiCheck size={12} /> },
  working: {
    tile: "bg-accent-4-light/15 text-accent-4",
    badge: "bg-accent-4 text-text-contrast",
    icon: <NiLoader size={12} className="animate-spin motion-reduce:animate-none" />,
  },
  client: {
    tile: "bg-accent-4-light/15 text-accent-4",
    badge: "bg-accent-4 text-text-contrast",
    icon: <NiClock size={12} />,
  },
  firm: {
    tile: "bg-accent-3-light/10 text-accent-3",
    badge: "bg-accent-3 text-text-contrast",
    icon: <NiExclamationSquare size={12} />,
  },
  failed: { tile: "bg-error/10 text-error", badge: "bg-error text-text-contrast", icon: <NiCrossSquare size={12} /> },
};

/** The words of the marks, in the screen's language. */
export type CardMarkWords = { firm: string; failed: string; client: string };

/** The head of each card: the icon of what it is, on its family's tint. */
export type CardLook = { icon: ReactNode; tone?: TileTone };

type Group = {
  command: Command | null;
  setAll: (open: boolean) => void;
  marks: Record<string, CardMark>;
  looks: Record<string, CardLook>;
  words: CardMarkWords | null;
};

const GroupContext = createContext<Group | null>(null);

const NO_MARKS: Record<string, CardMark> = {};
const NO_LOOKS: Record<string, CardLook> = {};

/**
 * The cards of one screen, opened or closed together by its
 * `CollapsibleGroupToggle`. Each card below obeys the latest order once, and
 * is the person's again right after it. The screen may hand each card, by its
 * id, the icon of its head (`looks`) and what the top knows of it (`marks`).
 */
export function CollapsibleGroup({
  children,
  marks,
  looks,
  words,
}: {
  children: ReactNode;
  marks?: Record<string, CardMark>;
  looks?: Record<string, CardLook>;
  words?: CardMarkWords;
}) {
  const [command, setCommand] = useState<Command | null>(null);
  const setAll = useCallback((open: boolean) => setCommand((last) => ({ seq: (last?.seq ?? 0) + 1, open })), []);
  const value = useMemo(
    () => ({ command, setAll, marks: marks ?? NO_MARKS, looks: looks ?? NO_LOOKS, words: words ?? null }),
    [command, setAll, marks, looks, words],
  );
  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

/** "Abrir todos os cartões" or "Fechar todos os cartões", for a screen of many cards that close. */
export function CollapsibleGroupToggle({ className }: { className?: string }) {
  const t = useTranslations("product");
  const group = useContext(GroupContext);
  if (!group) return null;
  const allOpen = group.command?.open === true;
  return (
    <Box className={cn("flex justify-end", className)}>
      <Button variant="text" color="grey" size="small" onClick={() => group.setAll(!allOpen)}>
        {allOpen ? t("cards-close-all") : t("cards-open-all")}
      </Button>
    </Box>
  );
}

/**
 * A card a person opens when they need what is in it. Closed, it still says
 * what it holds (`summary`, one line) and, when something there waits for a
 * person, what (`chip`, a StatusChip): a long screen of many cards reads as
 * a list of where things stand, and the person opens the one to work on.
 *
 * Closest catalog entries: the Card of every product screen, and the
 * template's Accordion (`style/surfaces/accordion.css`), whose flat rows do
 * not carry a card's surface. This keeps the Card as it is and puts its
 * header in a disclosure button (the WAI pattern: a button inside the
 * heading, `aria-expanded`, `aria-controls`), stretched over the whole header
 * so any point of it toggles; what sits beside the title (`chip`) stands
 * above it, so an `InfoHint` there is still its own control. What explains
 * the card and its own action live in the body, so a closed card is the same
 * height as any other.
 *
 * A link to the heading's id (`#case-drafts`) or to `anchor` opens the card
 * and brings it into view. The body stays mounted while closed: a text being
 * typed in it, or a card that reads itself again, is not lost. A card whose
 * content starts over when the screen reads again (a form keyed by what it
 * saved) keys that content, never the card, or it would close under the
 * person's hands.
 */
export default function CollapsibleCard({
  id,
  anchor,
  title,
  titleAs = "h2",
  summary,
  summaryClosedOnly = false,
  chip,
  description,
  action,
  defaultOpen = false,
  bodyClassName,
  children,
}: {
  /** The heading's id: what the section is labelled by, and the address that opens it. */
  id: string;
  /** Another address of the card, kept by links written before (`#como-vai-a-juizo`). */
  anchor?: string;
  title: string;
  /** The heading's level: h2 on a screen, h3 for cards under a heading of their own. */
  titleAs?: "h2" | "h3";
  /** Where things stand, in one line: shown open or closed. */
  summary?: ReactNode;
  /** The summary only stands in for the content: a card whose open body says the same shows it closed only. */
  summaryClosedOnly?: boolean;
  /** What waits for a person here, as a StatusChip; or a definition of the title, as an InfoHint. */
  chip?: ReactNode;
  /** What the card is for: shown open, above its content. */
  description?: ReactNode;
  /** The card's own action (add, settings, the whole list elsewhere): shown open, beside the description. */
  action?: ReactNode;
  /** Open on arrival. Read once: what the person does afterwards is theirs. */
  defaultOpen?: boolean;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const group = useContext(GroupContext);
  const mark = group?.marks[id] ?? null;
  const look = group?.looks[id] ?? null;
  // Something there waits for the firm, or failed: the card opens for it, and closes once it is done.
  const attention = Boolean(mark && (mark.firm || mark.failed));
  const [open, setOpen] = useState(defaultOpen || attention);
  // Why the card is open: on arrival by its stage, for something that waits, or by the person (who keeps it open).
  const [openedBy, setOpenedBy] = useState<"arrival" | "attention" | "person" | null>(
    attention ? "attention" : defaultOpen ? "arrival" : null,
  );
  const card = useRef<HTMLElement>(null);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const bodyId = `${id}-body`;

  // The screen's "open all" or "close all", obeyed once when it is given.
  const command = group?.command ?? null;
  const [seen, setSeen] = useState(command?.seq ?? 0);
  if (command && command.seq !== seen) {
    setSeen(command.seq);
    setOpen(command.open);
    setOpenedBy(command.open ? "person" : null);
  }

  // Something came to wait for the firm here while the screen was open: the card opens, once. Once it is done, a
  // card that opened for it closes, unless the person opened it or is working in it (a field in it has the focus).
  const [wasAttention, setWasAttention] = useState(attention);
  if (attention !== wasAttention) {
    setWasAttention(attention);
    if (attention && !open) {
      setOpen(true);
      setOpenedBy("attention");
    } else if (!attention && open && openedBy === "attention") {
      const focused =
        typeof document !== "undefined" && card.current !== null && card.current.contains(document.activeElement);
      if (!focused) {
        setOpen(false);
        setOpenedBy(null);
      }
    }
  }

  const toggle = () => {
    setOpenedBy(open ? null : "person");
    setOpen(!open);
  };

  // Where the card stands: its own chip says what asks for somebody there in its own words; the state's badge says
  // the rest (done, ONE at work, waiting for the client, nothing yet), and ONE at work beside a card's own chip too.
  const state = mark?.state ?? null;
  const stateChip =
    state && (!chip || state.tone === "working") ? (
      <StatusChip label={state.label} tone={STATE_CHIP[state.tone].tone} icon={STATE_CHIP[state.tone].icon} />
    ) : null;
  const stateLook = state && state.tone !== "idle" ? STATE_TILE[state.tone] : null;

  // A screen that gives no state says what the top knows of the card, when the card's own chip does not say it.
  const markChip =
    !state && mark && group?.words
      ? mark.failed && !chip
        ? { label: group.words.failed, tone: "danger" as const }
        : mark.firm && !chip
          ? { label: group.words.firm, tone: "attention" as const }
          : mark.client && !chip && !mark.working
            ? { label: group.words.client, tone: "neutral" as const }
            : null
      : null;

  useEffect(() => {
    const follow = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (!hash || (hash !== id && hash !== anchor)) return;
      // The person came to this card (a link of the top, or an address): it is theirs, and never closes by itself.
      setOpen(true);
      setOpenedBy("person");
      window.requestAnimationFrame(() => card.current?.scrollIntoView({ block: "start" }));
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, [id, anchor]);

  return (
    <Card component="section" ref={card} aria-labelledby={id} id={anchor} className="scroll-mt-24">
      <CardContent className="flex flex-col">
        <Box className="group relative flex items-start gap-3">
          {look ? (
            <span
              aria-hidden
              className={cn(
                "relative flex h-10 w-10 flex-none items-center justify-center rounded-xl",
                stateLook
                  ? stateLook.tile
                  : [TILE_TONE[look.tone ?? "primary"].bg, TILE_TONE[look.tone ?? "primary"].text],
              )}
            >
              {look.icon}
              {stateLook ? (
                <span
                  className={cn(
                    "border-background-paper absolute -right-1.5 -bottom-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2",
                    stateLook.badge,
                  )}
                >
                  {stateLook.icon}
                </span>
              ) : null}
            </span>
          ) : null}
          <Box className="flex min-w-0 flex-1 flex-col gap-1">
            <Box className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Typography id={id} variant={titleAs === "h2" ? "h5" : "h6"} component={titleAs} className="mb-0">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={bodyId}
                  onClick={toggle}
                  className="focus-visible:after:ring-primary dark:focus-visible:after:ring-primary-light cursor-pointer text-left outline-hidden after:absolute after:-inset-2 after:rounded-2xl after:content-[''] focus-visible:after:ring-2"
                >
                  {title}
                </button>
              </Typography>
              {chip || stateChip || markChip || (!state && mark?.working) ? (
                <Box className="relative z-[1] flex flex-wrap items-center gap-2">
                  {chip}
                  {stateChip}
                  {markChip ? <StatusChip label={markChip.label} tone={markChip.tone} /> : null}
                  {!state && mark?.working ? (
                    <StatusChip
                      label={mark.working}
                      tone="info"
                      icon={<NiLoader size="small" className="animate-spin motion-reduce:animate-none" />}
                    />
                  ) : null}
                </Box>
              ) : null}
            </Box>
            {summary && !(summaryClosedOnly && open) ? (
              <Typography variant="body2" className="text-text-secondary break-words">
                {summary}
              </Typography>
            ) : null}
          </Box>
          <Box
            aria-hidden
            className="text-text-secondary group-hover:bg-grey-50 group-hover:text-text-primary flex size-8 shrink-0 items-center justify-center rounded-full transition-colors"
          >
            <NiChevronDownSmall
              size="small"
              className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")}
            />
          </Box>
        </Box>

        <Collapse in={open} timeout={reduceMotion ? 0 : "auto"}>
          <Box id={bodyId} className={cn("flex flex-col gap-4 pt-4", bodyClassName)}>
            {description || action ? (
              <Box className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                {description ? (
                  <Typography variant="body2" className="text-text-secondary min-w-0 flex-1 basis-64">
                    {description}
                  </Typography>
                ) : null}
                {action ? <Box className="flex flex-wrap gap-2">{action}</Box> : null}
              </Box>
            ) : null}
            {children}
          </Box>
        </Collapse>
      </CardContent>
    </Card>
  );
}
