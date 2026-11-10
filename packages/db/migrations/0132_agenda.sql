-- ============================================================
-- 0132 · A agenda de cada pessoa: o prazo interno, o e-mail da manhã e o link de calendário
--
-- Phase 8 of the plan of the controladoria, the outcome of the cases and the
-- firm's finance. A deadline is the market's "prazo fatal", and the firm works
-- to an internal one some of the court's business days before it: how many is
-- the firm's (`organizations.internal_deadline_days`, two by default, zero
-- switches it off), said by a partner or the controladoria. The internal day
-- itself is the rule's (`internalDeadline` of `@flyee/rules/deadlines`, over
-- the days the count saw), computed by the app wherever it is shown.
--
-- Who answers for each deadline and hearing is deduced, never assigned by
-- hand: the lawyers of the lawsuit, else the lawyers the publication was
-- addressed to, else who is responsible for the case; for a hearing, who
-- attends it too. Only people still of the firm.
--
-- Each person has an e-mail of the morning (on by default, stopped by them in
-- one click: `agenda_preferences.digest_off`) and a calendar link of their own
-- (`calendar_hash`: the SHA-256 of the link's token, never the token), which
-- ends when they leave the firm. The partners, who decide for the firm, and the
-- controladoria read the whole firm in both. The backend reserves each e-mail
-- before it sends it (`agenda_digests`, one per person and day), so none goes
-- twice; a refusal by the provider's quota gives the turn back.
--
-- What the e-mail and the link say of an item is the act's name, or "Prazo",
-- and the case's number: never a typed title, which may hold the client's name.
-- ============================================================

-- ---------- How many days before the fatal deadline ----------
alter table public.organizations add column internal_deadline_days smallint not null default 2;
alter table public.organizations add constraint organizations_internal_deadline_days_check
  check (internal_deadline_days between 0 and 15);

/** A partner (who decides for the firm) or the controladoria says how many of the court's business days before
 * the fatal deadline the internal one comes; zero switches it off. Never a support visit; on the record. */
create or replace function public.set_internal_deadline_days(target_org uuid, target_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  before integer;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.decides_for_firm(target_org)
     and not public.has_firm_function(target_org, array['controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if target_days is null or target_days not between 0 and 15 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  select internal_deadline_days into before from public.organizations where id = target_org for update;
  update public.organizations set internal_deadline_days = target_days where id = target_org;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'agenda.internal_days_set', 'organization', target_org::text,
    jsonb_build_object('before', before, 'after', target_days));
  return jsonb_build_object('ok', true, 'days', target_days);
end;
$$;

revoke all on function public.set_internal_deadline_days(uuid, integer) from public, anon;
grant execute on function public.set_internal_deadline_days(uuid, integer) to authenticated;

-- ---------- Each person's preferences ----------
create table public.agenda_preferences (
  org_id uuid not null,
  user_id uuid not null,
  -- The e-mail of the morning, stopped by the person.
  digest_off boolean not null default false,
  digest_changed_at timestamptz,
  -- The person's calendar link: the SHA-256 of its token, never the token, and when it was made.
  calendar_hash text,
  calendar_at timestamptz,
  primary key (org_id, user_id),
  -- A person who leaves the firm takes their preferences and their link with them.
  foreign key (org_id, user_id) references public.memberships (org_id, user_id) on delete cascade,
  constraint agenda_preferences_hash_check check (calendar_hash is null or calendar_hash ~ '^[0-9a-f]{64}$')
);

create unique index agenda_preferences_hash_idx on public.agenda_preferences (calendar_hash) where calendar_hash is not null;

alter table public.agenda_preferences enable row level security;
create policy "agenda_preferences_select_own" on public.agenda_preferences
  for select to authenticated using (user_id = auth.uid() and public.is_org_member(org_id));
-- The hash is read by nobody of the firm: the link is the person's alone, and ONE keeps no way back to it.
grant select (org_id, user_id, digest_off, digest_changed_at, calendar_at) on table public.agenda_preferences to authenticated;
create trigger guard_impersonation_agenda_preferences after insert or update or delete on public.agenda_preferences
  for each statement execute function public.guard_impersonation_readonly();

/** The person stops or starts their e-mail of the morning. Never a support visit. */
create or replace function public.set_agenda_digest(target_org uuid, target_on boolean)
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
  insert into public.agenda_preferences (org_id, user_id, digest_off, digest_changed_at)
  values (target_org, auth.uid(), not coalesce(target_on, true), now())
  on conflict (org_id, user_id) do update set digest_off = excluded.digest_off, digest_changed_at = now();
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), case when coalesce(target_on, true) then 'agenda.digest_on' else 'agenda.digest_off' end,
    'profile', auth.uid()::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'on', coalesce(target_on, true));
end;
$$;

revoke all on function public.set_agenda_digest(uuid, boolean) from public, anon;
grant execute on function public.set_agenda_digest(uuid, boolean) to authenticated;

/**
 * The person makes their calendar link, or a new one: the app hands the SHA-256 of the token it shows the person
 * once, and the link before it stops answering. Never a support visit; on the record, never with the hash.
 */
create or replace function public.start_agenda_calendar(target_org uuid, target_hash text)
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
  if target_hash is null or target_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  insert into public.agenda_preferences (org_id, user_id, calendar_hash, calendar_at)
  values (target_org, auth.uid(), target_hash, now())
  on conflict (org_id, user_id) do update set calendar_hash = excluded.calendar_hash, calendar_at = now();
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'agenda.calendar_started', 'profile', auth.uid()::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.start_agenda_calendar(uuid, text) from public, anon;
grant execute on function public.start_agenda_calendar(uuid, text) to authenticated;

/** The person ends their calendar link: it stops answering at once. Never a support visit; on the record. */
create or replace function public.end_agenda_calendar(target_org uuid)
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
  update public.agenda_preferences set calendar_hash = null, calendar_at = null
  where org_id = target_org and user_id = auth.uid() and calendar_hash is not null;
  if found then
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, auth.uid(), 'agenda.calendar_ended', 'profile', auth.uid()::text, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.end_agenda_calendar(uuid) from public, anon;
grant execute on function public.end_agenda_calendar(uuid) to authenticated;

-- ---------- Who answers for each item ----------
/** Whether a person reads the whole firm in their agenda's e-mail and link: who decides for it, or the controladoria. */
create or replace function public.agenda_whole_firm(target_org uuid, target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = target_user
      and (m.firm_function in ('socio', 'controladoria')
           or (m.role in ('owner', 'admin') and not exists (
             select 1 from public.memberships p where p.org_id = target_org and p.firm_function = 'socio')))
  );
$$;

revoke all on function public.agenda_whole_firm(uuid, uuid) from public, anon, authenticated;

/**
 * Who answers for a deadline (internal): the lawyers of its lawsuit, else the lawyers its publication was addressed
 * to, else who is responsible for its case; only people still of the firm.
 */
create or replace function public.agenda_deadline_people(target_deadline uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with d as (select * from public.deadlines where id = target_deadline),
  members as (select m.user_id from public.memberships m join d on d.org_id = m.org_id),
  lawyers as (
    select array_agg(distinct l.user_id order by l.user_id) as ids from public.proceeding_lawyers l join d on d.proceeding_id = l.proceeding_id
    where l.user_id in (select user_id from members)
  ),
  addressed as (
    select array_agg(distinct x order by x) as ids
    from d join public.publications p on p.id = d.publication_id, unnest(p.lawyer_ids) as x
    where x in (select user_id from members)
  ),
  responsible as (
    select array_agg(c.responsible_id) as ids from d join public.cases c on c.id = d.case_id
    where c.responsible_id in (select user_id from members)
  )
  select coalesce((select ids from lawyers), (select ids from addressed), (select ids from responsible), '{}'::uuid[]);
$$;

revoke all on function public.agenda_deadline_people(uuid) from public, anon, authenticated;

/** Who answers for a hearing (internal): who attends it, and the lawyers of its lawsuit, else who is responsible for
 * its case; only people still of the firm. */
create or replace function public.agenda_hearing_people(target_hearing uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  with h as (select * from public.hearings where id = target_hearing),
  members as (select m.user_id from public.memberships m join h on h.org_id = m.org_id),
  lawyers as (
    select array_agg(distinct l.user_id order by l.user_id) as ids from public.proceeding_lawyers l join h on h.proceeding_id = l.proceeding_id
    where l.user_id in (select user_id from members)
  ),
  responsible as (
    select array_agg(c.responsible_id) as ids from h join public.cases c on c.id = h.case_id
    where c.responsible_id in (select user_id from members)
  ),
  chosen as (
    select coalesce((select ids from lawyers), (select ids from responsible), '{}'::uuid[])
      || coalesce((select array[h.attendee_user_id] from h where h.attendee_user_id in (select user_id from members)), '{}'::uuid[])
      as ids
  )
  select coalesce((select array_agg(distinct x order by x) from chosen, unnest(chosen.ids) as x), '{}'::uuid[]);
$$;

revoke all on function public.agenda_hearing_people(uuid) from public, anon, authenticated;

/**
 * The items of a firm's agenda between two days (internal): the open deadlines whose fatal day is from `from_day` to
 * 31 days past `to_day` (the app computes each one's internal day, which may fall in the range), and the hearings
 * that start in the range, cancelled ones included; each with who answers for it. Under a module, only its cases.
 */
create or replace function public.agenda_items(target_org uuid, from_day date, to_day date, target_module text default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'deadlines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'act', d.act, 'act_name', a.name, 'title', d.title, 'status', d.status, 'due_on', d.due_on,
        'starts_on', d.starts_on, 'explanation', d.explanation, 'case_id', d.case_id, 'case_seq', c.seq,
        'is_test', coalesce(c.is_test, false), 'cnj', d.cnj, 'court', d.court,
        'changed_at', greatest(d.created_at, d.computed_at, d.confirmed_at),
        'people', public.agenda_deadline_people(d.id)
      ) order by d.due_on, d.id)
      from public.deadlines d
      left join public.deadline_acts a on a.slug = d.act
      left join public.cases c on c.id = d.case_id
      where d.org_id = target_org and d.status in ('proposed', 'confirmed') and d.due_on is not null
        and d.due_on between from_day and to_day + 31
        and (target_module is null or c.module = target_module)
    ), '[]'::jsonb),
    'hearings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'kind', h.kind, 'mode', h.mode, 'status', h.status, 'starts_at', h.starts_at,
        'time_zone', h.time_zone, 'case_id', h.case_id, 'case_seq', c.seq, 'is_test', coalesce(c.is_test, false),
        'cnj', p.cnj, 'court', p.court, 'attendee_user_id', h.attendee_user_id,
        'changed_at', h.updated_at, 'people', public.agenda_hearing_people(h.id)
      ) order by h.starts_at, h.id)
      from public.hearings h
      join public.cases c on c.id = h.case_id
      join public.proceedings p on p.id = h.proceeding_id
      where h.org_id = target_org
        and h.starts_at >= (from_day::timestamp at time zone 'America/Sao_Paulo') - interval '1 day'
        and h.starts_at < ((to_day + 1)::timestamp at time zone 'America/Sao_Paulo') + interval '1 day'
        and (target_module is null or c.module = target_module)
    ), '[]'::jsonb),
    'duration_minutes', greatest(public.hearings_setting('duration_minutes', 60), 1)
  );
