import CheckoutForm from "./checkout-form";
import PixPaymentPanel from "./pix-payment-panel";
import { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { Alert, Box, Button, Paper, Typography } from "@mui/material";

import Logo from "@/components/logo/logo";
import { COOKIE_KEYS } from "@/constants";
import { resolveCurrency } from "@/lib/billing-currency";
import { getMaxInstallments } from "@/lib/billing-settings";
import { campaignQuery, pickCampaignParams } from "@/lib/campaign-params";
import { getGuaranteeDays } from "@/lib/guarantee";
import { pendingPixCharge } from "@/lib/pending-pix";
import { createClient } from "@flyee/auth/server";
import { isPixAvailable } from "@flyee/billing";
import { formatPrice } from "@flyee/billing/currency";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("checkout-meta-title"), robots: { index: false, follow: false } };
}

/** How long a started kit purchase counts as "waiting for the payment" (a PIX confirms in minutes). */
const PENDING_KIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * One screen, one job: turn a decision already made into a paid invoice.
 *
 * A TOP-LEVEL route, outside `app/(dashboard)`: someone who clicked "buy" on a
 * public page gets a checkout, not the settings hub. Nothing on this page
 * navigates anywhere except forward, plus one deliberate way out.
 *
 * `?plan=<slug>` names what is bought; without it the door is the kit, in the
 * member's currency (`kit` in BRL, `kit-usd` in USD). The plan's currency
 * decides the provider and therefore the form: BRL asks for the CPF/CNPJ and
 * the payment method, USD continues to Stripe's own page (docs/BILLING.md).
 */
