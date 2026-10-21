-- ============================================================
-- 0012_admin: what the operator consoles read.
--
--   admin_metrics()               platform totals for /admin;
--   admin_firms_overview()        one row per firm, with the summary tiles
--                                 computed from the SAME rows;
--   admin_firm_dossier(org)       everything about one firm's account;
--   admin_people_without_firm()   accounts that founded or joined no firm.
--
-- Every function is superadmin-only. They READ what the product enforces
-- instead of recomputing it, so a console can never disagree with a gate.
--
-- Money rules:
--   * revenue is what is still PAID: a refund flips the invoice, so it simply
--     stops counting;
--   * a comped plan is not revenue: the snapshot price of a subscription with
--     no provider behind it is zero;
--   * currencies are never added together.
--
-- Privacy is structural. The consoles see the ACCOUNT of a firm: who belongs
-- to it, what it pays, whether it signs in. Nothing here reads what a firm
-- keeps in the product (its clients, cases, documents or messages), and no
-- answer carries a token, a hash, a consent text or audit metadata. The fiscal
-- document appears only as its kind plus the last two digits.
-- ============================================================

create or replace function public.admin_metrics()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'firms', (select count(*) from public.organizations),
    'people', (select count(*) from public.profiles),
    'new_firms_30d', (select count(*) from public.organizations where created_at > now() - interval '30 days'),
    'new_people_30d', (select count(*) from public.profiles where created_at > now() - interval '30 days'),
    'people_without_firm', (
      select count(*) from public.profiles p
      where not exists (select 1 from public.memberships m where m.user_id = p.id)
    ),
    'open_invitations', (
      select count(*) from public.firm_invitations i
      where i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    ),
    'subscriptions', (
      select coalesce(jsonb_object_agg(s.status, s.total), '{}'::jsonb)
      from (
        select status::text as status, count(*) as total
        from public.subscriptions
        group by status
      ) s
    ),
    'suspended', (
      select count(*) from public.subscriptions
      where admin_suspended and status in ('trialing', 'active', 'past_due')
    ),
    -- Monthly recurring revenue per currency, from the price each firm was
    -- SOLD (the snapshot), normalized to a month.
    'mrr', (
      select coalesce(
        jsonb_agg(jsonb_build_object('currency', m.currency, 'amount_cents', m.amount_cents) order by m.currency),
        '[]'::jsonb
      )
      from (
        select coalesce(s.currency, p.currency) as currency,
               sum(
                 case coalesce(s.period, p.period)
                   when 'monthly' then coalesce(s.price_cents, p.price_cents)::numeric
                   when 'yearly' then round(coalesce(s.price_cents, p.price_cents) / 12.0)
                   when 'weekly' then round(coalesce(s.price_cents, p.price_cents) * 52 / 12.0)
                   else 0
                 end
               )::bigint as amount_cents
        from public.subscriptions s
        join public.plans p on p.id = s.plan_id
        where s.status in ('active', 'past_due')
          and not s.admin_suspended
          and s.provider is not null
          and coalesce(s.price_cents, p.price_cents) > 0
        group by 1
      ) m
    ),
    'revenue_30d', (
      select coalesce(
        jsonb_agg(jsonb_build_object('currency', r.currency, 'amount_cents', r.amount_cents) order by r.currency),
        '[]'::jsonb
      )
      from (
        select i.currency, sum(i.amount_cents)::bigint as amount_cents
        from public.invoices i
        where i.status = 'paid' and i.paid_at > now() - interval '30 days'
        group by i.currency
      ) r
    ),
    -- Firms where somebody of the team signed in, in their own name.
    'firms_signed_in_7d', (
      select count(distinct m.org_id)
      from public.access_events a
      join public.memberships m on m.user_id = a.user_id
      where a.impersonated_by is null and a.created_at > now() - interval '7 days'
    ),
    'leads_confirmed', (select count(*) from public.leads where confirmed_at is not null and opted_out_at is null)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_metrics() from public, anon;
grant execute on function public.admin_metrics() to authenticated;

