-- ============================================================
-- 0044_firm_setup: a firm that starts ready, and what waits for somebody.
--
-- Setting a firm up asked for four things before anything else (the CNPJ, a
-- registration at the bar, a team, a WhatsApp number), and a lawyer who works
-- alone could never finish it: the team counted as done only with a second
-- member or an invitation still open. Nothing in ONE needs a second person. A
-- firm now says once whether it works alone (`organizations.works_alone`),
-- which takes the team out of its list, and the setup records when its first
-- questions were answered (`setup_answered_at`), so the screen that asks them
-- does not ask again. The CNPJ leaves the first steps: it is asked when the
-- firm subscribes (0004). What the list reads now (`firm_setup_facts`, as in
-- 0020, with more facts): the registration at the bar together with somebody
-- chosen to sign what ONE prepares, the team where there is one, the channel
-- to the clients and the first case.
--
-- What waits for somebody, on every screen: `firm_pending` gives the cases in
-- which ONE waits for a person, each with what it waits for and since when
-- (`case_advances.waiting_since`, kept by a trigger: the moment the code ONE
-- waits for last changed), the deadlines past their day with their case, and
-- the counts `firm_today` does not have: the deadlines and hearings of today,
-- and the papers a client sent that nobody decided for longer than the
-- setting's hours. How long is too long is data (`platform_settings` key
-- `pending`). A firm reads its own only.
-- ============================================================

alter table public.organizations add column works_alone boolean;
alter table public.organizations add column setup_answered_at timestamptz;

comment on column public.organizations.works_alone is
  'The firm said it works alone (true) or with a team (false); null until it answers.';
comment on column public.organizations.setup_answered_at is
  'When the first questions of the setup were answered or set aside; null while they were never seen.';

/**
 * The answers of the first questions: whether the firm works alone, and that
 * the questions are answered. Who manages the firm (owner or admin), never in
 * a support visit; each answer on the record. An answer left out keeps the one
 * there was, and the moment the setup was answered is never moved.
 */
create or replace function public.answer_firm_setup(
  target_org uuid,
  target_works_alone boolean default null,
  target_finished boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_works_alone is null and not coalesce(target_finished, false) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;

  update public.organizations o set
    works_alone = coalesce(target_works_alone, o.works_alone),
    setup_answered_at = case when coalesce(target_finished, false) then coalesce(o.setup_answered_at, now()) else o.setup_answered_at end
  where o.id = target_org;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org, caller, 'firm.setup_answered', 'organization', target_org::text,
    jsonb_strip_nulls(jsonb_build_object('works_alone', target_works_alone, 'finished', coalesce(target_finished, false)))
  );

  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.answer_firm_setup(uuid, boolean, boolean) from public, anon;
grant execute on function public.answer_firm_setup(uuid, boolean, boolean) to authenticated;

/**
 * What the setup list of a firm reads: each a fact of the data, never a box
 * somebody ticked. `oab_signer` is a registration at the bar together with
 * somebody chosen to sign what ONE prepares; `team` is read only where the
 * firm did not say it works alone; `channel` is a way to the clients.
 */
create or replace function public.firm_setup_facts(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  has_oab boolean;
  has_signer boolean;
  org public.organizations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into org from public.organizations o where o.id = target_org;
  has_oab := exists (
    select 1 from public.oab_registrations r
    join public.memberships m on m.user_id = r.user_id
    where m.org_id = target_org
  );
  has_signer := exists (select 1 from public.firm_signers s where s.org_id = target_org);

  return jsonb_build_object(
    'firm_document', org.billing_cpf_cnpj is not null,
    'oab', has_oab,
    'signer', has_signer,
    'oab_signer', has_oab and has_signer,
    'team', (select count(*) from public.memberships m where m.org_id = target_org) > 1
      or exists (
        select 1 from public.firm_invitations i
        where i.org_id = target_org and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
      ),
    'works_alone', coalesce(org.works_alone, false),
    'whatsapp', exists (select 1 from public.wa_numbers n where n.org_id = target_org and n.status = 'active'),
    'channel', exists (select 1 from public.wa_numbers n where n.org_id = target_org and n.status = 'active'),
    'first_case', exists (select 1 from public.cases c where c.org_id = target_org),
    'setup_answered', org.setup_answered_at is not null
  );
end;
$$;

revoke all on function public.firm_setup_facts(uuid) from public, anon;
grant execute on function public.firm_setup_facts(uuid) to authenticated;

-- ---------- Since when ONE waits ----------

alter table public.case_advances add column waiting_since timestamptz;

-- What waited before this migration is said to wait since ONE last looked.
update public.case_advances set waiting_since = coalesce(checked_at, created_at) where waiting is not null;

grant select (waiting_since) on table public.case_advances to authenticated;

/** The moment the code ONE waits for last changed; nothing while it waits for nothing. */
create or replace function public.case_advances_track_waiting()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.waiting is null then
    new.waiting_since := null;
  elsif tg_op = 'INSERT' or old.waiting is distinct from new.waiting then
    new.waiting_since := now();
  end if;
  return new;
end;
$$;

revoke all on function public.case_advances_track_waiting() from public, anon, authenticated;

create trigger case_advances_track_waiting before insert or update of waiting on public.case_advances
  for each row execute function public.case_advances_track_waiting();

-- ---------- What waits for somebody ----------

insert into public.platform_settings (key, value, is_public)
values ('pending', '{"documents_stale_hours": 24, "one_waits_stale_days": 2, "list_size": 20}'::jsonb, false)
on conflict (key) do nothing;

/** A number of the setting `pending`, or the fallback when it is not one. */
create or replace function public.pending_setting(setting text, fallback integer)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select (ps.value ->> setting)::integer
      from public.platform_settings ps
      where ps.key = 'pending' and coalesce(ps.value ->> setting, '') ~ '^[0-9]{1,6}$'
    ),
    fallback
  );
