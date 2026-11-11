import { type EntitlementKey, hasEntitlement, isTierSlug } from "@flyee/billing/entitlements";

/**
 * What the member's workspace is entitled to, as `org_entitlements(org)`
 * (migration 0004) answers it: the SINGLE source for "what does this
 * workspace unlock". The database merges the free floor, every live grant
 * (the kit, a courtesy), the live subscription and its add-ons. Screens never
 * re-derive it from `subscriptions` or `entitlement_grants`: a second opinion
 * about the same workspace is how two screens end up disagreeing.
 *
 * Screens branch on keys (`has("monitor_voo")`) and on whether there is a tier,
 * never on a plan's name: a tier is a slug the operator writes (migration 0202).
 */
export type EntitlementSource = {
  /** `grant` (kit, courtesy), `subscription`, `free` or `provisional` (a PIX being confirmed). */
  type: string;
  planId: string | null;
  tier: string | null;
};

export type Entitlements = {
  active: boolean;
  suspended: boolean;
  /** The subscription's status, when there is one. */
  status: string | null;
  /** Still unlocked while a failed renewal is retried. */
  pastDueGrace: boolean;
  graceEndsAt: string | null;
  /** The tier of the live source of the highest rank; null = nothing bought. */
  tier: string | null;
  sources: EntitlementSource[];
  limits: Record<string, unknown>;
  /** Whether a right is on; always false while the workspace is inactive. */
  has: (key: EntitlementKey) => boolean;
};

export type RpcEntitlements = {
  active?: boolean;
  suspended?: boolean;
  status?: string | null;
  past_due_grace?: boolean;
  grace_ends_at?: string | null;
  tier?: string | null;
  sources?: { type?: string; plan_id?: string | null; tier?: string | null }[] | null;
  limits?: Record<string, unknown> | null;
};

export function toEntitlements(raw: RpcEntitlements): Entitlements {
  const active = Boolean(raw.active);
  const limits = raw.limits ?? {};
  return {
    active,
    suspended: Boolean(raw.suspended),
    status: raw.status ?? null,
    pastDueGrace: Boolean(raw.past_due_grace),
    graceEndsAt: raw.grace_ends_at ?? null,
    tier: isTierSlug(raw.tier) ? raw.tier : null,
    sources: (raw.sources ?? []).map((source) => ({
      type: source.type ?? "unknown",
      planId: source.plan_id ?? null,
      tier: isTierSlug(source.tier) ? source.tier : null,
    })),
    limits,
    has: (key) => active && hasEntitlement(limits, key),
  };
}
