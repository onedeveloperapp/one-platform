"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { pulseDelay } from "@/lib/cases/pulse";

/** What a screen kept alive says of itself: when it last knew it shows what the database has, and whether it can tell. */
export type LiveRead = {
  /** The screen follows the database by itself (its pulse can be read). */
  live: boolean;
  /** When the screen last knew it shows what the database has, in milliseconds; null before the first answer. */
  checkedAt: number | null;
  /** The last ask of the pulse failed: the screen may be behind, and says so. */
  failed: boolean;
  /** The person just did something that sets ONE to work: the screen asks often for a while. */
  acted: () => void;
  /** Ask now, as the person's "Atualizar" does. */
  checkNow: () => void;
};

/**
 * Keeps a screen in step with the database while it is open (the owner's audit of the case screen, 2026-11-05):
 * it asks a light pulse (`stamp`, a mark that changes whenever what the screen shows changes) every few seconds
 * while ONE is at work there or right after the person acted, and less often otherwise, never while the tab is
 * hidden, and as soon as it is in front of the person again; when the mark differs from the one the screen was
 * drawn with, the screen is read again (`onChange`, the router's refresh). So what ONE did, and what the client
 * sent, shows while the person is on the screen, with no reload, and nothing is read whole for nothing.
 *
 * A screen whose pulse cannot be read at all (`stamp` null: the database does not have it) is not followed, and
 * says nothing of being live.
 */
export function useLiveRead({
  stamp,
  read,
  busy,
  onChange,
}: {
  /** The mark of what the screen shows, read with it; null when the pulse could not be read. */
  stamp: string | null;
  read: () => Promise<string | null>;
  /** ONE is at work on what the screen shows: ask often. */
  busy: boolean;
  onChange: () => void;
}): LiveRead {
  const shown = useRef(stamp);
  const asked = useRef<{ stamp: string; at: number } | null>(null);
  const actedAt = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const reading = useRef(false);
  const busyRef = useRef(busy);
  const failedRef = useRef(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(stamp ? Date.now() : null);
  const [failed, setFailed] = useState(false);
  const [wake, setWake] = useState(0);

  // A new drawing of the screen carries the mark it was drawn with.
  useEffect(() => {
    shown.current = stamp;
    asked.current = null;
    if (stamp) setCheckedAt(Date.now());
  }, [stamp]);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const check = useCallback(async () => {
    if (reading.current || !shown.current) return;
    reading.current = true;
    try {
      const latest = await read().catch(() => null);
      if (latest === null) {
        failedRef.current = true;
        setFailed(true);
        return;
      }
      failedRef.current = false;
      setFailed(false);
      if (latest === shown.current) {
        setCheckedAt(Date.now());
        return;
      }
      // Something changed: the screen is read again, once per new mark (a refresh still on its way is not asked twice).
      const now = Date.now();
      if (asked.current?.stamp === latest && now - asked.current.at < 15_000) return;
      asked.current = { stamp: latest, at: now };
      onChange();
    } finally {
      reading.current = false;
    }
  }, [read, onChange]);

  useEffect(() => {
    if (!stamp) return;
    let stopped = false;
    const schedule = () => {
      if (stopped) return;
      const delay = pulseDelay({
        busy: busyRef.current,
        actedAt: actedAt.current,
        now: Date.now(),
        failed: failedRef.current,
      });
      timer.current = window.setTimeout(async () => {
        if (document.visibilityState === "visible") await check();
        schedule();
      }, delay);
    };
    schedule();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
    // `wake` starts the loop over, so an action's quick asks begin at once instead of after a long wait.
  }, [stamp, check, wake]);

  const acted = useCallback(() => {
    actedAt.current = Date.now();
    setWake((value) => value + 1);
  }, []);
  const checkNow = useCallback(() => {
    void check();
  }, [check]);

  return { live: stamp !== null, checkedAt, failed, acted, checkNow };
}
