-- ============================================================
-- 0088_notices_by_default: the client's notices go with no agreement asked.
--
-- The owner, 2026-11-03: the notices of a client's own lawsuit (that what
-- they sent arrived, the filing, a hearing coming or moved, the course, the
-- warning against the scam, a document to send again) are the only way the
-- firm reaches the passenger, and a client who never answered the question
-- on their link would miss a hearing and leave the lawsuit stalled (in the
-- small-claims court a claimant absent from a hearing has the lawsuit
-- extinguished: Lei 9.099/1995, art. 51, I). So nobody is asked to agree any
-- longer: a notice goes to every person a lawsuit tells (its adult
-- claimants, and who answers for a minor) at the WhatsApp the firm has for
-- them, unless that person asked to stop:
--
--   on their link, kept with what the server saw of the request;
--   to a person of the firm, who records it saying how;
--   or on WhatsApp itself, writing SAIR, as the footer of every notice says
--   (`wa_optouts`, 0019), which stops every message the firm's number
--   would start.
--
-- A request to stop holds for the person, whatever number the firm has for
-- them later, until they ask to be told again (on their link, a few times a
-- day; or to a person of the firm, who records how). Nothing is rewritten:
-- every request stays on record, with who ended it and how.
--
--   notice_stops             every request to stop: one in force per person.
--   notice_person_blocker    no WhatsApp, SAIR, or a request to stop; the
--                            agreement is no longer asked (`no_optin` is gone).
--   document_recipient       a paper of the whole trip is asked of who may be
--                            told, first.
--   case_notices             each person's request to stop in force.
--   client_link_notices      what the link says: where the notices go, and
--                            whether the person stopped them.
--   client_link_set_notices  the client stops, or asks to be told again.
--   record_notice_optin      a person of the firm records that somebody asked
--                            to stop, or to be told again, saying how.
--
-- The agreements given before (`notice_optins`, 0038) stay on record and
-- decide nothing; a person whose last word was to take the agreement back
-- keeps that word, as a request to stop.
-- ============================================================

/**
 * Each request to stop the notices, kept as it was made and never rewritten:
 * one in force per person at most (`ended_at` is null). Asking to be told
 * again ends it; the row stays, with who ended it and how.
 */
create table public.notice_stops (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- client: on their own link; firm: a person of the firm recorded it, saying how the person asked.
  source text not null,
  note text,
  link_id uuid references public.client_links (id) on delete set null,
  -- What the server saw of the client's request (its browser, its address): never the caller's to write.
  evidence jsonb,
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  -- When the person asked to be told again, and how: on their link (with what the server saw), or to a person of
  -- the firm (saying how).
  ended_at timestamptz,
  ended_source text,
  ended_by uuid references public.profiles (id) on delete set null,
  ended_note text,
  ended_evidence jsonb,
  foreign key (person_id, org_id) references public.people (id, org_id) on delete cascade,
  constraint notice_stops_source_check check (source in ('client', 'firm')),
  constraint notice_stops_note_check check (
    (source = 'firm') = (note is not null) and (note is null or char_length(note) between 8 and 500)
  ),
  constraint notice_stops_end_check check (
    (ended_at is null) = (ended_source is null)
    and (ended_source is null or ended_source in ('client', 'firm'))
    and (ended_source = 'firm') = (ended_note is not null)
    and (ended_note is null or char_length(ended_note) between 8 and 500)
    and (ended_evidence is null or ended_source = 'client')
  )
);

-- One request in force per person.
create unique index notice_stops_current_idx on public.notice_stops (person_id) where ended_at is null;
create index notice_stops_org_idx on public.notice_stops (org_id);

alter table public.notice_stops enable row level security;

-- A support visit writes nothing of a firm's (0009).
create trigger guard_impersonation_notice_stops after insert or update or delete on public.notice_stops
  for each statement execute function public.guard_impersonation_readonly();

create policy "notice_stops_select_member" on public.notice_stops
  for select to authenticated
  using (public.is_org_member(org_id));

revoke all on table public.notice_stops from public, anon, authenticated;
grant select on table public.notice_stops to authenticated;

