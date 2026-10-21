"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { remoteEmpty, remoteError, remoteLoading, type RemoteState, remoteSuccess } from "@/lib/remote-state";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/client";

export type OrgLite = { id: string; name: string; role: string };

export interface SubscriptionInfo {
  id: string;
  status: string;
  adminSuspended: boolean;
  planId: string;
  planName: string;
  planKind: string;
  isFree: boolean;
  period: string | null;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  cancellationRequestedAt: string | null;
  /** False for a yearly plan paid in installments: one purchase, which ends with its period. */
  renews: boolean;
  modules: { id: string; name: string }[];
}

/**
 * A checkout that was started and has not been confirmed yet.
 *
 * `incomplete` was excluded from every query, so between paying a boleto/Pix
 * and the provider's confirmation — hours, sometimes days — the screen said
 * "no active plan". People reasonably concluded the payment had failed and
 * started a SECOND checkout, which on Asaas means a second recurring charge.
 */
export interface PendingCheckout {
  id: string;
  planId: string;
  planName: string;
  createdAt: string;
  /** The provider's hosted page: where an unpaid boleto/Pix is still payable. */
  checkoutUrl: string | null;
}

export interface PlanRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: "recurring" | "access";
  period: "weekly" | "monthly" | "yearly" | null;
  priceCents: number;
  currency: string;
  trialDays: number;
  isFree: boolean;
  /** The same offer across periods and currencies: `free`, `kit`, `club`, `pro`. */
  family: string;
  /** The rung of the ladder (`kit`, `club`, `pro`); null for the free plan. */
  tier: string | null;
  /** Not a subscription tier: an add-on (none are sold today). */
  isAddon: boolean;
  /** How long a one-time access lasts, in months; null when it has no end (and for every recurring plan). */
  accessMonths: number | null;
  /**
   * Whether the plan belongs in the catalog grid (0085). A limited offer is
   * active and fully purchasable but not public: it is reached by the link the
   * operator sends (`?plan=<slug>`), never listed next to the table price.
   */
  isPublic: boolean;
  limits: Record<string, unknown>;
}

export interface ModuleRow {
  id: string;
  name: string;
  description: string | null;
  kind: "recurring" | "one_time";
  priceCents: number;
}

