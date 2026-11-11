-- ============================================================
-- 0200 · The partner's weekly digest (M3, sprint S10).
--
-- Every Monday morning of Brasília, each person who decides for a firm (a
-- partner, or who manages a firm with none: `decides_for_firm`) is sent the
-- firm's week in numbers: the cases opened, closed (the closing of 0146),
-- filed and ended, beside the week before; the judgments by their result,
-- the settlements and the money released that arrived; what the next week
-- holds (the deadlines that fall in it and the hearings); what waits for the
-- firm now (deadlines past their day, the cases stagnant at their step, the
-- answers of the AI that wait for a person, the awareness owed of a
-- publication ONE triaged); and what ONE did in the week, with the hours a
-- person would have taken by the firm's own estimates (0120).
--
-- Numbers only: nothing of a client, a lawsuit's number or a value of a case
-- goes in the e-mail, which leads to ONE for the rest. The test cases are
-- counted only while the firm has no real case (as the controladoria,
-- 0114), and the e-mail says so.
--
-- The person stops it in one click (the e-mail's own link and the mail
-- client's button, RFC 8058) or in their settings
-- (`agenda_preferences.weekly_off`); a week with nothing at all is recorded
-- and sends nothing. Each e-mail is reserved before it goes (claim then
-- send), so none goes twice.
-- ============================================================

-- ---------- The person's choice ----------
alter table public.agenda_preferences add column weekly_off boolean not null default false;
alter table public.agenda_preferences add column weekly_changed_at timestamptz;
grant select (weekly_off, weekly_changed_at) on table public.agenda_preferences to authenticated;

/** Whether a person decides for a firm (as `decides_for_firm`, for the backend that names the person). */
create or replace function public.decides_for_firm_of(target_org uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = target_user
      and (
        m.firm_function = 'socio'
        or (
          m.role in ('owner', 'admin')
          and not exists (
            select 1 from public.memberships p where p.org_id = target_org and p.firm_function = 'socio'
          )
        )
      )
  );
$$;

revoke all on function public.decides_for_firm_of(uuid, uuid) from public, anon, authenticated;

-- ---------- The e-mails of each week ----------
create table public.weekly_digests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The Monday of the week the e-mail tells.
  week date not null,
  -- reserved  being sent: never sent again by itself;
  -- sent      the provider took it;
  -- failed    the provider refused it for another reason than its quota;
  -- empty     nothing at all in the week: no e-mail.
  status text not null default 'reserved',
  items integer not null default 0,
  reserved_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  constraint weekly_digests_status_check check (status in ('reserved', 'sent', 'failed', 'empty')),
  constraint weekly_digests_week_check check (extract(isodow from week) = 1),
  constraint weekly_digests_error_check check (error is null or char_length(error) <= 300)
);

create unique index weekly_digests_week_idx on public.weekly_digests (org_id, user_id, week);

alter table public.weekly_digests enable row level security;
create policy "weekly_digests_select_own" on public.weekly_digests
  for select to authenticated using (user_id = auth.uid() and public.is_org_member(org_id));
grant select on table public.weekly_digests to authenticated;
create trigger guard_impersonation_weekly_digests after insert or update or delete on public.weekly_digests
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- What a week of a firm was ----------
/**
 * The facts of a firm's week (internal): from the Monday named to the Sunday after it, in Brasília's days, beside the
 * week before, and what the next week holds and what waits now. Counts and one sum of money; nothing of a person.
 */
