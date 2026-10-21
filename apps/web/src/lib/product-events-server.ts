import "server-only";

import { createServiceClient } from "@flyee/auth/service";

/**
 * The product_events vocabulary (migration 0007_product_events). Adding a
 * name means changing `product_event_known()` in a migration first; the
 * database drops anything it does not know.
 */
export type ProductEventName =
  | "account.created"
  | "firm.created"
  | "invite.accepted"
  | "checkout.started"
  | "kit.purchased"
  | "subscription.started"
  | "subscription.cancel_requested"
  | "subscription.canceled"
  | "upsell.viewed"
  | "upsell.clicked"
  | "upsell.purchased"
  | "waitlist.joined";

export type ServerEventInput = {
  /** The person the event is about; null for events without one (a waitlist confirmation, a webhook). */
  actorId: string | null;
  /** Defaults to the firm of the actor. */
  orgId?: string | null;
  event: ProductEventName;
  /**
   * Only the allowlisted keys and values survive (product_event_sanitize):
   * role, firm_function, tier_from, tier_to, period, offer, reason, origin and
   * origem. Never content: no name, case number, document or free text.
   */
  properties?: Record<string, string>;
  /** When it happened, if it was not now (a webhook delivered late). */
  occurredAt?: Date;
};

/**
 * Records an event from the backend, with the service role. The database
 * fills in the firm of the actor and forces the platform to "server".
 *
 * Never throws: telemetry must not break the request that produced it.
 * Resolves to false when the event was not recorded (no service key, unknown
 * event, an RPC error).
 */
export async function trackServerEvent(input: ServerEventInput): Promise<boolean> {
  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch {
    return false;
  }

  try {
    const { data, error } = await supabase.rpc("track_product_event_server", {
      target_actor: input.actorId,
      target_org: input.orgId ?? null,
      target_event: input.event,
      target_properties: input.properties ?? {},
      target_occurred_at: input.occurredAt ? input.occurredAt.toISOString() : null,
    });
    if (error) {
      console.warn("[product-events] not recorded:", error.message);
      return false;
    }
    return data === true;
  } catch (error) {
    console.warn("[product-events] not recorded:", error instanceof Error ? error.message : error);
    return false;
  }
}
