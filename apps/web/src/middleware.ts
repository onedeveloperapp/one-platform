import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";

import { DEFAULTS } from "@/config";
import { COOKIE_KEYS, REQUEST_PATH_HEADER } from "@/constants";
import { matchPublicPath, routing } from "@/i18n/routing";
import { ATTRIBUTION_COOKIE_MAX_AGE, encodeAttribution, readAttributionFromUrl } from "@/lib/attribution";
import { CURRENCY_COOKIE_MAX_AGE, CURRENCY_PARAM, normalizeCurrency } from "@/lib/billing-currency";
import { encodeCampaignCookie, hasCampaign, LAST_CAMPAIGN_MAX_AGE, pickCampaignParams } from "@/lib/campaign-params";
import { COUPON_COOKIE_MAX_AGE, COUPON_PARAM, normalizeCouponCode } from "@/lib/offer-link";
import { sanitizeInternalNext } from "@/lib/safe-next";
import { IMPERSONATION_MARKER_COOKIE, parseImpersonationMarker } from "@flyee/auth";
import { updateSession } from "@flyee/auth/middleware";

/**
 * Routing of the public site: maps `/contato` to the internal
 * `/pt-BR/contato` (the `[locale]` segment) and redirects the non-canonical
 * `/pt-BR/contato` to `/contato`. It runs ONLY for public pages: the logged
 * area, sign-in and checkout have no locale in the URL.
 */
const handleI18nRouting = createIntlMiddleware(routing);

// Non-page prefixes reachable without a session. Everything else requires a
// session: without Supabase configured nobody has one, so the public site
// stays readable and the logged area redirects to sign-in. Public PAGES are
// not listed here: they are the pathnames declared in src/i18n/routing.ts.
const PUBLIC_PREFIXES = [
  "/auth",
  // Leaving a support impersonation only DELETES session cookies, so it must
  // work even when the session it is ending is already gone — otherwise the
  // way out redirects to sign-in and the operator is stuck.
  "/api/impersonation/exit",
  // Provider callbacks that authenticate THEMSELVES (Asaas token / Stripe
  // signature / Inngest signing key), so they must NOT hit the auth redirect.
  "/api/webhooks",
  "/api/inngest",
  // An invitation to a firm is opened from an e-mail, before the person signs
  // in or even has an account: the page shows who invites and sends them on.
  "/convite/",
  // An invitation to a partner of a firm (a travel agency, or a colleague of
  // it): the same, before anybody signs in.
  "/parceria/",
  // Anyone holding a document a firm issued checks its code here, with no
  // account: the page shows who issued it and nothing of its content.
  "/verificar",
  // A client's link: a passenger has no account, the token in the path is
  // their way in (lib/cases/client-link.ts).
  "/c/",
  // A firm's test chat: whoever tests has no account, the token in the path is
  // the way in (lib/test-chat/actions.ts).
  "/t/",
  // Endpoints a person reaches from an e-mail, with no account or signed out:
  // each carries its own token (the unsubscribe link, lib/unsubscribe.ts). The
  // trailing slash is part of the rule: `/api/publicity` is not this folder.
  "/api/public/",
  // SEO surfaces crawlers hit anonymously.
  "/sitemap.xml",
  "/robots.txt",
  "/opengraph-image",
];

const isPublic = (pathname: string) =>
  matchPublicPath(pathname) !== null || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

/** Where a support impersonation ends (also the operator's way back). */
const IMPERSONATION_EXIT = "/api/impersonation/exit";

/**
 * Surfaces a support session must not reach (support visits read everything
 * and write only settings and billing).
 *
 * The database is what actually refuses member writes — they leave the browser
 * straight for PostgREST and never pass through this middleware. What this
 * list adds is the two things Postgres cannot see, credentials and platform
 * admin, plus anything that mints credentials.
 */
const IMPERSONATION_BLOCKED_PREFIXES = [
  // Credential takeover: password, email and 2FA changes go to GoTrue, not to
  // Postgres, so no trigger can fence them.
  "/settings/security",
  // Platform administration is the operator's own account's business.
  "/admin",
];

