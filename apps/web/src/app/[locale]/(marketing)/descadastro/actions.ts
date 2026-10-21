"use server";

import { cookies } from "next/headers";

import { COOKIE_KEYS } from "@/constants";
import { readUnsubscribeTarget, unsubscribe } from "@/lib/unsubscribe";

export type UnsubscribeStatus = "done" | "expired" | "unavailable";

/**
 * The unsubscribe link was followed AND the button on the page was pressed.
 * Acting on the link alone would let the scanners of mail providers, which
 * open every link they deliver, unsubscribe people who never asked.
 *
 * The token never reaches the browser's JavaScript: the link's route moved it
 * into an httpOnly cookie, read and spent here.
 */
export async function confirmUnsubscribe(): Promise<{ status: UnsubscribeStatus }> {
  const target = await readUnsubscribeTarget();
  if (!target) return { status: "expired" };
  if (!(await unsubscribe(target))) return { status: "unavailable" };
  (await cookies()).delete(COOKIE_KEYS.unsubscribe);
  return { status: "done" };
}
