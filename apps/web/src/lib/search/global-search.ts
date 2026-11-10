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

/** A person of the firm the search found (migration 0133): their page opens. */
export type PersonHit = {
  id: string;
  name: string;
  /** The CPF's middle only ("982.247"), never the whole number on a screen anybody may look at. */
  cpfMiddle: string | null;
  place: string | null;
  cases: number;
  active: boolean;
};

/** A conversation of the firm's WhatsApp the search found: it opens in Atendimento. */
export type ConversationHit = { id: string; name: string | null; number: string };

/** Everything the search at the top found, in the order a person reads it: people, cases, conversations. */
export type GlobalHit =
  | { kind: "person"; id: string; href: string; person: PersonHit }
  | { kind: "case"; id: string; href: string; hit: SearchHit }
  | { kind: "conversation"; id: string; href: string; conversation: ConversationHit };

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/** The middle of a CPF ("982.247"), as a screen shows it. */
export const cpfMiddle = (cpf: string | null): string | null =>
  cpf && /^\d{11}$/.test(cpf) ? `${cpf.slice(3, 6)}.${cpf.slice(6, 9)}` : null;

/** The people and conversations the database answered (`firm_people_search`), read as nothing more than they may be. */
export function readPeopleSearch(raw: unknown): { people: PersonHit[]; conversations: ConversationHit[] } {
  const answer = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const rows = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
      : [];
  return {
    people: rows(answer.people).flatMap((row): PersonHit[] => {
      const id = text(row.id);
      const name = text(row.name);
      if (!id || !name) return [];
      const city = text(row.city);
      const uf = text(row.uf);
      return [
        {
          id,
          name,
          cpfMiddle: cpfMiddle(text(row.cpf)),
          place: city ? (uf ? `${city}/${uf}` : city) : null,
          cases: typeof row.cases === "number" ? row.cases : 0,
          active: row.active === true,
        },
      ];
    }),
    conversations: rows(answer.conversations).flatMap((row): ConversationHit[] => {
      const id = text(row.id);
      const number = text(row.number);
      return id && number ? [{ id, name: text(row.name), number }] : [];
    }),
  };
}

/** The hits of one search, people first, then cases, then conversations. */
export function globalHits(
  found: { people: PersonHit[]; conversations: ConversationHit[] },
  cases: readonly SearchHit[],
): GlobalHit[] {
  return [
    ...found.people.map(
      (person): GlobalHit => ({ kind: "person", id: `person:${person.id}`, href: `/pessoas/${person.id}`, person }),
    ),
    ...cases.map((hit): GlobalHit => ({ kind: "case", id: `case:${hit.id}`, href: `/casos/${hit.id}`, hit })),
    ...found.conversations.map(
      (conversation): GlobalHit => ({
        kind: "conversation",
        id: `conversation:${conversation.id}`,
        href: `/atendimento?c=${conversation.id}`,
        conversation,
      }),
    ),
  ];
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

/**
 * The setups lead nowhere else before they end (apps/web/CLAUDE.md): on them the top offers neither the search nor
 * "Adicionar".
 */
export const isSetupPath = (pathname: string): boolean =>
  pathname === "/configurar" || pathname.startsWith("/configurar/");