/** API routes whose non-GET methods write member work (none today: member writes go to PostgREST). */
const IMPERSONATION_READONLY_API: string[] = [];

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const requestedPath = `${pathname}${search}`;
  const publicPage = matchPublicPath(pathname);

  // The path, for the server layouts that gate the logged area. Always
  // overwritten here, so whatever a browser sent under this name is discarded.
  request.headers.set(REQUEST_PATH_HEADER, pathname);

  // The waitlist confirmation link carries a one-time token. Analytics scripts
  // send the page URL to third parties and links send it as Referer, so the
  // token moves into a short-lived httpOnly cookie and the page loads at the
  // clean address; the confirm action reads it from there.
  const confirmToken = request.nextUrl.searchParams.get("t");
  if (publicPage?.internal === "/espera/confirmar" && confirmToken) {
    const clean = request.nextUrl.clone();
    clean.searchParams.delete("t");
    const redirect = NextResponse.redirect(clean);
    redirect.cookies.set(COOKIE_KEYS.leadConfirm, confirmToken.slice(0, 128), {
      path: "/",
      maxAge: 15 * 60,
      sameSite: "lax",
      httpOnly: true,
      secure: request.nextUrl.protocol === "https:",
    });
    return redirect;
  }

  const { response: sessionResponse, user, needsMfa, impersonating } = await updateSession(request);

  /**
   * A campaign code (`?cupom=`) must reach the checkout, and between the click
   * and the checkout sit a sign-up, an e-mail confirmation and redirects that
   * all drop the query string. Capturing it here — before any of them — is the
   * only place that sees the original link on EVERY route.
   *
   * The newest link wins over an older stored code: typing a code in a URL is a
   * deliberate act, not passive attribution, and the last campaign she followed
   * is the offer she believes she is getting.
   */
  const linkCoupon = normalizeCouponCode(request.nextUrl.searchParams.get(COUPON_PARAM));

  /**
   * A link that names the currency (`?moeda=USD`): a campaign for one market,
   * or the currency switch of the pricing page. Like the coupon it has to
   * survive the sign-up on the way to the checkout, so it is kept here.
   */
  const linkCurrency = normalizeCurrency(request.nextUrl.searchParams.get(CURRENCY_PARAM));

  /**
   * Campaign attribution (?origem/?onda/utm_*), captured on the FIRST touch and
   * never overwritten: the campaign that brought her earned the signup, and a
   * later visit through a bookmark must not take the credit. Persisted to the
   * workspace once the account exists (lib/signup-attribution.ts).
   */
  const linkAttribution = request.cookies.has(COOKIE_KEYS.attribution)
    ? null
    : readAttributionFromUrl(request.nextUrl, request.headers.get("referer"));

  /**
   * The LAST-touch campaign, the opposite rule: rewritten by every link that
   * carries one, because it credits the SALE, not the signup. The checkout
   * reads it when its own link has no campaign: a campaign link crosses a
   * sign-up and the billing page, which drop the query string
   * (lib/campaign-params.ts).
   */
  const linkCampaign = pickCampaignParams(Object.fromEntries(request.nextUrl.searchParams));

  // A page whose path carries a token keeps no visit cookie: a campaign
  // parameter on it would store the path, token included, as the landing page.
  const tokenInPath =
    pathname.startsWith("/c/") ||
    pathname.startsWith("/t/") ||
    pathname.startsWith("/convite/") ||
    pathname.startsWith("/parceria/");

  const withVisitCookies = <T extends NextResponse>(res: T): T => {
    if (tokenInPath) return res;
    if (linkCoupon) {
      res.cookies.set(COOKIE_KEYS.offerCoupon, linkCoupon, {
        path: "/",
        maxAge: COUPON_COOKIE_MAX_AGE,
        sameSite: "lax",
        // Read by the billing page to confirm the code visually. A coupon code
        // is public by nature — it is printed in the campaign itself.
        httpOnly: false,
      });
    }
    if (linkCurrency) {
      res.cookies.set(COOKIE_KEYS.currency, linkCurrency, {
        path: "/",
        maxAge: CURRENCY_COOKIE_MAX_AGE,
        sameSite: "lax",
        httpOnly: false,
      });
    }
    if (linkAttribution) {
      res.cookies.set(COOKIE_KEYS.attribution, encodeAttribution(linkAttribution), {
        path: "/",
        maxAge: ATTRIBUTION_COOKIE_MAX_AGE,
        sameSite: "lax",
        httpOnly: true,
      });
    }
    if (hasCampaign(linkCampaign)) {
      res.cookies.set(COOKIE_KEYS.lastCampaign, encodeCampaignCookie(linkCampaign), {
        path: "/",
        maxAge: LAST_CAMPAIGN_MAX_AGE,
        sameSite: "lax",
        httpOnly: true,
      });
    }
    return res;
  };

  if (impersonating && pathname !== IMPERSONATION_EXIT) {
    const marker = parseImpersonationMarker(request.cookies.get(IMPERSONATION_MARKER_COOKIE)?.value);

    // The support session died (revoked, or its refresh token expired). Drop
    // the parallel cookies so the very next request reads the operator's own
    // session again — being impersonated must never strand anyone signed out.
    if (!user || !marker) {
      const back = NextResponse.redirect(new URL(IMPERSONATION_EXIT, request.url));
      back.cookies.delete(IMPERSONATION_MARKER_COOKIE);
      return back;
    }

    // A support access is a visit, not a tenancy.
    if (marker.expiresAt <= Date.now()) {
      return NextResponse.redirect(new URL(`${IMPERSONATION_EXIT}?reason=expired`, request.url));
    }

    if (IMPERSONATION_BLOCKED_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
      return NextResponse.redirect(new URL(DEFAULTS.appRoot, request.url));
    }

    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      IMPERSONATION_READONLY_API.some((prefix) => pathname.startsWith(prefix))
    ) {
      return NextResponse.json(
        {
          error: "impersonation_read_only",
          message: "Support sessions cannot write member data. Leave the session to act as yourself.",
        },
        { status: 403 },
      );
    }
  }

  if (publicPage) {
    // A public page never needs a session: next-intl maps the address to its
    // internal route, or redirects a non-canonical one. Its response must
    // carry the session cookies the refresh above may have rotated; the
    // refreshed REQUEST cookies are already in, because next-intl copies the
    // request headers after updateSession rewrote them.
    const intlResponse = handleI18nRouting(request);
    for (const cookie of sessionResponse.cookies.getAll()) intlResponse.cookies.set(cookie);

    return withVisitCookies(intlResponse);
  }

  // Users with a verified TOTP factor must complete the challenge before
  // reaching anything protected (their session is still AAL1).
  if (user && needsMfa && !isPublic(pathname)) {
    const twoFactor = new URL("/auth/two-factor", request.url);
    twoFactor.searchParams.set("next", sanitizeInternalNext(requestedPath));
    return withVisitCookies(NextResponse.redirect(twoFactor));
  }

  // Signed-in users don't need the sign-in/sign-up screens.
  if (user && !needsMfa && (pathname.startsWith("/auth/sign-in") || pathname.startsWith("/auth/sign-up"))) {
    const destination = sanitizeInternalNext(request.nextUrl.searchParams.get("next"), DEFAULTS.appRoot);
    return withVisitCookies(NextResponse.redirect(new URL(destination, request.url)));
  }

  if (!user && !isPublic(pathname)) {
    const signIn = new URL("/auth/sign-in", request.url);
    signIn.searchParams.set("next", sanitizeInternalNext(requestedPath));
    return withVisitCookies(NextResponse.redirect(signIn));
  }

  return withVisitCookies(sessionResponse);
}

export const config = {
  matcher: [
    // Skip static assets and image optimization; run everywhere else.
    // `videos` belongs here for the same reason `images` does: a file under
    // `public/` has no session to refresh, and without it every <video> on a
    // public page answered a 307 to /auth/sign-in.
    "/((?!_next/static|_next/image|favicon|images|videos|initial-loader|assets|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
  ],
};
