import type { PrefillLeg } from "@/lib/cases/document-prefill";

/**
 * The firm's own passengers (migration 0170), as pure rules: the ways a passenger's agreement is recorded, a leg as
 * the form holds it and as the database takes it, and the words of a refusal.
 */

export const AGREEMENT_HOWS = ["whatsapp", "telefone", "presencial", "email", "contrato"] as const;
export type AgreementHow = (typeof AGREEMENT_HOWS)[number];

export const AGREEMENT_HOW_KEY: Record<AgreementHow, string> = {
  whatsapp: "passenger-how-whatsapp",
  telefone: "passenger-how-phone",
  presencial: "passenger-how-in-person",
  email: "passenger-how-email",
  contrato: "passenger-how-contract",
};

/** A leg as the database takes it (`firm_follow_trip`). */
export type PassengerLeg = {
  flight_number: string;
  origin_iata: string;
  destination_iata: string;
  /** Local time of the airport, `YYYY-MM-DDTHH:MM`. */
  scheduled_departure_local: string;
  scheduled_arrival_local: string;
};

export const emptyLeg = (): PassengerLeg => ({
  flight_number: "",
  origin_iata: "",
  destination_iata: "",
  scheduled_departure_local: "",
  scheduled_arrival_local: "",
});

const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** A leg ONE read of a ticket, as the form holds it. */
export const legOfReading = (leg: PrefillLeg): PassengerLeg => ({
  flight_number: leg.flight_number,
  origin_iata: leg.origin_iata,
  destination_iata: leg.destination_iata,
  scheduled_departure_local: MOMENT.test(leg.scheduled_departure_local) ? leg.scheduled_departure_local : "",
  scheduled_arrival_local: MOMENT.test(leg.scheduled_arrival_local) ? leg.scheduled_arrival_local : "",
});

/** A leg as the form sends it: the flight without spaces, the airports in capitals; null for one left blank. */
export function legToSend(leg: PassengerLeg): PassengerLeg | null {
  const flight = leg.flight_number.replace(/\s+/g, "").toUpperCase();
  const origin = leg.origin_iata.trim().toUpperCase();
  const destination = leg.destination_iata.trim().toUpperCase();
  if (!flight && !origin && !destination && !leg.scheduled_departure_local && !leg.scheduled_arrival_local) return null;
  return {
    flight_number: flight,
    origin_iata: origin,
    destination_iata: destination,
    scheduled_departure_local: leg.scheduled_departure_local,
    scheduled_arrival_local: leg.scheduled_arrival_local,
  };
}

/** Whether a leg is whole enough to send. */
export const legReady = (leg: PassengerLeg): boolean =>
  /^[A-Z0-9]{2}[0-9]{1,4}[A-Z]?$/.test(leg.flight_number.replace(/\s+/g, "").toUpperCase()) &&
  /^[A-Za-z]{3}$/.test(leg.origin_iata.trim()) &&
  /^[A-Za-z]{3}$/.test(leg.destination_iata.trim()) &&
  MOMENT.test(leg.scheduled_departure_local) &&
  MOMENT.test(leg.scheduled_arrival_local) &&
  leg.scheduled_arrival_local > leg.scheduled_departure_local;

const ERROR_KEY: Record<string, string> = {
  no_phone: "passenger-error-no-phone",
  opted_out: "passenger-error-opted-out",
  trip_past: "passenger-error-trip-past",
  not_found: "passenger-error-not-found",
  not_allowed_in_support_session: "passenger-error-support",
};

/** What a refusal of registering or following is called on the screen. */
export function passengerErrorKey(code: string, field?: string | null): string {
  if (code === "invalid_data" && field === "legs") return "passenger-error-legs";
  if (code === "invalid_data" && field === "full_name") return "passenger-error-name";
  if (code === "invalid_data" && field === "how") return "passenger-error-how";
  if (code === "invalid_data") return "passenger-error-data";
  return ERROR_KEY[code] ?? "passenger-error-failed";
}

/** Where a followed trip stands, in a word. */
export const TRIP_STATUS_KEY: Record<string, string> = {
  watching: "passenger-trip-watching",
  alerted: "passenger-trip-alerted",
  case_opened: "passenger-trip-case",
  declined: "passenger-trip-declined",
  stopped: "passenger-trip-stopped",
};

/** A leg's local moment as the screens write it: "12/11/2026 08:00"; what is not a moment, as it came. */
export function legWhen(moment: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(moment);
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : moment;
}

/** The tone of a followed trip's state. */
export const TRIP_STATUS_TONE: Record<string, "info" | "attention" | "positive" | "neutral"> = {
  watching: "info",
  alerted: "attention",
  case_opened: "positive",
  declined: "neutral",
  stopped: "neutral",
};

/** Whether the firm may still stop following a trip. */
export const tripStoppable = (status: string): boolean => status === "watching" || status === "alerted";
