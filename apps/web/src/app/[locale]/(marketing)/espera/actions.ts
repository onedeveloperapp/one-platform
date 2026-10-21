"use server";

import { readConfirmationToken } from "./confirmation-token";
import { cookies, headers } from "next/headers";
import { createHash, createHmac, randomBytes } from "node:crypto";

import { COOKIE_KEYS } from "@/constants";
import { isPublicLocale, localizeHref, type PublicLocale, routing } from "@/i18n/routing";
import { decodeAttribution } from "@/lib/attribution";
import { normalizeCouponCode } from "@/lib/offer-link";
import { absoluteUrl } from "@/lib/seo";
import { createServiceClient } from "@flyee/auth/service";
import { isEmailConfigured, sendLeadConfirmationEmail } from "@flyee/email";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type WaitlistStatus = "sent" | "invalid_email" | "consent_required" | "rate_limited" | "unavailable" | "error";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/**
 * The visitor's network, pseudonymized for the per-network window of
 * submit_lead: an HMAC with a server secret, so the stored value cannot be
 * reversed into an address or linked across deployments. Without the secret
 * (PUBLIC_FORMS_IP_SALT) there is no window at all, never a raw IP.
 */
async function networkHash(): Promise<string | null> {
  const salt = process.env.PUBLIC_FORMS_IP_SALT?.trim();
  if (!salt) return null;
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || headerList.get("x-real-ip")?.trim();
  if (!ip) return null;
  return createHmac("sha256", salt).update(ip).digest("hex");
}

/**
 * A waitlist sign-up (the form on /espera): validates, stores the person
 * through submit_lead (service role; consent snapshot, first-touch campaign,
 * per-network window) and e-mails the double opt-in link.
 *
 * The answer is the same whether the address was new, pending or already
 * confirmed: the form must not tell a stranger which addresses are on the
 * list. Only the confirmation link proves who owns an address, so nothing is
 * sent to an address that is already confirmed.
 */
export async function joinWaitlist(input: {
  email: string;
  consent: boolean;
  /** Honeypot: invisible to people, filled by bots. */
  website?: string;
  locale: string;
}): Promise<{ status: WaitlistStatus }> {
  // A bot filled the invisible field: answer as if it worked, store nothing.
  if (input.website) return { status: "sent" };

  const email = input.email.trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return { status: "invalid_email" };
  if (input.consent !== true) return { status: "consent_required" };

  let service;
  try {
    service = createServiceClient();
  } catch {
    return { status: "unavailable" };
  }

  const locale: PublicLocale = isPublicLocale(input.locale) ? input.locale : routing.defaultLocale;
  const cookieStore = await cookies();
  const attribution = decodeAttribution(cookieStore.get(COOKIE_KEYS.attribution)?.value) ?? {};
  const coupon = normalizeCouponCode(cookieStore.get(COOKIE_KEYS.offerCoupon)?.value);

  // The link carries the token; the database keeps only its hash.
  const token = randomBytes(32).toString("base64url");

  const { data, error } = await service.rpc("submit_lead", {
    payload: {
      email,
      consent: true,
      locale,
      source: "waitlist",
      ...(coupon ? { cupom: coupon } : {}),
      ...attribution,
    },
    target_ip_hash: await networkHash(),
    target_confirm_token_hash: sha256(token),
  });
  if (error || !data) return { status: "error" };

  const result = data as { ok: boolean; code: string; send_confirmation?: boolean; locale?: string };
  if (!result.ok) {
    if (result.code === "invalid_email") return { status: "invalid_email" };
    if (result.code === "consent_required") return { status: "consent_required" };
    if (result.code === "rate_limited") return { status: "rate_limited" };
    return { status: "error" };
  }
  if (!result.send_confirmation) return { status: "sent" };

  // In the language the address signed up in, which a repeated sign-up keeps.
  const mailLocale: PublicLocale = isPublicLocale(result.locale) ? result.locale : locale;
  const confirmUrl = absoluteUrl(localizeHref(`/espera/confirmar?t=${token}`, mailLocale));
  const sent = await sendLeadConfirmationEmail({ to: email, locale: mailLocale, confirmUrl });
  if (sent.sent) return { status: "sent" };

  if (!isEmailConfigured && process.env.NODE_ENV !== "production") {
    // Local development without Resend: the link is the only way through.
    console.info(`[waitlist] confirmation link for ${email}: ${confirmUrl}`);
    return { status: "sent" };
  }
  // Without the e-mail the address can never be confirmed: say so instead of
  // promising a message that will not arrive.
  return { status: isEmailConfigured ? "error" : "unavailable" };
}

export type ConfirmStatus = "confirmed" | "resubscribed" | "invalid" | "unavailable";

/**
 * The confirmation link was followed AND the button on the page was pressed.
 * Confirming on the GET alone would let the link scanners of mail providers,
 * which open every link they deliver, confirm addresses nobody confirmed.
 *
 * The token never reaches the browser's JavaScript: the middleware moved it
 * from the link into an httpOnly cookie, read and spent here.
 */
export async function confirmWaitlist(): Promise<{ status: ConfirmStatus }> {
  const token = await readConfirmationToken();
  if (!token) return { status: "invalid" };

  let service;
  try {
    service = createServiceClient();
  } catch {
    return { status: "unavailable" };
  }

  const { data, error } = await service.rpc("confirm_lead", { target_token_hash: sha256(token) });
  if (error || !data) return { status: "unavailable" };
  // Spent or not, a token the database answered for has done its job here.
  (await cookies()).delete(COOKIE_KEYS.leadConfirm);
  const result = data as { ok: boolean; code: string };
  if (!result.ok) return { status: "invalid" };
  return { status: result.code === "resubscribed" ? "resubscribed" : "confirmed" };
}
