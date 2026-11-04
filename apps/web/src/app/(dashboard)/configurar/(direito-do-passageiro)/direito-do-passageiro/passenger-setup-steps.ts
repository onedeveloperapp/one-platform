/**
 * The steps of the passenger module's setup, by the names its address takes (`?passo=`). Plain, with no
 * "use client": the server page reads the step asked for, and a value exported by a client module is only a
 * client reference on the server, so calling one there throws (seen in production on 2026-11-04, where the page
 * imported this guard from its view and every visit answered the error boundary).
 */
export const PASSENGER_SETUP_STEPS = ["seguranca", "valores", "clausula", "agencia"] as const;
export type PassengerSetupStep = (typeof PASSENGER_SETUP_STEPS)[number];

export const isPassengerSetupStep = (value: unknown): value is PassengerSetupStep =>
  typeof value === "string" && (PASSENGER_SETUP_STEPS as readonly string[]).includes(value);
