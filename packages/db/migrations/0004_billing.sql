-- ============================================================
-- 0004_billing: plan catalog, subscriptions, invoices, entitlement grants and
-- the idempotent checkout and webhook machinery.
--
-- INHERITED SHAPE. This file carries the billing ladder of the base ONE was
-- built over: a one-time ACCESS purchase that leaves an entitlement grant,
-- RECURRING subscriptions on top, BRL charged by Asaas and USD by Stripe, and
-- the rungs `kit`, `club` and `pro`. ONE sells one thing, the firm's
-- subscription in BRL, with tiers as data; the plan
-- (docs/ONE-PLANO-DESENVOLVIMENTO.md, M3) rewrites this file to that shape
-- before the first production deploy. Until then nothing seeds a priced plan:
-- the operator creates plans in the console.
--
-- Naming: `modules` below are BILLING add-ons (an extra sold on top of a plan).
-- ============================================================

create type public.plan_kind as enum ('recurring', 'access');
create type public.billing_period as enum ('weekly', 'monthly', 'yearly');
create type public.billing_provider as enum ('stripe', 'asaas');
create type public.subscription_status as enum ('incomplete', 'trialing', 'active', 'past_due', 'canceled');
create type public.invoice_status as enum ('open', 'paid', 'failed', 'refunded', 'void');
create type public.discount_type as enum ('percent', 'fixed');
create type public.coupon_duration as enum ('once', 'repeating', 'forever');
create type public.module_kind as enum ('recurring', 'one_time');
create type public.subscription_cancel_reason as enum (
  'too_expensive',
  'not_using',
  'missing_tool',
  'switched',
  'technical',
  'temporary',
  'other'
);

-- ---------- Plans ----------

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  kind public.plan_kind not null default 'recurring',
  -- Groups the same offer across periods and currencies (kit, club, pro, free).
  family text not null,
  -- The rung of the ladder this plan grants. NULL for the free plan and for
  -- add-ons.
  tier text,
  period public.billing_period,
  price_cents integer not null default 0,
  currency text not null default 'BRL',
  -- The PROVIDER's checkout trial. Seeded 0: there is no trial in v1.
  trial_days integer not null default 0,
  is_free boolean not null default false,
  is_active boolean not null default true,
  is_public boolean not null default true,
  is_addon boolean not null default false,
  limits jsonb not null default '{}'::jsonb,
  provider_refs jsonb not null default '{}'::jsonb,
  sort integer not null default 0,
  -- How long a one-time access lasts, in months from the paid invoice; NULL
  -- means it never ends. Only for kind = access.
  access_months integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_access_months_check check (access_months is null or access_months > 0),
  -- A recurring plan has a period; only an access purchase has a term.
  constraint plans_access_months_kind check (kind = 'access' or access_months is null),
  constraint plans_slug_check check (slug ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  constraint plans_family_check check (family ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  constraint plans_tier_check check (tier is null or tier in ('kit', 'club', 'pro')),
  constraint plans_currency_check check (currency in ('BRL', 'USD')),
  constraint plans_price_check check (price_cents >= 0),
  constraint plans_trial_check check (trial_days >= 0),
  constraint plans_free_price check (not is_free or price_cents = 0),
  constraint plans_recurring_period check (kind <> 'recurring' or period is not null),
  constraint plans_access_no_period check (kind <> 'access' or period is null)
);

comment on column public.plans.is_active is
  'Whether the plan may be charged for at all: checkout and set_org_plan both refuse an inactive plan. To take an offer out of the catalog while keeping it sellable, use is_public.';
comment on column public.plans.is_public is
  'Whether the plan appears in the pricing grids. A plan with is_active = true and is_public = false stays purchasable through a direct link and assignable by a superadmin: that is how an offer is sold without publishing its price.';
comment on column public.plans.limits is
  'Entitlement keys this plan grants, as data (for example assentos_max, the seat ceiling of the team). Read only through org_entitlements().';

-- The grid shows one price per offer, period and currency.
create unique index plans_one_public_recurring_idx
  on public.plans (family, period, currency)
  where is_public and is_active and not is_addon and period is not null;
create unique index plans_one_public_access_idx
  on public.plans (family, currency)
  where is_public and is_active and not is_addon and period is null;

alter table public.plans enable row level security;

create policy "plans_select" on public.plans
  for select to authenticated
  using (is_active or public.is_superadmin());

create policy "plans_all_superadmin" on public.plans
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

grant select, insert, update, delete on table public.plans to authenticated;

create trigger plans_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

-- ---------- Billing add-ons ----------

create table public.modules (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  kind public.module_kind not null default 'recurring',
  price_cents integer not null default 0,
  currency text not null default 'BRL' check (currency in ('BRL', 'USD')),
  limits jsonb not null default '{}'::jsonb,
  provider_refs jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.modules enable row level security;

create policy "modules_select" on public.modules
  for select to authenticated
  using (is_active or public.is_superadmin());

create policy "modules_all_superadmin" on public.modules
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

grant select, insert, update, delete on table public.modules to authenticated;

create trigger modules_updated_at
  before update on public.modules
  for each row execute function public.set_updated_at();

-- ---------- Coupons ----------

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  discount_type public.discount_type not null,
  discount_value integer not null,
  -- A fixed discount is an amount of money, so it belongs to one currency. A
  -- percentage applies to any.
  currency text,
  -- NULL = every plan family.
  plan_families text[],
  duration public.coupon_duration not null default 'once',
  duration_months integer,
  max_redemptions integer,
  redeemed_count integer not null default 0,
  valid_until timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint coupons_code_check check (code = upper(code) and code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  constraint coupons_value_check check (
    (discount_type = 'percent' and discount_value between 1 and 100)
    or (discount_type = 'fixed' and discount_value > 0)
  ),
  constraint coupons_currency_check check (currency is null or currency in ('BRL', 'USD')),
  constraint coupons_fixed_currency check (discount_type <> 'fixed' or currency is not null),
  constraint coupons_duration_months check (
    (duration = 'repeating' and duration_months is not null and duration_months > 0)
    or (duration <> 'repeating' and duration_months is null)
  ),
  constraint coupons_redemptions_check check (max_redemptions is null or max_redemptions > 0)
);

alter table public.coupons enable row level security;

create policy "coupons_all_superadmin" on public.coupons
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

grant select, insert, update, delete on table public.coupons to authenticated;

-- ---------- Subscriptions ----------

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  status public.subscription_status not null default 'incomplete',
  -- Superadmin kill-switch: blocks access regardless of payment status.
  admin_suspended boolean not null default false,
  provider public.billing_provider,
  provider_customer_id text,
  provider_subscription_id text,
  -- A yearly plan paid in installments is ONE provider payment, not a provider
  -- subscription. It activates for a year and does not renew by itself.
  provider_payment_id text,
  renews boolean not null default true,
  period public.billing_period,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  coupon_id uuid references public.coupons (id) on delete set null,
  -- What THIS member was sold, frozen at checkout. A later price change in
  -- `plans` never touches a live subscription.
  price_cents integer,
  currency text,
  coupon_code_snapshot text,
  payment_method text,
  cancel_at_period_end boolean not null default false,
  cancellation_requested_at timestamptz,
  cancel_reason public.subscription_cancel_reason,
  cancel_note text,
  canceled_at timestamptz,
  past_due_since timestamptz,
  -- Until when a not-yet-confirmed PIX releases the plan. Once per firm.
  provisional_until timestamptz,
  billing_operation_id uuid,
  -- When the "your paid period is ending" notice went out for this period.
  -- Cleared when the period changes.
  term_notice_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_payment_method_check
    check (payment_method is null or payment_method in ('pix', 'credit_card')),
  constraint subscriptions_currency_check check (currency is null or currency in ('BRL', 'USD')),
  constraint subscriptions_price_check check (price_cents is null or price_cents >= 0),
  constraint subscriptions_cancel_note_length check (cancel_note is null or char_length(cancel_note) <= 500)
);

-- One LIVE subscription per firm. Everything that changes a tier updates
-- or supersedes this row; nothing inserts a second one.
create unique index subscriptions_org_live_unique on public.subscriptions (org_id)
  where status in ('trialing', 'active', 'past_due');
create unique index subscriptions_provider_subscription_unique_idx
  on public.subscriptions (provider, provider_subscription_id)
  where provider is not null and provider_subscription_id is not null;
create unique index subscriptions_provider_payment_unique_idx
  on public.subscriptions (provider, provider_payment_id)
  where provider is not null and provider_payment_id is not null;
create unique index subscriptions_billing_operation_unique_idx
  on public.subscriptions (billing_operation_id)
  where billing_operation_id is not null;
create index subscriptions_org_idx on public.subscriptions (org_id, created_at desc);
create index subscriptions_cancellation_due_idx on public.subscriptions (current_period_end)
  where cancel_at_period_end = true and status in ('trialing', 'active', 'past_due');

alter table public.subscriptions enable row level security;

create policy "subscriptions_select_member" on public.subscriptions
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

create policy "subscriptions_all_superadmin" on public.subscriptions
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

grant select, insert, update, delete on table public.subscriptions to authenticated;

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

select public.enable_row_versioning('public.subscriptions');

create table public.subscription_modules (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  module_id uuid not null references public.modules (id),
  status text not null default 'active' check (status in ('active', 'canceled')),
  provider_item_id text,
  added_at timestamptz not null default now(),
  canceled_at timestamptz,
  unique (subscription_id, module_id)
);

alter table public.subscription_modules enable row level security;

create policy "subscription_modules_select_member" on public.subscription_modules
  for select to authenticated
  using (
    exists (
      select 1 from public.subscriptions s
      where s.id = subscription_modules.subscription_id
        and (public.is_org_member(s.org_id) or public.is_superadmin())
    )
  );

create policy "subscription_modules_all_superadmin" on public.subscription_modules
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

grant select, insert, update, delete on table public.subscription_modules to authenticated;

-- ---------- Invoices ----------

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  -- What was bought. Set for one-time access purchases, which have no
  -- subscription to read it from.
  plan_id uuid references public.plans (id) on delete set null,
  provider public.billing_provider not null,
  provider_invoice_id text not null,
  amount_cents integer not null,
  currency text not null default 'BRL' check (currency in ('BRL', 'USD')),
  status public.invoice_status not null default 'open',
  description text,
  invoice_url text,
  -- The fiscal document (NFS-e). Asaas issues it for BRL sales; the operator
  -- pastes the link for USD ones.
  fiscal_document_url text,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_invoice_id)
);

