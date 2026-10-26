import { createClient } from "@flyee/auth/client";

/**
 * The second factor of the person signed in, from the browser: set up, then
 * confirmed with a code of the authenticator app. Shared by the security card,
 * where a factor is kept, and by the prompt that sets one up where an action
 * asks for it (`components/product/second-factor-prompt.tsx`), so the two
 * never differ. A confirmed code raises the session to the second level at
 * once: the cookies carry it, and the server reads it on its next request.
 */

/** A factor being set up: the code the app reads, its key written out, and the factor to confirm. */
export type TotpEnrollment = { factorId: string; qrCode: string; secret: string };

/** Supabase returns the QR as an SVG string or a data URL depending on version. */
export const qrSrc = (qr: string) =>
  qr.startsWith("data:") ? qr : `data:image/svg+xml;utf8,${encodeURIComponent(qr)}`;

/**
 * Starts setting up the authenticator. A factor nobody confirmed (a setup left
 * half way, in this tab or another) is taken off first: the auth server keeps
 * one name per account, and would refuse the new one. Null when it could not.
 */
export async function startTotpEnrollment(friendlyName: string): Promise<TotpEnrollment | null> {
  const supabase = createClient();
  const { data: listed } = await supabase.auth.mfa.listFactors();
  for (const factor of listed?.all ?? []) {
    if (factor.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName });
  if (error || !data) return null;
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/**
 * Confirms a factor with a code of the app: `ok`, `code` when the code was not
 * taken, `failed` when nothing could be asked.
 */
export async function confirmTotp(factorId: string, code: string): Promise<"ok" | "code" | "failed"> {
  const supabase = createClient();
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
  if (challengeError || !challenge) return "failed";
  const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.trim() });
  return error ? "code" : "ok";
}

/** The factor the account already confirmed, which a session confirms again with a code; null when it has none. */
export async function verifiedTotp(): Promise<string | null> {
  const supabase = createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  return data?.totp?.find((factor) => factor.status === "verified")?.id ?? null;
}

/** Takes off a factor nobody confirmed: a setup given up. */
export async function dropTotp(factorId: string): Promise<void> {
  const supabase = createClient();
  await supabase.auth.mfa.unenroll({ factorId });
}
