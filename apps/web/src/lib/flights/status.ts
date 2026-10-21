import "server-only";

import { FlightAwareProvider } from "@flyee/flights/providers/flightaware";
import type { FlightStatusProvider } from "@flyee/flights/types";

/**
 * What happened to a flight anywhere, from FlightAware's AeroAPI with the
 * platform's key (`FLIGHTAWARE_API_KEY`; never a firm's). Null when this
 * environment has no key: the case screen does not offer the lookup, and no
 * answer is ever invented in its place. Every answer is billed to the
 * platform: the database decides when a firm may ask (`begin_flight_lookup`).
 */
export function flightStatusProvider(): FlightStatusProvider | null {
  const key = process.env.FLIGHTAWARE_API_KEY?.trim();
  return key ? new FlightAwareProvider({ apiKey: key }) : null;
}
