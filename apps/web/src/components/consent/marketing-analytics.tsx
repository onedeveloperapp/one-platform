"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { trackPageView } from "@/lib/analytics";
import { datasetToEventProps, isSiteEventName, trackSiteEvent } from "@/lib/site-events";

/**
 * The browser side of the public site's measurement (docs/TRACKING.md):
 *
 *  - a PageView on client-side navigation between marketing routes (the
 *    Pixel/GA4 base scripts and the initial PageView come from the
 *    server-rendered `marketing-trackers.tsx`, so the first render is skipped);
 *  - `section_view` once per load for each element carrying `data-section`,
 *    when half of it is on screen (or half of the screen is it, for a section
 *    taller than the viewport);
 *  - every click on an element that declares an event with `data-track`
 *    (`lib/site-events.ts`), reported by this ONE listener so server
 *    components declare events without client code.
 *
 * Mounted ONLY in the marketing and funnel layouts. Every event is a no-op
 * once the visitor opted out (`track`).
 */
export default function MarketingAnalytics() {
  const pathname = usePathname();
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    trackPageView(pathname);
  }, [pathname]);

  useEffect(() => {
    const seen = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (seen.has(entry.target)) continue;
          const halfOfSection = entry.intersectionRatio >= 0.5;
          const halfOfScreen = entry.intersectionRect.height >= window.innerHeight * 0.5;
          if (!entry.isIntersecting || !(halfOfSection || halfOfScreen)) continue;
          seen.add(entry.target);
          observer.unobserve(entry.target);
          const section = (entry.target as HTMLElement).dataset.section;
          if (section) trackSiteEvent("section_view", { section });
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const element of document.querySelectorAll("[data-section]")) observer.observe(element);
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const element = target.closest<HTMLElement>("[data-track]");
      if (!element) return;
      const name = element.dataset.track;
      if (!isSiteEventName(name)) return;
      trackSiteEvent(name, datasetToEventProps(element.dataset));
    };
    // Capture phase: the event is reported before a link navigates away.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
