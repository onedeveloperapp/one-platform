"use client";
import { useCallback, useEffect, useRef, useState } from "react";

import AutoplayButton from "@/components/marketing/autoplay-button";
import { prefersReducedMotion, watchEntry } from "@/components/marketing/motion";
import { TONE, type Tone } from "@/components/marketing/tone";
import NiCheck from "@/icons/nexture/ni-check";
import { cn } from "@/lib/utils";

export type RadarItem = {
  /** Where it came from ("Publicação no DJEN"). */
  source: string;
  icon: React.ReactNode;
  tone: Tone;
  title: string;
  /** The lawsuit and the facts, in one line. */
  detail: string;
  /** What ONE did with it. */
  action: string;
};

/** Where each blip sits on the radar, in percent of its square: never on the centre, never on a ring's edge. */
const BLIPS = [
  { x: 64, y: 22 },
  { x: 80, y: 60 },
  { x: 40, y: 78 },
  { x: 20, y: 44 },
  { x: 38, y: 28 },
];

/** The clockwise angle of a blip from the top, in turns: when the sweep, starting at the top, passes over it. */
const turnOf = ({ x, y }: { x: number; y: number }) => {
  const angle = (Math.atan2(x - 50, 50 - y) * 180) / Math.PI;
  return ((angle + 360) % 360) / 360;
};

/**
 * What ONE finds in the lawsuits it follows, as a radar and a card: the sweep
 * turns once per example, each example lights its blip, and the card under it
 * says where it came from, what it is and what ONE did. The examples change by
 * themselves once the radar reaches the screen, one pass through all of them,
 * and then rest on the last; a button pauses them and plays them again, and the
 * dots go to any one. With reduced motion nothing turns or changes by itself.
 * A tag on the card says the data are an example.
 */
export default function SourceRadar({
  label,
  sample,
  items,
  pauseLabel,
  playLabel,
  gotoLabels,
  cycle = 6,
}: {
  /** The region's name for a screen reader. */
  label: string;
  /** "Exemplo com dados fictícios". */
  sample: string;
  items: RadarItem[];
  pauseLabel: string;
  playLabel: string;
  /** One per item: "Ver o exemplo 1". */
  gotoLabels: string[];
  /** Seconds each example stays, and one turn of the sweep. */
  cycle?: number;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(false);
  // Whether the visitor took the controls: the card then speaks to a screen reader when it changes.
  const [driven, setDriven] = useState(false);

  // Start the pass once the radar reaches the screen; never with reduced motion.
  useEffect(() => {
    const element = root.current;
    if (!element || prefersReducedMotion()) return;
    return watchEntry(element, {
      onPlaced: (position) => {
        if (position === "visible") setRunning(true);
      },
      onEnter: () => setRunning(true),
    });
  }, []);

  // One example per turn, one pass: it rests on the last.
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      if (index >= items.length - 1) setRunning(false);
      else setIndex(index + 1);
    }, cycle * 1000);
    return () => window.clearTimeout(timer);
  }, [running, index, items.length, cycle]);

  const toggle = useCallback(() => {
    setDriven(true);
    if (running) {
      setRunning(false);
      return;
    }
    // Played after the pass ended: from the first again.
    if (index >= items.length - 1) setIndex(0);
    setRunning(true);
  }, [running, index, items.length]);

  const item = items[index];
  const tone = TONE[item.tone];

  return (
    <div
      ref={root}
      role="region"
      aria-label={label}
      className="border-grey-100 bg-background-paper shadow-darker-sm flex w-full flex-col gap-6 rounded-3xl border p-5 sm:p-7"
    >
      <div
        aria-hidden
        // A dark disc: it reads as a radar before a word is read, under either mode.
        className="bg-background-deep relative mx-auto aspect-square w-full max-w-80 overflow-hidden rounded-full"
        style={{ "--sweep-cycle": `${cycle}s`, "--sweep-turns": items.length } as React.CSSProperties}
      >
        {[100, 72, 44].map((size) => (
          <span
            key={size}
            className="border-text-contrast/15 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border"
            style={{ width: `${size}%`, height: `${size}%` }}
          />
        ))}
        <span className="bg-text-contrast/15 absolute top-0 bottom-0 left-1/2 w-px" />
        <span className="bg-text-contrast/15 absolute top-1/2 right-0 left-0 h-px" />
        <span
          data-running={running}
          className="mkt-sweep absolute inset-0 rounded-full"
          style={{
            background: "conic-gradient(from 0deg, transparent 0deg 290deg, hsl(var(--secondary) / 0.45) 360deg)",
          }}
        />
        {BLIPS.slice(0, items.length).map((blip, blipIndex) => (
          <span
            key={blipIndex}
            className={cn(
              "mkt-blip absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full",
              blipIndex === index ? "ring-4 ring-current/20" : "opacity-40",
              TONE[items[blipIndex].tone].text,
            )}
            style={
              {
                left: `${blip.x}%`,
                top: `${blip.y}%`,
                backgroundColor: "currentcolor",
                "--blip-delay": `${(turnOf(blip) * cycle).toFixed(2)}s`,
              } as React.CSSProperties
            }
          />
        ))}
        <span className="bg-secondary absolute top-1/2 left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full" />
      </div>

      <div
        aria-live={driven && !running ? "polite" : "off"}
        className="border-grey-100 flex flex-col gap-2 border-t pt-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-text-primary flex items-center gap-2 text-sm font-bold">
            <span
              aria-hidden
              className={cn("flex h-7 w-7 items-center justify-center rounded-full", tone.softBg, tone.text)}
            >
              {item.icon}
            </span>
            {item.source}
          </span>
          <span className="bg-grey-50 text-text-secondary rounded-full px-2.5 py-0.5 text-xs font-semibold">
            {sample}
          </span>
        </div>
        <p className="font-heading text-text-primary text-lg font-bold">{item.title}</p>
        <p className="text-text-secondary text-sm leading-6 tabular-nums">{item.detail}</p>
        <p className="text-text-primary flex items-start gap-2 text-sm leading-6">
          <NiCheck size="small" className={cn("mt-0.5 flex-none", tone.text)} />
          {item.action}
        </p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          {items.map((entry, dot) => (
            <button
              key={entry.title}
              type="button"
              aria-label={gotoLabels[dot]}
              aria-current={dot === index}
              onClick={() => {
                setDriven(true);
                setRunning(false);
                setIndex(dot);
              }}
              className="flex h-6 min-w-6 items-center justify-center"
            >
              <span
                aria-hidden
                className={cn(
                  "h-1.5 rounded-full transition-[width,background-color] duration-200 motion-reduce:transition-none",
                  dot === index ? "bg-primary w-5" : "bg-grey-200 w-1.5",
                )}
              />
            </button>
          ))}
        </div>
        <AutoplayButton running={running} onToggle={toggle} pauseLabel={pauseLabel} playLabel={playLabel} />
      </div>
    </div>
  );
}
