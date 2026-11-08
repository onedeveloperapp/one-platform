import type { FirmPartnership, OpenPartnerInvitation } from "@/lib/partners/facts";

/**
 * The firm's partnerships as a list of the screen pattern (the bar of every list, 2026-11-07): its ready views,
 * its search and its numbers. A firm has a handful of partnerships, read whole, so all of it is decided here, in the
 * browser. Pure, so the numbers of the cards and of the views are the very rows the list shows.
 */

/** The ready views: the partnerships in force, the ones that ended (kept with their reason), the open invitations. */
export const PARTNER_VIEWS = ["ativas", "encerradas", "convites"] as const;
export type PartnerView = (typeof PARTNER_VIEWS)[number];

export const isPartnerView = (value: unknown): value is PartnerView =>
  typeof value === "string" && (PARTNER_VIEWS as readonly string[]).includes(value);

/** Who manages the firm reads the invitations still open; everybody reads the partnerships. */
export const partnerViewsFor = (manager: boolean): PartnerView[] =>
  PARTNER_VIEWS.filter((view) => manager || view !== "convites");

/** Words compared as a person types them: no accents, no case, single spaces. */
const folded = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

function matches(text: string, search: string): boolean {
  const words = folded(search).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = folded(text);
  return words.every((word) => haystack.includes(word));
}

export type PartnerRows = { partnerships: FirmPartnership[]; invitations: OpenPartnerInvitation[] };

export function partnerRows(
  partnerships: FirmPartnership[],
  invitations: OpenPartnerInvitation[],
  view: PartnerView,
  search: string,
): PartnerRows {
  if (view === "convites") {
    return {
      partnerships: [],
      invitations: invitations.filter((invitation) =>
        matches(`${invitation.partnerName ?? ""} ${invitation.email}`, search),
      ),
    };
  }
  const status = view === "ativas" ? "active" : "ended";
  return {
    partnerships: partnerships.filter(
      (partnership) => partnership.status === status && matches(partnership.partner, search),
    ),
    invitations: [],
  };
}

/** How many each view holds under the search: the numbers the bar and the cards say. */
export function partnerCounts(
  partnerships: FirmPartnership[],
  invitations: OpenPartnerInvitation[],
  search: string,
): Record<PartnerView, number> {
  return Object.fromEntries(
    PARTNER_VIEWS.map((view) => {
      const rows = partnerRows(partnerships, invitations, view, search);
      return [view, rows.partnerships.length + rows.invitations.length];
    }),
  ) as Record<PartnerView, number>;
}

/**
 * The cases the firm's partnerships brought that are still going: the number of the firm's own list of them
 * (`/casos?ver=agencia`), summed over every partnership; null when the numbers of one could not be read, since a
 * sum that leaves one out is a wrong number.
 */
export function casesGoing(partnerships: FirmPartnership[]): number | null {
  let total = 0;
  for (const partnership of partnerships) {
    if (!partnership.facts) return null;
    total += partnership.facts.casesGoing;
  }
  return total;
}

/** The view the list opens on: the partnerships in force, else the invitations waiting, else what ended. */
export function firstPartnerView(
  partnerships: FirmPartnership[],
  invitations: OpenPartnerInvitation[],
  manager: boolean,
): PartnerView {
  if (partnerships.some((partnership) => partnership.status === "active")) return "ativas";
  if (manager && invitations.length > 0) return "convites";
  if (partnerships.length > 0) return "encerradas";
  return "ativas";
}
