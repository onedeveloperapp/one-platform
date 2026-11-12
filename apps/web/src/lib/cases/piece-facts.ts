import { FACTS_LINE } from "@/lib/conversations/questions";
/**
 * The client checks the facts of the initial (migration 0182, item 3.6 of the case journey plan): ONE writes the
 * facts of a ready piece in plain words, the client confirms them or says what is wrong, a correction goes back to
 * the piece, and the filing waits for the confirmation unless a partner or a lawyer goes on without it. Pure: what
 * the database answers, read into what the screens show, and ONE's words in the conversation.
 */

export const PIECE_FACTS_TASK = "caso.peca.fatos_cliente";

export type PieceFactsStatus = "writing" | "asked" | "confirmed" | "corrected" | "waived" | "failed" | "superseded";
const STATUSES: readonly PieceFactsStatus[] = [
  "writing",
  "asked",
  "confirmed",
  "corrected",
  "waived",
  "failed",
  "superseded",
];

export type PieceFactCheck = {
  id: string;
  draftId: string;
  version: number;
  status: PieceFactsStatus;
  facts: string | null;
  note: string | null;
  via: string | null;
  answeredAt: string | null;
  askedAt: string | null;
  reason: string | null;
  /** The piece's version and state now: a check of an older version waits for its newer one. */
  draftVersion: number;
  draftStatus: string;
};

export type CasePieceFacts = { reachable: boolean; checks: PieceFactCheck[] };

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/** What the case screen reads of the facts of its pieces, or null for an answer that is not one. */
export function casePieceFactsOf(raw: unknown): CasePieceFacts | null {
  const row = (raw ?? null) as { ok?: unknown; reachable?: unknown; items?: unknown } | null;
  if (!row || row.ok !== true) return null;
  const items = Array.isArray(row.items) ? row.items : [];
  return {
    reachable: row.reachable === true,
    checks: items.flatMap((item): PieceFactCheck[] => {
      const check = (item ?? {}) as Record<string, unknown>;
      const status = STATUSES.find((value) => value === check.status);
      if (typeof check.id !== "string" || typeof check.draft_id !== "string" || !status) return [];
      return [
        {
          id: check.id,
          draftId: check.draft_id,
          version: Number(check.version) || 0,
          status,
          facts: text(check.facts),
          note: text(check.note),
          via: text(check.via),
          answeredAt: text(check.answered_at),
          askedAt: text(check.asked_at),
          reason: text(check.reason),
          draftVersion: Number(check.draft_version) || 0,
          draftStatus: text(check.draft_status) ?? "proposed",
        },
      ];
    }),
  };
}

export type ClientPieceFacts = {
  id: string;
  kind: "juizado" | "comum";
  facts: string;
  status: "asked" | "confirmed" | "corrected";
  note: string | null;
};

/** What the client's link shows of the facts of their pieces. */
export function clientPieceFactsOf(raw: unknown): ClientPieceFacts[] {
  const row = (raw ?? null) as { ok?: unknown; items?: unknown } | null;
  if (!row || row.ok !== true || !Array.isArray(row.items)) return [];
  return row.items.flatMap((item): ClientPieceFacts[] => {
    const check = (item ?? {}) as Record<string, unknown>;
    const facts = text(check.facts);
    const status = check.status;
    if (typeof check.id !== "string" || !facts) return [];
    if (status !== "asked" && status !== "confirmed" && status !== "corrected") return [];
    return [
      { id: check.id, kind: check.kind === "comum" ? "comum" : "juizado", facts, status, note: text(check.note) },
    ];
  });
}

/** The longest facts ONE writes in the chat; longer ones are read on the link. */
const FACTS_IN_CHAT = 3000;

/**
 * ONE's word in the conversation when the facts are ready for the client to check: the facts themselves, to answer
 * right there (0233), or, when there are none to show or they are too long for a message, where to read them.
 */
export function factsAskedMessage(firstName: string, facts: string | null = null): string {
  const name = firstName.trim();
  const lead = `${name ? `${name}, a` : "A"} sua ação está pronta para o escritório levar ao tribunal.`;
  const told = facts?.trim();
  if (told && told.length <= FACTS_IN_CHAT) {
    return `${lead} Antes, confira se os fatos estão certos, do jeito que aconteceu:\n\n${told}\n\nEstá certo?\n${FACTS_LINE}`;
  }
  return [
    lead,
    "Antes, confira no seu link, em Os fatos da sua ação, se está tudo certo do jeito que aconteceu.",
    "Se estiver, toque em Confirmo. Se algo estiver errado, diga o que é: o escritório corrige a ação e te mostra de novo.",
  ].join(" ");
}

/** ONE's reminder when the client did not answer: in the chat when the facts were written there. */
export function factsReminderMessage(firstName: string, inChat = false): string {
  const name = firstName.trim();
  return inChat
    ? `${name ? `${name}, a` : "A"} sua ação só vai ao tribunal depois que você conferir os fatos que mandei acima. Está certo?\n${FACTS_LINE}`
    : `${name ? `${name}, a` : "A"} sua ação só vai ao tribunal depois que você conferir os fatos no seu link, em Os fatos da sua ação. Leva poucos minutos.`;
}

/** The refusals of a word on the facts, in the screen's words. */
export function pieceFactsErrorKey(code: string | null | undefined): string {
  switch (code) {
    case "note_required":
      return "piece-facts-error-note";
    case "reason":
      return "piece-facts-error-reason";
    case "second_factor":
      return "piece-facts-error-second-factor";
    case "not_allowed":
      return "piece-facts-error-not-allowed";
    case "not_owed":
      return "piece-facts-error-not-owed";
    default:
      return "piece-facts-error";
  }
}
