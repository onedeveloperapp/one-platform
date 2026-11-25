"use client";

import { useCallback, useEffect, useState } from "react";

import { type CaseTab, isCaseTab, openingTab, tabAddress, type TabLine } from "@/lib/cases/case-tabs";
import type { JourneyStepId } from "@/lib/cases/journey";

/**
 * The tab the case screen is on (the owner's canvas "ONE · O caso em abas", 2026-11-25). It opens on the one the
 * address asks for (`?aba=`), else where the firm is asked first, else the step's, and never moves by itself while
 * the person reads. A link to a card (`#case-drafts`: the top's "Resolver", the home, the bell, a decision) opens the
 * tab the card is in and brings the card into view: the panels are found by `data-case-tab`, every one mounted and
 * hidden, so a card is found wherever it is and nothing typed in another tab is lost. The address keeps the tab, so
 * coming back or reading again keeps the place, and the history is not filled with tabs.
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
    const follow = () => {
      const hash = decodeURIComponent(window.location.hash.slice(1));
      if (!hash) return;
      const target = document.getElementById(hash)?.closest<HTMLElement>("[data-case-tab]")?.dataset.caseTab;
      if (!isCaseTab(target)) return;
      setTab(target);
      setGoingTo(hash);
      window.history.replaceState(null, "", tabAddress(window.location.pathname, target, `#${hash}`));
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
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
