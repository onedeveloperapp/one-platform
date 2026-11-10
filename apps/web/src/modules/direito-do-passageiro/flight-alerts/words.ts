import { firstNameOf } from "@/lib/cases/cases";
import { type Assistance, assistanceDue, type FlightProblem } from "@flyee/rules/flight-problem";

/**
 * The values of ONE's first word when a flight it follows has a problem
 * (migration 0047, the notice kind `flight_problem`): the passenger's first
 * name, the firm, the flight, what happened and what the airline owes, in
 * the order the template has them. Pure: what is owed is the rule's
 * (`@flyee/rules/flight-problem`), the words are these. Each value is one
 * line, as a template takes it, with no dash and no exclamation mark.
 */

export type AlertLeg = {
  position: number;
  flightNumber: string;
  origin: string;
  originCity: string | null;
  destination: string;
  destinationCity: string | null;
  /** Local, at the origin: `2026-10-22T08:10:00`. */
  departure: string;
};

export type AlertFacts = {
  kind: FlightProblem["kind"];
  delayMinutes: number | null;
  passengerName: string;
  firm: string;
  legs: AlertLeg[];
};

/** A flight as people write it: `LA 3456` for `LA3456`. */
export const flightLabel = (normalized: string): string => normalized.replace(/^([A-Z0-9]{2})(\d)/, "$1 $2");

/** An airport as a message names it: its city and its code, or the code alone. */
const placeOf = (code: string, city: string | null): string => (city?.trim() ? `${city.trim()} (${code})` : code);

/** A day of the calendar as people read it, from a local time. */
const dayOf = (local: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(local);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
};

/** Words in a list, as Portuguese says them: `a`, `a e b`, `a, b e c`. */
export function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** The trip: its flights, from where to where, through which connection, and its day. */
export function flightWords(legs: readonly AlertLeg[]): string {
  const ordered = [...legs].sort((a, b) => a.position - b.position);
  if (ordered.length === 0) return "";
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const flights = listOf(ordered.map((leg) => flightLabel(leg.flightNumber)));
  const stops = ordered.slice(0, -1).map((leg) => placeOf(leg.destination, leg.destinationCity));
  const through = stops.length > 0 ? `, com conexão em ${listOf(stops)}` : "";
  const day = dayOf(first.departure);
  return `${flights} de ${placeOf(first.origin, first.originCity)} para ${placeOf(last.destination, last.destinationCity)}${through}${day ? `, de ${day}` : ""}`;
}

/** How late, in hours and minutes. */
export function lateWords(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourWords = hours === 1 ? "1 hora" : `${hours} horas`;
  if (rest === 0) return hourWords;
  if (hours === 0) return `${rest} minutos`;
  return `${hourWords} e ${rest} minutos`;
}

/** What happened to the trip. */
export function whatWords(kind: FlightProblem["kind"], delayMinutes: number | null): string {
  if (kind === "cancelled") return "foi cancelado";
  if (kind === "changed") return "teve o voo ou o horário alterado pela companhia aérea";
  return `está previsto para chegar ao destino com ${lateWords(Math.max(delayMinutes ?? 0, 0))} de atraso`;
}

const OWED: Record<Exclude<Assistance, "rebooking_or_refund">, string> = {
  food: "alimentação",
  lodging: "hospedagem, se for preciso passar a noite, com o transporte até ela",
};

/** What the airline owes, by ANAC's rules: the choice first, then what the wait brings. */
export function assistanceWords(problem: FlightProblem): string {
  const owed = assistanceDue(problem);
  const choice = owed.includes("rebooking_or_refund")
    ? "oferecer outro voo, o reembolso ou outro meio de transporte"
    : "";
  const given = owed.filter(
    (item): item is Exclude<Assistance, "rebooking_or_refund"> => item !== "rebooking_or_refund",
  );
  const care = given.length > 0 ? `dar ${listOf(given.map((item) => OWED[item]))}` : "";
  if (choice && care) return `${choice}, e ${care}`;
  return choice || care || "informar o que aconteceu e o que vai fazer";
}

/** The five values of the template, in order. */
export function alertParams(facts: AlertFacts): string[] {
  const problem: FlightProblem = { kind: facts.kind, leg: 1, delayMinutes: facts.delayMinutes };
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  return [
    clean(firstNameOf(facts.passengerName) || facts.passengerName),
    clean(facts.firm),
    clean(flightWords(facts.legs)),
    clean(whatWords(facts.kind, facts.delayMinutes)),
    clean(assistanceWords(problem)),
  ];
}
