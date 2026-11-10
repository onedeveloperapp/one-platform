"use client";

import { useEffect, useRef, useState } from "react";

import { listFirmCases } from "@/lib/cases/list-actions";
import { searchPeople } from "@/lib/people/search-actions";
import { caseHits, type GlobalHit, globalHits, SEARCH_DELAY_MS, searchable } from "@/lib/search/global-search";

export type GlobalSearch =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; hits: GlobalHit[] }
  | { kind: "error" };

/**
 * What the search at the top finds for what is typed (phase 9): the firm's people and conversations (migration 0133)
 * and its cases, asked together a moment after the last key, in the request's body. One part that fails leaves the
 * other's hits; an answer to an older question is never the list's.
 */
export function useGlobalSearch(text: string): GlobalSearch {
  const [found, setFound] = useState<GlobalSearch>({ kind: "idle" });
  const asked = useRef(0);

  useEffect(() => {
    const turn = (asked.current += 1);
    if (!searchable(text)) {
      setFound({ kind: "idle" });
      return;
    }
    setFound({ kind: "loading" });
    const timer = window.setTimeout(async () => {
      const [cases, people] = await Promise.all([
        listFirmCases({ filter: null, search: text, module: null, page: 0, pageSize: 25 }).catch(() => ({
          ok: false as const,
        })),
        searchPeople(text).catch(() => ({ ok: false as const })),
      ]);
      if (turn !== asked.current) return;
      if (!cases.ok && !people.ok) return setFound({ kind: "error" });
      setFound({
        kind: "ready",
        hits: globalHits(
          people.ok ? people.found : { people: [], conversations: [] },
          cases.ok ? caseHits(cases.page.rows) : [],
        ),
      });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  return found;
}