create or replace function public.weekly_digest_facts(target_org uuid, target_week date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  week_start date := target_week - (extract(isodow from target_week)::integer - 1);
  from_at timestamptz;
  to_at timestamptz;
  before_at timestamptz;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  tests boolean := not public.firm_has_real_case(target_org);
  limits jsonb := coalesce(
    (select s.value -> 'stagnant_days' from public.platform_settings s where s.key = 'controladoria'), '{}'::jsonb
  );
  cases_part jsonb;
  outcomes_part jsonb;
  ahead_part jsonb;
  waiting_part jsonb;
  one_part jsonb;
begin
  from_at := week_start::timestamp at time zone 'America/Sao_Paulo';
  to_at := (week_start + 7)::timestamp at time zone 'America/Sao_Paulo';
  before_at := (week_start - 7)::timestamp at time zone 'America/Sao_Paulo';

  select jsonb_build_object(
    'opened', count(*) filter (where c.created_at >= from_at and c.created_at < to_at),
    'opened_before', count(*) filter (where c.created_at >= before_at and c.created_at < from_at),
    'ended', count(*) filter (where c.status = 'closed' and c.closed_at >= from_at and c.closed_at < to_at),
    'ended_before', count(*) filter (where c.status = 'closed' and c.closed_at >= before_at and c.closed_at < from_at),
    'going', count(*) filter (where c.status not in ('closed', 'declined'))
  ) into cases_part
  from public.cases c
  where c.org_id = target_org and (tests or not c.is_test);

  cases_part := cases_part || (
    select jsonb_build_object(
      'closings', count(*) filter (where k.closed_at >= from_at and k.closed_at < to_at),
      'closings_before', count(*) filter (where k.closed_at >= before_at and k.closed_at < from_at)
    )
    from public.case_closings(target_org) k
    join public.cases c on c.id = k.case_id
    where tests or not c.is_test
  ) || (
    select jsonb_build_object(
      'filed', count(*) filter (where p.filed_at >= week_start and p.filed_at < week_start + 7),
      'filed_before', count(*) filter (where p.filed_at >= week_start - 7 and p.filed_at < week_start)
    )
    from public.proceedings p
    join public.cases c on c.id = p.case_id
    where p.org_id = target_org and p.filed_at is not null and p.status <> 'planned' and (tests or not c.is_test)
  );

  select jsonb_build_object(
    'won', count(*) filter (where f.kind = 'sentenca' and f.result = 'procedente'),
    'partial', count(*) filter (where f.kind = 'sentenca' and f.result = 'parcial'),
    'lost', count(*) filter (where f.kind = 'sentenca' and f.result = 'improcedente'),
    'settlements', count(*) filter (where f.kind = 'acordo'),
    'final', count(*) filter (where f.kind = 'transito'),
    'received', (select count(*) from public.lawsuit_facts r join public.cases rc on rc.id = r.case_id
                 where r.org_id = target_org and r.kind = 'alvara' and r.corrected_at is null
                   and r.received_on >= week_start and r.received_on < week_start + 7 and (tests or not rc.is_test)),
    'received_cents', (select coalesce(sum(r.received_cents), 0) from public.lawsuit_facts r join public.cases rc on rc.id = r.case_id
                       where r.org_id = target_org and r.kind = 'alvara' and r.corrected_at is null
                         and r.received_on >= week_start and r.received_on < week_start + 7 and (tests or not rc.is_test))
  ) into outcomes_part
  from public.lawsuit_facts f
  join public.cases c on c.id = f.case_id
  where f.org_id = target_org and f.corrected_at is null and f.kind in ('sentenca', 'acordo', 'transito')
    and f.happened_on >= week_start and f.happened_on < week_start + 7 and (tests or not c.is_test);

  select jsonb_build_object(
    'deadlines', (select count(*) from public.deadlines d left join public.cases c on c.id = d.case_id
                  where d.org_id = target_org and d.status in ('proposed', 'confirmed')
                    and d.due_on >= week_start + 7 and d.due_on < week_start + 14 and (tests or not coalesce(c.is_test, false))),
    'hearings', (select count(*) from public.hearings h left join public.cases c on c.id = h.case_id
                 where h.org_id = target_org and h.status = 'scheduled'
                   and h.starts_at >= to_at and h.starts_at < (week_start + 14)::timestamp at time zone 'America/Sao_Paulo'
                   and (tests or not coalesce(c.is_test, false)))
  ) into ahead_part;

  select jsonb_build_object(
    'overdue', (select count(*) from public.deadlines d left join public.cases c on c.id = d.case_id
                where d.org_id = target_org and d.status in ('proposed', 'confirmed') and d.due_on < today
                  and (tests or not coalesce(c.is_test, false))),
    'stagnant', (select count(*) from public.case_standing(target_org) s join public.cases c on c.id = s.case_id
                 where (tests or not c.is_test)
                   and coalesce(case when jsonb_typeof(limits -> s.step) = 'number'
                     then greatest(today - (s.step_since at time zone 'America/Sao_Paulo')::date, 0) > (limits ->> s.step)::numeric
                   end, false)),
    'decisions', (select count(*) from public.approvals a where a.org_id = target_org and a.status = 'pending'),
    'awareness', (select count(*) from public.publications p where p.org_id = target_org and p.ack_owed)
  ) into waiting_part;

  select jsonb_build_object(
    'tasks', count(*),
    'minutes', coalesce(sum(coalesce(m.minutes, k.minutes)), 0)
  ) into one_part
  from public.one_work_acts(target_org, from_at, to_at) a
  join public.one_work_kinds k on k.key = a.kind
  left join public.firm_one_work_minutes m on m.org_id = target_org and m.kind = a.kind
  left join public.cases c on c.id = a.case_id
  where not coalesce(c.is_test, a.test, false) or tests;

  return jsonb_build_object(
    'week', week_start, 'week_end', week_start + 6, 'tests_counted', tests,
    'cases', cases_part, 'outcomes', outcomes_part, 'ahead', ahead_part, 'waiting', waiting_part, 'one', one_part
  );
end;
$$;

revoke all on function public.weekly_digest_facts(uuid, date) from public, anon, authenticated;

/**
 * What the person who decides for a firm reads in their settings: whether they receive the weekly digest, and the
 * facts of the week before this one, as the next e-mail would tell them. Anybody else of the firm reads that it is
 * not theirs.
 */
create or replace function public.firm_weekly_digest(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  monday date;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.decides_for_firm(target_org) then
    return jsonb_build_object('ok', true, 'decides', false);
  end if;
  monday := today - (extract(isodow from today)::integer - 1);
  return jsonb_build_object(
    'ok', true, 'decides', true,
    'on', not coalesce((select ap.weekly_off from public.agenda_preferences ap
                        where ap.org_id = target_org and ap.user_id = auth.uid()), false),
    'firm', (select o.name from public.organizations o where o.id = target_org),
    'facts', public.weekly_digest_facts(target_org, monday - 7)
  );
end;
$$;

revoke all on function public.firm_weekly_digest(uuid) from public, anon;
grant execute on function public.firm_weekly_digest(uuid) to authenticated;

/** The person who decides for the firm stops or starts their weekly digest. Never a support visit. */
create or replace function public.set_weekly_digest(target_org uuid, target_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.decides_for_firm(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  insert into public.agenda_preferences (org_id, user_id, weekly_off, weekly_changed_at)
  values (target_org, auth.uid(), not coalesce(target_on, true), now())
  on conflict (org_id, user_id) do update set weekly_off = excluded.weekly_off, weekly_changed_at = now();
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), case when coalesce(target_on, true) then 'weekly_digest.on' else 'weekly_digest.off' end,
    'profile', auth.uid()::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'on', coalesce(target_on, true));
end;
$$;

revoke all on function public.set_weekly_digest(uuid, boolean) from public, anon;
grant execute on function public.set_weekly_digest(uuid, boolean) to authenticated;

/**
 * The people whose weekly digest of a week is still owed (the backend's): who decides for each firm, with the e-mail
 * on, an address and nothing of that week recorded yet, a few firms at a time, each firm with its facts.
 */
create or replace function public.weekly_digests_owed(target_week date, target_firms integer default 5)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with owed as (
    select m.org_id, m.user_id, u.email, pr.email_unsubscribe_token as stop_token,
      coalesce(nullif(btrim(pr.display_name), ''), split_part(u.email, '@', 1)) as name
    from public.memberships m
    join auth.users u on u.id = m.user_id
    join public.profiles pr on pr.id = m.user_id
    left join public.agenda_preferences ap on ap.org_id = m.org_id and ap.user_id = m.user_id
    where public.decides_for_firm_of(m.org_id, m.user_id)
      and coalesce(ap.weekly_off, false) = false and u.email is not null and u.email <> ''
      and not exists (select 1 from public.weekly_digests w
                      where w.org_id = m.org_id and w.user_id = m.user_id and w.week = target_week)
  ),
  firms as (
    select o.id, o.name from public.organizations o
    where o.id in (select org_id from owed)
    order by o.id
    limit greatest(target_firms, 1)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'org_id', f.id, 'firm_name', f.name,
    'people', (select jsonb_agg(jsonb_build_object('user_id', w.user_id, 'email', w.email, 'name', w.name,
                 'stop_token', w.stop_token) order by w.user_id)
               from owed w where w.org_id = f.id),
    'facts', public.weekly_digest_facts(f.id, target_week)
  ) order by f.id), '[]'::jsonb)
  from firms f;
