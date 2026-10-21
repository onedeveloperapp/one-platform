import { cache } from "react";

import { createAnonClient } from "@/lib/public-content";

/**
 * What the public site offers (platform_settings `launch`, migration 0019,
 * flipped by the superadmin at /admin/support).
 *
 * - `waitlist`: nothing is on sale yet, so every primary call to action leads
 *   to the waitlist. Sign-in and sign-up stay reachable, only unadvertised.
 * - `open`: the same buttons lead to sign-up and checkout.
 *
 * Anything unreadable (no Supabase, an error, a malformed value) reads as
 * `waitlist`: sending a visitor to a checkout that may not exist is the worse
 * mistake of the two.
 */
export type LaunchStage = "waitlist" | "open";

export const getLaunchStage = cache(async (): Promise<LaunchStage> => {
  const supabase = createAnonClient();
  if (!supabase) return "waitlist";
  const { data, error } = await supabase.from("platform_settings").select("value").eq("key", "launch").maybeSingle();
  if (error) return "waitlist";
  return (data?.value as { stage?: unknown } | null)?.stage === "open" ? "open" : "waitlist";
});

/** The page's primary action in a stage: the label key (marketing namespace) and where it leads. */
export type PrimaryCta = { labelKey: "cta-primary" | "cta-waitlist"; href: string };

export const primaryCtaFor = (stage: LaunchStage): PrimaryCta =>
  stage === "open" ? { labelKey: "cta-primary", href: "/auth/sign-up" } : { labelKey: "cta-waitlist", href: "/espera" };

/** The header's button in a stage: the same action as the page's primary one. */
export type NavCta = PrimaryCta;

export const navCtaFor = (stage: LaunchStage): NavCta => primaryCtaFor(stage);
