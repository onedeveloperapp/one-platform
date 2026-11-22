"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

/**
 * Whether a setup is on the screen now, wherever its address is: the firm's setup and the person's own open on
 * `/inicio` too, while nobody answered them, and a setup carries nothing that leads away from finishing it (the rule
 * is in `.claude/rules/app-ux.md`). The header reads it to leave out the search and "Adicionar", which
 * `isSetupPath` leaves out on `/configurar` by its address alone. On `/inicio` the browser filled the search with the
 * person's e-mail, and its list of "Nada encontrado." stood over the panel of the papers' step (2026-11-21).
 */
let shown = 0;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** A setup on the screen says so while it is mounted, before the first paint, so the header never flashes. */
export function useMarkSetupShown(): void {
  useLayoutEffect(() => {
    shown += 1;
    tell();
    return () => {
      shown -= 1;
      tell();
    };
  }, []);
}

/** Whether a setup is on the screen now. */
export function useSetupShown(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => shown > 0,
    () => false,
  );
}
