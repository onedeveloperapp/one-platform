import "server-only";

import { DjenHttpClient } from "@flyee/courts/providers/djen";
import type { DjenClient } from "@flyee/courts/types";

/**
 * The DJEN (the national electronic gazette of the courts) as ONE reads it:
 * its public API, which asks for no key. Because it asks for none, whether
 * an environment reads it is a switch and not a credential:
 *
 *   production          reads it, unless `DJEN_CAPTURE=0`;
 *   anywhere else       reads it only with `DJEN_CAPTURE=1`.
 *
 * A development machine or a preview holds invented firms, and an invented
 * registration at the bar may be a real lawyer's number: it is not read for
 * by accident. The API counts calls per address and its reference calls the
 * use of several addresses to get around the limit abuse, so the platform
 * reads from the one place its jobs run, one registration at a time.
 */
export function isDjenCaptureOn(): boolean {
  const flag = (process.env.DJEN_CAPTURE ?? "").trim();
  if (flag === "0") return false;
  if (flag === "1") return true;
  return process.env.VERCEL_ENV === "production";
}

let cached: DjenClient | null = null;

/** The client of the public API, or null where the reading is off. */
export function djenClient(): DjenClient | null {
  if (!isDjenCaptureOn()) return null;
  cached ??= new DjenHttpClient({
    // By what was checked of the API this is never called: said aloud to who runs the platform when it is,
    // by the count alone.
    onFiltered: (communications) => console.warn("djen_not_addressed", { communications }),
  });
  return cached;
}