export interface InvoiceRow {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  description: string | null;
  invoiceUrl: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface BillingDetails {
  subscription: SubscriptionInfo | null;
  pendingCheckout: PendingCheckout | null;
  /** Every purchasable plan, in every currency; the screen picks the member's. */
  plans: PlanRow[];
  /** What the workspace may use now, as `org_entitlements` answers it. */
  entitlements: WorkspaceEntitlements;
  modules: ModuleRow[];
  invoices: InvoiceRow[];
  billingProfile: BillingProfile;
}

/**
 * The part of `org_entitlements(org)` the billing screen needs: the rung the
 * workspace is on, whether it owns the kit (a grant that survives any
 * subscription ending), and when that access ends.
 */
export interface WorkspaceEntitlements {
  tier: string | null;
  hasKit: boolean;
  catalogAccess: boolean;
  /**
   * When the kit access ends, renewals included (a renewal starts when the
   * current term ends, so the furthest end is the one that counts); null for
   * an access with no end date, or none.
   */
  accessEndsAt: string | null;
}

const NO_ENTITLEMENTS: WorkspaceEntitlements = { tier: null, hasKit: false, catalogAccess: false, accessEndsAt: null };

/** Fiscal identity of the workspace — Asaas refuses a customer without it. */
export interface BillingProfile {
  document: string | null;
  postalCode: string | null;
  addressNumber: string | null;
  phone: string | null;
}

const EMPTY_PROFILE: BillingProfile = { document: null, postalCode: null, addressNumber: null, phone: null };

const EMPTY_DETAILS: BillingDetails = {
  subscription: null,
  pendingCheckout: null,
  plans: [],
  entitlements: NO_ENTITLEMENTS,
  modules: [],
  invoices: [],
  billingProfile: EMPTY_PROFILE,
};

const remoteData = <T>(state: RemoteState<T, "load_failed">): T | undefined =>
  state.status === "success"
    ? state.data
    : state.status === "loading" || state.status === "error"
      ? state.previous
      : undefined;

export function useBilling() {
  const [orgsState, setOrgsState] = useState<RemoteState<OrgLite[], "load_failed">>(() => remoteLoading());
  const [detailsState, setDetailsState] = useState<RemoteState<BillingDetails, "load_failed">>(() => remoteEmpty());
  const orgsRef = useRef<OrgLite[] | undefined>(undefined);
  const detailsRef = useRef<BillingDetails | undefined>(undefined);
  const orgRequestRef = useRef(0);
  const detailsRequestRef = useRef(0);
  const [currentOrgId, setCurrentOrgId] = useState<string | null>(null);

  const refreshOrgs = useCallback(async (preservePrevious = true) => {
    const requestId = ++orgRequestRef.current;
    if (!preservePrevious) orgsRef.current = undefined;
    const previous = preservePrevious ? orgsRef.current : undefined;
    setOrgsState(remoteLoading(previous));
    if (!isSupabaseConfigured) {
      orgsRef.current = undefined;
      setCurrentOrgId(null);
      setOrgsState(remoteEmpty());
      return;
    }
    const supabase = createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (requestId !== orgRequestRef.current) return;
    if (userError || !user) {
      setOrgsState(remoteError("load_failed", previous));
      return;
    }
    const { data, error: membershipsError } = await supabase
      .from("memberships")
      .select("role, organizations(id, name)")
      .eq("user_id", user.id)
      .order("created_at");
    if (requestId !== orgRequestRef.current) return;
    if (membershipsError) {
      setOrgsState(remoteError("load_failed", previous));
      return;
    }
    const list: OrgLite[] = (data ?? [])
      .filter((row) => row.organizations)
      .map((row) => {
        const org = row.organizations as unknown as { id: string; name: string };
        return { id: org.id, name: org.name, role: row.role };
      });
    orgsRef.current = list.length === 0 ? undefined : list;
    setCurrentOrgId((current) => (current && list.some((org) => org.id === current) ? current : (list[0]?.id ?? null)));
    setOrgsState(list.length === 0 ? remoteEmpty() : remoteSuccess(list));
  }, []);

  const refreshDetails = useCallback(
    async (preservePrevious = true) => {
      const requestId = ++detailsRequestRef.current;
      if (!preservePrevious) detailsRef.current = undefined;
      const previous = preservePrevious ? detailsRef.current : undefined;
      if (!isSupabaseConfigured || !currentOrgId) {
        detailsRef.current = undefined;
        setDetailsState(remoteEmpty());
        return;
      }
      setDetailsState(remoteLoading(previous));
      const supabase = createClient();

      const [
        subResult,
        plansResult,
        modulesResult,
        invoicesResult,
        pendingResult,
        orgResult,
        entitlementsResult,
        grantsResult,
      ] = await Promise.all([
        supabase
          .from("subscriptions")
          .select(
            "id, status, admin_suspended, plan_id, period, current_period_end, trial_ends_at, cancel_at_period_end, cancellation_requested_at, renews, plans(name, kind, is_free), subscription_modules(module_id, status, modules(name))",
          )
          .eq("org_id", currentOrgId)
          .in("status", ["trialing", "active", "past_due"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from("plans").select("*").eq("is_active", true).order("sort"),
        supabase.from("modules").select("*").eq("is_active", true).order("sort"),
        supabase
          .from("invoices")
          .select("*")
          .eq("org_id", currentOrgId)
          .order("created_at", { ascending: false })
          .limit(24),
        // The checkout she started and has not paid yet. `billing_operations`
        // carries the provider's hosted URL, and its RLS already limits the
        // read to the manager who started it.
        supabase
          .from("subscriptions")
          .select("id, plan_id, created_at, plans(name), billing_operations(result)")
          .eq("org_id", currentOrgId)
          .eq("status", "incomplete")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("organizations")
          .select("billing_cpf_cnpj, billing_postal_code, billing_address_number, billing_phone")
          .eq("id", currentOrgId)
          .maybeSingle(),
        supabase.rpc("org_entitlements", { target_org: currentOrgId }),
        // Every kit grant that is not revoked, the chained renewals included:
        // `org_entitlements` lists only the one running now.
        supabase
          .from("entitlement_grants")
          .select("kind, expires_at")
          .eq("org_id", currentOrgId)
          .is("revoked_at", null),
      ]);

      if (requestId !== detailsRequestRef.current) return;
      if (subResult.error || plansResult.error || modulesResult.error || invoicesResult.error) {
        setDetailsState(remoteError("load_failed", previous));
        return;
      }

      const sub = subResult.data;
      let subscription: SubscriptionInfo | null = null;
      if (sub) {
        const plan = sub.plans as unknown as { name: string; kind: string; is_free: boolean } | null;
        const subModules =
          (sub.subscription_modules as unknown as
            | { module_id: string; status: string; modules: { name: string } | null }[]
            | null) ?? [];
        subscription = {
          id: sub.id,
          status: sub.status,
          adminSuspended: sub.admin_suspended,
          planId: sub.plan_id,
          planName: plan?.name ?? "Unknown plan",
          planKind: plan?.kind ?? "recurring",
          isFree: plan?.is_free ?? false,
          period: sub.period,
          currentPeriodEnd: sub.current_period_end,
          trialEndsAt: sub.trial_ends_at,
          cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
          cancellationRequestedAt: sub.cancellation_requested_at,
          renews: sub.renews !== false,
          modules: subModules
            .filter((m) => m.status === "active")
            .map((m) => ({ id: m.module_id, name: m.modules?.name ?? "Module" })),
        };
      }

      const catalog: PlanRow[] = (plansResult.data ?? []).map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        kind: p.kind,
        period: p.period,
        priceCents: p.price_cents,
        currency: p.currency,
        trialDays: p.trial_days,
        isFree: p.is_free,
        family: p.family,
        tier: p.tier,
        isAddon: Boolean(p.is_addon),
        isPublic: p.is_public !== false,
        limits: (p.limits as Record<string, unknown> | null) ?? {},
        accessMonths: (p.access_months as number | null) ?? null,
      }));

      const pendingRow = pendingResult.data;
      const pendingOperation = pendingRow?.billing_operations as unknown as { result: { url?: string } | null } | null;
      const pendingCheckout: PendingCheckout | null = pendingRow
        ? {
            id: pendingRow.id,
            planId: pendingRow.plan_id,
            planName: (pendingRow.plans as unknown as { name: string } | null)?.name ?? "",
            createdAt: pendingRow.created_at,
            checkoutUrl: pendingOperation?.result?.url ?? null,
          }
        : null;

      const details: BillingDetails = {
        subscription,
        pendingCheckout,
        billingProfile: {
          document: orgResult.data?.billing_cpf_cnpj ?? null,
          postalCode: orgResult.data?.billing_postal_code ?? null,
          addressNumber: orgResult.data?.billing_address_number ?? null,
          phone: orgResult.data?.billing_phone ?? null,
        },
        // An add-on is not a rung of the ladder.
        plans: catalog.filter((plan) => !plan.isAddon),
        entitlements: readEntitlements(entitlementsResult.data, grantsResult.data ?? []),
        modules: (modulesResult.data ?? []).map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          kind: m.kind,
          priceCents: m.price_cents,
        })),
        invoices: (invoicesResult.data ?? []).map((invoice) => ({
          id: invoice.id,
          amountCents: invoice.amount_cents,
          currency: invoice.currency,
          status: invoice.status,
          description: invoice.description,
          invoiceUrl: invoice.invoice_url,
          paidAt: invoice.paid_at,
          createdAt: invoice.created_at,
        })),
      };
      detailsRef.current = details;
      setDetailsState(remoteSuccess(details));
    },
    [currentOrgId],
  );

  useEffect(() => {
    void refreshOrgs(false);
  }, [refreshOrgs]);

  useEffect(() => {
    void refreshDetails(false);
  }, [refreshDetails]);

  const orgs = remoteData(orgsState) ?? [];
  const details = remoteData(detailsState) ?? EMPTY_DETAILS;
  const currentOrg = orgs.find((org) => org.id === currentOrgId) ?? null;
  const canManage = currentOrg ? ["owner", "admin"].includes(currentOrg.role) : false;
  const orgsLoading = orgsState.status === "loading" && !orgsState.previous;
  const detailsLoading = detailsState.status === "loading" && !detailsState.previous;

  return {
    configured: isSupabaseConfigured,
    loading: orgsLoading || (Boolean(currentOrgId) && detailsLoading),
    orgsState,
    detailsState,
    loadFailed: orgsState.status === "error" || detailsState.status === "error",
    refreshing:
      (orgsState.status === "loading" && Boolean(orgsState.previous)) ||
      (detailsState.status === "loading" && Boolean(detailsState.previous)),
    orgs,
    currentOrg,
    canManage,
    setCurrentOrgId,
    subscription: details.subscription,
    pendingCheckout: details.pendingCheckout,
    billingProfile: details.billingProfile,
    plans: details.plans,
    entitlements: details.entitlements,
    modules: details.modules,
    invoices: details.invoices,
    retry: async () => {
      if (orgsState.status === "error") await refreshOrgs(true);
      else await refreshDetails(true);
    },
    refreshDetails,
  };
}

/** Reads the slice of `org_entitlements` the screen uses; nothing readable means nothing owned. */
function readEntitlements(raw: unknown, grants: { kind: string; expires_at: string | null }[]): WorkspaceEntitlements {
  const value = (raw ?? {}) as {
    tier?: string | null;
    limits?: Record<string, unknown> | null;
    sources?: { type?: string; tier?: string | null }[] | null;
  };
  const sources = Array.isArray(value.sources) ? value.sources : [];
  const kitEnds = grants.filter((grant) => grant.kind === "kit").map((grant) => grant.expires_at);
  return {
    tier: value.tier ?? null,
    hasKit: sources.some((source) => source.type === "grant" && source.tier === "kit"),
    catalogAccess: Number(value.limits?.catalog_access ?? 0) > 0,
    accessEndsAt:
      kitEnds.length === 0 || kitEnds.includes(null)
        ? null
        : kitEnds.reduce<string | null>((latest, end) => (!latest || (end && end > latest) ? end : latest), null),
  };
}
