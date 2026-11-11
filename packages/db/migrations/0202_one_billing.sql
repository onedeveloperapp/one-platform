-- ============================================================
-- 0202 · ONE's own billing (M3, sprint S10): the tiers as data, the metering
-- of what a firm uses, the alerts as it nears its tier, the change of tier on
-- the subscription in force, and the panel of use.
--
-- ONE bills its subscription through Asaas in BRL (the app no longer offers
-- Stripe, USD nor the one-time access of the previous product). A tier is
-- data: a plan names its tier by a slug the operator writes and orders it by
-- `rank`, and `org_entitlements` names the firm's tier by the highest rank
-- among its live sources, never by a name written in the code. What a tier
-- allows is the plan's `limits` (`processos_ativos_max`, `assentos_max`,
-- `whatsapp_numeros_max`, and `monitor_voo` for the flight monitor, sold as an
-- add-on).
--
-- What a firm uses is measured once a day (`usage_ledger`): its active cases
-- (open and not a test), the people of its team and its WhatsApp numbers at
-- the vendor. Nearing a ceiling of its tier, at the setting's shares (80 and
-- 100 percent), the firm is told once a month (`usage_alerts`): who manages
-- the firm's account and who decides for it. ONE never stops a firm's work for
-- it: a case past the ceiling opens and goes on, and the firm is asked to
-- change its tier (the team's ceiling is the one limit already kept, 0003).
--
-- A change of tier goes on the subscription in force at Asaas (its value from
-- the next charge on), begun by who manages the firm's account with the
-- second factor and recorded by the backend once Asaas took it.
-- ============================================================

-- ---------- The tiers as data ----------
alter table public.plans add column rank integer not null default 0;
alter table public.plans drop constraint plans_tier_check;
alter table public.plans add constraint plans_tier_check check (tier is null or tier ~ '^[a-z0-9][a-z0-9-]{1,39}$');
alter table public.plans add constraint plans_rank_check check (rank between 0 and 1000);
comment on column public.plans.rank is
  'The order of the plan''s tier among the tiers, the higher the more it allows: the firm''s tier is the one of its live source of the highest rank.';
-- The plans written before ranks existed keep their order.
update public.plans set rank = case tier when 'kit' then 1 when 'club' then 2 when 'pro' then 3 else rank end
where tier is not null and rank = 0;

-- The setting: the shares of a ceiling at which a firm is told.
update public.platform_settings set value = value || '{"usage_alert_percents": [80, 100]}'::jsonb where key = 'billing';

/**
 * What a firm may use (redefined from 0005): the free floor, every live grant, the live subscription with its add-ons
 * and an unconfirmed PIX inside its window, merged; the tier is the one of the live source of the highest rank (the
 * plan's `rank`), never a name in the code.
 */
create or replace function public.org_entitlements(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  sub public.subscriptions%rowtype;
  sub_plan public.plans%rowtype;
  provisional_plan public.plans%rowtype;
  provisional_until timestamptz;
  merged jsonb := '{}'::jsonb;
  addon_limits jsonb;
  grace_ends timestamptz;
  in_grace boolean := false;
  sub_live boolean := false;
  suspended boolean := false;
  any_source boolean := false;
  sources jsonb := '[]'::jsonb;
  best_rank integer := -1;
  best_tier text;
  grant_row record;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not a member of this organization';
  end if;

  -- 1. The floor.
  select coalesce(p.limits, '{}'::jsonb) into merged
  from public.plans p
  where p.is_free and p.is_active
  order by p.created_at
  limit 1;
  merged := coalesce(merged, '{}'::jsonb);

  -- 2. Live grants.
  for grant_row in
    select g.id, g.kind, g.limits, g.plan_id, g.expires_at, p.tier, coalesce(p.rank, 0) as rank
    from public.entitlement_grants g
    left join public.plans p on p.id = g.plan_id
    where g.org_id = target_org
      and g.revoked_at is null
      and g.starts_at <= now()
      and (g.expires_at is null or g.expires_at > now())
    order by g.created_at
  loop
    merged := public.entitlement_merge(merged, grant_row.limits);
    any_source := true;
    sources := sources || jsonb_build_object(
      'type', 'grant', 'kind', grant_row.kind, 'grant_id', grant_row.id, 'plan_id', grant_row.plan_id,
      'tier', grant_row.tier, 'expires_at', grant_row.expires_at
    );
    if grant_row.tier is not null and grant_row.rank > best_rank then
      best_rank := grant_row.rank;
      best_tier := grant_row.tier;
    end if;
  end loop;

  -- 3. The live subscription.
  select * into sub
  from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc
  limit 1;

  if found then
    suspended := sub.admin_suspended;
    grace_ends := public.billing_past_due_grace_ends(sub);
    in_grace := grace_ends is not null and grace_ends > now();
    sub_live := sub.status in ('trialing', 'active') or in_grace;
    select * into sub_plan from public.plans where id = sub.plan_id;

    if sub_live then
      merged := public.entitlement_merge(merged, sub_plan.limits);

      select public.jsonb_merge_agg(m.limits) into addon_limits
      from public.subscription_modules sm
      join public.modules m on m.id = sm.module_id
      where sm.subscription_id = sub.id and sm.status = 'active';
      if addon_limits is not null and addon_limits <> '{}'::jsonb then
        merged := public.entitlement_merge(merged, addon_limits);
      end if;

      any_source := true;
      sources := sources || jsonb_build_object(
        'type', case when sub_plan.is_free then 'free' else 'subscription' end,
        'subscription_id', sub.id, 'plan_id', sub.plan_id, 'tier', sub_plan.tier
      );
      if sub_plan.tier is not null and sub_plan.rank > best_rank then
        best_rank := sub_plan.rank;
        best_tier := sub_plan.tier;
      end if;
    end if;
  end if;

  -- 4. An unconfirmed PIX inside its provisional window (mark_pix_checkout).
  select p.* into provisional_plan
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.org_id = target_org
    and s.status = 'incomplete'
    and s.provisional_until is not null
    and s.provisional_until > now()
  order by s.created_at desc
  limit 1;
  select s.provisional_until into provisional_until
  from public.subscriptions s
  where s.org_id = target_org and s.status = 'incomplete' and s.provisional_until > now()
  order by s.created_at desc
  limit 1;

  if provisional_plan.id is not null then
    merged := public.entitlement_merge(merged, provisional_plan.limits);
    any_source := true;
    sources := sources || jsonb_build_object(
      'type', 'provisional', 'plan_id', provisional_plan.id, 'tier', provisional_plan.tier, 'expires_at', provisional_until
    );
    if provisional_plan.tier is not null and provisional_plan.rank > best_rank then
      best_rank := provisional_plan.rank;
      best_tier := provisional_plan.tier;
    end if;
  end if;

  return jsonb_build_object(
    'active', (not suspended) and any_source,
    'suspended', suspended,
    'status', sub.status,
    'past_due_grace', in_grace,
    'grace_ends_at', case when in_grace then grace_ends else null end,
    'plan_id', sub.plan_id,
    'tier', best_tier,
    'sources', sources,
    'limits', merged,
    'subscription', case
      when sub.id is null then null
      else jsonb_build_object(
        'id', sub.id, 'status', sub.status, 'plan_id', sub.plan_id, 'period', sub.period,
        'price_cents', sub.price_cents, 'currency', sub.currency, 'current_period_end', sub.current_period_end,
        'cancel_at_period_end', sub.cancel_at_period_end, 'renews', sub.renews, 'provider', sub.provider
      )
    end
  );
end;
$$;

revoke all on function public.org_entitlements(uuid) from public, anon;
grant execute on function public.org_entitlements(uuid) to authenticated;

-- ---------- What a firm uses ----------
create table public.usage_ledger (
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The day of Brasília measured.
  day date not null,
  -- processos_ativos  open cases that are not a test;
  -- assentos          the people of the team;
  -- whatsapp_numeros  the firm's numbers at the vendor, active.
  metric text not null,
  value integer not null,
  recorded_at timestamptz not null default now(),
  primary key (org_id, day, metric),
  constraint usage_ledger_metric_check check (metric in ('processos_ativos', 'assentos', 'whatsapp_numeros')),
  constraint usage_ledger_value_check check (value >= 0)
);

alter table public.usage_ledger enable row level security;
create policy "usage_ledger_select_member" on public.usage_ledger
  for select to authenticated using (public.is_org_member(org_id) or public.is_superadmin());
grant select on table public.usage_ledger to authenticated;
create trigger guard_impersonation_usage_ledger after insert or update or delete on public.usage_ledger
  for each statement execute function public.guard_impersonation_readonly();

create table public.usage_alerts (
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The first day of the month of Brasília the alert is of: one per metric and share a month.
  month date not null,
  metric text not null,
  percent integer not null,
  value integer not null,
  ceiling integer not null,
  at timestamptz not null default now(),
  primary key (org_id, month, metric, percent),
  constraint usage_alerts_metric_check check (metric in ('processos_ativos', 'assentos', 'whatsapp_numeros')),
  constraint usage_alerts_month_check check (extract(day from month) = 1),
  constraint usage_alerts_numbers_check check (percent between 1 and 1000 and value >= 0 and ceiling > 0)
);

alter table public.usage_alerts enable row level security;
create policy "usage_alerts_select_member" on public.usage_alerts
  for select to authenticated using (public.is_org_member(org_id) or public.is_superadmin());
grant select on table public.usage_alerts to authenticated;
create trigger guard_impersonation_usage_alerts after insert or update or delete on public.usage_alerts
  for each statement execute function public.guard_impersonation_readonly();

/** What a firm uses now (internal): its active cases, its people and its numbers at the vendor. */
create or replace function public.usage_now(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'processos_ativos', (select count(*) from public.cases c
                         where c.org_id = target_org and c.status not in ('closed', 'declined') and not c.is_test),
    'assentos', (select count(*) from public.memberships m where m.org_id = target_org),
    'whatsapp_numeros', (select count(*) from public.wa_numbers n
                         where n.org_id = target_org and n.provider = 'meta' and n.status = 'active')
  );
$$;

revoke all on function public.usage_now(uuid) from public, anon, authenticated;

/** The ceiling a firm's tier sets on a metric (internal); null where it sets none. */
create or replace function public.usage_ceiling(target_limits jsonb, target_metric text)
returns integer
language sql
immutable
as $$
  select case when jsonb_typeof(target_limits -> (target_metric || '_max')) = 'number'
              and (target_limits ->> (target_metric || '_max'))::numeric > 0
         then (target_limits ->> (target_metric || '_max'))::numeric::integer end;
$$;

revoke all on function public.usage_ceiling(jsonb, text) from public, anon, authenticated;

/**
 * The backend measures a few firms a day (the ones not measured today yet), keeps each metric of the day, and answers
 * the alerts that crossed a share of a ceiling for the first time this month, with who is told: who manages the
 * firm's account and who decides for it.
 */
create or replace function public.record_usage_day(target_firms integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  this_month date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  percents integer[] := coalesce(
    (select array_agg(x::integer order by x::integer)
     from public.platform_settings s, jsonb_array_elements_text(s.value -> 'usage_alert_percents') x
     where s.key = 'billing'),
    array[80, 100]
  );
  firm record;
  used jsonb;
  limits jsonb;
  one_metric text;
  one_value integer;
  one_ceiling integer;
  one_level integer;
  alerts jsonb := '[]'::jsonb;
  measured integer := 0;
begin
  for firm in
    select o.id from public.organizations o
    where exists (select 1 from public.memberships m where m.org_id = o.id)
      and not exists (select 1 from public.usage_ledger u where u.org_id = o.id and u.day = today)
    order by o.id
    limit greatest(target_firms, 1)
  loop
    used := public.usage_now(firm.id);
    limits := coalesce(public.org_entitlements(firm.id) -> 'limits', '{}'::jsonb);
    foreach one_metric in array array['processos_ativos', 'assentos', 'whatsapp_numeros'] loop
      one_value := coalesce((used ->> one_metric)::integer, 0);
      insert into public.usage_ledger (org_id, day, metric, value) values (firm.id, today, one_metric, one_value)
      on conflict (org_id, day, metric) do update set value = excluded.value, recorded_at = now();
      one_ceiling := public.usage_ceiling(limits, one_metric);
      if one_ceiling is not null then
        foreach one_level in array percents loop
          if one_value * 100 >= one_ceiling * one_level then
            insert into public.usage_alerts (org_id, month, metric, percent, value, ceiling)
            values (firm.id, this_month, one_metric, one_level, one_value, one_ceiling)
            on conflict do nothing;
            if found then
              alerts := alerts || jsonb_build_object(
                'org_id', firm.id, 'metric', one_metric, 'percent', one_level, 'value', one_value, 'ceiling', one_ceiling,
                'month', this_month,
                'people', (select coalesce(jsonb_agg(m.user_id), '[]'::jsonb) from public.memberships m
                           where m.org_id = firm.id
                             and (m.role in ('owner', 'admin') or public.decides_for_firm_of(firm.id, m.user_id))));
            end if;
          end if;
        end loop;
      end if;
    end loop;
    measured := measured + 1;
  end loop;
  return jsonb_build_object('measured', measured, 'alerts', alerts);
end;
$$;

revoke all on function public.record_usage_day(integer) from public, anon, authenticated;
grant execute on function public.record_usage_day(integer) to service_role;

/**
 * The panel of use (who manages the firm's account or decides for it): the firm's plan and tier, what each metric
 * is now, its highest of the month and its ceiling, the alerts of the month, and the plans of the same period it may
 * change to. Anybody else of the firm reads that it is not theirs.
 */
create or replace function public.firm_usage(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  this_month date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  rights jsonb;
  limits jsonb;
  used jsonb;
  sub public.subscriptions%rowtype;
  plan public.plans%rowtype;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not (public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) or public.decides_for_firm(target_org)) then
    return jsonb_build_object('ok', true, 'manages', false);
  end if;
  rights := public.org_entitlements(target_org);
  limits := coalesce(rights -> 'limits', '{}'::jsonb);
  used := public.usage_now(target_org);
  select * into sub from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc limit 1;
  if sub.id is not null then
    select * into plan from public.plans where id = sub.plan_id;
  end if;
  return jsonb_build_object(
    'ok', true, 'manages', true,
    'tier', rights ->> 'tier',
    'plan', case when plan.id is null then null else jsonb_build_object(
      'id', plan.id, 'name', plan.name, 'tier', plan.tier, 'rank', plan.rank, 'period', plan.period,
      'price_cents', sub.price_cents, 'status', sub.status, 'current_period_end', sub.current_period_end,
      'cancel_at_period_end', sub.cancel_at_period_end, 'changeable', sub.provider = 'asaas' and sub.provider_subscription_id is not null
    ) end,
    'metrics', (
      select jsonb_agg(jsonb_build_object(
        'metric', m.metric,
        'now', coalesce((used ->> m.metric)::integer, 0),
        'peak', greatest(coalesce((used ->> m.metric)::integer, 0),
                         coalesce((select max(u.value) from public.usage_ledger u
                                   where u.org_id = target_org and u.metric = m.metric and u.day >= this_month), 0)),
        'ceiling', public.usage_ceiling(limits, m.metric)
      ) order by m.position)
      from (values ('processos_ativos', 1), ('assentos', 2), ('whatsapp_numeros', 3)) as m (metric, position)
    ),
    'flight_monitor', coalesce((limits ->> 'monitor_voo')::numeric > 0, false),
    'alerts', coalesce((
      select jsonb_agg(jsonb_build_object('metric', a.metric, 'percent', a.percent, 'value', a.value,
               'ceiling', a.ceiling, 'at', a.at) order by a.at desc)
      from public.usage_alerts a where a.org_id = target_org and a.month = this_month
    ), '[]'::jsonb),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description, 'tier', p.tier,
               'rank', p.rank, 'period', p.period, 'price_cents', p.price_cents, 'limits', p.limits,
               'current', p.id = sub.plan_id) order by p.rank, p.price_cents)
      from public.plans p
      where p.is_active and p.is_public and not p.is_free and not p.is_addon and p.kind = 'recurring'
        and p.currency = 'BRL' and (sub.period is null or p.period = sub.period)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.firm_usage(uuid) from public, anon;
grant execute on function public.firm_usage(uuid) to authenticated;

-- ---------- The change of tier ----------
/**
 * Who manages the firm's account begins a change of tier, with the second factor and never in a support visit: the
 * plan must be on sale, in BRL, of the subscription's period and another than its own, and the subscription live at
 * Asaas. Answers what the app hands Asaas; nothing changes until the backend records that Asaas took it.
 */
create or replace function public.begin_plan_change(target_org uuid, target_plan uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sub public.subscriptions%rowtype;
  plan public.plans%rowtype;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not public.is_aal2() then
    return jsonb_build_object('ok', false, 'code', 'second_factor');
  end if;
  select * into sub from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc limit 1;
  if sub.id is null or sub.provider is distinct from 'asaas' or sub.provider_subscription_id is null then
    return jsonb_build_object('ok', false, 'code', 'no_subscription');
  end if;
  if sub.cancel_at_period_end then
    return jsonb_build_object('ok', false, 'code', 'canceling');
  end if;
  select * into plan from public.plans where id = target_plan;
  if plan.id is null or not plan.is_active or plan.is_free or plan.is_addon or plan.kind <> 'recurring'
     or plan.currency <> 'BRL' or plan.price_cents <= 0 then
    return jsonb_build_object('ok', false, 'code', 'plan_unavailable');
  end if;
  if plan.id = sub.plan_id then
    return jsonb_build_object('ok', false, 'code', 'same_plan');
  end if;
  if plan.period is distinct from sub.period then
    return jsonb_build_object('ok', false, 'code', 'period_mismatch');
  end if;
  return jsonb_build_object(
    'ok', true, 'subscription_id', sub.id, 'provider_subscription_id', sub.provider_subscription_id,
    'plan_id', plan.id, 'price_cents', plan.price_cents, 'plan_name', plan.name,
    'up', plan.rank > coalesce((select p.rank from public.plans p where p.id = sub.plan_id), 0)
  );
end;
$$;

revoke all on function public.begin_plan_change(uuid, uuid) from public, anon;
grant execute on function public.begin_plan_change(uuid, uuid) to authenticated;

/**
 * The backend records a change of tier Asaas took (service role): the subscription's plan and price, on the record
 * with who asked. A change already recorded answers the same.
 */
create or replace function public.commit_plan_change(target_subscription uuid, target_plan uuid, target_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sub public.subscriptions%rowtype;
  plan public.plans%rowtype;
  before_plan uuid;
begin
  select * into sub from public.subscriptions where id = target_subscription for update;
  select * into plan from public.plans where id = target_plan;
  if sub.id is null or plan.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if sub.plan_id = plan.id then
    return jsonb_build_object('ok', true, 'code', 'already');
  end if;
  before_plan := sub.plan_id;
  update public.subscriptions set plan_id = plan.id, price_cents = plan.price_cents, updated_at = now()
  where id = sub.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (sub.org_id, target_actor, 'billing.plan_changed', 'subscription', sub.id::text,
    jsonb_build_object('from', before_plan, 'to', plan.id, 'price_cents', plan.price_cents));
  return jsonb_build_object('ok', true, 'code', 'changed');
end;
$$;

revoke all on function public.commit_plan_change(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.commit_plan_change(uuid, uuid, uuid) to service_role;
