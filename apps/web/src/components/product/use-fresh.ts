"use client";

import { useEffect, useRef, useState } from "react";

const EMPTY: ReadonlySet<string> = new Set();

/**
 * The keys whose signature is new or different in `after` (pure). A key that left says nothing: what went is not
 * marked as new.
 */
export function changedKeys(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): string[] {
  return Object.keys(after).filter((key) => before[key] !== after[key]);
}

/** The signatures in one string whatever the order their keys were written in, so a new order is no change. */
export function signatureOf(signatures: Readonly<Record<string, string>>): string {
  return JSON.stringify(
    Object.keys(signatures)
      .sort()
      .map((key) => [key, signatures[key]]),
  );
}

/**
 * What changed on a screen a moment ago, for it to be marked for a few seconds (the owner's canvas of the case's
 * actions, 2026-11-10): each thing the screen shows under a key and a signature of how it stands; when a new reading
 * changes a signature or brings a key, that key is fresh for `holdMs`. The first reading marks nothing (nothing
 * changed, the person just arrived), and a reading that changes nothing keeps what is marked until its time ends.
 *
 * Closest catalog entry: `useLiveRead`, which knows when a screen was read again; this knows what changed in it.
 */
export function useFresh(signatures: Readonly<Record<string, string>>, holdMs = 6000): ReadonlySet<string> {
  const signature = signatureOf(signatures);
  const before = useRef<Record<string, string> | null>(null);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(EMPTY);

  useEffect(() => {
    const now = Object.fromEntries(JSON.parse(signature) as [string, string][]);
    const previous = before.current;
    before.current = now;
    if (!previous) return;
    const changed = changedKeys(previous, now);
    if (changed.length === 0) {
      setFresh(EMPTY);
      return;
    }
    setFresh(new Set(changed));
    const timer = window.setTimeout(() => setFresh(EMPTY), holdMs);
    return () => window.clearTimeout(timer);
  }, [signature, holdMs]);

  return fresh;
}
