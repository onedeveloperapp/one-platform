"use server";

import { headers } from "next/headers";
import { createHash } from "node:crypto";

import { type InvitationNext, invitationOfNext, nameMeetsRules, passwordMeetsRules } from "@/lib/auth/sign-up-rules";
import { sanitizeInternalNext } from "@/lib/safe-next";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";
import { BRAND } from "@flyee/content";

/**
 * Signing up from an invitation with the address it was sent to, which the person never types (the owner,
 * 2026-11-03: an agency retyped the e-mail the firm had invited it at). The page behind an invitation's link is
 * public by its token and shows the address masked (`firm_invitation_preview`, `partner_invitation_preview`), and
 * so does the sign-up: the whole address is read here, on the server, from the open invitation the token names,
 * and goes to the provider of the accounts, never to the browser. The account is still confirmed by a link sent
 * to that address, as any sign-up is: a link copied into a chat proves no inbox, and accepting asks a confirmed
 * e-mail (0003, 0069).
 */

export type InvitationHint = { ok: true; hint: string } | { ok: false };

export type InvitationSignUpResult =
  | { ok: true; session: boolean }
  | { ok: false; code: "invalid" | "closed" | "registered" | "failed" };

type Preview = { found?: boolean; status?: string; email_hint?: string };

/** The invited address, masked as the invitation's page shows it, while the invitation is open. */
export async function invitationSignUpHint(next: string): Promise<InvitationHint> {
  const invitation = invitationOfNext(next);
  if (!invitation || !isSupabaseConfigured) return { ok: false };
  const supabase = await createClient();
  const { data, error } =
    invitation.kind === "firm"
      ? await supabase.rpc("firm_invitation_preview", { target_token: invitation.token })
      : await supabase.rpc("partner_invitation_preview", { target_token: invitation.token });
  const preview = (data ?? {}) as Preview;
  if (error || !preview.found || preview.status !== "open" || !preview.email_hint) return { ok: false };
  return { ok: true, hint: preview.email_hint };
}

/** Creates the account at the invited address, with the name and the password typed. */
export async function signUpByInvitation(input: {
  next: string;
  name: string;
  password: string;
  locale: string;
}): Promise<InvitationSignUpResult> {
  const invitation = invitationOfNext(input.next);
  if (!invitation || !nameMeetsRules(input.name) || !passwordMeetsRules(input.password)) {
    return { ok: false, code: "invalid" };
  }
  if (!isSupabaseConfigured) return { ok: false, code: "failed" };
  const email = await invitedAddress(invitation);
  if (!email) return { ok: false, code: "closed" };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: {
      emailRedirectTo: await callbackUrl(input.next),
      data: { display_name: input.name.trim(), locale: input.locale },
    },
  });
  if (error) return { ok: false, code: error.code === "user_already_exists" ? "registered" : "failed" };
  // An address that has an account already comes back as a new one with no identity: the provider does not say
  // who exists. The person signs in instead.
  if (data.user && (data.user.identities?.length ?? 0) === 0) return { ok: false, code: "registered" };
  return { ok: true, session: Boolean(data.session) };
}

/** Sends again the link that confirms an account made from an invitation, to the invited address. */
export async function resendInvitationConfirmation(next: string): Promise<{ ok: boolean }> {
  const invitation = invitationOfNext(next);
  if (!invitation || !isSupabaseConfigured) return { ok: false };
  const email = await invitedAddress(invitation);
  if (!email) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: await callbackUrl(next) },
  });
  return { ok: !error };
}

/** The address of the open invitation a token names, read past RLS (nobody is signed in yet), or null. */
async function invitedAddress(invitation: InvitationNext): Promise<string | null> {
  const service = createServiceClient();
  const hash = createHash("sha256").update(invitation.token, "utf8").digest("hex");
  const { data, error } =
    invitation.kind === "firm"
      ? await service
          .from("firm_invitations")
          .select("email, expires_at, accepted_at, revoked_at")
          .eq("token_hash", hash)
          .maybeSingle()
      : await service
          .from("partner_invitations")
          .select("email, expires_at, accepted_at, revoked_at")
          .eq("token_hash", hash)
          .maybeSingle();
  if (error || !data) return null;
  if (data.accepted_at || data.revoked_at) return null;
  if (typeof data.expires_at !== "string" || new Date(data.expires_at).getTime() <= Date.now()) return null;
  return typeof data.email === "string" ? data.email : null;
}

/**
 * Where the confirmation's link lands: the callback of the address the person is on (the browser's own origin,
 * as the sign-up in the browser used), back to the invitation. The provider only takes addresses it allows.
 */
async function callbackUrl(next: string): Promise<string> {
  const list = await headers();
  const origin = list.get("origin");
  const host = list.get("x-forwarded-host") ?? list.get("host");
  const base =
    origin && /^https?:\/\/[^/\s]+$/.test(origin)
      ? origin
      : host
        ? `${list.get("x-forwarded-proto") ?? "https"}://${host}`
        : BRAND.siteUrl;
  const callback = new URL("/auth/callback", base);
  callback.searchParams.set("next", sanitizeInternalNext(next));
  return callback.toString();
}
