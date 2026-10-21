-- ============================================================
-- 0005_entitlements: the single answer to "what may this firm use?", the
-- operator's courtesy paths, and the commercial settings.
--
-- Screens and gates never branch on a plan name: they ask org_entitlements()
-- and read `active` and `limits`. The limit keys are data on the plan rows
-- (for example `assentos_max`, the ceiling of the team, read by 0003).
-- ============================================================

/**
 * Merges two limit objects so that MORE SOURCES NEVER MEAN FEWER RIGHTS.
 * Numbers take the greater value (a plan with 3 seats plus a courtesy with 5 is
 * 5; a second courtesy with 2 leaves it at 5). Anything else takes the incoming
 * value. A plain `||` would let whichever source happens to merge last lower a
 * ceiling somebody paid for.
 */
create or replace function public.entitlement_merge(a jsonb, b jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    (
      select jsonb_object_agg(
        key,
        case
          when jsonb_typeof(left_value) = 'number' and jsonb_typeof(right_value) = 'number'
            then to_jsonb(greatest((left_value #>> '{}')::numeric, (right_value #>> '{}')::numeric))
          when right_value is null or jsonb_typeof(right_value) = 'null' then left_value
          else right_value
        end
      )
      from (
        select
          coalesce(l.key, r.key) as key,
          l.value as left_value,
          r.value as right_value
        from jsonb_each(coalesce(a, '{}'::jsonb)) as l
        full join jsonb_each(coalesce(b, '{}'::jsonb)) as r on r.key = l.key
      ) as pairs
    ),
    '{}'::jsonb
  );
$$;

revoke all on function public.entitlement_merge(jsonb, jsonb) from public, anon;
grant execute on function public.entitlement_merge(jsonb, jsonb) to authenticated;

/**
 * What a firm may use, and why.
 *
 * Sources, merged with entitlement_merge:
 *   1. the free plan's limits (the floor every firm has);
 *   2. every LIVE grant (a one-time access, a courtesy);
 *   3. the live subscription, while it is trialing, active or inside the
 *      dunning grace window, plus its add-ons;
 *   4. an unconfirmed PIX inside its provisional window.
 *
 * `active` is false when the operator suspended the firm, or when no source is
 * live. Screens and gates branch on `active` and `limits`, never on a plan
 * name. `tier` is the highest rung among the live sources.
 *
 * The backend calls this with the service role (jobs, the billing webhook),
 * hence the third branch of the guard.
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
  provisional_plan_id uuid;
  provisional_tier text;
  provisional_limits jsonb;
  provisional_until timestamptz;
  merged jsonb := '{}'::jsonb;
  addon_limits jsonb;
  grace_ends timestamptz;
  in_grace boolean := false;
  sub_live boolean := false;
  suspended boolean := false;
  any_source boolean := false;
  sources jsonb := '[]'::jsonb;
  best_rank integer := 0;
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
    select g.id, g.kind, g.limits, g.plan_id, g.expires_at, p.tier
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
      'type', 'grant',
      'kind', grant_row.kind,
      'grant_id', grant_row.id,
      'plan_id', grant_row.plan_id,
      'tier', grant_row.tier,
      'expires_at', grant_row.expires_at
    );
    best_rank := greatest(best_rank, case grant_row.tier when 'pro' then 3 when 'club' then 2 when 'kit' then 1 else 0 end);
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
        'subscription_id', sub.id,
        'plan_id', sub.plan_id,
        'tier', sub_plan.tier
      );
      best_rank := greatest(best_rank, case sub_plan.tier when 'pro' then 3 when 'club' then 2 when 'kit' then 1 else 0 end);
    end if;
  end if;

  -- 4. An unconfirmed PIX inside its provisional window (mark_pix_checkout).
  select p.id, p.tier, p.limits, s.provisional_until
    into provisional_plan_id, provisional_tier, provisional_limits, provisional_until
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.org_id = target_org
    and s.status = 'incomplete'
    and s.provisional_until is not null
    and s.provisional_until > now()
  order by s.created_at desc
  limit 1;

  if provisional_plan_id is not null then
    merged := public.entitlement_merge(merged, provisional_limits);
    any_source := true;
    sources := sources || jsonb_build_object(
      'type', 'provisional',
      'plan_id', provisional_plan_id,
      'tier', provisional_tier,
      'expires_at', provisional_until
    );
    best_rank := greatest(best_rank, case provisional_tier when 'pro' then 3 when 'club' then 2 when 'kit' then 1 else 0 end);
  end if;

  return jsonb_build_object(
    'active', (not suspended) and any_source,
    'suspended', suspended,
    'status', sub.status,
    'past_due_grace', in_grace,
    'grace_ends_at', case when in_grace then grace_ends else null end,
    'plan_id', sub.plan_id,
    'tier', case best_rank when 3 then 'pro' when 2 then 'club' when 1 then 'kit' else null end,
    'sources', sources,
    'limits', merged,
    'subscription', case
      when sub.id is null then null
      else jsonb_build_object(
        'id', sub.id,
        'status', sub.status,
        'plan_id', sub.plan_id,
        'period', sub.period,
        'price_cents', sub.price_cents,
        'currency', sub.currency,
        'current_period_end', sub.current_period_end,
        'cancel_at_period_end', sub.cancel_at_period_end,
        'renews', sub.renews,
        'provider', sub.provider
      )
    end
  );
end;
$$;

revoke all on function public.org_entitlements(uuid) from public, anon;
grant execute on function public.org_entitlements(uuid) to authenticated;

/**
 * Yes/no for one entitlement key, for RLS policies and server gates. Never
 * raises: a caller with no firm, or asking about somebody else's, simply
 * gets false. A number counts when it is above zero; a text value counts when
 * it is not empty, "0" or "false".
 */
create or replace function public.org_has_entitlement(target_org uuid, entitlement_key text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  answer jsonb;
  raw jsonb;
begin
  if target_org is null or entitlement_key is null then
    return false;
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and not (public.is_org_member(target_org) or public.is_superadmin()) then
    return false;
  end if;

  answer := public.org_entitlements(target_org);
  if not coalesce((answer ->> 'active')::boolean, false) then
    return false;
  end if;

  raw := answer -> 'limits' -> entitlement_key;
  if raw is null or jsonb_typeof(raw) = 'null' then
    return false;
  end if;
  if jsonb_typeof(raw) = 'number' then
    return (raw #>> '{}')::numeric > 0;
  end if;
  if jsonb_typeof(raw) = 'boolean' then
    return (raw #>> '{}')::boolean;
  end if;
  return coalesce(nullif(raw #>> '{}', ''), '0') not in ('0', 'false');
end;
$$;

revoke all on function public.org_has_entitlement(uuid, text) from public, anon;
grant execute on function public.org_has_entitlement(uuid, text) to authenticated;

-- ---------- Operator paths (no checkout) ----------

/**
 * Puts a firm on a recurring tier without a checkout: pilots, partners, the
 * team's own firm. It exists because doing it by hand walks past several
 * traps:
 *   * UPDATE, not INSERT: a firm holds one live subscription;
 *   * the period bounds stay NULL: a comped plan has no provider cycle to
 *     advance them, and a fixed end date would silently expire it;
 *   * "remove the plan" means assigning the FREE one;
 *   * a provider-backed subscription is REFUSED (`provider_managed`): changing
 *     the tier here while Stripe or Asaas keeps charging the old one is a
 *     billing inconsistency no console should create;
 *   * a one-time access plan is refused: that purchase is a grant, see
 *     grant_entitlement().
 * Self-assignment is allowed and stamped `self_grant`, the case an auditor
 * looks for.
 */
create or replace function public.set_org_plan(target_org uuid, target_plan uuid, target_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_row public.plans%rowtype;
  sub public.subscriptions%rowtype;
  previous_slug text;
  self_grant boolean;
  created boolean := false;
begin
  if not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized';
  end if;

  select * into plan_row from public.plans where id = target_plan and is_active;
  if not found then
    raise exception 'plan_not_found';
  end if;
  if plan_row.is_addon or plan_row.kind <> 'recurring' or plan_row.period is null then
    raise exception 'plan_not_assignable';
  end if;

  if not exists (select 1 from public.organizations where id = target_org) then
    raise exception 'organization_not_found';
  end if;

  select * into sub
  from public.subscriptions
  where org_id = target_org and status in ('trialing', 'active', 'past_due')
  order by created_at desc
  limit 1
  for update;

  if sub.id is not null
     and (nullif(btrim(coalesce(sub.provider_subscription_id, '')), '') is not null
          or nullif(btrim(coalesce(sub.provider_payment_id, '')), '') is not null) then
    raise exception 'provider_managed'
      using hint = 'This firm pays through a provider. Changing the plan here would desync the charge from the entitlement.';
  end if;

  self_grant := exists (
    select 1 from public.memberships m where m.org_id = target_org and m.user_id = auth.uid()
  );

  if sub.id is null then
    insert into public.subscriptions (org_id, plan_id, status, period, price_cents, currency)
    values (target_org, target_plan, 'active', plan_row.period, 0, plan_row.currency)
    returning * into sub;
    created := true;
  else
    select slug into previous_slug from public.plans where id = sub.plan_id;
    update public.subscriptions
    set plan_id = target_plan,
        period = plan_row.period,
        status = 'active',
        -- Nothing is charged for a comped plan.
        price_cents = 0,
        currency = plan_row.currency,
        coupon_id = null,
        coupon_code_snapshot = null,
        current_period_start = null,
        current_period_end = null,
        -- Whatever lifecycle state the previous plan carried is not the new
        -- plan's: a pending cancellation or an open dunning window would
        -- otherwise keep counting against a plan that no longer exists.
        cancel_at_period_end = false,
        cancellation_requested_at = null,
        cancel_reason = null,
        cancel_note = null,
        past_due_since = null,
        canceled_at = null,
        updated_at = now()
    where id = sub.id
    returning * into sub;
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org,
    auth.uid(),
    'admin.org.plan_assigned',
    'subscription',
    sub.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'from_plan', previous_slug,
      'to_plan', plan_row.slug,
      'created_subscription', created,
      'self_grant', self_grant,
      'note', nullif(btrim(target_note), '')
    ))
  );

  return jsonb_build_object(
    'ok', true,
    'subscriptionId', sub.id,
    'fromPlan', previous_slug,
    'toPlan', plan_row.slug,
    'selfGrant', self_grant
  );
end;
$$;

revoke all on function public.set_org_plan(uuid, uuid, text) from public, anon;
grant execute on function public.set_org_plan(uuid, uuid, text) to authenticated;

/**
 * A courtesy grant: the limits of a plan given to a firm with no money changing
 * hands (a pilot firm, a partner). The grant copies the plan's limits at this
 * moment and may carry an end date.
 */
create or replace function public.grant_entitlement(
  target_org uuid,
  target_plan uuid,
  target_note text default null,
  target_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  plan_row public.plans%rowtype;
  grant_row public.entitlement_grants%rowtype;
  self_grant boolean;
begin
  if not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized';
  end if;

  select * into plan_row from public.plans where id = target_plan and is_active;
  if not found then
    raise exception 'plan_not_found';
  end if;
  if plan_row.is_free then
    raise exception 'plan_not_grantable';
  end if;
  if not exists (select 1 from public.organizations where id = target_org) then
    raise exception 'organization_not_found';
  end if;
  if target_expires_at is not null and target_expires_at <= now() then
    raise exception 'invalid_expiry';
  end if;

  self_grant := exists (
    select 1 from public.memberships m where m.org_id = target_org and m.user_id = auth.uid()
  );

  insert into public.entitlement_grants (
    org_id, kind, plan_id, limits, price_cents, currency, source, granted_by, note, expires_at
  ) values (
    target_org, 'comp', plan_row.id, plan_row.limits, 0, plan_row.currency, 'admin', auth.uid(),
    nullif(btrim(target_note), ''), target_expires_at
  )
  returning * into grant_row;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org, auth.uid(), 'admin.org.entitlement_granted', 'entitlement_grant', grant_row.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'plan', plan_row.slug,
      'expires_at', target_expires_at,
      'self_grant', self_grant,
      'note', nullif(btrim(target_note), '')
    ))
  );

  return jsonb_build_object('ok', true, 'grantId', grant_row.id, 'plan', plan_row.slug, 'selfGrant', self_grant);
end;
$$;

revoke all on function public.grant_entitlement(uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.grant_entitlement(uuid, uuid, text, timestamptz) to authenticated;

create or replace function public.revoke_entitlement_grant(target_grant uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  grant_row public.entitlement_grants%rowtype;
  reason text := nullif(btrim(target_reason), '');
begin
  if not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized';
  end if;
  if reason is null then
    raise exception 'reason_required';
  end if;

  select * into grant_row from public.entitlement_grants where id = target_grant for update;
  if not found then
    raise exception 'grant_not_found';
  end if;
  if grant_row.revoked_at is not null then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update public.entitlement_grants
  set revoked_at = now(), revoke_reason = left(reason, 300)
  where id = grant_row.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    grant_row.org_id, auth.uid(), 'admin.org.entitlement_revoked', 'entitlement_grant', grant_row.id::text,
    jsonb_build_object('kind', grant_row.kind, 'source', grant_row.source, 'reason', left(reason, 300))
  );

  return jsonb_build_object('ok', true, 'changed', true);
end;
$$;

revoke all on function public.revoke_entitlement_grant(uuid, text) from public, anon;
grant execute on function public.revoke_entitlement_grant(uuid, text) to authenticated;

-- ---------- Commercial settings ----------

insert into public.platform_settings (key, value, is_public) values
  -- How long a failed charge keeps the plan usable before access is cut.
  ('dunning', '{"grace_days": 7}'::jsonb, false),
  -- Money-back window shown on the pricing page and in the checkout. The app
  -- clamps it to the statutory minimum of 7 days.
  ('guarantee', '{"days": 7}'::jsonb, true),
  -- Whether an unconfirmed PIX releases the plan for a few hours.
  ('pix_provisional_access', '{"enabled": false, "hours": 24}'::jsonb, false),
  -- Checkout knobs. Installments apply to yearly BRL plans only.
  ('billing', '{"max_installments": 12}'::jsonb, true)
on conflict (key) do nothing;