-- ---------- Firms ----------

/**
 * One row per firm, answering the operator's real questions: which firm this
 * is and who answers for it, how many people work in it, which plan it is on
 * and what it pays, whether anybody still signs in, and what needs attention.
 * The summary tiles are counted over the same rows, so a tile and the list it
 * filters can never disagree.
 */
create or replace function public.admin_firms_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  with live_sub as (
    select distinct on (s.org_id)
      s.org_id, s.id, s.status, s.admin_suspended, s.provider, s.period, s.price_cents, s.currency,
      s.current_period_end, s.cancel_at_period_end, s.renews, s.past_due_since, s.coupon_code_snapshot,
      p.slug as plan_slug, p.name as plan_name, p.tier as plan_tier, p.is_free,
      (s.status in ('trialing', 'active')
        or coalesce(public.billing_past_due_grace_ends(s) > now(), false)) as counts
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    where s.status in ('trialing', 'active', 'past_due')
    order by s.org_id, s.created_at desc
  ),
  live_grants as (
    select g.org_id,
      max(case p.tier when 'pro' then 3 when 'club' then 2 when 'kit' then 1 else 0 end) as rank,
      count(*) as total,
      jsonb_agg(jsonb_build_object(
        'id', g.id, 'kind', g.kind, 'plan', p.slug, 'source', g.source,
        'createdAt', g.created_at, 'expiresAt', g.expires_at
      ) order by g.created_at) as grants
    from public.entitlement_grants g
    left join public.plans p on p.id = g.plan_id
    where g.revoked_at is null and g.starts_at <= now() and (g.expires_at is null or g.expires_at > now())
    group by g.org_id
  ),
  team as (
    select m.org_id,
      count(*) as people,
      count(*) filter (
        where exists (select 1 from public.oab_registrations r where r.user_id = m.user_id)
      ) as lawyers,
      max(u.last_sign_in_at) as last_sign_in_at,
      -- The people who manage the team must be able to pass the second factor:
      -- the functions that change the team ask for it.
      count(*) filter (
        where m.role in ('owner', 'admin')
          and not exists (
            select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified'
          )
      ) as managers_without_second_factor
    from public.memberships m
    join auth.users u on u.id = m.user_id
    group by m.org_id
  ),
  invitations as (
    select i.org_id, count(*) as open
    from public.firm_invitations i
    where i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    group by i.org_id
  ),
  revenue as (
    select i.org_id,
      coalesce(sum(i.amount_cents) filter (where i.currency = 'BRL'), 0)::bigint as brl,
      coalesce(sum(i.amount_cents) filter (where i.currency = 'USD'), 0)::bigint as usd
    from public.invoices i
    where i.status = 'paid'
    group by i.org_id
  ),
  shaped as (
    select
      o.id as org_id,
      o.name,
      o.created_at,
      owner.user_id as owner_id,
      owner_profile.display_name as owner_name,
      owner_auth.email as owner_email,
      owner_auth.email_confirmed_at as owner_confirmed_at,
      owner_auth.banned_until as owner_banned_until,
      coalesce(t.people, 0) as people,
      coalesce(t.lawyers, 0) as lawyers,
      t.last_sign_in_at,
      coalesce(t.managers_without_second_factor, 0) as managers_without_second_factor,
      coalesce(inv.open, 0) as open_invitations,
      ls.id as subscription_id,
      ls.status,
      ls.admin_suspended,
      ls.provider,
      ls.period,
      ls.price_cents,
      ls.currency,
      ls.current_period_end,
      ls.cancel_at_period_end,
      ls.renews,
      ls.plan_slug,
      ls.plan_name,
      ls.is_free,
      greatest(
        coalesce(lg.rank, 0),
        case when ls.counts then (case ls.plan_tier when 'pro' then 3 when 'club' then 2 when 'kit' then 1 else 0 end) else 0 end
      ) as tier_rank,
      coalesce(lg.total, 0) as live_grants,
      coalesce(lg.grants, '[]'::jsonb) as grants,
      coalesce(rv.brl, 0) as revenue_brl,
      coalesce(rv.usd, 0) as revenue_usd,
      sa.origem,
      sa.onda,
      sa.utm_source,
      sa.utm_campaign
    from public.organizations o
    left join public.memberships owner on owner.org_id = o.id and owner.role = 'owner'
    left join public.profiles owner_profile on owner_profile.id = owner.user_id
    left join auth.users owner_auth on owner_auth.id = owner.user_id
    left join team t on t.org_id = o.id
    left join invitations inv on inv.org_id = o.id
    left join live_sub ls on ls.org_id = o.id
    left join live_grants lg on lg.org_id = o.id
    left join revenue rv on rv.org_id = o.id
    left join public.signup_attribution sa on sa.org_id = o.id
  ),
  flagged as (
    select s.*,
      case s.tier_rank when 3 then 'pro' when 2 then 'club' when 1 then 'kit' else null end as tier,
      -- Something beyond the free floor: a paid or comped plan, or a live grant.
      (s.tier_rank > 0 or s.live_grants > 0) as has_plan,
      (s.status = 'past_due') as is_past_due,
      -- Nobody of the team signed in for a month.
      (s.last_sign_in_at is null or s.last_sign_in_at < now() - interval '30 days') as idle,
      (s.managers_without_second_factor > 0) as no_second_factor,
      -- A firm must have an owner; a row without one is a defect to look at.
      (s.owner_id is null) as no_owner,
      -- A plan with no provider behind it that is not the free one: given by
      -- the team, charged to nobody.
      (s.subscription_id is not null and s.provider is null and not coalesce(s.is_free, false)) as comped
    from shaped s
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'totals', jsonb_build_object(
      'firms', count(*),
      'withPlan', count(*) filter (where has_plan),
      'noPlan', count(*) filter (where not has_plan),
      'pastDue', count(*) filter (where is_past_due),
      'suspended', count(*) filter (where coalesce(admin_suspended, false)),
      'cancelScheduled', count(*) filter (where coalesce(cancel_at_period_end, false)),
      'idle', count(*) filter (where idle),
      'noSecondFactor', count(*) filter (where no_second_factor),
      'noOwner', count(*) filter (where no_owner)
    ),
    'firms', coalesce(jsonb_agg(
      jsonb_build_object(
        'orgId', org_id,
        'name', name,
        'createdAt', created_at,
        'owner', case when owner_id is null then null else jsonb_build_object(
          'userId', owner_id,
          'name', owner_name,
          'email', owner_email,
          'confirmed', owner_confirmed_at is not null,
          'bannedUntil', owner_banned_until
        ) end,
        'people', people,
        'lawyers', lawyers,
        'openInvitations', open_invitations,
        'lastSignInAt', last_sign_in_at,
        'tier', tier,
        'plan', case when subscription_id is null then null else jsonb_build_object(
          'slug', plan_slug,
          'name', plan_name,
          'status', status,
          'period', period,
          'priceCents', price_cents,
          'currency', currency,
          'renewsAt', case when renews and not cancel_at_period_end then current_period_end end,
          'endsAt', case when cancel_at_period_end or not renews then current_period_end end,
          'provider', provider,
          'comped', comped
        ) end,
        'grants', grants,
        'revenue', jsonb_build_object('BRL', revenue_brl, 'USD', revenue_usd),
        'attribution', jsonb_strip_nulls(jsonb_build_object(
          'origem', origem, 'onda', onda, 'utmSource', utm_source, 'utmCampaign', utm_campaign
        )),
        'flags', jsonb_build_object(
          'hasPlan', has_plan,
          'pastDue', is_past_due,
          'suspended', coalesce(admin_suspended, false),
          'cancelScheduled', coalesce(cancel_at_period_end, false),
          'idle', idle,
          'noSecondFactor', no_second_factor,
          'noOwner', no_owner,
          'comped', comped
        )
      )
      order by created_at desc
    ), '[]'::jsonb)
  )
  into result
  from flagged;

  return result;