export default async function AssinaturaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t, locale, cookieStore] = await Promise.all([
    searchParams,
    getTranslations("product"),
    getLocale(),
    cookies(),
  ]);
  const rawSlug = Array.isArray(params.plan) ? params.plan[0] : params.plan;
  const requestedSlug = typeof rawSlug === "string" ? rawSlug.trim() : "";
  // The campaign of THIS purchase, forwarded from the landing link.
  const campaign = pickCampaignParams(params);
  const currency = resolveCurrency({ cookie: cookieStore.get(COOKIE_KEYS.currency)?.value, locale });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The middleware already guarantees a session here; this keeps the plan (and
  // the campaign) in the destination.
  if (!user) {
    redirect(`/auth/sign-in?next=${encodeURIComponent(`/assinatura?plan=${requestedSlug}${campaignQuery(campaign)}`)}`);
  }

  const [guaranteeDays, pixAvailable, maxInstallments] = await Promise.all([
    getGuaranteeDays(),
    isPixAvailable(),
    getMaxInstallments(),
  ]);

  // One workspace per member, so the first membership is THE membership.
  const { data: membership } = await supabase
    .from("memberships")
    .select(
      "org_id, role, organizations(name, billing_cpf_cnpj, billing_postal_code, billing_address_number, billing_phone)",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const orgId = (membership?.org_id as string | undefined) ?? null;
  if (!orgId) {
    return (
      <Shell>
        <Typography variant="h1" component="h1" className="mb-0">
          {t("checkout-no-workspace-title")}
        </Typography>
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("checkout-no-workspace-body")}
        </Alert>
        <Button
          variant="contained"
          component={Link}
          href={`/auth/complete-profile?next=${encodeURIComponent(`/assinatura?plan=${requestedSlug}`)}`}
        >
          {t("checkout-no-workspace-action")}
        </Button>
      </Shell>
    );
  }

  const orgRel = membership?.organizations as Record<string, unknown> | Record<string, unknown>[] | null;
  const org = (Array.isArray(orgRel) ? orgRel[0] : orgRel) ?? {};

  // `is_active`, never `is_public`: a limited offer (the founders plan) is
  // deliberately unlisted and reached only by the link it is sent with.
  const planQuery = supabase
    .from("plans")
    .select("id, slug, name, kind, family, tier, period, price_cents, currency, is_free, access_months")
    .eq("is_active", true);
  const { data: planRow } = requestedSlug
    ? await planQuery.eq("slug", requestedSlug).maybeSingle()
    : await planQuery
        .eq("kind", "access")
        .eq("family", "kit")
        .eq("currency", currency)
        .eq("is_public", true)
        .order("sort")
        .limit(1)
        .maybeSingle();

  if (!planRow || planRow.is_free) {
    return (
      <Shell>
        <Typography variant="h1" component="h1" className="mb-0">
          {t("checkout-not-found-title")}
        </Typography>
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("checkout-not-found-body")}
        </Alert>
        <Button variant="contained" component={Link} href="/contato?assunto=assinar">
          {t("checkout-contact")}
        </Button>
      </Shell>
    );
  }

  const oneTime = planRow.kind === "access";
  const planCurrency = planRow.currency === "USD" ? "USD" : "BRL";
  const suffix = planRow.period ? t(`billing-period-${planRow.period}` as never) : t("billing-one-time");
  const priceLabel = `${formatPrice(Number(planRow.price_cents), planCurrency, locale)} ${suffix}`;

  // An access the workspace already holds: buying again is a RENEWAL, and the
  // new term starts when the current one ends (grant_entitlement_on_invoice,
  // 0024), so the form says so instead of refusing the purchase.
  let renewalFrom: string | null = null;
  if (oneTime) {
    const { data: liveGrants } = await supabase
      .from("entitlement_grants")
      .select("expires_at")
      .eq("org_id", orgId)
      .eq("kind", "kit")
      .is("revoked_at", null);
    const ends = (liveGrants ?? []).map((grant) => grant.expires_at as string | null);
    if (ends.length > 0) {
      renewalFrom = ends.includes(null)
        ? null
        : ends.reduce<string | null>((latest, end) => (!latest || (end && end > latest) ? end : latest), null);
    }

    // A kit purchase started in the last day and not granted yet: a PIX being
    // confirmed. Showing the form again would open a second charge.
    const { data: pendingOperation } = await supabase
      .from("billing_operations")
      .select("result, created_at")
      .eq("org_id", orgId)
      .eq("kind", "access_checkout")
      .eq("plan_id", planRow.id)
      .eq("status", "completed")
      .gte("created_at", new Date(Date.now() - PENDING_KIT_WINDOW_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const pendingUrl = (pendingOperation?.result as { url?: string } | null)?.url ?? null;
    if (pendingOperation) {
      return (
        <Shell>
          <Typography variant="h1" component="h1" className="mb-0">
            {t("checkout-pending-title")}
          </Typography>
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("checkout-pending-body", { plan: planRow.name })}
          </Alert>
          {pendingUrl && (
            <Button variant="outlined" component="a" href={pendingUrl} rel="noopener noreferrer">
              {t("checkout-pending-open")}
            </Button>
          )}
          <Button variant="contained" component={Link} href="/inicio">
            {t("checkout-go-platform")}
          </Button>
        </Shell>
      );
    }
  }

  // A subscription: already paying for this exact plan, or waiting on a charge
  // for it (`incomplete` is the state a PIX sits in until the webhook). Several
  // rows are fetched and ranked in code: `maybeSingle()` errors on more than
  // one row, which would switch the double-charge guard off.
  const { data: subscriptionRows } = await supabase
    .from("subscriptions")
    .select("plan_id, status, plans(name, is_free)")
    .eq("org_id", orgId)
    .in("status", ["trialing", "active", "past_due", "incomplete"])
    .order("created_at", { ascending: false })
    .limit(5);
  const rows = subscriptionRows ?? [];
  const currentSub = rows.find((row) => ["trialing", "active", "past_due"].includes(row.status)) ?? null;
  const pendingSub = rows.find((row) => row.status === "incomplete") ?? null;
  const subPlanRel = currentSub?.plans as
    | { name?: string; is_free?: boolean }
    | { name?: string; is_free?: boolean }[]
    | null;
  const subPlan = (Array.isArray(subPlanRel) ? subPlanRel[0] : subPlanRel) ?? null;
  const alreadyHoldsThisPlan = Boolean(currentSub && currentSub.plan_id === planRow.id);

  if (!oneTime && pendingSub && pendingSub.plan_id === planRow.id && !alreadyHoldsThisPlan) {
    // The charge already exists. If it is a PIX whose code can still be read,
    // show THAT code again — the same charge, never a new one.
    const waitingPix = await pendingPixCharge(supabase, orgId, planRow.id as string);
    if (waitingPix) {
      return (
        <Shell wide>
          <Box className="flex justify-center">
            <Logo classNameFull="h-11 w-auto" classNameMobile="hidden" />
          </Box>
          <PixPaymentPanel
            pix={waitingPix}
            orgId={orgId}
            planId={planRow.id as string}
            planName={planRow.name as string}
            priceLabel={priceLabel}
            oneTime={false}
          />
        </Shell>
      );
    }
    return (
      <Shell>
        <Typography variant="h1" component="h1" className="mb-0">
          {t("checkout-pending-title")}
        </Typography>
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("checkout-pending-body", { plan: planRow.name })}
        </Alert>
        <Button variant="contained" component={Link} href="/inicio">
          {t("checkout-go-platform")}
        </Button>
      </Shell>
    );
  }

  if (!oneTime && alreadyHoldsThisPlan) {
    return (
      <Shell>
        <Typography variant="h1" component="h1" className="mb-0">
          {t("checkout-owned-plan-title")}
        </Typography>
        <Alert severity="success" className="neutral bg-background-paper/60!">
          {t("checkout-owned-plan-body", { plan: planRow.name })}
        </Alert>
        <Button variant="contained" component={Link} href="/inicio">
          {t("checkout-go-platform")}
        </Button>
      </Shell>
    );
  }

  // Installments in BRL, on a card, for the one-time access or a yearly plan
  // (the server re-applies the same rule, lib/payment-choice.ts).
  const splittable = planCurrency === "BRL" && (oneTime || planRow.period === "yearly");

  return (
    <Shell wide>
      <Box className="flex justify-center">
        <Logo classNameFull="h-11 w-auto" classNameMobile="hidden" />
      </Box>

      <CheckoutForm
        orgId={orgId}
        planId={planRow.id as string}
        planName={planRow.name as string}
        priceLabel={priceLabel}
        currency={planCurrency}
        oneTime={oneTime}
        accessMonths={oneTime ? ((planRow.access_months as number | null) ?? null) : null}
        renewalFrom={renewalFrom}
        guaranteeDays={guaranteeDays}
        priceCents={Number(planRow.price_cents)}
        maxInstallments={splittable ? maxInstallments : 1}
        pixAvailable={planCurrency === "BRL" && pixAvailable}
        campaign={campaign}
        // Only the owner or an admin may start a checkout; saying so up front
        // beats letting her fill a form the server will refuse.
        canManage={membership?.role === "owner" || membership?.role === "admin"}
        // A paid subscription already exists: switching starts a NEW one and
        // retires the current one, with no credit for days already paid.
        switchingFrom={!oneTime && currentSub && !subPlan?.is_free ? (subPlan?.name ?? null) : null}
        profile={{
          document: (org.billing_cpf_cnpj as string | null) ?? null,
          postalCode: (org.billing_postal_code as string | null) ?? null,
          addressNumber: (org.billing_address_number as string | null) ?? null,
          phone: (org.billing_phone as string | null) ?? null,
        }}
      />
    </Shell>
  );
}

/** Same chrome-less card the other top-level authenticated screens use. */
function Shell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
      <Paper
        elevation={3}
        className={
          wide
            ? "bg-background-paper shadow-darker-xs w-2xl max-w-full rounded-4xl py-10"
            : "bg-background-paper shadow-darker-xs w-lg max-w-full rounded-4xl py-12"
        }
      >
        <Box className="flex flex-col gap-5 px-6 sm:px-12">{children}</Box>
      </Paper>
    </Box>
  );
}
