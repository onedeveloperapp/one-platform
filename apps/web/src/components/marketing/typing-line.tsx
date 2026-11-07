"use client";
import { useEffect, useRef, useState } from "react";

import AutoplayButton from "@/components/marketing/autoplay-button";
import { prefersReducedMotion, watchEntry } from "@/components/marketing/motion";

/** Milliseconds to type a phrase, to hold it, and to erase it. */
const TYPE_MS = 1500;
const HOLD_MS = 2000;
const ERASE_MS = 500;

type Phase = "typing" | "holding" | "erasing";

/**
 * A field that types, one after the other, what the product is doing: each
 * phrase typed in about a second and a half, held two seconds, erased in half
 * a second. One pass, then it rests on the last phrase, typed whole; a button
 * pauses it and plays it again. A screen reader reads the whole list at once
 * (the field itself is hidden from it), and with reduced motion the first
 * phrase stands still.
 */
export default function TypingLine({
  label,
  icon,
  phrases,
  listLabel,
  pauseLabel,
  playLabel,
}: {
  /** What the field is ("O ONE agora"). */
  label: string;
  icon: React.ReactNode;
  phrases: string[];
  /** The name of the hidden list read in its place. */
  listLabel: string;
  pauseLabel: string;
  playLabel: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [chars, setChars] = useState(phrases[0]?.length ?? 0);
  const [phase, setPhase] = useState<Phase>("holding");
  const [running, setRunning] = useState(false);

  // Start once the field reaches the screen, from an empty field; never with reduced motion.
  useEffect(() => {
    const element = root.current;
    if (!element || prefersReducedMotion()) return;
    const start = () => {
      setChars(0);
      setPhase("typing");
      setRunning(true);
    };
    return watchEntry(element, {
      onPlaced: (position) => {
        if (position === "visible") start();
      },
      onEnter: start,
    });
  }, []);

  useEffect(() => {
    if (!running) return;
    const phrase = phrases[index] ?? "";
    let timer: number;
    if (phase === "typing") {
      if (chars < phrase.length) timer = window.setTimeout(() => setChars(chars + 1), TYPE_MS / phrase.length);
      else timer = window.setTimeout(() => setPhase("holding"), 0);
    } else if (phase === "holding") {
      // The last phrase rests, typed whole: the pass is over.
      if (index >= phrases.length - 1) {
        setRunning(false);
        return;
      }
      timer = window.setTimeout(() => setPhase("erasing"), HOLD_MS);
    } else if (chars > 0) {
      timer = window.setTimeout(() => setChars(chars - 1), ERASE_MS / phrase.length);
    } else {
      timer = window.setTimeout(() => {
        setIndex(index + 1);
        setPhase("typing");
      }, 150);
    }
    return () => window.clearTimeout(timer);
  }, [running, phase, chars, index, phrases]);

  const toggle = () => {
    if (running) {
      setRunning(false);
      return;
    }
    // Played after the pass ended: from the first phrase again.
    if (index >= phrases.length - 1 && phase === "holding") {
      setIndex(0);
      setChars(0);
      setPhase("typing");
    }
    setRunning(true);
  };

  const shown = (phrases[index] ?? "").slice(0, chars);

  return (
    <div
      ref={root}
      className="border-grey-100 bg-background-paper shadow-darker-sm flex items-start gap-3 rounded-2xl border py-2 pr-2 pl-4 sm:items-center"
    >
      <span aria-hidden className="text-primary flex flex-none">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-text-secondary text-xs font-bold">{label}</span>
        {/* Two lines kept on a phone, one from sm: a phrase wraps instead of being cut, and the
            panel under the field never moves while a phrase is typed or erased. */}
        <span aria-hidden className="text-text-primary min-h-12 text-sm leading-6 sm:min-h-6">
          {shown}
          <span className="bg-primary ml-0.5 inline-block h-4 w-0.5 align-middle" />
        </span>
        <ul aria-label={listLabel} className="sr-only">
          {phrases.map((phrase) => (
            <li key={phrase}>{phrase}</li>
          ))}
        </ul>
      </div>
      <AutoplayButton running={running} onToggle={toggle} pauseLabel={pauseLabel} playLabel={playLabel} />
    </div>
  );
}
