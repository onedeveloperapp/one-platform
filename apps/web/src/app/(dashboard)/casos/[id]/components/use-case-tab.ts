"use client";

import { useCallback, useEffect, useState } from "react";

import { followArrivals } from "@/lib/anchor-arrival";
import { type CaseTab, isCaseTab, openingTab, tabAddress, type TabLine } from "@/lib/cases/case-tabs";
import type { JourneyStepId } from "@/lib/cases/journey";

/**
 * The tab the case screen is on (the owner's canvas "ONE · O caso em abas", 2026-11-25). It opens on the one the
 * address asks for (`?aba=`), else where the firm is asked first, else the step's, and never moves by itself while
 * the person reads. A link to a card (`#case-drafts`: the top's "Resolver", the home, the bell, a decision) opens the
 * tab the card is in and brings the card into view: the panels are found by `data-case-tab`, every one mounted and
 * hidden, so a card is found wherever it is and nothing typed in another tab is lost. The address keeps the tab, so
 * coming back or reading again keeps the place, and the history is not filled with tabs.
 *
 * The arrival is heard as the card itself hears it (`followArrivals`): the address, its `hashchange`, and the click
 * on a link to a card of this case, whatever draws the link. A link the router draws (a notice of the bell about the
 * case that is open, "Completar" of the filing guide) says no `hashchange`, and listening to that event alone left
 * the click dead (found by the Orkestree's tabs, 2026-11-25).
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

  // The tab the person picks: the card a link had sent them to leaves the address, or coming back would reopen its tab.
  const pick = useCallback((next: CaseTab) => {
    setTab(next);
    window.history.replaceState(null, "", tabAddress(window.location.pathname, window.location.search, next));
  }, []);

  useEffect(
    () =>
      // Opens the tab of the card with this id and brings the card into view; nothing when no card has it.
      followArrivals((anchor, at) => {
        const target = document.getElementById(anchor)?.closest<HTMLElement>("[data-case-tab]")?.dataset.caseTab;
        if (!isCaseTab(target)) return;
        setTab(target);
        setGoingTo(anchor);
        // The address is the one the person came by, the link's own query kept (the bell's `?acesso=`, read by the
        // card of the filing). For a router's link this write also drops the link's navigation (Next 15.5: a history
        // write dispatches a restore, which takes priority over a pending navigation), so nothing of the case is read
        // again for the click: the case's server reads nothing of the query, and the screen reads it in the browser.
        window.history.replaceState(null, "", tabAddress(at.pathname, at.search, target, `#${anchor}`));
      }),
    [],
  );

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
