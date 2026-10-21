-- ============================================================
-- 0011_messages: what the jobs that write to people read.
--
-- Every job here follows claim-then-send (packages/jobs/README.md): the rows
-- that are due are claimed in the statement that marks them as sent, with
-- `for update skip locked`, so a job that runs twice, or two workers at once,
-- never write to the same person twice. What is due is recomputed from the
-- data on every sweep; nothing sleeps until a date.
-- ============================================================

-- ---------- End of a paid period that does not renew ----------

-- A yearly plan paid in installments is one purchase (renews = false): nothing
-- tells the firm before the day it stops. One notice, about two weeks ahead
-- (subscriptions.term_notice_sent_at, 0004).
create or replace function public.claim_term_end_notices(target_within interval default interval '15 days')
returns table (
  subscription_id uuid,
  org_id uuid,
  plan_name text,
  current_period_end timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return query
  with due as (
    select s.id
    from public.subscriptions s
    where s.status = 'active'
      and s.renews = false
      and s.term_notice_sent_at is null
      and s.current_period_end is not null
      and s.current_period_end > now()
      and s.current_period_end <= now() + least(greatest(target_within, interval '1 day'), interval '60 days')
    order by s.current_period_end
    limit 200
    for update skip locked
  ),
  claimed as (
    update public.subscriptions s
    set term_notice_sent_at = now()
    from due
    where s.id = due.id
    returning s.id, s.org_id, s.plan_id, s.current_period_end
  )
  select c.id, c.org_id, p.name, c.current_period_end
  from claimed c
  join public.plans p on p.id = c.plan_id;
end;
$$;

revoke all on function public.claim_term_end_notices(interval) from public, anon, authenticated;

-- ---------- The notice before an access ends ----------

-- A grant followed by a renewal is not announced: the chained grant has its
-- own end, announced in its turn.
create or replace function public.claim_access_end_notices(target_within interval default interval '15 days')
returns table (
  grant_id uuid,
  org_id uuid,
  plan_name text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return query
  with due as (
    select g.id
    from public.entitlement_grants g
    where g.revoked_at is null
      and g.end_notice_sent_at is null
      and g.expires_at is not null
      and g.expires_at > now()
      and g.expires_at <= now() + least(greatest(target_within, interval '1 day'), interval '60 days')
      and not exists (
        select 1 from public.entitlement_grants later
        where later.org_id = g.org_id
          and later.kind = g.kind
          and later.id <> g.id
          and later.revoked_at is null
          and (later.expires_at is null or later.expires_at > g.expires_at)
      )
    order by g.expires_at
    limit 200
    for update skip locked
  ),
  claimed as (
    update public.entitlement_grants g
    set end_notice_sent_at = now()
    from due
    where g.id = due.id
    returning g.id, g.org_id, g.plan_id, g.expires_at
  )
  select c.id, c.org_id, p.name, c.expires_at
  from claimed c
  join public.plans p on p.id = c.plan_id;
end;
$$;

revoke all on function public.claim_access_end_notices(interval) from public, anon, authenticated;

-- ---------- Settling an access that ended ----------

-- The grants whose term ran out and were not settled yet: the job tells the
-- people who manage the firm. The same fence: claimed once, marked in the
-- statement that returns them.
create or replace function public.claim_access_endings()
returns table (
  grant_id uuid,
  org_id uuid,
  plan_name text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return query
  with due as (
    select g.id
    from public.entitlement_grants g
    where g.revoked_at is null
      and g.ended_handled_at is null
      and g.expires_at is not null
      and g.expires_at <= now()
    order by g.expires_at
    limit 200
    for update skip locked
  ),
  claimed as (
    update public.entitlement_grants g
    set ended_handled_at = now()
    from due
    where g.id = due.id
    returning g.id, g.org_id, g.plan_id, g.expires_at
  )
  select c.id, c.org_id, p.name, c.expires_at
  from claimed c
  join public.plans p on p.id = c.plan_id;
end;
$$;

revoke all on function public.claim_access_endings() from public, anon, authenticated;

-- ---------- Who a message is written to ----------

-- The address, the language and the preferences of a set of people, in one
-- read. The address lives in auth.users, which only the backend reaches; an
-- account that is banned or has no address is left out, so no job writes to it.
create or replace function public.member_recipients(target_users uuid[])
returns table (
  user_id uuid,
  email text,
  display_name text,
  locale text,
  timezone text,
  marketing_email_opt_out boolean,
  email_unsubscribe_token uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return query
  select p.id, u.email::text, p.display_name, p.locale, p.timezone,
         p.marketing_email_opt_out, p.email_unsubscribe_token
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = any (coalesce(target_users, array[]::uuid[]))
    and u.email is not null
    and (u.banned_until is null or u.banned_until <= now());
end;
$$;

revoke all on function public.member_recipients(uuid[]) from public, anon, authenticated;