end;
$$;

revoke all on function public.admin_firms_overview() from public, anon;
grant execute on function public.admin_firms_overview() to authenticated;

/**
 * Everything the platform knows about the ACCOUNT of one firm, fired when the
 * operator opens it: the team, the invitations, what it may use, the money,
 * the consents of its people and how often they sign in.
 */
create or replace function public.admin_firm_dossier(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  org public.organizations%rowtype;
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into org from public.organizations where id = target_org;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'generatedAt', now(),
    'firm', jsonb_build_object(
      'orgId', org.id,
      'name', org.name,
      'slug', org.slug,
      'createdAt', org.created_at,
      'billingDocument', case
        when org.billing_cpf_cnpj is null then null
        else jsonb_build_object(
          'kind', case when char_length(org.billing_cpf_cnpj) = 11 then 'cpf' else 'cnpj' end,
          'lastDigits', right(org.billing_cpf_cnpj, 2)
        )
      end
    ),
    'team', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', m.user_id,
        'name', p.display_name,
        'email', u.email,
        'role', m.role,
        'firmFunction', m.firm_function,
        'joinedAt', m.created_at,
        'authProvider', nullif(btrim(coalesce(u.raw_app_meta_data ->> 'provider', '')), ''),
        'confirmed', u.email_confirmed_at is not null,
        'lastSignInAt', u.last_sign_in_at,
        'bannedUntil', u.banned_until,
        'timezone', p.timezone,
        'marketingOptOut', p.marketing_email_opt_out,
        'isSuperadmin', coalesce(p.is_superadmin, false),
        'twoFactor', exists (
          select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified'
        ),
        'oab', coalesce((
          select jsonb_agg(jsonb_build_object('uf', r.uf, 'number', r.number, 'kind', r.kind) order by r.kind, r.uf)
          from public.oab_registrations r where r.user_id = m.user_id
        ), '[]'::jsonb)
      ) order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at)
      from public.memberships m
      join public.profiles p on p.id = m.user_id
      join auth.users u on u.id = m.user_id
      where m.org_id = target_org
    ), '[]'::jsonb),
    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'email', i.email::text,
        'role', i.role,
        'firmFunction', i.firm_function,
        'createdAt', i.created_at,
        'expiresAt', i.expires_at,
        'status', case
          when i.accepted_at is not null then 'accepted'
          when i.revoked_at is not null then 'revoked'
          when i.expires_at <= now() then 'expired'
          else 'open'
        end
      ) order by i.created_at desc)
      from public.firm_invitations i
      where i.org_id = target_org
    ), '[]'::jsonb),
    'entitlements', public.org_entitlements(target_org),
    'money', jsonb_build_object(
      'paid', (
        select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb)
        from (select i.currency, sum(i.amount_cents)::bigint as total
              from public.invoices i where i.org_id = target_org and i.status = 'paid' group by i.currency) x
      ),
      'refunded', (
        select coalesce(jsonb_object_agg(currency, total), '{}'::jsonb)
        from (select i.currency, sum(i.amount_cents)::bigint as total
              from public.invoices i where i.org_id = target_org and i.status = 'refunded' group by i.currency) x
      ),
      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', s.id, 'plan', p.slug, 'status', s.status, 'period', s.period,
          'priceCents', s.price_cents, 'currency', s.currency, 'coupon', s.coupon_code_snapshot,
          'provider', s.provider, 'renews', s.renews, 'paymentMethod', s.payment_method,
          'createdAt', s.created_at, 'currentPeriodEnd', s.current_period_end,
          'cancelAtPeriodEnd', s.cancel_at_period_end, 'cancelReason', s.cancel_reason,
          'cancelNote', s.cancel_note, 'canceledAt', s.canceled_at,
          'pastDueSince', s.past_due_since, 'suspended', s.admin_suspended
        ) order by s.created_at desc)
        from public.subscriptions s
        join public.plans p on p.id = s.plan_id
        where s.org_id = target_org
      ), '[]'::jsonb),
      'grants', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', g.id, 'kind', g.kind, 'plan', p.slug, 'source', g.source,
          'priceCents', g.price_cents, 'currency', g.currency, 'note', g.note,
          'createdAt', g.created_at, 'expiresAt', g.expires_at,
          'revokedAt', g.revoked_at, 'revokeReason', g.revoke_reason
        ) order by g.created_at desc)
        from public.entitlement_grants g
        left join public.plans p on p.id = g.plan_id
        where g.org_id = target_org
      ), '[]'::jsonb),
      'invoices', coalesce((
        select jsonb_agg(row_data)
        from (
          select jsonb_build_object(
            'id', i.id, 'amountCents', i.amount_cents, 'currency', i.currency, 'status', i.status,
            'paidAt', i.paid_at, 'createdAt', i.created_at, 'provider', i.provider,
            'hasFiscalDocument', i.fiscal_document_url is not null
          ) as row_data
          from public.invoices i
          where i.org_id = target_org
          order by i.created_at desc
          limit 20
        ) recent
      ), '[]'::jsonb)
    ),
    -- Consent belongs to the person: these are the acceptances of the people
    -- who are in the firm today.
    'consent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', a.user_id, 'slug', t.slug, 'locale', t.locale, 'version', t.version,
        'acceptedAt', a.accepted_at, 'revokedAt', a.revoked_at
      ) order by a.accepted_at desc)
      from public.consent_acceptances a
      join public.consent_terms t on t.id = a.term_id
      where a.user_id in (select m.user_id from public.memberships m where m.org_id = target_org)
    ), '[]'::jsonb),
    'access', jsonb_build_object(
      'signIns30d', (
        select count(*) from public.access_events a
        where a.user_id in (select m.user_id from public.memberships m where m.org_id = target_org)
          and a.impersonated_by is null
          and a.created_at > now() - interval '30 days'
      ),
      'supportVisits', (
        select count(*) from public.impersonation_sessions s where s.target_org_id = target_org
      )
    ),
    'attribution', (
      select to_jsonb(sa) - 'org_id' from public.signup_attribution sa where sa.org_id = target_org
    )
  );
