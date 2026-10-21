import "server-only";

import { cookies } from "next/headers";

import { COOKIE_KEYS } from "@/constants";

const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

/**
 * The waitlist confirmation token this browser holds, or null. The middleware
 * moved it from the e-mail link into an httpOnly cookie; it is read only on the
 * server (the page asks whether it exists, the confirm action spends it).
 */
export async function readConfirmationToken(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE_KEYS.leadConfirm)?.value ?? "";
  return TOKEN.test(value) ? value : null;
}
