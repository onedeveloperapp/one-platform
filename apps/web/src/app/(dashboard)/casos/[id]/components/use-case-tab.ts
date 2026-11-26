"use client";

import { useCallback, useEffect, useState } from "react";

import { type CaseTab, isCaseTab, openingTab, tabAddress, type TabLine } from "@/lib/cases/case-tabs";
import type { JourneyStepId } from "@/lib/cases/journey";

/** The id an address's `#...` names, or null: an address somebody typed wrong never breaks the screen. */
function anchorOf(hash: string): string | null {
  try {
    return decodeURIComponent(hash.replace(/^#/, "")) || null;
  } catch {
    return null;
  }
}

/**
 * The tab the case screen is on (the owner's canvas "ONE · O caso em abas", 2026-11-25). It opens on the one the
 * address asks for (`?aba=`), else where the firm is asked first, else the step's, and never moves by itself while
 * the person reads. A link to a card (`#case-drafts`: the top's "Resolver", the home, the bell, a decision) opens the
 * tab the card is in and brings the card into view: the panels are found by `data-case-tab`, every one mounted and
 * hidden, so a card is found wherever it is and nothing typed in another tab is lost. The address keeps the tab, so
 * coming back or reading again keeps the place, and the history is not filled with tabs.
 *
 * A link the router draws (`next/link`: a notice of the bell about the case that is open, "Completar" of the filing
 * guide) changes the address with no `hashchange`, so listening to that event alone left the click dead: the card
 * stayed in a tab out of sight and nothing moved (found by the Orkestree's tabs, 2026-11-25). The click itself opens
 * the card's tab, whatever draws the link.
 */
export function useCaseTab({
  asked,
  blocking,
  step,
}: {
  asked: string | null;
  blocking: readonly TabLine[];
  step: JourneyStepId;
}): { tab: CaseTab; pick: (next: CaseTab) => void } {
  const [tab, setTab] = useState<CaseTab>(() => openingTab(asked, blocking, step));
  // The card a link sent the person to, brought into view once its tab shows.
  const [goingTo, setGoingTo] = useState<string | null>(null);

  const pick = useCallback((next: CaseTab) => {
    setTab(next);
    window.history.replaceState(null, "", tabAddress(window.location.pathname, next));
  }, []);

  useEffect(() => {
    /** Opens the tab of the card with this id and brings the card into view; nothing when no card has it. */
    const open = (anchor: string) => {
      const target = document.getElementById(anchor)?.closest<HTMLElement>("[data-case-tab]")?.dataset.caseTab;
      if (!isCaseTab(target)) return;
      setTab(target);
      setGoingTo(anchor);
      // For a router's link this write also drops the link's own navigation (Next 15.5: a history write dispatches a
      // restore, which takes priority over a pending navigation), so the address is the screen's and nothing of the
      // case is read again for the click.
      window.history.replaceState(null, "", tabAddress(window.location.pathname, target, `#${anchor}`));
    };
    const follow = () => {
      const anchor = anchorOf(window.location.hash);
      if (anchor) open(anchor);
    };
    // A plain click on a link to a card of this very page, whatever draws the link: the router's own navigation says
    // nothing a listener can hear, and a link of the browser's still says its `hashchange` right after.
    const clicked = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const href = link?.getAttribute("href");
      if (!link || !href || !href.includes("#") || link.getAttribute("target") === "_blank") return;
      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
      const anchor = anchorOf(url.hash);
      if (anchor) open(anchor);
    };
    follow();
    window.addEventListener("hashchange", follow);
    document.addEventListener("click", clicked);
    return () => {
      window.removeEventListener("hashchange", follow);
      document.removeEventListener("click", clicked);
    };
  }, []);

  useEffect(() => {
    if (!goingTo) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(goingTo)?.scrollIntoView?.({ block: "start" });
      setGoingTo(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [goingTo, tab]);

  return { tab, pick };
}
