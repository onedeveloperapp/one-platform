/**
 * Reading what a firm may use. Pure and import-free (client-safe through `@flyee/billing/entitlements`).
 *
 * The answer itself comes from the database, `org_entitlements(org)` (redefined in migration 0202), which merges the
 * free floor, every live grant, the live subscription and its add-ons, and names the firm's tier by the rank of its
 * plan. This module only reads that answer: screens branch on keys, never on a plan's name or slug.
 */

/**
 * ONE's rights, as keys of a plan's `limits`. The ceilings are counts (`processos_ativos_max`: the firm's open cases
 * that are not a test; `assentos_max`: the people of its team; `whatsapp_numeros_max`: its numbers at the vendor);
 * `monitor_voo` is the flight monitor, sold as an add-on (1 on, 0 off).
 */
export const CEILING_KEYS = ["processos_ativos_max", "assentos_max", "whatsapp_numeros_max"] as const;
export type CeilingKey = (typeof CEILING_KEYS)[number];

export const FEATURE_KEYS = ["monitor_voo"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type EntitlementKey = CeilingKey | FeatureKey;
export const ENTITLEMENT_KEYS: readonly EntitlementKey[] = [...CEILING_KEYS, ...FEATURE_KEYS];

/** A tier is data: a slug the operator writes on a plan (`essencial`, `escritorio`), ordered by the plan's rank. */
export const isTierSlug = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9-]{1,39}$/.test(value);

/** The value of a key; 0 when it is absent or not a number. */
export function limitOf(limits: Record<string, unknown> | null | undefined, key: string): number {
  const value = Number(limits?.[key]);
  return Number.isFinite(value) ? value : 0;
}

/** Whether a right is on (any positive value). */
export function hasEntitlement(limits: Record<string, unknown> | null | undefined, key: EntitlementKey): boolean {
  return limitOf(limits, key) > 0;
}

/** The on/off rights a plan has on, in display order. */
export function enabledFeatures(limits: Record<string, unknown> | null | undefined): FeatureKey[] {
  return FEATURE_KEYS.filter((key) => hasEntitlement(limits, key));
}

/** The ceilings a plan sets, in display order, each with its count; a ceiling the plan does not set is left out. */
export function ceilingsOf(limits: Record<string, unknown> | null | undefined): { key: CeilingKey; value: number }[] {
  return CEILING_KEYS.flatMap((key) => {
    const value = limitOf(limits, key);
    return value > 0 ? [{ key, value }] : [];
  });
}
