"use client";
import { useEffect, useRef } from "react";

import { prefersReducedMotion, readMotionToken, tokenSeconds, watchEntry } from "@/components/marketing/motion";
import { cn } from "@/lib/utils";

/** The inline properties a reveal writes, and puts back when it is done. */
const HIDDEN_STATE = ["opacity", "visibility", "transform"];
const WRITTEN = [...HIDDEN_STATE, "transition"];

/**
 * Scroll reveal for marketing sections: the ONLY sanctioned way to animate
 * content into view. Rules baked in (do not bypass):
 * - transform + opacity only, as a CSS transition the compositor runs;
 * - plays once, when the block reaches 85% of the viewport height;
 * - a block that is already on screen when the page hydrates is left alone:
 *   hiding it to animate it back would make visible content blink;
 * - `prefers-reduced-motion: reduce` renders everything static and visible;
 * - distance, duration and easing come from the marketing motion tokens.
 */
export default function Reveal({
  children,
  className,
  stagger = 0,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  /** Seconds between children; 0 animates the wrapper as a single block. */
  stagger?: number;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || prefersReducedMotion()) return;

    const targets = (stagger > 0 ? Array.from(element.children) : [element]) as HTMLElement[];
    // What each target had inline before, so a style its owner set survives.
    const before = targets.map(
      (target): Record<string, string> =>
        Object.fromEntries(WRITTEN.map((property) => [property, target.style.getPropertyValue(property)])),
    );
    const restore = (target: HTMLElement, index: number, properties: string[]) => {
      for (const property of properties) target.style.setProperty(property, before[index][property]);
    };
    const timers: number[] = [];

    const stop = watchEntry(element, {
      onPlaced: (position) => {
        if (position !== "below") return;
        const distance = readMotionToken("--motion-reveal-distance", "2.5rem");
        for (const target of targets) {
          target.style.opacity = "0";
          target.style.visibility = "hidden";
          target.style.transform = `translateY(${distance})`;
        }
      },
      onEnter: () => {
        const duration = tokenSeconds("--motion-duration-3", 0.8);
        const ease = readMotionToken("--motion-ease", "ease-out");
        targets.forEach((target, index) => {
          const wait = delay + index * stagger;
          // The transition and the final values land in one style update: the
          // browser animates from the hidden state to the element at rest.
          target.style.transition = `opacity ${duration}s ${ease} ${wait}s, transform ${duration}s ${ease} ${wait}s`;
          restore(target, index, HIDDEN_STATE);
          // Arrived: the element gets its own transitions (hover states) back.
          timers.push(window.setTimeout(() => restore(target, index, ["transition"]), (wait + duration) * 1000 + 100));
        });
      },
    });

    return () => {
      stop();
      for (const timer of timers) window.clearTimeout(timer);
      targets.forEach((target, index) => restore(target, index, WRITTEN));
    };
  }, [stagger, delay]);

  return (
    <div ref={ref} className={cn(className)}>
      {children}
    </div>
  );
}
