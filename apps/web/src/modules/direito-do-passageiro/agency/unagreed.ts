/**
 * The agency's passengers who fly in the next days with no agreement (migration 0094, `pax_departing_unagreed`),
 * as its home reads them: while there is still time to send the link, so ONE follows the flight. Only who never
 * answered, or whose agreement no longer covers the trip (0086); never who said no or took the agreement back,
 * and nothing is read of any flight (the day is the one the agency registered). Pure.
 */

import { localTimeLabel, type Reagree, REAGREE_REASONS } from "./passengers";

export type UnagreedTraveler = {
  id: string;
  fullName: string;
  /** The first departure in the window, in the local time the agency registered (`YYYY-MM-DDTHH:MM`). */
  departure: string;
  /** Why an agreement in force no longer covers the trip; null when the passenger never answered. */
  reagree: Reagree | null;
  /** Until when the link the passenger was sent is open; null when none is. */
  linkUntil: string | null;
};

export type UnagreedRead = { days: number; travelers: UnagreedTraveler[] };

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);

/** The database's answer as the home reads it, or null when it is not one. */
export function unagreedOf(value: unknown): UnagreedRead | null {
  if (!value || typeof value !== "object") return null;
  const answer = value as { days?: unknown; travelers?: unknown };
  if (typeof answer.days !== "number" || !Array.isArray(answer.travelers)) return null;
  const travelers: UnagreedTraveler[] = [];
  for (const row of answer.travelers as Record<string, unknown>[]) {
    const id = text(row?.id);
    const fullName = text(row?.full_name);
    const departure = text(row?.departure);
    if (!id || !fullName || !departure) continue;
    const reagree = text(row.reagree);
    travelers.push({
      id,
      fullName,
      departure,
      reagree: reagree && (REAGREE_REASONS as readonly string[]).includes(reagree) ? (reagree as Reagree) : null,
      linkUntil: text(row.link_until),
    });
  }
  return { days: Math.max(1, Math.trunc(answer.days)), travelers };
}

/** What each line says the agency does next: send the link, or ask the passenger to agree again on it. */
export function unagreedLineKey(traveler: UnagreedTraveler): string {
  if (traveler.reagree) return "pax-unagreed-line-reagree";
  return traveler.linkUntil ? "pax-unagreed-line-sent" : "pax-unagreed-line-none";
}

/** The departure as the agency registered it, in the airport's local time. */
export const unagreedDepartureLabel = (traveler: UnagreedTraveler): string => localTimeLabel(traveler.departure);