-- A person whose last word on the notices was to take the agreement back (on their link, or as the firm recorded
-- it) keeps that word: it is a request to stop now. One whose agreement is in force, or who never answered, is told.
insert into public.notice_stops (person_id, org_id, source, note, recorded_by, recorded_at)
select o.person_id, o.org_id, o.ended_source, o.ended_note, o.ended_by, o.ended_at
from (
  select distinct on (o.person_id) o.*
  from public.notice_optins o
  order by o.person_id, (o.ended_at is null) desc, o.ended_at desc nulls last, o.recorded_at desc
) o
where o.ended_at is not null and o.ended_source in ('client', 'firm');

/**
 * Why a person cannot be told on WhatsApp now, or null (replaces the one of
 * 0038, which asked for an agreement): no number; the number asked the firm
 * to stop on WhatsApp, with or without its ninth digit (SAIR); or the person
 * asked to stop the notices, on their link or to a person of the firm.
 */
create or replace function public.notice_person_blocker(target_org uuid, target_person uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.phone is null then 'no_phone'
    when exists (
      select 1 from public.wa_optouts w
      where w.org_id = target_org and w.contact_wa_id = any (public.wa_phone_variants(p.phone))
    ) then 'opted_out'
    when exists (
      select 1 from public.notice_stops s
      where s.person_id = p.id and s.org_id = target_org and s.ended_at is null
    ) then 'stopped'
  end
  from public.people p
  where p.id = target_person and p.org_id = target_org;
$$;

revoke all on function public.notice_person_blocker(uuid, uuid) from public, anon, authenticated;

/**
 * Who is asked again for a document the firm refused (replaces the one of
 * 0038): the person it is of, an adult, or who answers for them, a minor;
 * one sent through a link, its person, while they are still of the case (one
 * taken out of it is asked nothing, and nobody is asked in their place); a
 * paper of the whole trip the firm added, who holds the case as its screens
 * read it (an adult claimant, else who answers for a minor), one who may be
 * told first.
 */
create or replace function public.document_recipient(target_document uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when d.party_id is not null then (
      select coalesce(g.person_id, case
        when cp.guardian_id is null
         and (p.birth_date is null or p.birth_date <= ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date)
        then cp.person_id end)
      from public.case_parties cp
      join public.people p on p.id = cp.person_id
      left join public.case_parties g on g.id = cp.guardian_id
      where cp.id = d.party_id)
    when d.link_id is not null then (
      select l.person_id from public.client_links l
      where l.id = d.link_id
        and exists (select 1 from public.case_parties cp where cp.case_id = d.case_id and cp.person_id = l.person_id))
    else (
      select cp.person_id
      from public.case_parties cp
      join public.people p on p.id = cp.person_id
      where cp.case_id = d.case_id
        and ((cp.role = 'claimant' and cp.guardian_id is null
              and (p.birth_date is null
                   or p.birth_date <= ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date))
             or cp.role = 'guardian')
      order by (public.notice_person_blocker(d.org_id, p.id) is null) desc,
               (cp.role = 'claimant') desc, cp.created_at, cp.id
      limit 1)
  end
  from public.case_documents d
  where d.id = target_document;
$$;

revoke all on function public.document_recipient(uuid) from public, anon, authenticated;

/**
 * A case's notices, for its card (replaces the one of 0038): the people of
 * the case who are told (its adults, and who answers for a minor), each with
 * their number, the request to stop in force when they made one, and why they
 * cannot be told when they cannot; the notices sent, the latest first, with
 * what became of each message; and the ones due now with why each cannot go.
 * Anybody of the firm.
 */
create or replace function public.case_notices(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'kinds_on', coalesce((
      select jsonb_agg(f.kind order by f.kind) from public.firm_notice_kinds f
      where f.org_id = current_case.org_id and f.enabled
    ), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'person_id', p.id,
        'name', p.full_name,
        'phone', p.phone,
        'stop', case when s.id is null then null else jsonb_build_object(
          'source', s.source, 'note', s.note, 'recorded_at', s.recorded_at) end,
        'blocker', public.notice_person_blocker(current_case.org_id, p.id)
      ) order by p.full_name)
      from public.people p
      left join public.notice_stops s on s.person_id = p.id and s.ended_at is null
      where p.id in (
        select cp.person_id from public.case_parties cp
        join public.people pp on pp.id = cp.person_id
        where cp.case_id = current_case.id
          and (cp.role = 'guardian' or (cp.guardian_id is null and (pp.birth_date is null
               or pp.birth_date <= ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date)))
      )
    ), '[]'::jsonb),
    'sent', coalesce((
      select jsonb_agg(item order by (item ->> 'reserved_at') desc)
      from (
        select jsonb_build_object(
          'id', n.id, 'kind', n.kind, 'person_id', n.person_id, 'reserved_at', n.reserved_at, 'attempts', n.attempts,
          'about_at', n.about_at, 'status', m.status, 'error', m.error_code, 'body', m.body
        ) as item
        from public.client_notices n
        join public.wa_messages m on m.id = n.message_id
        where n.case_id = current_case.id
        order by n.reserved_at desc
        limit 30
      ) latest
    ), '[]'::jsonb),
    'due', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', c.kind, 'person_id', c.person_id, 'about_at', c.about_at, 'hearing_id', c.hearing_id,
        'proceeding_id', c.proceeding_id, 'blocker', c.blocker
      ) order by c.priority, c.about_at nulls last)
      from public.notice_candidates(current_case.org_id, current_case.id) c
      where c.blocker is distinct from 'kind_off'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.case_notices(uuid) from public, anon;