$$;

revoke all on function public.weekly_digests_owed(date, integer) from public, anon, authenticated;
grant execute on function public.weekly_digests_owed(date, integer) to service_role;

/**
 * The backend reserves a person's weekly digest before it sends it, or records a week with nothing (`empty`). Answers
 * the reservation when it is the caller's to send.
 */
create or replace function public.reserve_weekly_digest(target_org uuid, target_user uuid, target_week date, target_items integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved uuid;
begin
  if extract(isodow from target_week) <> 1 then
    raise exception 'invalid_week' using errcode = '22023';
  end if;
  insert into public.weekly_digests (org_id, user_id, week, status, items, finished_at)
  values (target_org, target_user, target_week, case when coalesce(target_items, 0) > 0 then 'reserved' else 'empty' end,
    greatest(coalesce(target_items, 0), 0), case when coalesce(target_items, 0) > 0 then null else now() end)
  on conflict (org_id, user_id, week) do nothing
  returning id into reserved;
  return case when coalesce(target_items, 0) > 0 then reserved else null end;
end;
$$;

revoke all on function public.reserve_weekly_digest(uuid, uuid, date, integer) from public, anon, authenticated;
grant execute on function public.reserve_weekly_digest(uuid, uuid, date, integer) to service_role;

/** What came of a reserved weekly digest: sent, failed, or refused by the provider's quota (the turn given back). */
create or replace function public.finish_weekly_digest(target_digest uuid, target_outcome text, target_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_outcome = 'quota' then
    delete from public.weekly_digests where id = target_digest and status = 'reserved';
  elsif target_outcome in ('sent', 'failed') then
    update public.weekly_digests set status = target_outcome, finished_at = now(), error = left(target_error, 300)
    where id = target_digest and status = 'reserved';
  else
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.finish_weekly_digest(uuid, text, text) from public, anon, authenticated;
grant execute on function public.finish_weekly_digest(uuid, text, text) to service_role;

/**
 * The one-click exit of the weekly digest (RFC 8058, the backend's): the person's own unsubscribe token stops that
 * e-mail in every firm they decide for, and nothing else.
 */
create or replace function public.stop_weekly_digest(target_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  person uuid;
begin
  select pr.id into person from public.profiles pr where pr.email_unsubscribe_token = target_token;
  if person is null then
    return false;
  end if;
  insert into public.agenda_preferences (org_id, user_id, weekly_off, weekly_changed_at)
  select m.org_id, m.user_id, true, now() from public.memberships m where m.user_id = person
  on conflict (org_id, user_id) do update set weekly_off = true, weekly_changed_at = now();
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  select m.org_id, person, 'weekly_digest.off', 'profile', person::text, jsonb_build_object('by', 'email')
  from public.memberships m where m.user_id = person;
  return true;
end;
$$;

revoke all on function public.stop_weekly_digest(uuid) from public, anon, authenticated;
grant execute on function public.stop_weekly_digest(uuid) to service_role;