create index invoices_org_idx on public.invoices (org_id, created_at desc);
create index invoices_paid_idx on public.invoices (paid_at) where status = 'paid';

alter table public.invoices enable row level security;

create policy "invoices_select_member" on public.invoices
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

create policy "invoices_all_superadmin" on public.invoices
  for all to authenticated
  using (public.is_superadmin())
  with check (public.is_superadmin());

grant select, insert, update, delete on table public.invoices to authenticated;

select public.enable_row_versioning('public.invoices');

-- ---------- Entitlement grants ----------

/**
 * A right that does not depend on a live subscription: an access a firm
 * bought once, or a courtesy from the platform team. A grant
 * carries a SNAPSHOT of the limits it grants, so editing the plan later never
 * changes what somebody already paid for.
 *
 * `expires_at` is NULL for the kit: it has no end date. A grant stops counting
 * when it is revoked (a refund, a chargeback, an operator) or expires.
 *
 * Rows are written only by grant_entitlement_on_invoice (the paid webhook),
 * grant_entitlement (the console, 0004) and their revoke counterparts.
 */
create table public.entitlement_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('kit', 'license', 'comp')),
  plan_id uuid references public.plans (id) on delete set null,
  limits jsonb not null default '{}'::jsonb,
  price_cents integer not null default 0 check (price_cents >= 0),
  currency text check (currency is null or currency in ('BRL', 'USD')),
  -- `<provider>:<provider invoice id>`: the idempotency fence of the webhook.
  invoice_key text unique,
  source text not null default 'purchase' check (source in ('purchase', 'admin')),
  granted_by uuid references public.profiles (id) on delete set null,
  note text,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  -- When the "your access ends on" notice went out for this grant.
  end_notice_sent_at timestamptz,
  -- When the end of this grant was settled and the people of the firm told.
  ended_handled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint entitlement_grants_purchase_key check (source <> 'purchase' or invoice_key is not null),
  constraint entitlement_grants_window check (expires_at is null or expires_at > starts_at)
);