grant execute on function public.case_notices(uuid) to authenticated;

/**
 * What the link says of the notices (replaces the one of 0038): whether the
 * firm sends any, its name, the number they go to, whether the person asked
 * to stop them (when, and where), and whether the number asked the firm to
 * stop on WhatsApp. Nothing is asked to be agreed to: `agreed` is the person
 * being told, for a page loaded before this migration.
 */
create or replace function public.client_link_notices(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  person public.people%rowtype;
  stop public.notice_stops%rowtype;
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now()
     or not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id) then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  select * into person from public.people where id = link.person_id;
  select * into stop from public.notice_stops s where s.person_id = person.id and s.ended_at is null;
  return jsonb_build_object(
    'ok', true,
    -- The firm tells its clients something on WhatsApp: a kind of notice is on.
    'active', exists (select 1 from public.firm_notice_kinds k where k.org_id = link.org_id and k.enabled),
    'firm', (select o.name from public.organizations o where o.id = link.org_id),
    'phone', person.phone,
    'stopped', stop.id is not null,
    'stopped_at', stop.recorded_at,
    'stopped_source', stop.source,
    'opted_out', person.phone is not null and exists (
      select 1 from public.wa_optouts w
      where w.org_id = link.org_id and w.contact_wa_id = any (public.wa_phone_variants(person.phone))
    ),
    'agreed', person.phone is not null and stop.id is null
  );
end;
$$;

revoke all on function public.client_link_notices(text) from public;
grant execute on function public.client_link_notices(text) to anon, authenticated;

/**
 * The client stops the notices on their link, or asks to be told again
 * (replaces the one of 0038, where they agreed in words the page showed:
 * `target_wording` is no longer read). Nothing is rewritten: a request to stop
 * stays on record with what the server saw of the request, and asking to be
 * told again ends it, with what the server saw then. A link is no switch to
 * flip without end: stopping is always taken, being told again a few times a
 * day. Called by the backend only: the evidence is never the caller's to
 * write.
 */
