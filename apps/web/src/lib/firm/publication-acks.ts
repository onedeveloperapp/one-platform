import type { PendingItem } from "@/lib/firm/pending";
import { CATEGORY_KEY, isPublicationCategory } from "@/lib/publications/publications";

/**
 * The awareness of ONE's triage of the firm's publications (migration 0104), as the center of what waits and the
 * home say it. Pure: no I/O.
 *
 * ONE triages each publication by itself, and the lawyer it was addressed to says they are aware of it; with none of
 * the firm, anybody who triages may. Each lawyer reads the ones addressed to them, who runs the firm's deadlines
 * (the controladoria) reads them all, and a partner reads theirs and the ones addressed to nobody of the firm. One
 * that waited longer than the setting's hours is late.
 */

export type PublicationAck = {
  publicationId: string;
  caseId: string | null;
  seq: number | null;
  category: string | null;
  availableOn: string | null;
  triagedAt: string | null;
  late: boolean;
  /** The lawyers it was addressed to who still sign; empty when none is of the firm. */
  lawyers: string[];
};

export type PublicationAcks = { items: PublicationAck[]; total: number; late: number; lateHours: number };

/** Who reads it: their own id and function. */
export type AckViewer = { userId: string; firmFunction: string | null };

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const whole = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;

/** The database's answer (`firm_publication_acks`), read; null when it is not one. */
export function readPublicationAcks(raw: unknown): PublicationAcks | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const answer = raw as Record<string, unknown>;
  if (!Array.isArray(answer.items)) return null;
  return {
    items: answer.items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const publicationId = text(row.publication_id);
      if (!publicationId) return [];
      return [
        {
          publicationId,
          caseId: text(row.case_id),
          seq: typeof row.seq === "number" ? row.seq : null,
          category: text(row.category),
          availableOn: text(row.available_on),
          triagedAt: text(row.triaged_at),
          late: row.late === true,
          lawyers: Array.isArray(row.lawyers) ? row.lawyers.filter((id): id is string => typeof id === "string") : [],
        },
      ];
    }),
    total: whole(answer.total, 0),
    late: whole(answer.late, 0),
    lateHours: Math.max(whole(answer.late_hours, 4), 1),
  };
}

/** A day of the calendar as people read it: 05/11/2026. */
const dayLabel = (day: string | null): string => (day ? day.slice(0, 10).split("-").reverse().join("/") : "");

/** Whether the viewer is asked for this awareness. */
function asks(ack: PublicationAck, viewer: AckViewer): boolean {
  if (viewer.firmFunction === "controladoria") return true;
  if (ack.lawyers.includes(viewer.userId)) return true;
  return viewer.firmFunction === "socio" && ack.lawyers.length === 0;
}

/**
 * The lines of the center and of the home: each publication ONE triaged that waits for the viewer's awareness, under
 * "O ONE precisa de você", or "Atrasado" once it waited longer than the setting's hours, one click from its case (or
 * from the list of the firm, for a publication of no case). Who sees every one (the controladoria) is also told how
 * many more there are.
 */
export function publicationAckItems(
  acks: PublicationAcks,
  viewer: AckViewer,
): { late: PendingItem[]; one: PendingItem[] } {
  const late: PendingItem[] = [];
  const one: PendingItem[] = [];
  if (!["socio", "advogado", "controladoria"].includes(viewer.firmFunction ?? "")) return { late, one };
  const listed = acks.items.filter((ack) => asks(ack, viewer));
  for (const ack of listed) {
    const what = { message: isPublicationCategory(ack.category) ? CATEGORY_KEY[ack.category] : CATEGORY_KEY.outro };
    const item: PendingItem = {
      id: `publication-ack:${ack.publicationId}`,
      href: ack.caseId ? `/casos/${ack.caseId}#case-publications` : "/publicacoes",
      tag: { key: "pending-tag-publication" },
      label: ack.late
        ? { key: "pending-publication-ack-late", values: { what, hours: acks.lateHours } }
        : { key: "pending-publication-ack", values: { what } },
      detail:
        ack.seq !== null
          ? { key: "pending-publication-ack-detail", values: { seq: ack.seq, day: dayLabel(ack.availableOn) } }
          : { key: "pending-publication-ack-detail-nocase", values: { day: dayLabel(ack.availableOn) } },
      count: 1,
    };
    (ack.late ? late : one).push(item);
  }
  const unlisted = acks.total - acks.items.length;
  if (viewer.firmFunction === "controladoria" && unlisted > 0) {
    one.push({
      id: "publication-acks:more",
      href: "/publicacoes",
      tag: { key: "pending-tag-publication" },
      label: { key: "pending-publication-acks-more", values: { count: unlisted } },
      count: unlisted,
    });
  }
  return { late, one };
}
