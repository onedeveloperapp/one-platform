/**
 * What a publication asks (migration 0186, item 4.1 of the case journey plan), as the screens read it. Pure: what the
 * database answers, read into what the case's card of publications and the client's link show.
 */

export const PUBLICATION_ACTION_TASK = "publicacao.acao";

export const PUBLICATION_ACTIONS = [
  "nada",
  "prazo",
  "manifestacao",
  "replica",
  "contrarrazoes",
  "embargos",
  "recurso",
  "cumprimento",
  "levantamento",
  "juntar_documento",
] as const;
export type PublicationAction = (typeof PUBLICATION_ACTIONS)[number];

export type ActionPending = {
  from: "cliente" | "escritorio";
  kind: "documento" | "resposta" | "decisao";
  text: string;
};

export type PublicationActionView = {
  publicationId: string;
  status: "owed" | "done" | "failed";
  action: PublicationAction | null;
  firmSummary: string | null;
  clientSummary: string | null;
  reason: string | null;
  pending: ActionPending[];
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

export function publicationActionsOf(raw: unknown): PublicationActionView[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): PublicationActionView[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    if (typeof row.publication_id !== "string") return [];
    const status = row.status === "done" || row.status === "failed" ? row.status : "owed";
    const pending = Array.isArray(row.pending)
      ? row.pending.flatMap((entry): ActionPending[] => {
          const value = (entry ?? {}) as Record<string, unknown>;
          const from = value.de === "cliente" || value.de === "escritorio" ? value.de : null;
          const kind =
            value.tipo === "documento" || value.tipo === "resposta" || value.tipo === "decisao" ? value.tipo : null;
          const words = text(value.texto);
          return from && kind && words ? [{ from, kind, text: words }] : [];
        })
      : [];
    return [
      {
        publicationId: row.publication_id,
        status,
        action: PUBLICATION_ACTIONS.find((action) => action === row.action) ?? null,
        firmSummary: text(row.firm_summary),
        clientSummary: text(row.client_summary),
        reason: text(row.reason),
        pending,
      },
    ];
  });
}

export const ACTION_KEY: Record<PublicationAction, string> = {
  nada: "publication-action-nada",
  prazo: "publication-action-prazo",
  manifestacao: "publication-action-manifestacao",
  replica: "publication-action-replica",
  contrarrazoes: "publication-action-contrarrazoes",
  embargos: "publication-action-embargos",
  recurso: "publication-action-recurso",
  cumprimento: "publication-action-cumprimento",
  levantamento: "publication-action-levantamento",
  juntar_documento: "publication-action-juntar-documento",
};

export type ClientPublicationNews = { id: string; on: string; summary: string; asks: string[] };

export function clientPublicationNewsOf(raw: unknown): ClientPublicationNews[] {
  const row = (raw ?? null) as { ok?: unknown; items?: unknown } | null;
  if (!row || row.ok !== true || !Array.isArray(row.items)) return [];
  return row.items.flatMap((item): ClientPublicationNews[] => {
    const value = (item ?? {}) as Record<string, unknown>;
    const summary = text(value.summary);
    if (typeof value.id !== "string" || !summary) return [];
    return [
      {
        id: value.id,
        on: String(value.on ?? "").slice(0, 10),
        summary,
        asks: Array.isArray(value.asks) ? value.asks.filter((ask): ask is string => typeof ask === "string") : [],
      },
    ];
  });
}
