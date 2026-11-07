"use client";

import { useEffect, useRef, useState } from "react";

import { listFirmCases } from "@/lib/cases/list-actions";
import { caseHits, SEARCH_DELAY_MS, searchable, type SearchHit } from "@/lib/search/global-search";

export type CaseSearch =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; hits: SearchHit[] }
  | { kind: "error" };

/**
 * The firm's cases for what is typed, asked of the database a moment after the last key, in the request's body
 * (never in the address): the search of the top and the choice of a case in a panel read the same. An answer to an
 * older question is never the list's.
 */
export function useCaseSearch(text: string): CaseSearch {
  const [found, setFound] = useState<CaseSearch>({ kind: "idle" });
  const asked = useRef(0);

  useEffect(() => {
    const turn = (asked.current += 1);
    if (!searchable(text)) {
      setFound({ kind: "idle" });
      return;
    }
    setFound({ kind: "loading" });
    const timer = window.setTimeout(async () => {
      let answer: Awaited<ReturnType<typeof listFirmCases>>;
      try {
        answer = await listFirmCases({ filter: null, search: text, module: null, page: 0, pageSize: 25 });
      } catch {
        answer = { ok: false };
      }
      if (turn !== asked.current) return;
      setFound(answer.ok ? { kind: "ready", hits: caseHits(answer.page.rows) } : { kind: "error" });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  return found;
}
