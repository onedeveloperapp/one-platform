import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";

import { DEFAULTS } from "@/config";
import { COOKIE_KEYS } from "@/constants";
import { decodeAttribution } from "@/lib/attribution";
import { sendGa4Event } from "@/lib/ga4-mp";
import { sendMetaConversion } from "@/lib/meta-capi";
import { getGaClientId, getMetaClientContext } from "@/lib/meta-capi-context";
import { resolvePostAuthDestination } from "@/lib/onboarding";
import { sanitizeInternalNext } from "@/lib/safe-next";
import { isNewAccount, welcomeOnce } from "@/lib/welcome";
import { createClient } from "@flyee/auth/server";

/** A brand-new account confirms within minutes; a returning session (e.g. a
 * password recovery link) has an old created_at — so this window isolates
 * the sign-up conversion without firing on every callback. */
const NEW_ACCOUNT_WINDOW_MS = 10 * 60 * 1000;

/**
 * OAuth and email-link callback: exchanges the auth code for a session and
 * redirects. An account that belongs to no firm goes to found one or accept
 * an invitation; otherwise an explicit `next` (a page the person was bounced
 * from) wins, and without one the app root.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const requestedNext = searchParams.get("next");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (data.user) {
        // Meta CAPI — CompleteRegistration, once per brand-new account (dedup
        // by user id). Covers email-confirmation and first-time OAuth; the
        // created-at window skips returning sessions like password recovery.
        const createdAtMs = data.user.created_at ? new Date(data.user.created_at).getTime() : 0;
        if (createdAtMs && Date.now() - createdAtMs < NEW_ACCOUNT_WINDOW_MS) {
          const metaContext = await getMetaClientContext(`${origin}/auth/callback`);
          // The campaign that brought the person, straight from the first-touch
          // cookie: no firm exists yet at this point, and the sign-up is the
          // event a campaign is optimized against.
          const campaign = decodeAttribution((await cookies()).get(COOKIE_KEYS.attribution)?.value) ?? {};
          await sendMetaConversion({
            eventName: "CompleteRegistration",
            eventId: data.user.id,
            email: data.user.email,
            externalId: data.user.id,
            customData: campaign,
            ...metaContext,
          });
          // GA4 sign_up — stitched to the web session via the _ga client id.
          await sendGa4Event({
            clientId: await getGaClientId(),
            eventName: "sign_up",
            eventId: data.user.id,
            params: { method: "email" },
          });
        }
        // The welcome (bell and e-mail) of a new account, once: its own key
        // keeps a second link or another browser from repeating it. Sent after
        // the redirect is on its way, so nobody waits on it.
        if (isNewAccount(data.user.created_at)) {
          const newAccount = data.user.id;
          after(() => welcomeOnce(newAccount));
        }
        // Sign-up creates the account and nothing else (migration 0000): a new
        // account belongs to no firm until it founds one or accepts an
        // invitation. The campaign that brought a founder is attached to the
        // firm when it is founded (lib/firm/actions.ts), never here.
        const { data: membership } = await supabase
          .from("memberships")
          .select("org_id")
          .eq("user_id", data.user.id)
          .maybeSingle();
        if (!membership) {
          const safeNext = requestedNext ? sanitizeInternalNext(requestedNext) : null;
          // Somebody who came from an invitation link goes back to it: the page
          // shows the invitation and accepts it.
          if (safeNext?.startsWith("/convite/") || safeNext?.startsWith("/parceria/")) {
            return NextResponse.redirect(`${origin}${safeNext}`);
          }
          // Somebody of a partner of a firm (migration 0069) works in its area.
          const { data: partner } = await supabase
            .from("partner_members")
            .select("partner_id")
            .eq("user_id", data.user.id)
            .maybeSingle();
          if (partner) {
            return NextResponse.redirect(`${origin}${safeNext?.startsWith("/parceiro") ? safeNext : "/parceiro"}`);
          }
          const firmSetup = new URL("/auth/complete-profile", origin);
          if (safeNext) firmSetup.searchParams.set("next", safeNext);
          return NextResponse.redirect(firmSetup);
        }
        // The exact protected destination is kept once the person is in a firm;
        // before that it is carried through the firm setup.
        if (requestedNext) {
          return NextResponse.redirect(`${origin}${sanitizeInternalNext(requestedNext)}`);
        }
        const next = await resolvePostAuthDestination();
        return NextResponse.redirect(`${origin}${next}`);
      }
      return NextResponse.redirect(`${origin}${DEFAULTS.appRoot}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/sign-in?error=auth_callback_failed`);
}