create index entitlement_grants_org_idx on public.entitlement_grants (org_id, created_at desc);
create index entitlement_grants_live_idx on public.entitlement_grants (org_id) where revoked_at is null;

alter table public.entitlement_grants enable row level security;

create policy "entitlement_grants_select_member" on public.entitlement_grants
  for select to authenticated
  using (public.is_org_member(org_id) or public.is_superadmin());

grant select on table public.entitlement_grants to authenticated;

select public.enable_row_versioning('public.entitlement_grants');

-- ---------- Idempotent operations and webhook events ----------

create table public.billing_operations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('checkout', 'access_checkout', 'cancel', 'resume')),
  idempotency_key uuid not null,
  plan_id uuid references public.plans (id) on delete set null,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  provider text check (provider is null or provider in ('stripe', 'asaas')),
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  claim_token uuid,
  result jsonb not null default '{}'::jsonb,
  error_code text,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_operations_processing_claim_check
    check (status <> 'processing' or (claim_token is not null and lease_expires_at is not null)),
  unique (org_id, kind, idempotency_key)
);

alter table public.subscriptions
  add constraint subscriptions_billing_operation_id_fkey
  foreign key (billing_operation_id) references public.billing_operations (id) on delete set null;

alter table public.billing_operations enable row level security;

create policy "billing_operations_select_manager" on public.billing_operations
  for select to authenticated
  using (actor_id = auth.uid() and public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

grant select on table public.billing_operations to authenticated;

-- No policy and no grant: only the service role reads or writes it.
create table public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'asaas')),
  provider_event_id text not null,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  claim_token uuid,
  lease_expires_at timestamptz,
  error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_webhooks_processing_claim_check
    check (status <> 'processing' or (claim_token is not null and lease_expires_at is not null)),
  unique (provider, provider_event_id, event_type)
);

alter table public.billing_webhook_events enable row level security;

-- ---------- Small helpers ----------

create or replace function public.jsonb_merge(a jsonb, b jsonb)
returns jsonb
language sql
immutable
as $$ select coalesce(a, '{}'::jsonb) || coalesce(b, '{}'::jsonb); $$;

revoke all on function public.jsonb_merge(jsonb, jsonb) from public, anon;
grant execute on function public.jsonb_merge(jsonb, jsonb) to authenticated;

create aggregate public.jsonb_merge_agg(jsonb) (
  sfunc = public.jsonb_merge,
  stype = jsonb,
  initcond = '{}'
);

revoke all on function public.jsonb_merge_agg(jsonb) from public, anon;
grant execute on function public.jsonb_merge_agg(jsonb) to authenticated;

/**
 * A coupon that may be applied now, optionally to one plan. With a plan, the
 * coupon must cover the plan's family and, for a fixed amount, be in the
 * plan's currency: R$ 20 off is not US$ 20 off.
 */
create or replace function public.validate_coupon(coupon_code text, target_plan uuid default null)
returns table (
  id uuid,
  code text,
  discount_type public.discount_type,
  discount_value integer,
  currency text,
  duration public.coupon_duration,
  duration_months integer
)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.code, c.discount_type, c.discount_value, c.currency, c.duration, c.duration_months
  from public.coupons c
  left join public.plans p on p.id = target_plan
  where c.code = upper(btrim(coupon_code))
    and c.is_active
    and (c.valid_until is null or c.valid_until > now())
    and (c.max_redemptions is null or c.redeemed_count < c.max_redemptions)
    and (
      target_plan is null
      or (
        p.id is not null
        and not p.is_free
        and (c.plan_families is null or p.family = any (c.plan_families))
        and (c.discount_type = 'percent' or c.currency = p.currency)
      )
    );
$$;

revoke all on function public.validate_coupon(text, uuid) from public, anon;
grant execute on function public.validate_coupon(text, uuid) to authenticated;

/**
 * When the dunning grace of a past_due subscription ends. The ONE answer every
 * gate shares, so they cannot disagree about the same firm. The window
 * is configuration (`platform_settings` key `dunning`, `grace_days`).
 */
create or replace function public.billing_past_due_grace_ends(subscription_row public.subscriptions)
returns timestamptz
language sql
security definer
set search_path = public
stable
as $$
  select case
    when subscription_row.id is null or subscription_row.status <> 'past_due' then null
    else coalesce(subscription_row.past_due_since, subscription_row.updated_at, now())
      + make_interval(days => greatest(
          coalesce((select (value ->> 'grace_days')::int from public.platform_settings where key = 'dunning'), 0),
          0
        ))
  end;
$$;

revoke all on function public.billing_past_due_grace_ends(public.subscriptions) from public, anon;
grant execute on function public.billing_past_due_grace_ends(public.subscriptions) to authenticated;

-- ---------- The floor plan follows every firm ----------

create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  free_plan public.plans%rowtype;
begin
  select * into free_plan
  from public.plans
  where is_free and is_active
  order by created_at
  limit 1;

  if found then
    insert into public.subscriptions (org_id, plan_id, status, period, price_cents, currency)
    values (new.id, free_plan.id, 'active', free_plan.period, 0, free_plan.currency);
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_organization() from public, anon;

create trigger on_organization_created
  after insert on public.organizations
  for each row execute function public.handle_new_organization();

-- Puts a firm back on the floor plan after its paid subscription ended.
create or replace function public.ensure_free_subscription(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  free_plan public.plans%rowtype;
  inserted_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_org is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  select * into free_plan
  from public.plans
  where is_free and is_active
  order by created_at
  limit 1;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'no_free_plan');
  end if;

  insert into public.subscriptions (org_id, plan_id, status, period, price_cents, currency)
  values (target_org, free_plan.id, 'active', free_plan.period, 0, free_plan.currency)
  on conflict do nothing
  returning id into inserted_id;

  if inserted_id is null then
    return jsonb_build_object('ok', true, 'code', 'already_live');
  end if;
  return jsonb_build_object('ok', true, 'code', 'created', 'subscriptionId', inserted_id);