$$;

revoke all on function public.agenda_items(uuid, date, date, text) from public, anon, authenticated;

/**
 * What anybody of the firm reads of its agenda between two days (at most 62), under a module or every one: the items
 * with who answers for each, the firm's internal days, and the person's own preferences.
 */
create or replace function public.firm_agenda(target_org uuid, from_day date, to_day date, target_module text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  prefs public.agenda_preferences%rowtype;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if from_day is null or to_day is null or to_day < from_day or to_day - from_day > 62 then
    return jsonb_build_object('ok', false, 'code', 'invalid_range');
  end if;
  select * into prefs from public.agenda_preferences where org_id = target_org and user_id = auth.uid();
  return public.agenda_items(target_org, from_day, to_day, target_module) || jsonb_build_object(
    'ok', true,
    'internal_days', (select o.internal_deadline_days from public.organizations o where o.id = target_org),
    'me', jsonb_build_object(
      'id', auth.uid(),
      'whole_firm', public.agenda_whole_firm(target_org, auth.uid()),
      'digest_on', not coalesce(prefs.digest_off, false),
      'calendar_at', prefs.calendar_at,
      'sets_internal_days', public.decides_for_firm(target_org)
        or public.has_firm_function(target_org, array['controladoria']::public.firm_function[])
    )
  );
end;
$$;

revoke all on function public.firm_agenda(uuid, date, date, text) from public, anon;
grant execute on function public.firm_agenda(uuid, date, date, text) to authenticated;

-- ---------- The e-mail of the morning ----------
create table public.agenda_digests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The day of Brasília it is the e-mail of.
  day date not null,
  -- reserved  being sent: never sent again by itself;
  -- sent      the provider took it;
  -- failed    the provider refused it for another reason than its quota;
  -- empty     nothing of that person for the day: no e-mail.
  status text not null default 'reserved',
  items integer not null default 0,
  reserved_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  constraint agenda_digests_status_check check (status in ('reserved', 'sent', 'failed', 'empty')),
  constraint agenda_digests_error_check check (error is null or char_length(error) <= 300)
);

