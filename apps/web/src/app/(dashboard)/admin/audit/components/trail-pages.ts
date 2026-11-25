"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** What a trail is asked: the page (from zero), its size and the search. */
export type TrailQuery = { page: number; pageSize: number; search: string };
/** A page of a trail and how many events match in all. */
export type TrailPage<R> = { rows: R[]; total: number };

export const TRAIL_PAGE_SIZES = [25, 50, 100];
const FIRST: TrailQuery = { page: 0, pageSize: TRAIL_PAGE_SIZES[0]!, search: "" };

/**
 * A trail of the platform (the audit trail, the sign-in trail) read a page at a time, searched in the database
 * (`admin_audit_events`, `admin_access_events`, migration 0291). The console used to read the latest 200 events and
 * page them in the browser: every older event was out of reach, and the search said "nothing" of what it never
 * held. `read` must be stable (a function of the module): it is the one call to the database.
 *
 * An answer to an older question is not the trail's; a page past the end (the search found fewer, or the trail was
 * read again shorter) is its last page, never an empty table; a failed read is an error, never an empty trail.
 */
export function useTrailPages<R>(read: (query: TrailQuery) => Promise<TrailPage<R> | { error: string }>) {
  const [query, setQuery] = useState<TrailQuery>(FIRST);
  const [data, setData] = useState<TrailPage<R>>({ rows: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const turn = useRef(0);
  const current = useRef(FIRST);
  /** The question whose answer is on screen. */
  const shown = useRef(FIRST);

  const load = useCallback(
    async (next: TrailQuery) => {
      const mine = (turn.current += 1);
      current.current = next;
      setQuery(next);
      setLoading(true);
      let answer: TrailPage<R> | { error: string };
      try {
        answer = await read(next);
      } catch {
        answer = { error: "A leitura da trilha falhou." };
      }
      if (mine !== turn.current) return;
      if ("error" in answer) {
        // The pager goes back to the page whose rows are on screen; "Tentar de novo" asks the failed one again.
        setQuery(shown.current);
        setError(answer.error);
        setLoading(false);
        return;
      }
      const last = Math.max(0, Math.ceil(answer.total / next.pageSize) - 1);
      if (answer.rows.length === 0 && next.page > last) {
        void load({ ...next, page: last });
        return;
      }
      shown.current = next;
      setError(null);
      setData(answer);
      setLoaded(true);
      setLoading(false);
    },
    [read],
  );

  useEffect(() => {
    void load(FIRST);
  }, [load]);

  return {
    rows: data.rows,
    total: data.total,
    query,
    loading,
    loaded,
    error,
    /** Reads again what the person is looking at: the same search, the same page. */
    retry: () => void load(current.current),
    server: {
      total: data.total,
      page: query.page,
      pageSize: query.pageSize,
      onPageChange: (page: number, pageSize: number) => {
        const now = current.current;
        if (page === now.page && pageSize === now.pageSize) return;
        void load({ ...now, pageSize, page: pageSize === now.pageSize ? page : 0 });
      },
      onSearchChange: (text: string) => {
        const now = current.current;
        if (text === now.search) return;
        void load({ ...now, search: text, page: 0 });
      },
    },
  };
}

/** The total and the rows of a trail's answer; null when it is not one. */
export function trailPageOf(raw: unknown): { total: number; rows: Record<string, unknown>[] } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const answer = raw as { total?: unknown; rows?: unknown };
  if (typeof answer.total !== "number" || !Array.isArray(answer.rows)) return null;
  return {
    total: answer.total,
    rows: answer.rows.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null),
  };
}
