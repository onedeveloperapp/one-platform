import type { TeamInvitation, TeamPerson } from "./team-types";

import { FIRM_FUNCTIONS, type FirmFunction, formatOab, type OrgRole } from "@/lib/firm/roles";

/**
 * The firm's team as a list of the screen pattern (the bar of every list, 2026-11-07): its ready views, its search
 * and its numbers. The team is read whole (a firm's people and its open invitations), so all of it is decided here,
 * in the browser. Pure, so the numbers of the cards and of the views are the very rows the list shows.
 */

/** The ready views, in the order the bar lists them; the last two are of who manages the firm. */
export const TEAM_VIEWS = ["todos", ...FIRM_FUNCTIONS, "sem-fator", "convites"] as const;
export type TeamView = (typeof TEAM_VIEWS)[number];

export const isTeamView = (value: unknown): value is TeamView =>
  typeof value === "string" && (TEAM_VIEWS as readonly string[]).includes(value);

/** The views a person reads: who manages the firm reads the open invitations and who lacks the second factor. */
export const teamViewsFor = (manager: boolean): TeamView[] =>
  TEAM_VIEWS.filter((view) => manager || (view !== "sem-fator" && view !== "convites"));

const isFunctionView = (view: TeamView): view is FirmFunction => (FIRM_FUNCTIONS as readonly string[]).includes(view);

/**
 * Whether a person still owes the second factor the firm asks of who manages its account: the rule the roster has
 * always said beside a name. Only who manages the firm reads it (`hasSecondFactor` is null for everybody else).
 */
export const lacksSecondFactor = (person: { role: OrgRole; hasSecondFactor: boolean | null }): boolean =>
  person.role !== "member" && person.hasSecondFactor === false;

/** Words compared as a person types them: no accents, no case, single spaces. */
const folded = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

function matches(text: string, search: string): boolean {
  const words = folded(search).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = folded(text);
  return words.every((word) => haystack.includes(word));
}

/** A person is found by their name, their e-mail or a registration at the bar, however it is typed. */
const personText = (person: TeamPerson) =>
  [
    person.name,
    person.email,
    ...person.oab.flatMap((registration) => [formatOab(registration), registration.number]),
  ].join(" ");

function inView(person: TeamPerson, view: TeamView): boolean {
  if (view === "todos") return true;
  if (view === "sem-fator") return lacksSecondFactor(person);
  if (isFunctionView(view)) return person.firmFunction === view;
  return false;
}

/** What a view shows: people, or the invitations still open. */
export type TeamRows = { people: TeamPerson[]; invitations: TeamInvitation[] };

export function teamRows(
  people: TeamPerson[],
  invitations: TeamInvitation[],
  view: TeamView,
  search: string,
): TeamRows {
  if (view === "convites") {
    return { people: [], invitations: invitations.filter((invitation) => matches(invitation.email, search)) };
  }
  return {
    people: people.filter((person) => inView(person, view) && matches(personText(person), search)),
    invitations: [],
  };
}

/** How many each view holds under the search: the numbers the bar and the cards say. */
export function teamCounts(
  people: TeamPerson[],
  invitations: TeamInvitation[],
  search: string,
): Record<TeamView, number> {
  return Object.fromEntries(
    TEAM_VIEWS.map((view) => {
      const rows = teamRows(people, invitations, view, search);
      return [view, rows.people.length + rows.invitations.length];
    }),
  ) as Record<TeamView, number>;
}
