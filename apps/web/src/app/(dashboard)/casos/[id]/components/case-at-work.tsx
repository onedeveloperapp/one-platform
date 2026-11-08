"use client";

import type { CaseEvent } from "../case-types";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";

import AtWorkNotice, { type AtWorkStep } from "@/components/product/at-work-notice";
import { eventKeyOf } from "@/lib/cases/cases";
import type { NowItem } from "@/lib/cases/now";
import {
  type AtWorkMemory,
  dismissWork,
  elapsedText,
  emptyMemory,
  holdingWork,
  holdsScreen,
  isLong,
  LONG_AFTER_MS,
  memoryOf,
  nextStepOf,
  rememberWork,
  startOf,
} from "@/lib/cases/one-at-work";
import { sayPending } from "@/lib/firm/pending";

/** The class the notice's own modal carries, so it never counts as another window open over the screen. */
const OWN = "at-work-notice";

/** How many of the steps ONE finished while the notice was open it shows above what it is doing. */
const DONE_SHOWN = 3;

const clock = (at: number) =>
  new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(
    new Date(at),
  );

/**
 * The person is in the middle of something else on the screen: typing in a field, or in a dialog, a side panel or
 * a menu. The notice waits for them to leave it, so it never lands on words half typed.
 */
function busyElsewhere(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (active && !active.closest(`.${OWN}`)) {
    const tag = active.tagName;
    const typing =
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      active.isContentEditable ||
      (tag === "INPUT" &&
        !["button", "submit", "reset", "checkbox", "radio", "file", "range", "color", "image"].includes(
          (active as HTMLInputElement).type,
        ));
    if (typing) return true;
  }
  return [...document.querySelectorAll(".MuiModal-root:not(.MuiModal-hidden)")].some(
    (modal) => !modal.classList.contains(OWN),
  );
}

/**
 * The notice that holds the case screen while ONE works on the case (the screen pattern after ADVBox, approved by the
 * owner on 2026-11-07). It reads what the top of the case says ONE is doing now, and holds the screen for ONE's own
 * work only (never a look ONE takes soon, a work it already said is late, nor a wait on a court): the steps it
 * finished since the notice opened, what it is doing with how long, and what always follows. When the work ends, the
 * screen, which follows the database by itself, is read again and the notice closes. From two minutes on, it says
 * ONE is taking longer than usual and gives the screen back on request; that choice, and when each work was first
 * seen, are kept in this tab, so the notice opens again only for another work, and a stalled work is said as long
 * at once on the next visit.
 */
export default function CaseAtWork({
  caseId,
  working,
  events,
}: {
  caseId: string;
  working: NowItem[];
  events: CaseEvent[];
}) {
  const t = useTranslations("product");
  const items = useMemo(() => holdingWork(working), [working]);
  const storageKey = `one-at-work:${caseId}`;

  const [memory, setMemory] = useState<AtWorkMemory>(emptyMemory);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  /** When the notice opened in this visit: the steps ONE finished from then on are said as done. */
  const [openedAt, setOpenedAt] = useState<number | null>(null);

  // What this tab remembers of the case: read once, before the notice decides anything.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      setMemory(memoryOf(raw ? JSON.parse(raw) : null));
    } catch {
      setMemory(emptyMemory());
    }
    setLoaded(true);
  }, [storageKey]);
  useEffect(() => {
    if (loaded) setMemory((current) => rememberWork(current, items, Date.now()));
  }, [items, loaded]);
  useEffect(() => {
    if (!loaded) return;
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(memory));
    } catch {
      // A tab that keeps nothing still shows the notice; it only cannot remember the person's choice.
    }
  }, [memory, loaded, storageKey]);

  const holds = loaded && holdsScreen(memory, items);
  // The clock of the notice: how long each step has lasted, and when ONE is taking longer than usual.
  useEffect(() => {
    if (!holds) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [holds]);

  // The notice opens once the person is not in the middle of something else, and stays open until the work ends.
  useEffect(() => {
    if (!holds) {
      setOpenedAt(null);
      setWaitUntil(null);
      return;
    }
    if (openedAt === null && !busyElsewhere()) setOpenedAt(Date.now());
  }, [holds, now, openedAt]);
  const open = holds && openedAt !== null;
  const long = open && isLong(items, memory, now, waitUntil);

  const goOn = useCallback(() => {
    setMemory((current) => dismissWork(current, items));
    setOpenedAt(null);
    setWaitUntil(null);
  }, [items]);
  const waitMore = useCallback(() => setWaitUntil(Date.now() + LONG_AFTER_MS), []);

  const steps = useMemo<AtWorkStep[]>(() => {
    if (!open || openedAt === null) return [];
    const timeText = (ms: number) => {
      const elapsed = elapsedText(ms);
      return t(elapsed.key, elapsed.values);
    };
    // What ONE recorded while the notice was open, the oldest first.
    const done: AtWorkStep[] = events
      .filter(
        (event) =>
          (event.actorType === "system" || event.actorType === "ai") && Date.parse(event.at) >= openedAt - 2_000,
      )
      .slice(0, DONE_SHOWN)
      .reverse()
      .map((event) => ({
        key: `done:${event.id}`,
        state: "done",
        label: eventKeyOf(event) ? t(eventKeyOf(event) as string) : t("case-now-event-other"),
        detail: t("one-at-work-done"),
      }));
    const doing: AtWorkStep[] = items.map((item) => {
      const lasted = now - startOf(item, memory, now);
      return {
        key: `doing:${item.id}`,
        state: "doing",
        label: sayPending(t, item.text),
        detail:
          lasted < 5_000
            ? t("one-at-work-doing-just")
            : t(long ? "one-at-work-doing-long" : "one-at-work-doing-now", { time: timeText(lasted) }),
      };
    });
    const next: AtWorkStep[] = [...new Set(items.map(nextStepOf).filter((key): key is string => key !== null))].map(
      (key) => ({ key: `next:${key}`, state: "next", label: t(key), detail: t("one-at-work-next") }),
    );
    return [...done, ...doing, ...next];
  }, [open, openedAt, events, items, now, memory, long, t]);

  const started = items.length > 0 ? Math.min(...items.map((item) => startOf(item, memory, now))) : null;

  return (
    <AtWorkNotice
      className={OWN}
      open={open}
      long={long}
      title={t(long ? "one-at-work-long-title" : "one-at-work-title")}
      text={t(long ? "one-at-work-long-text" : "one-at-work-text")}
      steps={steps}
      footer={started !== null ? t("one-at-work-started", { time: clock(started) }) : null}
      continueLabel={t("one-at-work-continue")}
      waitLabel={t("one-at-work-wait")}
      onContinue={goOn}
      onWaitMore={waitMore}
    />
  );
}
