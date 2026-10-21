import "server-only";

import { cookies } from "next/headers";

import { COOKIE_KEYS } from "@/constants";
import type { UnsubscribeKind } from "@/lib/messages/format";
import { createServiceClient } from "@flyee/auth/service";

/**
 * Stopping a kind of e-mail from a link in the message itself, without a
 * session: the weekly summary of a member (`profiles.marketing_email_opt_out`)
 * or every message to a contact of the list (`leads.opted_out_at`).
 *
 * The address is `/api/public/email/unsubscribe?k=<m|l>&t=<token>`
 * (`unsubscribeUrl`, lib/messages/format.ts). A mail client POSTs to it and the
 * reader is off at once (RFC 8058). A person who follows it gets a page with
 * one button, because mail providers open every link they deliver to scan it,
 * and a GET that acted would unsubscribe people who never asked. On the way to
 * that page the token moves into a short-lived httpOnly cookie: the address of
 * a page is what analytics scripts and Referer headers carry.
 */

export type UnsubscribeTarget = { kind: UnsubscribeKind; token: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A Map, not an object: "constructor" in an address must not find Object's own members. */
const KIND_OF = new Map<string, UnsubscribeKind>([
  ["m", "member"],
  ["l", "lead"],
]);

/** What an unsubscribe address asks for, or null when it is not one. */
export function parseUnsubscribe(params: URLSearchParams): UnsubscribeTarget | null {
  const kind = KIND_OF.get(params.get("k") ?? "");
  const token = params.get("t") ?? "";
  return kind && UUID.test(token) ? { kind, token } : null;
}

/** The cookie that carries the request from the link to the page ("m:<token>"). */
export const encodeUnsubscribeCookie = (target: UnsubscribeTarget) =>
  `${target.kind === "member" ? "m" : "l"}:${target.token}`;

export function decodeUnsubscribeCookie(value: string | null | undefined): UnsubscribeTarget | null {
  const [key, token] = (value ?? "").split(":");
  const kind = KIND_OF.get(key ?? "");
  return kind && UUID.test(token ?? "") ? { kind, token: token as string } : null;
}

/** The request this browser carries from an unsubscribe link, or null. */
export async function readUnsubscribeTarget(): Promise<UnsubscribeTarget | null> {
  return decodeUnsubscribeCookie((await cookies()).get(COOKIE_KEYS.unsubscribe)?.value);
}

/**
 * Stops the messages. The database answers the same for a token it knows and
 * for one it does not, so nothing here tells a stranger which tokens exist.
 * False only when the request could not be carried out at all.
 */
export async function unsubscribe(target: UnsubscribeTarget): Promise<boolean> {
  try {
    const service = createServiceClient();
    const { error } =
      target.kind === "member"
        ? await service.rpc("unsubscribe_profile", { p_token: target.token })
        : await service.rpc("unsubscribe_lead", { target_token: target.token });
    return !error;
  } catch {
    return false;
  }
}