$$;

revoke all on function public.pending_setting(text, integer) from public, anon, authenticated;

/**
 * What waits for somebody of the firm, for the screens that tell it wherever
 * the person is (the counts of `firm_today` beside it). Each list is the
 * firm's own, oldest first, within the setting's size, with its total.
 *
 * - `one_waits`: the cases ONE carries and cannot carry on without a person,
 *   with the code it waits for (the case screen's words, 0039) and since when;
 *   a passing failure ONE tries again by itself, and a case the firm holds on
 *   the Tema 1.417, wait for nobody now.
 * - `deadlines_overdue`: the deadlines past their day, with their case.
 * - `deadlines_today`, `hearings_today`: what falls today, in Brasília (a
 *   hearing by the day of its own zone).
 * - `documents_stale`: papers received and decided by nobody for longer than
 *   the setting's hours.
 */
create or replace function public.firm_pending(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  document_hours integer := greatest(public.pending_setting('documents_stale_hours', 24), 1);
  waits_days integer := greatest(public.pending_setting('one_waits_stale_days', 2), 1);
  list_size integer := least(greatest(public.pending_setting('list_size', 20), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'one_waits', coalesce((
      select jsonb_agg(w.item order by w.since nulls last, w.seq)
      from (
        select
          a.waiting_since as since,
          c.seq,
          jsonb_build_object(
            'case_id', c.id,
            'seq', c.seq,
            -- The case is named as its list names it (0033): its first adult claimant, or who answers for a minor.
            'client', coalesce((
              select p.full_name from public.case_parties cp
              join public.people p on p.id = cp.person_id
              where cp.case_id = c.id
              order by (cp.role = 'claimant' and cp.guardian_id is null) desc, (cp.role = 'guardian') desc,
                       cp.created_at, cp.id
              limit 1
            ), ''),
            'waiting', a.waiting,
            'since', a.waiting_since
          ) as item
        from public.case_advances a
        join public.cases c on c.id = a.case_id
        where a.org_id = target_org and a.waiting is not null and a.waiting not in ('unavailable', 'held')
          and c.status not in ('closed', 'declined')
        order by a.waiting_since nulls last, c.seq
        limit list_size
      ) w
    ), '[]'::jsonb),
    'one_waits_total', (
      select count(*) from public.case_advances a
      join public.cases c on c.id = a.case_id
      where a.org_id = target_org and a.waiting is not null and a.waiting not in ('unavailable', 'held')
        and c.status not in ('closed', 'declined')
    ),
    'one_waits_stale', (
      select count(*) from public.case_advances a
      join public.cases c on c.id = a.case_id
      where a.org_id = target_org and a.waiting is not null and a.waiting not in ('unavailable', 'held')
        and c.status not in ('closed', 'declined')
        and a.waiting_since < now() - make_interval(days => waits_days)
    ),
    'deadlines_overdue', coalesce((
      select jsonb_agg(x.item order by x.urgent_on, x.title)
      from (
        select
          u.urgent_on,
          d.title,
          jsonb_build_object(
            'deadline_id', d.id,
            'case_id', d.case_id,
            'seq', (select c.seq from public.cases c where c.id = d.case_id),
            'title', d.title,
            'cnj', d.cnj,
            'due_on', u.urgent_on
          ) as item
        from public.deadlines d
        cross join lateral (
          select public.deadline_urgent_on(d.status, d.due_on, d.computed_due_on, d.computed_revision, d.revision,
            d.confirmed_against) as urgent_on
        ) u
        where d.org_id = target_org and d.status in ('proposed', 'confirmed') and u.urgent_on < today
        order by u.urgent_on, d.title
        limit list_size
      ) x
    ), '[]'::jsonb),
    'deadlines_today', (
      select count(*) from public.deadlines d
      where d.org_id = target_org and d.status in ('proposed', 'confirmed')
        and public.deadline_urgent_on(d.status, d.due_on, d.computed_due_on, d.computed_revision, d.revision,
          d.confirmed_against) = today
    ),
    'hearings_today', (
      select count(*) from public.hearings h
      where h.org_id = target_org and h.status = 'scheduled'
        and (h.starts_at at time zone h.time_zone)::date = (now() at time zone h.time_zone)::date
    ),
    'documents_stale', (
      select count(*) from public.case_documents d
      where d.org_id = target_org and d.status = 'received'
        and d.created_at < now() - make_interval(hours => document_hours)
    ),
    'documents_stale_hours', document_hours,
    'one_waits_stale_days', waits_days
  );
end;
$$;

revoke all on function public.firm_pending(uuid) from public, anon;
grant execute on function public.firm_pending(uuid) to authenticated;
