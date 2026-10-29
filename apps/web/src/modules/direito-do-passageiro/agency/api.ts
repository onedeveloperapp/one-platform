import "server-only";

import { NextResponse } from "next/server";
import { createHash, randomBytes } from "node:crypto";

import { createServiceClient } from "@flyee/auth/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The agency's API (migration 0073): its booking system sends ONE the passengers and trips of the partnership,
 * issues a passenger's link and reads where a passenger stands, with a key of the partnership in the
 * `Authorization` header. The key is shown once when created and kept as its SHA-256 alone; every rule is the
 * database's (`pax_api_*`, which the service role alone calls, after this reads the key from the request).
 *
 * The body is JSON, in Portuguese, as the agency's system writes it; nothing of a passenger goes in the address.
 */

const KEY_PREFIX = "one_";

/** A new key: what the agency copies once, what the database keeps, and the start the screen shows. */
export function mintApiKey(): { key: string; hash: string; prefix: string } {
  const secret = randomBytes(24).toString("base64url");
  const key = `${KEY_PREFIX}${secret}`;
  return { key, hash: hashApiKey(key), prefix: secret.slice(0, 8) };
}

export const hashApiKey = (key: string): string => createHash("sha256").update(key, "utf8").digest("hex");

/** The key of a request (`Authorization: Bearer one_...`), or null. */
export function keyOf(request: Request): string | null {
  const match = /^Bearer\s+(one_[A-Za-z0-9_-]{20,100})$/.exec((request.headers.get("authorization") ?? "").trim());
  return match ? match[1] : null;
}

/** The largest body a call takes: two hundred lines of a spreadsheet are far less. */
const MOST_BYTES = 512 * 1024;

/** The body of a call as JSON, or null for one that is none or too large. */
export async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MOST_BYTES) return null;
  try {
    const text = await request.text();
    if (text.length > MOST_BYTES) return null;
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** The HTTP status of each refusal; anything else is the server's. */
const STATUS: Record<string, number> = {
  missing_key: 401,
  invalid_key: 401,
  partnership_ended: 403,
  rate_limited: 429,
  invalid_body: 400,
  invalid_rows: 400,
  unavailable: 503,
  traveler_not_found: 404,
  holder_is_minor: 409,
  handed_over: 409,
  no_consent_term: 409,
};

/** A refusal, as the agency's system reads it: `{ ok: false, erro }` with its status. */
export function refused(code: string): NextResponse {
  return NextResponse.json({ ok: false, erro: code }, { status: STATUS[code] ?? 500, headers: NO_STORE });
}

export function answered(body: Record<string, unknown>): NextResponse {
  return NextResponse.json({ ok: true, ...body }, { headers: NO_STORE });
}

const NO_STORE = { "Cache-Control": "no-store" };

/** The backend, or null where this environment has no service key. */
export function backendOrNull(): SupabaseClient | null {
  try {
    return createServiceClient();
  } catch {
    return null;
  }
}

/** A CPF as the body gives it: digits, or null for none. */
export const cpfOf = (value: unknown): string | null => {
  const digits = typeof value === "string" ? value.replace(/\D/g, "") : "";
  return digits.length === 11 ? digits : null;
};
