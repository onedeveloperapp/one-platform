import { createServiceClient } from "@flyee/auth/service";
import type { CheckoutCoupon } from "./types";

/**
 * Plan fields safe to expose on public (unauthenticated) pages — no provider
 * refs, no internal limits payload beyond what marketing needs.
 */
export type PublicPlan = {
  slug: string;
  name: string;
  description: string | null;
  kind: "recurring" | "access";
  /** Groups the same offer across periods and currencies (kit, club, pro, free). */
  family: string;
  tier: "kit" | "club" | "pro" | null;
  period: "weekly" | "monthly" | "yearly" | null;
  priceCents: number;
  currency: string;
  trialDays: number;
  isFree: boolean;
  limits: Record<string, number>;
  sort: number;
  /** How long a one-time access lasts, in months; null when it has no end (and for every recurring plan). */
  accessMonths: number | null;
};

/**
 * Lists active plans for the public pricing page. Server-only: the `plans`
 * table is readable by authenticated users only (RLS), so this goes through
 * the service-role client — read-only, safe fields only.
 *
 * `currency` narrows the list to the plans sold in it (each offer exists once
 * per currency: `kit` in BRL, `kit-usd` in USD).
 *
 * Returns `null` when Supabase is not configured (fresh clone), so callers
 * MUST fall back to placeholder content and keep the page browsable.
 */
export async function listPublicPlans(options: { currency?: string } = {}): Promise<PublicPlan[] | null> {
  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch {
    return null;
  }

  let query = supabase
    .from("plans")
    .select(
      "slug, name, description, kind, family, tier, period, price_cents, currency, trial_days, is_free, limits, sort, access_months",
    )
    .eq("is_active", true)
    // Add-ons are not tiers: on a public pricing page they
    // would read as another plan to choose between.
    .eq("is_addon", false)
    // A limited offer (founders) is active and fully purchasable, but reached
    // by the link the operator sends — publishing its price next to the table
    // price would read as overcharging everybody else (0085).
    .eq("is_public", true);
  if (options.currency) query = query.eq("currency", options.currency.toUpperCase());
  const { data, error } = await query.order("sort", { ascending: true });

  if (error || !data) return null;

  return data.map((row) => ({
    slug: row.slug,
    name: row.name,
    description: row.description,
    kind: row.kind,
    period: row.period,
    priceCents: row.price_cents,
    currency: row.currency,
    family: row.family,
    tier: row.tier,
    trialDays: row.trial_days,
    isFree: row.is_free,
    limits: (row.limits ?? {}) as Record<string, number>,
    sort: row.sort,
    accessMonths: row.access_months ?? null,
  }));
}

/**
 * One plan by slug, INCLUDING unlisted ones (0085).
 *
 * `listPublicPlans` deliberately hides them, which is right for a catalog and
 * wrong for the offer page itself: a founders page has to print the price of
 * the very plan the catalog is not allowed to show. Named explicitly rather
 * than adding a flag to the listing, so nothing can accidentally leak an
 * unlisted plan into a grid.
 *
 * Still refuses an INACTIVE plan — that one is retired, not merely unlisted.
 */
export async function getPlanBySlug(slug: string): Promise<PublicPlan | null> {
  if (!slug.trim()) return null;

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch {
    return null;
  }

  const { data, error } = await supabase
    .from("plans")
    .select(
      "slug, name, description, kind, family, tier, period, price_cents, currency, trial_days, is_free, limits, sort, access_months",
    )
    .eq("slug", slug.trim())
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;

  return {
    slug: data.slug,
    name: data.name,
    description: data.description,
    kind: data.kind,
    period: data.period,
    priceCents: data.price_cents,
    currency: data.currency,
    family: data.family,
    tier: data.tier,
    trialDays: data.trial_days,
    isFree: data.is_free,
    limits: (data.limits ?? {}) as Record<string, number>,
    sort: data.sort,
    accessMonths: data.access_months ?? null,
  };
}

/**
 * Resolves a campaign code for the PUBLIC pricing page.
 *
 * The authenticated checkout validates the same code through the customer's own
 * session (`validate_coupon`), but the pricing page has no session at all — and
 * a visitor arriving from a partner's post with `?cupom=` has to SEE the price
 * she was promised, or she concludes the code did not work and leaves. Reading
 * it here, service-role and read-only, is what lets the page show the discount
 * before anyone signs up.
 *
 * Returns null for an unknown, expired or exhausted code — the caller must say
 * so rather than silently rendering full prices.
 */
export async function resolvePublicCoupon(code: string): Promise<CheckoutCoupon | null> {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,32}$/.test(normalized)) return null;

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch {
    return null;
  }

  const { data, error } = await supabase.rpc("validate_coupon", { coupon_code: normalized });
  if (error) return null;
  const row = (
    data as
      | { id: string; code: string; discount_type: string; discount_value: number; currency: string | null }[]
      | null
  )?.[0];
  if (!row) return null;

  return {
    id: row.id,
    code: row.code,
    discountType: row.discount_type as CheckoutCoupon["discountType"],
    discountValue: row.discount_value,
    currency: row.currency,
  };
}
