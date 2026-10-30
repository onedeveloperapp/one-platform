import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import { DEFAULTS } from "@/config";
import { COOKIE_KEYS, type LocaleOption } from "@/constants";
import { resolveCurrency } from "@/lib/billing-currency";
import { type Entitlements, type RpcEntitlements, toEntitlements } from "@/lib/entitlements";
import type { FirmFunction, OrgRole } from "@/lib/firm/roles";
import { type ModuleCatalogEntry, moduleCatalogOf } from "@/lib/modules/offer";
import { type MemberPartner, memberPartnerOf, partnerModules } from "@/lib/partners/partner";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/server";
import type { BillingCurrency } from "@flyee/billing/currency";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who is looking at a screen of the logged area, read once per request on the
 * server: the session client (every read under row-level security), the firm
 * the person belongs to and what they are in it, the language the screen
 * renders in, the currency prices show in, and `org_entitlements`, the one
 * answer to "what may this firm use".
 *
 * A person belongs to one firm at a time (migration 0000), so "the firm" is
 * their membership. `firm` is null for an account that founded or joined none
 * yet, and for the platform operator, who works in no firm.
 *
 * Null when there is no session (the middleware normally redirects first) or
 * no Supabase: every screen renders its "unavailable" state then.
 */
export type MemberProfile = {
  displayName: string;
  timezone: string | null;
};

export type MemberFirm = {
  id: string;
  name: string;
  /** What the person may do to the firm account. */
  role: OrgRole;
  /** What the person does in the firm. */
  firmFunction: FirmFunction;
};

export type MemberContext = {
  supabase: SupabaseClient;
  userId: string;
  email: string;
  /** The firm's id, or null. Kept beside `firm` for the many callers that only need the id. */
  orgId: string | null;
  firm: MemberFirm | null;
  /**
   * The product modules the person works in: the firm's (`firm_modules`, migration 0068), or, for somebody of a
   * partner, those of its active partnerships (0069); none otherwise.
   */
  modules: string[];
  /**
   * ONE's modules (`product_modules`, migrations 0075 and 0078): the ones out and the ones to come, in the
   * catalog's order, with their names and icons. Read with the membership, for the menu every page draws; null when
   * the read failed.
   */
  catalog: ModuleCatalogEntry[] | null;
  /** The partner the person works in (0069), or null. Somebody of a partner is in no firm. */
  partner: MemberPartner | null;
  isSuperadmin: boolean;
  locale: LocaleOption;
  currency: BillingCurrency;
  profile: MemberProfile;
  entitlements: Entitlements;
};

type OrganizationRow = { name: string; firm_modules?: { module_key: string }[] | null };

type MembershipRow = {
  org_id: string;
  role: OrgRole;
  firm_function: FirmFunction;
  organizations: OrganizationRow | OrganizationRow[] | null;
};

export const getMemberContext = cache(async (): Promise<MemberContext | null> => {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: membership }, { data: profile }, catalog, cookieStore] = await Promise.all([
    // Filtered by the person: a member reads every membership of their firm.
    supabase
      .from("memberships")
      .select("org_id, role, firm_function, organizations(name, firm_modules(module_key))")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("profiles").select("display_name, timezone, is_superadmin").eq("id", user.id).maybeSingle(),
    supabase
      .from("product_modules")
      .select("key, name, status, sold_as, description, sort, icon, retired_at")
      .then(({ data, error }) => (error ? null : moduleCatalogOf(data))),
    cookies(),
  ]);
  const row = (membership as MembershipRow | null) ?? null;
  const organization = Array.isArray(row?.organizations) ? row?.organizations[0] : row?.organizations;
  const firm: MemberFirm | null = row
    ? { id: row.org_id, name: organization?.name ?? "", role: row.role, firmFunction: row.firm_function }
    : null;
  const { data: raw } = firm ? await supabase.rpc("org_entitlements", { target_org: firm.id }) : { data: null };
  // Somebody in no firm may be in a partner: asked only then, so a firm's request pays nothing for it.
  const { data: partnerRaw } = firm ? { data: null } : await supabase.rpc("my_partner");
  const partner = firm ? null : memberPartnerOf(partnerRaw);
  const locale = DEFAULTS.locale as LocaleOption;

  return {
    supabase,
    userId: user.id,
    email: user.email ?? "",
    orgId: firm?.id ?? null,
    firm,
    modules: firm ? (organization?.firm_modules ?? []).map((row) => row.module_key) : partnerModules(partner),
    catalog,
    partner,
    isSuperadmin: Boolean(profile?.is_superadmin),
    locale,
    currency: resolveCurrency({ cookie: cookieStore.get(COOKIE_KEYS.currency)?.value, locale }),
    profile: {
      displayName: (profile?.display_name as string | null) ?? user.email?.split("@")[0] ?? "",
      timezone: (profile?.timezone as string | null) ?? null,
    },
    entitlements: toEntitlements((raw ?? {}) as RpcEntitlements),
  };
});