create unique index agenda_digests_day_idx on public.agenda_digests (org_id, user_id, day);

alter table public.agenda_digests enable row level security;
create policy "agenda_digests_select_own" on public.agenda_digests
  for select to authenticated using (user_id = auth.uid() and public.is_org_member(org_id));
grant select on table public.agenda_digests to authenticated;
create trigger guard_impersonation_agenda_digests after insert or update or delete on public.agenda_digests
  for each statement execute function public.guard_impersonation_readonly();

/**
 * The people of the firms whose e-mail of a day is still owed (the backend's): members with the e-mail on, an address,
 * and no e-mail of that day recorded yet, a few firms at a time, the people of each firm with the items of the day and
 * the two business days after it (the app picks each person's, and says nothing to who has none).
 */
create or replace function public.agenda_digests_owed(target_day date, target_to date, target_firms integer default 5)
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
    where coalesce(ap.digest_off, false) = false and u.email is not null and u.email <> ''
      and not exists (select 1 from public.agenda_digests g where g.org_id = m.org_id and g.user_id = m.user_id and g.day = target_day)
  ),
  firms as (
    select o.id, o.name, o.internal_deadline_days from public.organizations o
    where o.id in (select org_id from owed)
    order by o.id
    limit greatest(target_firms, 1)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'org_id', f.id, 'firm_name', f.name, 'internal_days', f.internal_deadline_days,
    'people', (select jsonb_agg(jsonb_build_object('user_id', w.user_id, 'email', w.email, 'name', w.name, 'stop_token', w.stop_token,
                 'whole_firm', public.agenda_whole_firm(f.id, w.user_id)) order by w.user_id)
               from owed w where w.org_id = f.id),
    'items', public.agenda_items(f.id, target_day, target_to)
  ) order by f.id), '[]'::jsonb)
  from firms f;
