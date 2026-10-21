/**
 * Reading what a workspace may use. Pure and import-free (client-safe through
 * `@flyee/billing/entitlements`).
 *
 * The answer itself comes from the database, `org_entitlements(org)`
 * (migration 0004), which merges the free floor, every live grant (the kit),
 * the live subscription and its add-ons. This module only reads that answer:
 * screens branch on keys and tiers, never on plan names or slugs.
 */

/**
 * The rights a plan, a grant or an add-on carries, as keys of `limits`
 * (migration 0018). Numbers: 0 means off; `devices` is a ceiling.
 */
export const ENTITLEMENT_KEYS = [
  "catalog_access",
  "devices",
  "advanced_lessons",
  "recipes",
  "roadmap_vote",
  "meetings",
  "commercial_license",
  "open_the_hood",
] as const;

export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

/** The rungs of the ladder, cheapest first. */
export const TIERS = ["kit", "club", "pro"] as const;

export type Tier = (typeof TIERS)[number];

export const TIER_RANK: Record<Tier, number> = { kit: 1, club: 2, pro: 3 };

export const isTier = (value: unknown): value is Tier =>
  typeof value === "string" && (TIERS as readonly string[]).includes(value);

/** The value of a key; 0 when it is absent or not a number. */
export function limitOf(limits: Record<string, unknown> | null | undefined, key: string): number {
  const value = Number(limits?.[key]);
  return Number.isFinite(value) ? value : 0;
}

/** Whether a right is on (any positive value). */
export function hasEntitlement(limits: Record<string, unknown> | null | undefined, key: EntitlementKey): boolean {
  return limitOf(limits, key) > 0;
}

/** The highest rung among some sources; null when none is a paid rung. */
export function tierOf(tiers: readonly (string | null | undefined)[]): Tier | null {
  let best: Tier | null = null;
  for (const tier of tiers) {
    if (isTier(tier) && (!best || TIER_RANK[tier] > TIER_RANK[best])) best = tier;
  }
  return best;
}

/**
 * The on/off rights a plan has on, in display order: what a pricing card
 * lists (one `pricing-feature-<key>` string each). `devices` is left out
 * because it is a count, rendered with its own number.
 */
export function enabledFeatures(limits: Record<string, unknown> | null | undefined): EntitlementKey[] {
  return ENTITLEMENT_KEYS.filter((key) => key !== "devices" && hasEntitlement(limits, key));
}