create or replace function public.client_link_set_notices(
  target_token text,
  target_agree boolean,
  target_wording text default null,
  target_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  person public.people%rowtype;
  current_stop public.notice_stops%rowtype;
  seen jsonb := coalesce(target_evidence, '{}'::jsonb);
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now()
     or not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id) then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_agree is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_value');
  end if;
  -- The person's row is held: two answers given at once take turns, and the second finds the first.
  select * into person from public.people where id = link.person_id for update;
  select * into current_stop from public.notice_stops s where s.person_id = person.id and s.ended_at is null for update;
  seen := jsonb_strip_nulls(jsonb_build_object(
    'user_agent', left(case when jsonb_typeof(seen) = 'object' then seen ->> 'user_agent' end, 300),
    'ip', left(case when jsonb_typeof(seen) = 'object' then seen ->> 'ip' end, 64),
    'channel', 'link'
  ));

  if not target_agree then
    if current_stop.id is not null then
      return jsonb_build_object('ok', true, 'code', 'unchanged');
    end if;
    insert into public.notice_stops (person_id, org_id, source, link_id, evidence)
    values (person.id, link.org_id, 'client', link.id, seen);
    perform public.record_case_event(link.org_id, link.case_id, 'notices_stopped', 'client',
      jsonb_build_object('person', person.id));
    return jsonb_build_object('ok', true, 'code', 'stopped');
  end if;

  if current_stop.id is null then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  if (
    select count(*) from public.notice_stops s
    where s.person_id = person.id and s.ended_source = 'client' and s.ended_at > now() - interval '24 hours'
  ) >= greatest(public.notices_setting('optin_changes_per_day', 10), 1) then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;
  update public.notice_stops set ended_at = now(), ended_source = 'client', ended_evidence = seen
  where id = current_stop.id;
  perform public.record_case_event(link.org_id, link.case_id, 'notices_resumed', 'client',
    jsonb_build_object('person', person.id));
  return jsonb_build_object('ok', true, 'code', 'resumed');
end;
$$;

revoke all on function public.client_link_set_notices(text, boolean, text, jsonb) from public, anon, authenticated;

/**
 * A person of the firm records that somebody of a case asked to stop the
 * notices (`target_agreed` false), or asked to be told again (true), saying
 * how they asked (replaces the one of 0038, where the firm recorded an
 * agreement). Nothing is rewritten: a request to stop stays on record, and
 * being told again ends it. Anybody of the firm; never a support visit.
 */
create or replace function public.record_notice_optin(target_case uuid, target_person uuid, target_agreed boolean, target_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  person public.people%rowtype;
  current_stop public.notice_stops%rowtype;
  note_value text := nullif(left(btrim(regexp_replace(coalesce(target_note, ''), '[[:cntrl:]]+', ' ', 'g')), 500), '');
begin
  -- The person's row is held: two requests recorded at once take turns, and the second finds the first.
  select * into person from public.people p
  where p.id = target_person and p.org_id = current_case.org_id
    and exists (select 1 from public.case_parties cp where cp.case_id = current_case.id and cp.person_id = p.id)
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'person_not_found');
  end if;
  if target_agreed is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_value');
  end if;
  if note_value is null or char_length(note_value) < 8 then
    return jsonb_build_object('ok', false, 'code', 'note_required', 'field', 'note');
  end if;
  select * into current_stop from public.notice_stops s where s.person_id = person.id and s.ended_at is null for update;

  if not target_agreed then
    if current_stop.id is not null then
      return jsonb_build_object('ok', true, 'code', 'unchanged');
    end if;
    insert into public.notice_stops (person_id, org_id, source, note, recorded_by)
    values (person.id, current_case.org_id, 'firm', note_value, auth.uid());
    perform public.record_case_event(current_case.org_id, current_case.id, 'notices_stopped', 'person',
      jsonb_build_object('person', person.id));
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (current_case.org_id, auth.uid(), 'notices.stop_recorded', 'person', person.id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'code', 'stopped');
  end if;

  if current_stop.id is null then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  update public.notice_stops set ended_at = now(), ended_source = 'firm', ended_by = auth.uid(), ended_note = note_value
  where id = current_stop.id;
  perform public.record_case_event(current_case.org_id, current_case.id, 'notices_resumed', 'person',
    jsonb_build_object('person', person.id));
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'notices.stop_ended', 'person', person.id::text,
    jsonb_build_object('stop', current_stop.id));
  return jsonb_build_object('ok', true, 'code', 'resumed');
end;
$$;

revoke all on function public.record_notice_optin(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.record_notice_optin(uuid, uuid, boolean, text) to authenticated;