$$;

revoke all on function public.agenda_digests_owed(date, date, integer) from public, anon, authenticated;
grant execute on function public.agenda_digests_owed(date, date, integer) to service_role;

/**
 * The backend reserves a person's e-mail of a day before it sends it, or records that there was nothing of them that
 * day (`empty`). Answers whether the reservation is the caller's: another worker that got there first, or an e-mail of
 * that day already on record, makes it nobody's to send again.
 */
create or replace function public.reserve_agenda_digest(target_org uuid, target_user uuid, target_day date, target_items integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved uuid;
begin
  insert into public.agenda_digests (org_id, user_id, day, status, items, finished_at)
  values (target_org, target_user, target_day, case when coalesce(target_items, 0) > 0 then 'reserved' else 'empty' end,
    greatest(coalesce(target_items, 0), 0), case when coalesce(target_items, 0) > 0 then null else now() end)
  on conflict (org_id, user_id, day) do nothing
  returning id into reserved;
  return case when coalesce(target_items, 0) > 0 then reserved else null end;
end;
$$;

revoke all on function public.reserve_agenda_digest(uuid, uuid, date, integer) from public, anon, authenticated;
grant execute on function public.reserve_agenda_digest(uuid, uuid, date, integer) to service_role;

/**
 * What came of a reserved e-mail: sent, failed (with the provider's words, never a person's data), or refused by the
 * provider's quota, which gives the turn back (the reservation goes, and the next round tries again).
 */
create or replace function public.finish_agenda_digest(target_digest uuid, target_outcome text, target_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_outcome = 'quota' then
    delete from public.agenda_digests where id = target_digest and status = 'reserved';
  elsif target_outcome in ('sent', 'failed') then
    update public.agenda_digests set status = target_outcome, finished_at = now(), error = left(target_error, 300)
    where id = target_digest and status = 'reserved';
  else
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.finish_agenda_digest(uuid, text, text) from public, anon, authenticated;
grant execute on function public.finish_agenda_digest(uuid, text, text) to service_role;

-- ---------- The calendar link ----------
/**
 * What a calendar link shows (the backend's, from the SHA-256 of the link's token): the person, whether they read the
 * whole firm, the firm's internal days, and the items of thirty days back to a hundred and eighty ahead. A link nobody
 * holds any more, or of a person who left the firm, answers nothing.
 */
create or replace function public.agenda_calendar_feed(target_hash text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'org_id', ap.org_id, 'user_id', ap.user_id,
    'whole_firm', public.agenda_whole_firm(ap.org_id, ap.user_id),
    'internal_days', o.internal_deadline_days
  ) || public.agenda_items(ap.org_id, (now() at time zone 'America/Sao_Paulo')::date - 30,
                           (now() at time zone 'America/Sao_Paulo')::date + 180)
  from public.agenda_preferences ap
  join public.organizations o on o.id = ap.org_id
  where target_hash ~ '^[0-9a-f]{64}$' and ap.calendar_hash = target_hash;
$$;

revoke all on function public.agenda_calendar_feed(text) from public, anon, authenticated;
grant execute on function public.agenda_calendar_feed(text) to service_role;

/**
 * The one-click exit of the e-mail of the morning (RFC 8058, the backend's): the person's own unsubscribe token
 * (`profiles.email_unsubscribe_token`) stops that e-mail in their firm, and nothing else. Answers whether it stopped.
 */
create or replace function public.stop_agenda_digest(target_token uuid)
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
  insert into public.agenda_preferences (org_id, user_id, digest_off, digest_changed_at)
  select m.org_id, m.user_id, true, now() from public.memberships m where m.user_id = person
  on conflict (org_id, user_id) do update set digest_off = true, digest_changed_at = now();
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  select m.org_id, person, 'agenda.digest_off', 'profile', person::text, jsonb_build_object('by', 'email')
  from public.memberships m where m.user_id = person;
  return true;
end;
$$;

revoke all on function public.stop_agenda_digest(uuid) from public, anon, authenticated;
grant execute on function public.stop_agenda_digest(uuid) to service_role;

-- ---------- A file a cost of a case names is never forgotten (0131) ----------
create or replace function public.discard_file(target_file uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  file public.files%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into file from public.files where id = target_file for update;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'not_found');
  end if;
  if exists (select 1 from public.issued_documents d where d.file_id = file.id)
     or exists (select 1 from public.case_documents d where d.file_id = file.id or d.normalized_file_id = file.id)
     or exists (select 1 from public.case_statements s where s.audio_file_id = file.id)
     or exists (select 1 from public.wa_messages m where m.media_file_id = file.id)
     or exists (select 1 from public.filing_package_items i where i.file_id = file.id or i.signed_file_id = file.id)
     or exists (select 1 from public.filing_receipts r where r.file_id = file.id)
     or exists (select 1 from public.filing_submissions s where s.receipt_file_id = file.id)
     or exists (select 1 from public.template_imports i where i.file_id = file.id)
     or exists (select 1 from public.pax_documents d where d.file_id = file.id)
     -- The receipt of a cost of a case (0131).
     or exists (select 1 from public.case_costs c where c.file_id = file.id) then
    return jsonb_build_object('ok', false, 'code', 'in_use');
  end if;

  delete from public.files where id = file.id;
  -- A file a partner held is none of the firm's trail (`confirm_file`, 0070).
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (case when file.partner_id is null then file.org_id end, null, 'file.discarded', 'file', file.id::text,
          jsonb_strip_nulls(jsonb_build_object('purpose', file.purpose, 'status', file.status, 'partner', file.partner_id)));
  return jsonb_build_object('ok', true, 'code', 'discarded');
end;
$$;

revoke all on function public.discard_file(uuid) from public, anon, authenticated;
