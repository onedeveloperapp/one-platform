"use client";

/**
 * Shared helpers of the marketing motion layer. Import this ONLY from
 * "use client" files.
 *
 * How the layer is built (docs/DESIGN.md, Motion):
 * - entrances and ambient drift are CSS animations (the hero sequence in
 *   style/layout/marketing-motion.css, <Float>): they start with the first
 *   paint and run on the compositor;
 * - scroll reveals and count-ups ask `watchEntry` when an element enters the
 *   viewport, and animate with a CSS transition or a short frame loop;
 * - GSAP is loaded by exactly one component, <Parallax>, on demand.
 *
 * It used to be GSAP everywhere, with a ScrollTrigger per revealed block.
 * ScrollTrigger measured every trigger with a forced layout, measured them
 * all again on each refresh and updated on every frame, and scripted tweens
 * restyled their targets on every frame: on a phone that was the largest
 * single cost of a public page, most of it spent before the visitor could
 * read anything.
 */

const tokens = new Map<string, string>();

/**
 * Read a marketing motion token off :root with a fallback (client-only). The
 * tokens do not change while a page is open, so each one is read once:
 * getComputedStyle forces a style recalculation whenever anything is dirty,
 * and every motion component on the page asks for the same values.
 */
export function readMotionToken(name: string, fallback: string): string {
  let value = tokens.get(name);
  if (value === undefined) {
    value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    tokens.set(name, value);
  }
  return value || fallback;
}

/** Parse a CSS duration token ("800ms" | "6s") into seconds. */
export function tokenSeconds(name: string, fallbackSeconds: number): number {
  const raw = readMotionToken(name, "");
  if (!raw) return fallbackSeconds;
  const value = parseFloat(raw);
  if (Number.isNaN(value)) return fallbackSeconds;
  return raw.endsWith("ms") ? value / 1000 : value;
}

/** True when the visitor asked the system for less motion: render static. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Where an element is the first time the observer reports it. */
export type EntryPosition = "visible" | "below" | "above";

type Watch = {
  placed: boolean;
  onPlaced: (position: EntryPosition) => void;
  onEnter: () => void;
};

const watched = new Map<Element, Watch>();
let observer: IntersectionObserver | undefined;

function unwatch(element: Element) {
  observer?.unobserve(element);
  watched.delete(element);
}

function onEntries(entries: IntersectionObserverEntry[]) {
  const viewport = window.innerHeight;
  for (const entry of entries) {
    const watch = watched.get(entry.target);
    if (!watch) continue;
    if (!watch.placed) {
      watch.placed = true;
      const { top, bottom, width, height } = entry.boundingClientRect;
      const onScreen = entry.isIntersecting || (top < viewport && bottom > 0);
      // A box without size (display: none at this width) is never "below".
      const position: EntryPosition = onScreen ? "visible" : top >= viewport && width + height > 0 ? "below" : "above";
      watch.onPlaced(position);
      if (position !== "below") unwatch(entry.target);
      continue;
    }
    if (entry.isIntersecting) {
      watch.onEnter();
      unwatch(entry.target);
    }
  }
}

/**
 * One-shot viewport entry for a motion component, on a single shared
 * IntersectionObserver (the trigger line is 85% of the viewport height). The
 * observer reports positions from the layout pass the page was going to run
 * anyway, so no component reads layout:
 *
 * - `onPlaced` runs once, with where the element is when first reported.
 *   Something already on screen (or above it) should be left as it is: hiding
 *   it now would make content the visitor is reading blink.
 * - `onEnter` runs once, when an element that started below reaches the line.
 *
 * Returns the function that stops watching.
 */
export function watchEntry(
  element: Element,
  callbacks: { onPlaced: (position: EntryPosition) => void; onEnter: () => void },
): () => void {
  observer ??= new IntersectionObserver(onEntries, { rootMargin: "0px 0px -15% 0px", threshold: 0 });
  watched.set(element, { placed: false, ...callbacks });
  observer.observe(element);
  return () => unwatch(element);
}
