"use client";

import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { Box, Button, Card, CardContent, Collapse, Typography, useMediaQuery } from "@mui/material";

import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import { cn } from "@/lib/utils";

/** An order given to every card of a screen at once: open them all, or close them all. */
type Command = { seq: number; open: boolean };

const GroupContext = createContext<{ command: Command | null; setAll: (open: boolean) => void } | null>(null);

/**
 * The cards of one screen, opened or closed together by its
 * `CollapsibleGroupToggle`. Each card below obeys the latest order once, and
 * is the person's again right after it.
 */
export function CollapsibleGroup({ children }: { children: ReactNode }) {
  const [command, setCommand] = useState<Command | null>(null);
  const setAll = useCallback((open: boolean) => setCommand((last) => ({ seq: (last?.seq ?? 0) + 1, open })), []);
  const value = useMemo(() => ({ command, setAll }), [command, setAll]);
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
  const [open, setOpen] = useState(defaultOpen);
  const card = useRef<HTMLElement>(null);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const bodyId = `${id}-body`;

  // The screen's "open all" or "close all", obeyed once when it is given.
  const command = useContext(GroupContext)?.command ?? null;
  const [seen, setSeen] = useState(command?.seq ?? 0);
  if (command && command.seq !== seen) {
    setSeen(command.seq);
    setOpen(command.open);
  }

  useEffect(() => {
    const follow = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (!hash || (hash !== id && hash !== anchor)) return;
      setOpen(true);
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
          <Box className="flex min-w-0 flex-1 flex-col gap-1">
            <Box className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Typography id={id} variant={titleAs === "h2" ? "h5" : "h6"} component={titleAs} className="mb-0">
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={bodyId}
                  onClick={() => setOpen((now) => !now)}
                  className="focus-visible:after:ring-primary dark:focus-visible:after:ring-primary-light cursor-pointer text-left outline-hidden after:absolute after:-inset-2 after:rounded-2xl after:content-[''] focus-visible:after:ring-2"
                >
                  {title}
                </button>
              </Typography>
              {chip ? <Box className="relative z-[1] flex flex-wrap items-center gap-2">{chip}</Box> : null}
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
