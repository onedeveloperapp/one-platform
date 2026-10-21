import "server-only";

import { type ProductEventName, trackServerEvent } from "@/lib/product-events-server";
import { createServiceClient } from "@flyee/auth/service";

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * What happens to a workspace around a billing transition, shared by the
 * provider webhook and the cron jobs (docs/BILLING.md). Service role only:
 * there is no member session behind a provider callback.
 */

/** The member a workspace's events are attributed to: its owner (one person per account). */
export async function workspaceOwner(service: ServiceClient, orgId: string): Promise<string | null> {
  const { data } = await service
    .from("memberships")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

/**
 * A usage event about a workspace, attributed to its owner so segment,
 * language and AI tool are stamped from that profile. Never throws.
 */
export async function trackWorkspaceEvent(
  service: ServiceClient,
  orgId: string,
  event: ProductEventName,
  properties: Record<string, string> = {},
  occurredAt?: Date,
): Promise<void> {
  try {
    const actorId = await workspaceOwner(service, orgId);
    await trackServerEvent({ actorId, orgId, event, properties, occurredAt });
  } catch {
    // Telemetry never decides a billing outcome.
  }
}

/** How long after seeing an offer a purchase is still credited to it. */
const UPSELL_WINDOW_MS = 14 * 86_400_000;

/**
 * Records `upsell.purchased` when a purchase follows an offer card the
 * workspace saw or clicked in the last 14 days (`upsell.viewed` /
 * `upsell.clicked`, components/product/upsell-card.tsx). That is what lets
 * the offer rule be judged by what it sold, per segment. Telemetry only: it
 * never throws.
 */
export async function trackUpsellPurchase(
  service: ServiceClient,
  orgId: string,
  offer: string | null | undefined,
  occurredAt?: Date,
): Promise<void> {
  if (!offer) return;
  try {
    const since = new Date((occurredAt?.getTime() ?? Date.now()) - UPSELL_WINDOW_MS).toISOString();
    const { data } = await service
      .from("product_events")
      .select("id")
      .eq("org_id", orgId)
      .in("event_name", ["upsell.viewed", "upsell.clicked"])
      .gte("created_at", since)
      .limit(1);
    if ((data ?? []).length === 0) return;
    await trackWorkspaceEvent(service, orgId, "upsell.purchased", { offer }, occurredAt);
  } catch {
    // Telemetry never decides a billing outcome.
  }
}
