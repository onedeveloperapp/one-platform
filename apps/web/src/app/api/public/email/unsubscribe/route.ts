import { NextResponse } from "next/server";

import { COOKIE_KEYS } from "@/constants";
import { localizeHref, routing } from "@/i18n/routing";
import { encodeUnsubscribeCookie, parseUnsubscribe, unsubscribe } from "@/lib/unsubscribe";

/**
 * The address behind every unsubscribe link and List-Unsubscribe header
 * (lib/unsubscribe.ts). Public: the reader may have no account, or be signed
 * out, and the token in the address is the only credential.
 */

/**
 * One-click unsubscribe (RFC 8058): the mail client posts here when the reader
 * presses its own "unsubscribe" button. No page, no cookie, no confirmation:
 * the header promised one click.
 */
export async function POST(request: Request) {
  const target = parseUnsubscribe(new URL(request.url).searchParams);
  if (!target) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const done = await unsubscribe(target);
  return done
    ? NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
}

/**
 * The link in the body, followed by a person (or opened by a mail scanner):
 * it changes nothing. The request moves into a short-lived httpOnly cookie
 * and the browser lands on the page that asks before acting, at an address
 * that carries no token.
 *
 * The redirect is RELATIVE on purpose. A route handler's `request.url` names
 * the host the server believes it runs on, which is not always the host the
 * browser asked (a proxy, `next start` reached by IP): an absolute address
 * built from it would send the browser to another host, where the cookie set
 * here does not exist and the page would say the link expired.
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const target = parseUnsubscribe(url.searchParams);
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: localizeHref("/descadastro", routing.defaultLocale), "Cache-Control": "no-store" },
  });
  if (target) {
    const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
    response.cookies.set(COOKIE_KEYS.unsubscribe, encodeUnsubscribeCookie(target), {
      path: "/",
      maxAge: 15 * 60,
      sameSite: "lax",
      httpOnly: true,
      secure: protocol === "https",
    });
  } else {
    // A malformed link must not leave an earlier request armed on the page.
    response.cookies.delete(COOKIE_KEYS.unsubscribe);
  }
  return response;
}
