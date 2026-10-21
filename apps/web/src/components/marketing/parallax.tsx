"use client";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/** Where the effect runs: a wide screen, and a visitor who has not asked for less motion. */
const QUERY = "(prefers-reduced-motion: no-preference) and (min-width: 960px)";

/**
 * Scroll-scrubbed vertical drift for layered media/decor. Desktop-only by
 * design (scroll-linked transforms fight mobile URL-bar resizes and feel
 * janky on touch) and reduced-motion safe. Speed is capped at 12 yPercent:
 * parallax is seasoning, never the dish.
 *
 * The one component of the site that uses GSAP, and it loads the library (and
 * its ScrollTrigger plugin) itself, only where the effect runs: a page without
 * a Parallax, a phone and a reduced-motion visitor never download either.
 */
export default function Parallax({
  speed = 8,
  className,
  children,
}: {
  /** yPercent half-range: the element travels from +speed to -speed across its scroll window. Capped at 12. */
  speed?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const clamped = Math.min(Math.abs(speed), 12) * (speed < 0 ? -1 : 1);
    const query = window.matchMedia(QUERY);
    let unmounted = false;
    let undo: (() => void) | undefined;

    const sync = () => {
      if (!query.matches) {
        undo?.();
        undo = undefined;
        return;
      }
      void Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([{ gsap }, { ScrollTrigger }]) => {
        // The answer arrives later: the component may be gone, the screen
        // narrower, or an earlier answer may already have started the tween.
        if (unmounted || !query.matches || undo) return;
        gsap.registerPlugin(ScrollTrigger);
        const tween = gsap.fromTo(
          element,
          { yPercent: clamped },
          {
            yPercent: -clamped,
            ease: "none",
            scrollTrigger: { trigger: element, start: "top bottom", end: "bottom top", scrub: true },
          },
        );
        undo = () => {
          tween.scrollTrigger?.kill();
          tween.kill();
          gsap.set(element, { clearProps: "transform" });
        };
      });
    };

    sync();
    query.addEventListener("change", sync);
    return () => {
      unmounted = true;
      query.removeEventListener("change", sync);
      undo?.();
    };
  }, [speed]);

  return (
    <div ref={ref} className={cn(className)}>
      {children}
    </div>
  );
}