end;
$$;

revoke all on function public.admin_firm_dossier(uuid) from public, anon;
grant execute on function public.admin_firm_dossier(uuid) to authenticated;

/**
 * Accounts that belong to no firm. A new account is here until it founds a
 * firm or accepts an invitation, so a few recent rows are normal; somebody who
 * stays is worth an operator's look (the invitation went to another address,
 * the firm removed them, the person gave up at the first screen).
 */
create or replace function public.admin_people_without_firm()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  with person as (
    select
      p.id as user_id,
      p.display_name,
      p.is_superadmin,
      u.email,
      u.created_at,
      u.last_sign_in_at,
      u.email_confirmed_at,
      u.banned_until,
      nullif(btrim(coalesce(u.raw_app_meta_data ->> 'provider', '')), '') as auth_provider,
      (
        select count(*) from public.firm_invitations i
        where i.email = lower(u.email)::extensions.citext
          and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
      ) as open_invitations
    from public.profiles p
    join auth.users u on u.id = p.id
    where not exists (select 1 from public.memberships m where m.user_id = p.id)
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'totals', jsonb_build_object(
      'people', count(*),
      'neverSignedIn', count(*) filter (where last_sign_in_at is null),
      'invited', count(*) filter (where open_invitations > 0)
    ),
    'people', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'userId', user_id,
          'name', display_name,
          'email', email,
          'createdAt', created_at,
          'lastSignInAt', last_sign_in_at,
          'confirmed', email_confirmed_at is not null,
          'bannedUntil', banned_until,
          'isSuperadmin', coalesce(is_superadmin, false),
          'authProvider', auth_provider,
          'openInvitations', open_invitations
        )
        order by created_at desc
      ),
      '[]'::jsonb
    )
  )
  into result
  from person;

  return result;
end;
$$;

revoke all on function public.admin_people_without_firm() from public, anon;
grant execute on function public.admin_people_without_firm() to authenticated;
