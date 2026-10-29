import "server-only";

import { RedemetProvider } from "@flyee/flights/providers/redemet";
import type { WeatherProvider } from "@flyee/flights/types";

/**
 * The weather reports of Brazilian airports, from REDEMET with the platform's
 * key (`REDEMET_API_KEY`, registered at api-redemet.decea.mil.br; never a
 * firm's). Null when this environment has no key: the screen says so, and no
 * report is ever invented in its place.
 */
export function weatherProvider(): WeatherProvider | null {
  const key = process.env.REDEMET_API_KEY?.trim();
  return key ? new RedemetProvider({ apiKey: key }) : null;
}
