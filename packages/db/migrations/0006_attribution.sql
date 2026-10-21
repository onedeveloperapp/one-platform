-- ============================================================
-- 0006_attribution: where firms and purchases came from.
--
-- Vocabulary: `origem` is the entry door, the page, partner or channel a link
-- names with `?origem=`. `onda` is the campaign wave.
--
-- Nothing here counts visits or follows a person: the site is measured by the
-- consented tags of the public pages, and the logged area carries no tracker.
-- ============================================================

-- ---------- First touch of a firm ----------

create table public.signup_attribution (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  origem text,
  onda text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer text,
  landing_path text,
  captured_at timestamptz not null default now(),
  constraint signup_attribution_lengths check (
    coalesce(length(origem), 0) <= 64
    and coalesce(length(onda), 0) <= 64
    and coalesce(length(utm_source), 0) <= 64
    and coalesce(length(utm_medium), 0) <= 64
    and coalesce(length(utm_campaign), 0) <= 64
    and coalesce(length(utm_content), 0) <= 64
    and coalesce(length(utm_term), 0) <= 64
    and coalesce(length(referrer), 0) <= 255
    and coalesce(length(landing_path), 0) <= 255
  )
);

comment on table public.signup_attribution is
  'First-touch campaign attribution of a firm, written once by the backend when the firm is created. Never updated: a later campaign does not get credit for a firm an earlier one brought.';

create index signup_attribution_origem_idx on public.signup_attribution (origem, captured_at desc);
create index signup_attribution_onda_idx on public.signup_attribution (onda, captured_at desc);

alter table public.signup_attribution enable row level security;

create policy "signup_attribution_select_superadmin" on public.signup_attribution
  for select to authenticated
  using (public.is_superadmin());

grant select on table public.signup_attribution to authenticated;

-- ---------- Ad-platform context of a firm ----------

-- What the server-side conversion events (Meta CAPI, GA4 Measurement
-- Protocol) need to be matched to a browser, plus the LAST campaign that
-- brought the firm to a checkout. Backend only: no policy, no grant.
create table public.meta_attribution (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  fbp text,
  fbc text,
  ga_client_id text,
  email text,
  client_ip text,
  client_user_agent text,
  campaign_origem text,
  campaign_utm_source text,
  campaign_utm_medium text,
  campaign_utm_campaign text,
  campaign_utm_content text,
  campaign_captured_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint meta_attribution_campaign_lengths check (
    coalesce(length(campaign_origem), 0) <= 64
    and coalesce(length(campaign_utm_source), 0) <= 64
    and coalesce(length(campaign_utm_medium), 0) <= 64
    and coalesce(length(campaign_utm_campaign), 0) <= 64
    and coalesce(length(campaign_utm_content), 0) <= 64
  )
);

alter table public.meta_attribution enable row level security;

-- ---------- Purchases credited to a campaign ----------

-- One row per paid invoice whose checkout carried a campaign. Counted only
-- while the invoice stays paid (purchase_attribution_is_paid): refunds and
-- chargebacks drop out of every report without anything being deleted.
create table public.purchase_attributions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  invoice_key text not null unique check (char_length(invoice_key) <= 200),
  subscription_id uuid,
  plan_slug text check (plan_slug is null or char_length(plan_slug) <= 80),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null check (currency in ('BRL', 'USD')),
  paid_at timestamptz not null,
  origem text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  campaign_captured_at timestamptz,
  created_at timestamptz not null default now(),
  constraint purchase_attributions_lengths check (
    coalesce(length(origem), 0) <= 64
    and coalesce(length(utm_source), 0) <= 64
    and coalesce(length(utm_medium), 0) <= 64
    and coalesce(length(utm_campaign), 0) <= 64
    and coalesce(length(utm_content), 0) <= 64
  )
);

create index purchase_attributions_org_idx on public.purchase_attributions (org_id);
create index purchase_attributions_campaign_idx on public.purchase_attributions (utm_campaign, paid_at desc);
create index purchase_attributions_origem_idx on public.purchase_attributions (origem, paid_at desc);

alter table public.purchase_attributions enable row level security;

create policy "purchase_attributions_select_superadmin" on public.purchase_attributions
  for select to authenticated
  using (public.is_superadmin());

grant select on table public.purchase_attributions to authenticated;

create or replace function public.purchase_attribution_is_paid(target_invoice_key text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.invoices i
    where i.provider::text || ':' || i.provider_invoice_id = target_invoice_key
      and i.status = 'paid'
  );
$$;

revoke all on function public.purchase_attribution_is_paid(text) from public, anon;
grant execute on function public.purchase_attribution_is_paid(text) to authenticated;
