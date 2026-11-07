import { caseLabel } from "@/lib/cases/cases";
import type { CaseListRow } from "@/lib/cases/list";

/**
 * The search at the top of every screen of the firm (phase 0 of the plan of 2026-11-07, after ADVBox's): what is
 * typed finds the firm's cases by the client's name, a CPF, a lawsuit's number or the case's own number, every
 * case, the ones that ended included (`firm_cases`, migration 0033). Phase 9 links it to people, conversations and
 * leads. What is typed goes in the request's body, never in an address: a name or a CPF in an address ends up in
 * history and logs.
 */

/** How many letters or digits a search needs before it is asked. */
export const SEARCH_MIN = 2;
/** How many cases the list under the field shows. */
export const SEARCH_HITS = 8;
/** How long the field waits after the last key before it asks. */
export const SEARCH_DELAY_MS = 300;

/** A case the search found, as the list under the field says it. */
export type SearchHit = {
  id: string;
  /** The case's own number, as the firm writes it. */
  label: string;
  /** The client's name, or nothing when the case has none yet. */
  client: string;
  status: CaseListRow["status"];
};

/** The first cases of a page of the list, as the search shows them. */
export function caseHits(rows: readonly CaseListRow[], max = SEARCH_HITS): SearchHit[] {
  return rows.slice(0, Math.max(0, max)).map((row) => ({
    id: row.id,
    label: caseLabel(row.seq),
    client: row.client,
    status: row.status,
  }));
}

/** Whether what was typed is enough to search: a few letters or digits, never only spaces and marks. */
export function searchable(text: string): boolean {
  return text.replace(/[^\p{L}\p{N}]/gu, "").length >= SEARCH_MIN;
}

/** A key press, as far as the shortcut reads it. */
export type ShortcutKey = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: unknown };

/**
 * Whether a key press asks for the search: "/" anywhere but in a field somebody is typing in, or Ctrl+K (Cmd+K
 * on a Mac) anywhere.
 */
export function isSearchShortcut(event: ShortcutKey): boolean {
  if (event.altKey) return false;
  if (event.ctrlKey || event.metaKey) return event.key.toLowerCase() === "k";
  return event.key === "/" && !isTypingTarget(event.target);
}

function isTypingTarget(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable === true;
}
