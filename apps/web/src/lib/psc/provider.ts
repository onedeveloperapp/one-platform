import "server-only";

import { createHash } from "node:crypto";

import { BRAND } from "@flyee/content";
import { FakePsc } from "@flyee/psc/fake";
import { ItiPscProvider } from "@flyee/psc/providers/iti";
import type { PscProvider } from "@flyee/psc/types";

/**
 * Who speaks for the lawyers' certificates in the cloud. Each PSC of the
 * platform's list (`psc_providers`, migration 0041) once the platform's own
 * client is registered at it, in the server's environment
 * (`PSC_<SLUG>_CLIENT_ID` and `PSC_<SLUG>_CLIENT_SECRET`, the slug in
 * capitals); on a development machine or a preview with `PSC_FAKE=1`, a PSC
 * in memory stands where every PSC of the list stands (as the simulator
 * stands where Meta does), consents at once and signs with an invented
 * certificate, never in production. A PSC with no client is not offered.
 */

/** A row of `psc_providers`, as the screens and the backend read it. */
export type PscRow = {
  slug: string;
  name: string;
  base_url: string;
  hash_encoding: string;
  token_body: string;
  max_hashes: number;
  confirmed_at: string | null;
};

export const PSC_COLUMNS = "slug, name, base_url, hash_encoding, token_body, max_hashes, confirmed_at";

/**
 * A PSC as ONE talks to it: its client, the platform's credentials there,
 * how many hashes a call takes, and `origin`, where a token is sent: a
 * lawyer's token is sealed with the origin it was issued at and is never sent
 * to another one (a PSC whose address moved, the fake turned off).
 */
export type PscClient = {
  provider: PscProvider;
  clientId: string;
  clientSecret: string;
  maxHashes: number;
  origin: string;
};

export const isPscFakeOn = (): boolean => process.env.PSC_FAKE === "1" && process.env.VERCEL_ENV !== "production";

/**
 * The fake kept for the process, on the global object so that every bundle
 * of the server shares it. It is lenient: on a preview the action that
 * starts an authorization and the page the PSC sends the lawyer back to may
 * run in different instances, each with its own memory.
 */
const shared = globalThis as typeof globalThis & { __onePscFake?: Promise<FakePsc> };

const credentialsOf = (slug: string): { clientId: string; clientSecret: string } | null => {
  const key = slug.toUpperCase();
  const clientId = process.env[`PSC_${key}_CLIENT_ID`];
  const clientSecret = process.env[`PSC_${key}_CLIENT_SECRET`];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
};

/** Whether ONE can ask this PSC anything here: the fake is on, or the platform's client is configured. */
export const pscAvailable = (slug: string): boolean => isPscFakeOn() || credentialsOf(slug) !== null;

/** The client of a PSC of the list, or null when the platform has no client there. */
export async function pscClientFor(row: PscRow): Promise<PscClient | null> {
  if (isPscFakeOn()) {
    // What every instance of a deployment shares seals what the fake carries, so no one else mints its codes.
    const secret = createHash("sha256")
      .update(`one-psc-fake:${process.env.VAULT_KEYS ?? ""}`)
      .digest("base64url");
    shared.__onePscFake ??= FakePsc.create({ name: "fake", consentAtOnce: true, lenient: true, secret });
    return {
      provider: await shared.__onePscFake,
      clientId: "one-fake",
      clientSecret: "fake",
      maxHashes: 5,
      origin: "fake",
    };
  }
  const credentials = credentialsOf(row.slug);
  if (!credentials) return null;
  return {
    provider: new ItiPscProvider({
      name: row.slug,
      baseUrl: row.base_url,
      hashEncoding: row.hash_encoding === "hex" ? "hex" : "base64",
      tokenBody: row.token_body === "json" ? "json" : "form",
    }),
    ...credentials,
    maxHashes: Math.max(1, Math.floor(row.max_hashes)),
    origin: row.base_url,
  };
}

/** Where the PSC sends the lawyer back after they authorized ONE: the address the platform registered at each PSC. */
export const pscRedirectUri = (): string => `${BRAND.siteUrl.replace(/\/+$/, "")}/api/connections/psc/callback`;

/** The cookie that ties the PSC's answer to the lawyer, the connection and the verifier of their own start. */
export const PSC_STATE_COOKIE = "one-psc-state";
export const PSC_COOKIE_PATH = "/api/connections/psc";
