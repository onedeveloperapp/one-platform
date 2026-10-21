import "server-only";

import { headers } from "next/headers";

import { createClient } from "@flyee/auth/server";
import { createServiceClient } from "@flyee/auth/service";

/**
 * Helpers shared by the billing server actions (`actions.ts` for checkouts,
 * `actions-cancel.ts`, `actions-recovery.ts`). A plain server module, not a
 * "use server" one: every export of a "use server" file is a public endpoint,
 * and none of these may be callable from the browser.
 */

export type SessionClient = Awaited<ReturnType<typeof createClient>>;

export async function requireOrgManager(orgId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    throw new Error("Only organization owners/admins can manage billing.");
  }
  return { supabase, user };
}

export async function appOrigin() {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ActiveBillingClaim = {
  service: ReturnType<typeof createServiceClient>;
  operationId: string;
  claimToken: string;
};

/**
 * A short, storable reason for a provider refusal.
 *
 * `billing_operations.error_code` was always the literal `provider_unavailable`,
 * which is true of a rejected payload, a key pointing at the wrong
 * environment, and an account still under review — three problems with three
 * different fixes. The provider's own status and error code are short, carry
 * no customer data, and turn that hunt into one query.
 */
export function providerFailureCode(error: unknown): string {
  if (!(error instanceof Error)) return "provider_unavailable";
  const status = (error as { status?: number }).status;
  const code = (error as { code?: string }).code;
  if (status || code) {
    return `provider_${status ?? "error"}${code ? `_${code}` : ""}`.slice(0, 120);
  }
  // Not a provider HTTP failure (a thrown URL parse, a missing key…): keep the
  // message, trimmed, rather than collapsing it to nothing.
  return `provider_error_${error.message.replace(/\s+/gu, " ").slice(0, 90)}`;
}

/**
 * Names the cause of a checkout failure in the server log.
 *
 * Every failure path collapses to `{ error: "unavailable" }` on purpose —
 * provider and configuration detail must not reach the browser. Without this
 * the cause was not recorded anywhere. The message is the operator's, not the
 * customer's.
 */
export function logBillingFailure(stage: string, context: Record<string, unknown>, error?: unknown) {
  console.error("billing_checkout_failed", {
    stage,
    ...context,
    ...(error instanceof Error
      ? {
          message: error.message,
          name: error.name,
          providerStatus: (error as { status?: number }).status,
          providerCode: (error as { code?: string }).code,
        }
      : error
        ? { error: String(error) }
        : {}),
  });
}

export async function failBillingClaim(claim: ActiveBillingClaim | null, errorCode: string) {
  if (!claim) return;
  try {
    await claim.service.rpc("complete_billing_operation", {
      target_operation: claim.operationId,
      target_claim_token: claim.claimToken,
      target_success: false,
      target_result: {},
      target_error_code: errorCode,
    });
  } catch {
    // The short server lease remains the retry boundary if Supabase is down.
  }
}

/** The fiscal identity Asaas requires to create a customer, as the workspace stored it. */
export async function loadPayer(supabase: SessionClient, orgId: string) {
  const { data } = await supabase
    .from("organizations")
    .select("name, billing_cpf_cnpj, billing_postal_code, billing_address_number, billing_phone")
    .eq("id", orgId)
    .single();
  return {
    orgName: data?.name ?? "Organization",
    payer: {
      document: data?.billing_cpf_cnpj ?? null,
      postalCode: data?.billing_postal_code ?? null,
      addressNumber: data?.billing_address_number ?? null,
      phone: data?.billing_phone ?? null,
    },
  };
}

/**
 * Refuses a purchase the workspace must not be able to make.
 *
 * `admin_suspended` is the superadmin kill-switch — fraud, chronic default, a
 * legal hold. A suspended workspace that could still pay would hold a charge
 * with no delivery, and a guaranteed refund.
 *
 * Returns the error code to answer with, or null when the purchase may go on.
 */
export async function purchaseBlockedReason(supabase: SessionClient, orgId: string): Promise<string | null> {
  const { data } = await supabase
    .from("subscriptions")
    .select("admin_suspended")
    .eq("org_id", orgId)
    .in("status", ["trialing", "active", "past_due"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.admin_suspended ? "suspended" : null;
}

/** The person a firm's server events are attributed to when nobody is in session: its owner. */
export async function orgOwnerId(
  service: ReturnType<typeof createServiceClient>,
  orgId: string,
): Promise<string | null> {
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