end;
$$;

revoke all on function public.ensure_free_subscription(uuid) from public, anon, authenticated;

-- ---------- Billing profile ----------

/**
 * The Brazilian billing profile Asaas needs to issue a charge. Every field is
 * optional HERE: a USD buyer goes through Stripe and has no CPF. The checkout
 * action is what requires the document when the provider is Asaas.
 */
create or replace function public.update_billing_profile(
  target_org uuid,
  target_cpf_cnpj text,
  target_postal_code text,
  target_address_number text,
  target_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  digits_document text := nullif(regexp_replace(coalesce(target_cpf_cnpj, ''), '[^0-9]', '', 'g'), '');
  digits_postal text := nullif(regexp_replace(coalesce(target_postal_code, ''), '[^0-9]', '', 'g'), '');
  digits_phone text := nullif(regexp_replace(coalesce(target_phone, ''), '[^0-9]', '', 'g'), '');
  normalized_number text := nullif(btrim(coalesce(target_address_number, '')), '');
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;
  if digits_document is not null and digits_document !~ '^([0-9]{11}|[0-9]{14})$' then
    raise exception using errcode = '22023', message = 'invalid_document';
  end if;
  if digits_postal is not null and digits_postal !~ '^[0-9]{8}$' then
    raise exception using errcode = '22023', message = 'invalid_postal_code';
  end if;
  if digits_phone is not null and digits_phone !~ '^[0-9]{10,11}$' then
    raise exception using errcode = '22023', message = 'invalid_phone';
  end if;
  if normalized_number is not null and char_length(normalized_number) > 20 then
    raise exception using errcode = '22023', message = 'invalid_address_number';
  end if;

  update public.organizations
     set billing_cpf_cnpj = digits_document,
         billing_postal_code = digits_postal,
         billing_address_number = normalized_number,
         billing_phone = digits_phone,
         updated_at = now()
   where id = target_org;

  if not found then
    raise exception using errcode = 'P0002', message = 'organization_not_found';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.update_billing_profile(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_billing_profile(uuid, text, text, text, text) to authenticated;

-- ---------- Billing operations (idempotent server actions) ----------

/**
 * Claims the right to run one billing action. The idempotency key makes a
 * double click, a retry and two tabs resolve to ONE provider call: the second
 * caller either gets the first one's result or is told it is still running.
 */
create or replace function public.claim_billing_operation(
  target_org uuid,
  target_actor uuid,
  target_kind text,
  target_idempotency_key uuid,
  target_provider text default null,
  target_plan uuid default null,
  target_subscription uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_row public.billing_operations%rowtype;
  inserted_count integer := 0;
  claimed_token uuid;
begin
  if auth.role() is distinct from 'service_role'
     or target_org is null
     or target_actor is null
     or target_kind is null
     or target_kind not in ('checkout', 'access_checkout', 'cancel', 'resume')
     or target_idempotency_key is null
     or target_provider is null
     or target_provider not in ('stripe', 'asaas') then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = target_actor and m.role in ('owner', 'admin')
  ) then return jsonb_build_object('ok', false, 'code', 'not_authorized'); end if;

  insert into public.billing_operations (
    org_id, actor_id, kind, idempotency_key, provider, plan_id,
    subscription_id, status, claim_token, lease_expires_at
  ) values (
    target_org, target_actor, target_kind, target_idempotency_key, target_provider,
    target_plan, target_subscription, 'processing', gen_random_uuid(), now() + interval '2 minutes'
  )
  on conflict (org_id, kind, idempotency_key) do nothing;
  get diagnostics inserted_count = row_count;

  select o.* into operation_row from public.billing_operations o
  where o.org_id = target_org and o.kind = target_kind and o.idempotency_key = target_idempotency_key
  for update;

  if operation_row.actor_id <> target_actor
     or operation_row.provider is distinct from target_provider
     or operation_row.plan_id is distinct from target_plan
     or operation_row.subscription_id is distinct from target_subscription then
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  if operation_row.status = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'completed', 'operationId', operation_row.id, 'result', operation_row.result);
  end if;
  if inserted_count = 0
     and operation_row.status = 'processing'
     and operation_row.lease_expires_at is not null
     and operation_row.lease_expires_at > now() then
    return jsonb_build_object('ok', false, 'code', 'operation_in_progress');
  end if;

  update public.billing_operations
  set status = 'processing',
      attempts = case when inserted_count = 0 then attempts + 1 else attempts end,
      claim_token = gen_random_uuid(),
      lease_expires_at = now() + interval '2 minutes',
      error_code = null,
      completed_at = null,
      updated_at = now()
  where id = operation_row.id
  returning claim_token into claimed_token;
  return jsonb_build_object(
    'ok', true,
    'code', 'claimed',
    'operationId', operation_row.id,
    'claimToken', claimed_token
  );
end;
$$;

revoke all on function public.claim_billing_operation(uuid, uuid, text, uuid, text, uuid, uuid) from public, anon, authenticated;

create or replace function public.complete_billing_operation(
  target_operation uuid,
  target_claim_token uuid,
  target_success boolean,
  target_result jsonb default '{}'::jsonb,
  target_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
     or target_operation is null
     or target_claim_token is null
     or target_success is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  update public.billing_operations
  set status = case when target_success then 'completed' else 'failed' end,
      result = case when target_success then coalesce(target_result, '{}'::jsonb) else result end,
      error_code = case when target_success then null else coalesce(nullif(btrim(target_error_code), ''), 'provider_unavailable') end,
      completed_at = case when target_success then now() else null end,
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where id = target_operation
    and status = 'processing'
    and claim_token = target_claim_token
    and lease_expires_at is not null
    and lease_expires_at > clock_timestamp();
  if not found then
    if exists (select 1 from public.billing_operations where id = target_operation) then
      return jsonb_build_object('ok', false, 'code', 'claim_lost');
    end if;
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', target_success, 'code', case when target_success then 'completed' else 'failed' end);
end;
$$;

revoke all on function public.complete_billing_operation(uuid, uuid, boolean, jsonb, text) from public, anon, authenticated;

/**
 * Finishes a SUBSCRIPTION checkout: writes the incomplete subscription the
 * webhook will activate, with the price the firm was sold frozen on it.
 *
 * Three ways the provider identifies what was created, in order:
 *   a provider subscription          the normal recurring case
 *   a provider payment               a yearly plan paid in installments: one
 *                                    payment, no provider subscription, so the
 *                                    row is marked `renews = false`
 *   neither (yet)                    keyed by the operation itself
 */
create or replace function public.complete_checkout_billing_operation(
  target_operation uuid,
  target_claim_token uuid,
  target_plan uuid,
  target_period text,
  target_provider_customer text,
  target_provider_subscription text,
  target_checkout_url text,
  target_price_cents integer default null,
  target_currency text default null,
  target_coupon_code text default null,
  target_provider_payment text default null,
  target_renews boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_row public.billing_operations%rowtype;
  subscription_row public.subscriptions%rowtype;
  plan_row public.plans%rowtype;
  sold_price integer;
  sold_currency text;
  provider_subscription text := nullif(btrim(target_provider_subscription), '');
  provider_payment text := nullif(btrim(target_provider_payment), '');
  will_renew boolean := coalesce(target_renews, true);
begin
  if auth.role() is distinct from 'service_role'
     or target_operation is null
     or target_claim_token is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  select o.* into operation_row from public.billing_operations o
  where o.id = target_operation for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if operation_row.status = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'completed', 'result', operation_row.result);
  end if;
  if operation_row.kind <> 'checkout'
     or operation_row.plan_id is distinct from target_plan then
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  if operation_row.status <> 'processing'
     or operation_row.claim_token is distinct from target_claim_token
     or operation_row.lease_expires_at is null
     or operation_row.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'code', 'claim_lost');
  end if;
  if target_plan is null
     or target_period is null
     or target_period not in ('weekly', 'monthly', 'yearly')
     or nullif(btrim(target_checkout_url), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_result');
  end if;

  select * into plan_row from public.plans where id = target_plan;
  if not found or plan_row.kind <> 'recurring' or plan_row.is_addon then
    return jsonb_build_object('ok', false, 'code', 'invalid_result');
  end if;

  sold_price := coalesce(target_price_cents, plan_row.price_cents);
  sold_currency := coalesce(nullif(btrim(target_currency), ''), plan_row.currency);
  if sold_price < 0 or sold_currency not in ('BRL', 'USD') then
    return jsonb_build_object('ok', false, 'code', 'invalid_result');
  end if;
  -- A single provider payment never renews by itself.
  if provider_subscription is null and provider_payment is not null then
    will_renew := false;
  end if;

  if provider_subscription is not null then
    insert into public.subscriptions (
      org_id, plan_id, status, provider, provider_subscription_id, provider_payment_id,
      provider_customer_id, period, billing_operation_id,
      price_cents, currency, coupon_code_snapshot, renews
    ) values (
      operation_row.org_id, target_plan, 'incomplete', operation_row.provider::public.billing_provider,
      provider_subscription, provider_payment, target_provider_customer, target_period::public.billing_period,
      operation_row.id, sold_price, sold_currency, nullif(btrim(target_coupon_code), ''), will_renew
    )
    on conflict (provider, provider_subscription_id)
      where provider is not null and provider_subscription_id is not null
    do update set
      provider_customer_id = coalesce(excluded.provider_customer_id, public.subscriptions.provider_customer_id),
      updated_at = now()
    where public.subscriptions.org_id = excluded.org_id
      and public.subscriptions.plan_id = excluded.plan_id
    returning * into subscription_row;
  elsif provider_payment is not null then
    insert into public.subscriptions (
      org_id, plan_id, status, provider, provider_payment_id,
      provider_customer_id, period, billing_operation_id,
      price_cents, currency, coupon_code_snapshot, renews
    ) values (
      operation_row.org_id, target_plan, 'incomplete', operation_row.provider::public.billing_provider,
      provider_payment, target_provider_customer, target_period::public.billing_period,
      operation_row.id, sold_price, sold_currency, nullif(btrim(target_coupon_code), ''), false
    )
    on conflict (provider, provider_payment_id)
      where provider is not null and provider_payment_id is not null
    do update set
      provider_customer_id = coalesce(excluded.provider_customer_id, public.subscriptions.provider_customer_id),
      updated_at = now()
    where public.subscriptions.org_id = excluded.org_id
      and public.subscriptions.plan_id = excluded.plan_id
    returning * into subscription_row;
  else
    insert into public.subscriptions (
      org_id, plan_id, status, provider, provider_customer_id, period, billing_operation_id,
      price_cents, currency, coupon_code_snapshot, renews
    ) values (
      operation_row.org_id, target_plan, 'incomplete', operation_row.provider::public.billing_provider,
      target_provider_customer, target_period::public.billing_period, operation_row.id,
      sold_price, sold_currency, nullif(btrim(target_coupon_code), ''), will_renew
    )
    on conflict (billing_operation_id) where billing_operation_id is not null do update
      set provider_customer_id = coalesce(excluded.provider_customer_id, public.subscriptions.provider_customer_id),
          updated_at = now()
    returning * into subscription_row;
  end if;

  if subscription_row.id is null then
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;

  update public.billing_operations
  set status = 'completed',
      subscription_id = subscription_row.id,
      result = jsonb_build_object('url', target_checkout_url, 'subscriptionId', subscription_row.id),
      completed_at = now(), claim_token = null, lease_expires_at = null, error_code = null, updated_at = now()
  where id = operation_row.id;
  return jsonb_build_object('ok', true, 'code', 'completed', 'result', jsonb_build_object('url', target_checkout_url));
end;
$$;

revoke all on function public.complete_checkout_billing_operation(uuid, uuid, uuid, text, text, text, text, integer, text, text, text, boolean)
  from public, anon, authenticated;

/**
 * Finishes a ONE-TIME ACCESS checkout. It writes no subscription: a firm holds
 * one live subscription, and a one-time access must coexist with it.
 * The right itself is granted later, by the webhook, on the PAID invoice
 * (grant_entitlement_on_invoice) and never at checkout start.
 */
create or replace function public.complete_access_checkout_billing_operation(
  target_operation uuid,
  target_claim_token uuid,
  target_plan uuid,
  target_checkout_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_row public.billing_operations%rowtype;
begin
  if auth.role() is distinct from 'service_role'
     or target_operation is null
     or target_claim_token is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select o.* into operation_row from public.billing_operations o
  where o.id = target_operation for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if operation_row.status = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'completed', 'result', operation_row.result);
  end if;
  if operation_row.kind <> 'access_checkout'
     or operation_row.plan_id is distinct from target_plan then
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict');
  end if;
  if operation_row.status <> 'processing'
     or operation_row.claim_token is distinct from target_claim_token
     or operation_row.lease_expires_at is null
     or operation_row.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('ok', false, 'code', 'claim_lost');
  end if;
  if target_plan is null or nullif(btrim(target_checkout_url), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_result');
  end if;
  if not exists (
    select 1 from public.plans
    where id = target_plan and kind = 'access' and is_active and not is_free
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_result');
  end if;

  update public.billing_operations
  set status = 'completed',
      result = jsonb_build_object('url', target_checkout_url),
      completed_at = now(), claim_token = null, lease_expires_at = null, error_code = null, updated_at = now()
  where id = operation_row.id;

  return jsonb_build_object('ok', true, 'code', 'completed', 'result', jsonb_build_object('url', target_checkout_url));
end;
$$;

revoke all on function public.complete_access_checkout_billing_operation(uuid, uuid, uuid, text)
  from public, anon, authenticated;

/**
 * Commits a cancellation (at period end) or its undo. The reason is recorded
 * with the cancellation and cleared when it is undone: a firm that stays did
 * not, in the end, give a reason to leave.
 */
create or replace function public.commit_billing_subscription_change(
  target_operation uuid,
  target_claim_token uuid,
  target_subscription uuid,
  target_kind text,
  target_current_period_end timestamptz default null,
  target_cancel_reason text default null,
  target_cancel_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_row public.billing_operations%rowtype;
  subscription_row public.subscriptions%rowtype;
  result_payload jsonb;
  reason public.subscription_cancel_reason;
begin
  if auth.role() is distinct from 'service_role'
     or target_operation is null
     or target_claim_token is null
     or target_subscription is null
     or target_kind not in ('cancel', 'resume') then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select o.* into operation_row
  from public.billing_operations o
  where o.id = target_operation
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if operation_row.status = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'completed', 'result', operation_row.result);
  end if;
  if operation_row.status <> 'processing'
     or operation_row.claim_token is distinct from target_claim_token
     or operation_row.lease_expires_at is null
     or operation_row.lease_expires_at <= clock_timestamp()
     or operation_row.subscription_id is distinct from target_subscription
     or operation_row.kind is distinct from target_kind then
    return jsonb_build_object('ok', false, 'code', 'operation_claim_lost');
  end if;

  select s.* into subscription_row
  from public.subscriptions s
  where s.id = target_subscription
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if subscription_row.org_id is distinct from operation_row.org_id then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if target_kind = 'cancel' then
    if target_current_period_end is null or target_current_period_end <= clock_timestamp() then
      return jsonb_build_object('ok', false, 'code', 'plan_stale');
    end if;
    if target_cancel_reason = any (enum_range(null::public.subscription_cancel_reason)::text[]) then
      reason := target_cancel_reason::public.subscription_cancel_reason;
    end if;
    update public.subscriptions
    set cancel_at_period_end = true,
        cancellation_requested_at = coalesce(cancellation_requested_at, now()),
        cancel_reason = coalesce(reason, cancel_reason),
        cancel_note = coalesce(left(nullif(btrim(target_cancel_note), ''), 500), cancel_note),
        current_period_end = target_current_period_end,
        updated_at = now()
    where id = target_subscription;
    result_payload := jsonb_build_object('currentPeriodEnd', target_current_period_end);
  else
    if subscription_row.current_period_end is not null
       and subscription_row.current_period_end <= clock_timestamp() then
      return jsonb_build_object('ok', false, 'code', 'plan_stale');
    end if;
    update public.subscriptions
    set cancel_at_period_end = false,
        cancellation_requested_at = null,
        cancel_reason = null,
        cancel_note = null,
        updated_at = now()
    where id = target_subscription;
    result_payload := '{}'::jsonb;
  end if;

  update public.billing_operations
  set status = 'completed',
      result = result_payload,
      error_code = null,
      completed_at = now(),
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where id = target_operation
    and claim_token = target_claim_token;

  return jsonb_build_object('ok', true, 'code', 'completed', 'result', result_payload);
end;
$$;

revoke all on function public.commit_billing_subscription_change(uuid, uuid, uuid, text, timestamptz, text, text)
  from public, anon, authenticated;

-- A checkout the firm gave up on. The provider-side cleanup is the caller's.
create or replace function public.abandon_incomplete_subscription(target_org uuid, target_subscription uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sub public.subscriptions%rowtype;
begin
  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;
  if auth.role() is distinct from 'service_role'
     and not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  select * into sub
  from public.subscriptions
  where id = target_subscription and org_id = target_org and status = 'incomplete'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  update public.subscriptions
  set status = 'canceled', canceled_at = now(), cancel_at_period_end = false, updated_at = now()
  where id = sub.id;

  return jsonb_build_object(
    'ok', true,
    'code', 'canceled',
    'provider', sub.provider,
    'providerSubscriptionId', sub.provider_subscription_id,
    'providerPaymentId', sub.provider_payment_id
  );
end;
$$;

revoke all on function public.abandon_incomplete_subscription(uuid, uuid) from public, anon;
grant execute on function public.abandon_incomplete_subscription(uuid, uuid) to authenticated;

/**
 * Marks a checkout as PIX and, when the setting allows, opens the provisional
 * window that releases the plan before the bank confirms the transfer.
 * Only the server calls it, right after creating the charge: a client able to
 * call this would open its own window. One window per firm, ever.
 */
create or replace function public.mark_pix_checkout(target_org uuid, target_provider_subscription text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  config jsonb;
  window_hours integer;
  granted_before boolean;
  marked public.subscriptions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select value into config from public.platform_settings where key = 'pix_provisional_access';
  window_hours := greatest(coalesce((config ->> 'hours')::integer, 24), 1);

  select exists (
    select 1 from public.subscriptions
    where org_id = target_org and provisional_until is not null
  ) into granted_before;

  update public.subscriptions s
  set payment_method = 'pix',
      provisional_until = case
        when s.provisional_until is not null then s.provisional_until  -- replay: keep it
        when coalesce((config ->> 'enabled')::boolean, false) and not granted_before
          then now() + make_interval(hours => window_hours)
        else null
      end,
      updated_at = now()
  where s.org_id = target_org
    and (s.provider_subscription_id = target_provider_subscription
         or s.provider_payment_id = target_provider_subscription)
    and s.status = 'incomplete'
  returning * into marked;

  if marked.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'provisional_until', marked.provisional_until);
end;
$$;

revoke all on function public.mark_pix_checkout(uuid, text) from public, anon, authenticated;

-- ---------- Granting with a term, and renewing by buying again ----------

-- A paid access with a term starts when the firm's current access ENDS, so
-- renewing early never throws away the days already paid for. Without a term
-- (access_months null) the grant has no end date, as before.
create or replace function public.grant_entitlement_on_invoice(
  target_org uuid,
  target_plan uuid,
  target_provider text,
  target_provider_invoice_id text,
  target_price_cents integer default null,
  target_currency text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_row public.plans%rowtype;
  grant_row public.entitlement_grants%rowtype;
  key text;
  grant_kind text;
  starts timestamptz := now();
  ends timestamptz := null;
begin
  if auth.role() is distinct from 'service_role'
     or target_org is null
     or target_plan is null
     or target_provider not in ('stripe', 'asaas')
     or nullif(btrim(target_provider_invoice_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select * into plan_row from public.plans where id = target_plan;
  if not found or plan_row.kind <> 'access' then
    return jsonb_build_object('ok', false, 'code', 'not_an_access_plan');
  end if;
  if not exists (select 1 from public.organizations where id = target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  key := target_provider || ':' || btrim(target_provider_invoice_id);
  grant_kind := case when plan_row.tier = 'kit' then 'kit' else 'license' end;

  if plan_row.access_months is not null then
    -- Chained after the latest access of the same kind that is still to end.
    select greatest(now(), max(g.expires_at)) into starts
    from public.entitlement_grants g
    where g.org_id = target_org
      and g.kind = grant_kind
      and g.revoked_at is null
      and g.expires_at is not null
      and g.expires_at > now();
    starts := coalesce(starts, now());
    ends := starts + make_interval(months => plan_row.access_months);
  end if;

  insert into public.entitlement_grants (
    org_id, kind, plan_id, limits, price_cents, currency, invoice_key, source, starts_at, expires_at
  ) values (
    target_org,
    grant_kind,
    plan_row.id,
    plan_row.limits,
    coalesce(target_price_cents, plan_row.price_cents),
    coalesce(nullif(btrim(target_currency), ''), plan_row.currency),
    key,
    'purchase',
    starts,
    ends
  )
  on conflict (invoice_key) do nothing
  returning * into grant_row;

  if grant_row.id is null then
    select * into grant_row from public.entitlement_grants where invoice_key = key;
    return jsonb_build_object(
      'ok', true,
      'code', case when grant_row.revoked_at is null then 'already_granted' else 'revoked' end,
      'grantId', grant_row.id,
      'startsAt', grant_row.starts_at,
      'expiresAt', grant_row.expires_at
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'granted',
    'grantId', grant_row.id,
    'kind', grant_row.kind,
    'startsAt', grant_row.starts_at,
    'expiresAt', grant_row.expires_at
  );
end;
$$;

revoke all on function public.grant_entitlement_on_invoice(uuid, uuid, text, text, integer, text)
  from public, anon, authenticated;

create or replace function public.revoke_grant_for_invoice(
  target_provider text,
  target_provider_invoice_id text,
  target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  revoked integer := 0;
begin
  if auth.role() is distinct from 'service_role'
     or target_provider not in ('stripe', 'asaas')
     or nullif(btrim(target_provider_invoice_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  update public.entitlement_grants
  set revoked_at = now(),
      revoke_reason = coalesce(nullif(btrim(target_reason), ''), 'refund')
  where invoice_key = target_provider || ':' || btrim(target_provider_invoice_id)
    and revoked_at is null;
  get diagnostics revoked = row_count;

  return jsonb_build_object('ok', true, 'code', case when revoked > 0 then 'revoked' else 'nothing_to_revoke' end);
end;
$$;

revoke all on function public.revoke_grant_for_invoice(text, text, text) from public, anon, authenticated;

create or replace function public.revert_paid_invoice(
  target_provider text,
  target_provider_invoice_id text,
  target_kind text,
  target_purchase_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invoice_row public.invoices%rowtype;
  revoked_grants integer := 0;
begin
  if auth.role() is distinct from 'service_role'
     or target_provider not in ('stripe', 'asaas')
     or nullif(btrim(target_provider_invoice_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  select * into invoice_row
  from public.invoices
  where provider = target_provider::public.billing_provider
    and provider_invoice_id = target_provider_invoice_id
  for update;
  if not found then
    -- Not ours (a charge created outside the platform). Nothing to revert and
    -- nothing worth retrying: the caller treats this as success.
    return jsonb_build_object('ok', true, 'code', 'unknown_invoice');
  end if;
  if invoice_row.status = 'refunded' then
    return jsonb_build_object('ok', true, 'code', 'already_reverted');
  end if;

  update public.invoices
  set status = 'refunded'
  where id = invoice_row.id;

  update public.entitlement_grants
  set revoked_at = now(),
      revoke_reason = coalesce(nullif(btrim(target_kind), ''), 'refund')
  where revoked_at is null
    and (invoice_key = target_provider || ':' || target_provider_invoice_id
         or (nullif(btrim(target_purchase_ref), '') is not null
             and invoice_key = target_provider || ':' || btrim(target_purchase_ref)));
  get diagnostics revoked_grants = row_count;

  return jsonb_build_object(
    'ok', true,
    'code', 'reverted',
    'orgId', invoice_row.org_id,
    'grantsRevoked', revoked_grants
  );
end;
$$;

revoke all on function public.revert_paid_invoice(text, text, text, text) from public, anon, authenticated;

-- ---------- Webhook events (idempotent handlers) ----------

create or replace function public.claim_billing_webhook_event(
  target_provider text,
  target_provider_event_id text,
  target_event_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.billing_webhook_events%rowtype;
  inserted_count integer := 0;
  claimed_token uuid;
  claimed_attempts integer := 1;
begin
  if auth.role() is distinct from 'service_role'
     or target_provider is null
     or target_provider not in ('stripe', 'asaas')
     or nullif(btrim(target_provider_event_id), '') is null
     or nullif(btrim(target_event_type), '') is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  insert into public.billing_webhook_events (
    provider, provider_event_id, event_type, claim_token, lease_expires_at
  ) values (
    target_provider, left(target_provider_event_id, 255), left(target_event_type, 80),
    gen_random_uuid(), now() + interval '5 minutes'
  ) on conflict (provider, provider_event_id, event_type) do nothing;
  get diagnostics inserted_count = row_count;

  select e.* into event_row from public.billing_webhook_events e
  where e.provider = target_provider
    and e.provider_event_id = left(target_provider_event_id, 255)
    and e.event_type = left(target_event_type, 80)
  for update;
  if event_row.status = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'already_processed');
  end if;
  -- A permanently failed event is not reclaimed: the route stops asking the
  -- provider to resend something already proven unreconcilable. The replay
  -- from here on is ours (an operator, from /admin/billing).
  if event_row.error_code = 'handler_failed_permanent' then
    return jsonb_build_object('ok', true, 'code', 'already_processed');
  end if;
  if inserted_count = 0
     and event_row.status = 'processing'
     and event_row.lease_expires_at is not null
     and event_row.lease_expires_at > now() then
    return jsonb_build_object('ok', false, 'code', 'event_in_progress');
  end if;
  update public.billing_webhook_events
  set status = 'processing',
      attempts = case when inserted_count = 0 then attempts + 1 else attempts end,
      claim_token = gen_random_uuid(),
      lease_expires_at = now() + interval '5 minutes',
      error_code = null,
      completed_at = null,
      updated_at = now()
  where id = event_row.id
  returning claim_token, attempts into claimed_token, claimed_attempts;
  return jsonb_build_object(
    'ok', true,
    'code', 'claimed',
    'eventId', event_row.id,
    'claimToken', claimed_token,
    'attempts', claimed_attempts
  );
end;
$$;

revoke all on function public.claim_billing_webhook_event(text, text, text) from public, anon, authenticated;

create or replace function public.complete_billing_webhook_event(
  target_event uuid,
  target_claim_token uuid,
  target_success boolean,
  target_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
     or target_event is null
     or target_claim_token is null
     or target_success is null then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  update public.billing_webhook_events
  set status = case when target_success then 'completed' else 'failed' end,
      completed_at = case when target_success then now() else null end,
      claim_token = null,
      lease_expires_at = null,
      error_code = case when target_success then null else coalesce(nullif(btrim(target_error_code), ''), 'handler_failed') end,
      updated_at = now()
  where id = target_event
    and status = 'processing'
    and claim_token = target_claim_token;
  if not found then
    if exists (select 1 from public.billing_webhook_events where id = target_event) then
      return jsonb_build_object('ok', false, 'code', 'claim_lost');
    end if;
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'code', case when target_success then 'completed' else 'failed' end
  );
end;
$$;

revoke all on function public.complete_billing_webhook_event(uuid, uuid, boolean, text) from public, anon, authenticated;

-- Housekeeping cron: a worker that died mid-flight must not hold a lease forever.
create or replace function public.expire_stale_billing_leases(target_grace interval default interval '1 hour')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expired_operations integer := 0;
  expired_events integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;

  update public.billing_operations
  set status = 'failed',
      error_code = coalesce(error_code, 'lease_expired'),
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where status = 'processing'
    and lease_expires_at is not null
    and lease_expires_at < now() - greatest(target_grace, interval '0');
  get diagnostics expired_operations = row_count;

  update public.billing_webhook_events
  set status = 'failed',
      error_code = coalesce(error_code, 'lease_expired'),
      claim_token = null,
      lease_expires_at = null,
      updated_at = now()
  where status = 'processing'
    and lease_expires_at is not null
    and lease_expires_at < now() - greatest(target_grace, interval '0');
  get diagnostics expired_events = row_count;

  return jsonb_build_object('ok', true, 'operations', expired_operations, 'events', expired_events);
end;
$$;

revoke all on function public.expire_stale_billing_leases(interval) from public, anon, authenticated;

-- ---------- The end-of-term notice ----------

-- A purchase paid in installments is one payment that does not renew: one
-- notice goes out about two weeks before it ends (claim_term_end_notices,
-- 0011). A new purchase moves the end of the period: the notice is owed again.
create or replace function public.reset_term_notice()
returns trigger
language plpgsql
as $$
begin
  if new.current_period_end is distinct from old.current_period_end then
    new.term_notice_sent_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.reset_term_notice() from public, anon, authenticated;

create trigger subscriptions_reset_term_notice
  before update on public.subscriptions
  for each row execute function public.reset_term_notice();

-- ---------- Counting a coupon use ----------

/**
 * One coupon use per purchase, counted atomically. A subscription's use is
 * claimed by writing its `coupon_id` where still null, so a replayed webhook
 * event (or a parallel parcel of the same split purchase) finds it taken and
 * counts nothing. A one-time access has no subscription row: the webhook calls
 * this once, on the first grant of the paid invoice.
 */
create or replace function public.redeem_coupon(target_coupon uuid, target_subscription uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_coupon is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_input');
  end if;

  if target_subscription is not null then
    update public.subscriptions
    set coupon_id = target_coupon
    where id = target_subscription
      and coupon_id is null;
    get diagnostics touched = row_count;
    if touched = 0 then
      return jsonb_build_object('ok', true, 'code', 'already_counted');
    end if;
  end if;

  update public.coupons
  set redeemed_count = redeemed_count + 1
  where id = target_coupon;
  get diagnostics touched = row_count;

  return jsonb_build_object('ok', true, 'code', case when touched > 0 then 'counted' else 'unknown_coupon' end);
end;
$$;

revoke all on function public.redeem_coupon(uuid, uuid) from public, anon, authenticated;
