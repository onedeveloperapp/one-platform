"use server";

import { emailEnv, isEmailConfigured } from "@flyee/email";

/**
 * Whether ONE can send an e-mail where it runs to anybody: the provider's key (`RESEND_API_KEY`) and a sender of
 * a domain verified at it (`EMAIL_FROM`). Without the sender, `packages/email` sends as the provider's test address
 * (`onboarding@resend.dev`), which delivers only to the provider account's own e-mail, so an invitation to anybody
 * else would never leave (2026-11-03: the key was set and every invitation came back "not sent"). An invitation
 * offers its e-mail only then, and its link always, so nobody types an address to learn afterwards that nothing
 * left. Says nothing of the key or the sender themselves.
 */
export async function emailReady(): Promise<boolean> {
  const sender = emailEnv("EMAIL_FROM");
  return isEmailConfigured && Boolean(sender) && !/@resend\.dev\b/i.test(sender ?? "");
}
