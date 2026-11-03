-- ============================================================
-- 0086_agreement_phone: an agreement is given at a WhatsApp, and the
-- agency is told when it no longer covers the passenger's trips.
--
-- The owner, 2026-11-03: a passenger's WhatsApp changed after she agreed,
-- and ONE stopped following her trip, as 0074 wants (an agreement covers
-- the WhatsApp it was given at: the alerts go to no number the passenger
-- did not agree with). Nothing on any screen said so: the agency's list
-- kept "Concordou", its count of agreements still owed said none, and her
-- link would have told her a trip had been added after her agreement.
--
-- Each yes now keeps the WhatsApp it was given at (`pax_consents.phone`;
-- a yes from before this was kept is taken as given at the WhatsApp ONE
-- followed it at). `pax_reagree` says when a passenger's agreement in force
-- no longer covers their trips, and why: the WhatsApp on record changed
-- since (`phone_changed`), or a trip of theirs ONE does not follow, added
-- or completed after the agreement (`trip_waiting`). The agency's list,
-- count, filter and passenger page say it, and so does the passenger's
-- link. A WhatsApp put back to the one the yes was given at is followed
-- again by itself, as that yes said.
-- ============================================================

alter table public.pax_consents
  -- The WhatsApp the passenger agreed at (an answer that is a yes); null for a no, a withdrawal or a yes from before.
  add column phone text,
  add constraint pax_consents_phone_check check (phone is null or phone ~ '^[0-9]{12,15}$');

-- A yes from before this was kept: the WhatsApp ONE followed its trips at is the one it was given at.
update public.pax_consents c set phone = (
  select t.phone from public.tracked_trips t
  join public.pax_trips p on p.id = t.pax_trip_id
  where p.holder_id = c.given_by
  order by t.created_at desc
  limit 1
)
where c.answer = 'agreed' and c.phone is null and c.given_by is not null;

/**
 * Why a holder's agreement in force no longer covers their trips, or null when it does, or when there is no agreement
 * to speak of (a draft, a passenger who never agreed, said no or took it back, one whose data went to the firm):
 * `phone_changed`, the WhatsApp on record is not the one the yes was given at; `trip_waiting`, a trip they hold, with
 * its legs and not over, is not followed (added or completed after the agreement). Internal.
 */
create or replace function public.pax_reagree(target_holder uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when latest.answer is distinct from 'agreed' or holder.draft or holder.handed_over_at is not null then null
    when latest.phone is not null and latest.phone is distinct from holder.phone then 'phone_changed'
    when exists (
      select 1 from public.pax_trips p
      where p.holder_id = holder.id
        and exists (
          select 1 from public.pax_trip_legs l
          where l.trip_id = p.id
            and l.scheduled_arrival_local >= (now() at time zone 'America/Sao_Paulo') - interval '1 day')
        and not exists (select 1 from public.tracked_trips t where t.pax_trip_id = p.id)
    ) then 'trip_waiting'
  end
  from public.pax_travelers holder
  cross join lateral (
    select c.answer, c.phone from public.pax_consents c
    where c.traveler_id = holder.id and c.given_by is not distinct from holder.id
    order by c.created_at desc, c.id desc
    limit 1
  ) latest
  where holder.id = target_holder;
$$;

revoke all on function public.pax_reagree(uuid) from public, anon, authenticated;

-- ---------- The yes keeps its WhatsApp ----------

/** 0074, redefined: the passenger answers on their link; a yes keeps the WhatsApp it was given at. */
create or replace function public.pax_link_answer(
  target_token text,
  target_answer text,
  target_wording text,
  target_evidence jsonb default '{}'::jsonb,
  target_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.pax_confirm_links%rowtype;
  holder public.pax_travelers%rowtype;
  partnership public.partner_links%rowtype;
  wording text;
  term uuid;
  person uuid;
  cleaned jsonb;
  followed integer;
  agreed_at text;
begin
  if target_answer is null or target_answer not in ('agreed', 'declined', 'withdrawn') then
    return jsonb_build_object('ok', false, 'code', 'invalid_answer');
  end if;
  link := public.pax_link_by_token(target_token);
  if link.id is null or link.ended_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_found');
  end if;
  select * into partnership from public.partner_links where id = link.partnership_id;
  if partnership.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'partnership_ended');
  end if;
  select * into holder from public.pax_travelers where id = link.holder_id for update;
  if holder.handed_over_at is not null then
    return jsonb_build_object('ok', false, 'code', 'handed_over');
  end if;
  wording := public.pax_consent_wording(holder.id);
  if wording is null or regexp_replace(btrim(wording), '\s+', ' ', 'g')
                        <> regexp_replace(btrim(coalesce(target_wording, '')), '\s+', ' ', 'g') then
    return jsonb_build_object('ok', false, 'code', 'wording_changed');
  end if;
  if (select count(*) from public.pax_consents c
      where c.traveler_id = holder.id and c.created_at > now() - interval '24 hours') >= 10 then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;
  if target_answer = 'agreed' then
    if nullif(btrim(coalesce(target_phone, '')), '') is not null then
      cleaned := public.pax_clean_fields(jsonb_build_object('phone', target_phone));
      if not (cleaned ->> 'ok')::boolean or (cleaned -> 'values' ->> 'phone') is null then
        return jsonb_build_object('ok', false, 'code', 'invalid_phone');
      end if;
      perform public.pax_apply_fields(holder.id, cleaned -> 'values', 'passenger');
    elsif holder.phone is null then
      return jsonb_build_object('ok', false, 'code', 'no_phone');
    end if;
    -- The WhatsApp the yes is given at: the one on record now, the one just written included.
    select t.phone into agreed_at from public.pax_travelers t where t.id = holder.id;
  end if;
  select t.id into term from public.pax_consent_terms t where t.partner_id = link.partner_id order by t.version desc limit 1;
  for person in select p.id from public.pax_link_people(holder.id) p loop
    insert into public.pax_consents (partner_id, org_id, traveler_id, given_by, term_id, wording, answer, confirm_link_id,
                                     evidence, phone)
    values (link.partner_id, link.org_id, person, holder.id, term, wording, target_answer, link.id,
            case when jsonb_typeof(target_evidence) = 'object' and octet_length(target_evidence::text) <= 2000
                 then target_evidence else '{}'::jsonb end,
            agreed_at);
  end loop;
  followed := public.pax_follow_holder(holder.id, target_answer = 'agreed', wording);
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, null, 'pax.consent.' || target_answer, 'pax_traveler', holder.id::text,
          jsonb_build_object('partner', link.partner_id, 'followed', followed));
  return jsonb_build_object('ok', true, 'code', target_answer, 'followed', followed);
end;
$$;

revoke all on function public.pax_link_answer(text, text, text, jsonb, text) from public;
grant execute on function public.pax_link_answer(text, text, text, jsonb, text) to anon, authenticated;

/**
 * 0074, redefined: a passenger's name, WhatsApp, birth date or adult changed: the trips they are on that ONE follows
 * are kept as they are now (a holder whose WhatsApp is not the agreement's waits for their agreement again), and a
 * WhatsApp put back to the one the holder's yes was given at follows their trips again, as that yes said.
 */
create or replace function public.pax_travelers_sync_trips()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  each_trip uuid;
  latest public.pax_consents%rowtype;
begin
  for each_trip in
    select distinct tt.trip_id
    from public.pax_trip_travelers tt
    join public.tracked_trips t on t.pax_trip_id = tt.trip_id and t.status = 'watching'
    where tt.traveler_id = new.id
  loop
    perform public.pax_sync_tracked_trip(each_trip);
  end loop;
  if old.phone is distinct from new.phone and new.phone is not null and new.handed_over_at is null then
    select * into latest from public.pax_consents c
    where c.traveler_id = new.id and c.given_by is not distinct from new.id
    order by c.created_at desc, c.id desc
    limit 1;
    if found and latest.answer = 'agreed' and latest.phone = new.phone then
      for each_trip in
        select p.id from public.pax_trips p
        where p.holder_id = new.id
          and exists (select 1 from public.pax_trip_legs l where l.trip_id = p.id)
          and not exists (select 1 from public.tracked_trips t where t.pax_trip_id = p.id)
      loop
        perform public.pax_follow_trip(each_trip, latest.wording);
      end loop;
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.pax_travelers_sync_trips() from public, anon, authenticated;

-- ---------- What the agency and the passenger read of it ----------

/** 0070, redefined: one passenger as the agency reads them, with why their agreement no longer covers their trips. */
create or replace function public.pax_traveler_detail(target_traveler uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  traveler public.pax_travelers%rowtype;
  holder uuid;
begin
  select * into traveler from public.pax_travelers where id = target_traveler;
  if not found or not public.is_partner_member(traveler.partner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  holder := coalesce(traveler.guardian_id, traveler.id);
  return jsonb_build_object(
    'traveler', to_jsonb(traveler) - 'read_fields' || jsonb_build_object(
      'minor', public.pax_is_minor(traveler.birth_date), 'read_fields', traveler.read_fields),
    'guardian', (select jsonb_build_object('id', g.id, 'full_name', g.full_name) from public.pax_travelers g where g.id = traveler.guardian_id),
    'children', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'full_name', c.full_name) order by c.full_name)
                          from public.pax_children_of(traveler.id) c), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'kind', d.kind, 'trip_id', d.trip_id, 'source', d.source, 'reading', d.reading,
               'reading_error', d.reading_error, 'file_id', d.file_id, 'name', f.name, 'created_at', d.created_at,
               'read', case when d.reading = 'done' then jsonb_build_object(
                 'matches', d.read_output ->> 'confere_tipo', 'legible', d.read_output -> 'legivel',
                 'identified', d.read_output ->> 'tipo_identificado', 'note', d.read_output ->> 'observacoes') end
             ) order by d.created_at)
      from public.pax_documents d join public.files f on f.id = d.file_id
      where d.traveler_id = traveler.id and d.reading <> 'uploading'), '[]'::jsonb),
    'trips', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', trip.id, 'locator', trip.locator, 'holder_id', trip.holder_id, 'state', public.pax_trip_state(trip.id),
               'travelers', (select jsonb_agg(jsonb_build_object('id', t.id, 'full_name', t.full_name) order by t.full_name)
                             from public.pax_trip_travelers tt join public.pax_travelers t on t.id = tt.traveler_id
                             where tt.trip_id = trip.id),
               'legs', (select coalesce(jsonb_agg(jsonb_build_object(
                          'position', l.position, 'flight_number', l.flight_number, 'origin_iata', l.origin_iata,
                          'destination_iata', l.destination_iata,
                          'departure', to_char(l.scheduled_departure_local, 'YYYY-MM-DD"T"HH24:MI'),
                          'arrival', to_char(l.scheduled_arrival_local, 'YYYY-MM-DD"T"HH24:MI')
                        ) order by l.position), '[]'::jsonb) from public.pax_trip_legs l where l.trip_id = trip.id)
             ) order by trip.created_at)
      from public.pax_trips trip
      where trip.id in (select tt.trip_id from public.pax_trip_travelers tt where tt.traveler_id = traveler.id)), '[]'::jsonb),
    'consent', public.pax_consent_state(holder),
    'reagree', public.pax_reagree(holder),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('answer', c.answer, 'created_at', c.created_at) order by c.created_at desc)
      from (select * from public.pax_consents c where c.traveler_id = traveler.id order by c.created_at desc limit 10) c), '[]'::jsonb),
    'confirm_link', (
      select jsonb_build_object('created_at', l.created_at, 'expires_at', l.expires_at,
                                'open', l.ended_at is null and l.expires_at > now())
      from public.pax_confirm_links l where l.holder_id = holder order by l.created_at desc limit 1)
  );
end;
$$;

revoke all on function public.pax_traveler_detail(uuid) from public, anon;
grant execute on function public.pax_traveler_detail(uuid) to authenticated;

/** 0074, redefined: what the passenger's link shows, with why their agreement no longer covers their trips. */
create or replace function public.pax_link_open(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.pax_confirm_links%rowtype;
  holder public.pax_travelers%rowtype;
  partnership public.partner_links%rowtype;
begin
  link := public.pax_link_by_token(target_token);
  if link.id is null then
    return jsonb_build_object('found', false);
  end if;
  select * into holder from public.pax_travelers where id = link.holder_id;
  select * into partnership from public.partner_links where id = link.partnership_id;
  if link.ended_at is not null or link.expires_at <= now() or partnership.status <> 'active' then
    return jsonb_build_object('found', true, 'state', case
      when partnership.status <> 'active' then 'partnership_ended'
      when link.ended_at is not null then 'ended'
      else 'expired' end,
      'agency', (select p.name from public.partners p where p.id = link.partner_id),
      'rights', (public.pax_link_for_rights(target_token)).id is not null);
  end if;
  return jsonb_build_object(
    'found', true,
    'state', case when holder.handed_over_at is not null then 'handed_over' else 'open' end,
    'agency', (select p.name from public.partners p where p.id = link.partner_id),
    'firm', (select o.name from public.organizations o where o.id = link.org_id),
    'expires_at', link.expires_at,
    'uploads_left', greatest(public.partner_setting('confirm_link_uploads', 20) - link.uploads, 0),
    'wording', public.pax_consent_wording(holder.id),
    'consent', public.pax_consent_state(holder.id),
    'reagree', public.pax_reagree(holder.id),
    'people', (
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'full_name', t.full_name, 'is_holder', t.id = holder.id,
               'minor', public.pax_is_minor(t.birth_date),
               'has_phone', t.phone is not null,
               'phone_end', case when t.id = holder.id then right(t.phone, 4) end,
               'documents', public.pax_documents_of(t.id)
             ) order by (t.id = holder.id) desc, t.created_at)
      from public.pax_travelers t where t.id in (select p.id from public.pax_link_people(holder.id) p)
    ),
    'trips', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', trip.id, 'locator', trip.locator, 'state', public.pax_trip_state(trip.id),
               'legs', (select coalesce(jsonb_agg(jsonb_build_object(
                          'position', l.position, 'flight_number', l.flight_number, 'origin_iata', l.origin_iata,
                          'destination_iata', l.destination_iata,
                          'departure', to_char(l.scheduled_departure_local, 'YYYY-MM-DD"T"HH24:MI'),
                          'arrival', to_char(l.scheduled_arrival_local, 'YYYY-MM-DD"T"HH24:MI')
                        ) order by l.position), '[]'::jsonb) from public.pax_trip_legs l where l.trip_id = trip.id)
             ) order by trip.created_at)
      from public.pax_trips trip where trip.holder_id = holder.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.pax_link_open(text) from public;
grant execute on function public.pax_link_open(text) to anon, authenticated;

/**
 * 0083, redefined: the agency's list of passengers, each row saying why the agreement in force no longer covers the
 * passenger's trips (`reagree`); the filter of agreements still owed takes those passengers too.
 */
create or replace function public.pax_travelers_page(
  target_partnership uuid,
  target_search text default null,
  target_filter text default 'all',
  target_limit integer default 25,
  target_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.partner_links%rowtype;
  term text := nullif(lower(public.plain_name(btrim(coalesce(target_search, '')))), '');
  digits text := nullif(regexp_replace(coalesce(target_search, ''), '\D', '', 'g'), '');
  page_size integer := greatest(least(coalesce(target_limit, 25), 100), 1);
  rows jsonb;
  total integer;
begin
  select * into link from public.partner_links where id = target_partnership;
  if not found or not public.is_partner_member(link.partner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  with matched as (
    select t.*,
      public.pax_consent_state(coalesce(t.guardian_id, t.id)) as consent,
      public.pax_reagree(coalesce(t.guardian_id, t.id)) as reagree,
      (select min(l.scheduled_departure_local) from public.pax_trip_legs l
       join public.pax_trip_travelers tt on tt.trip_id = l.trip_id
       where tt.traveler_id = t.id and l.scheduled_departure_local >= (now() at time zone 'America/Sao_Paulo') - interval '1 day') as next_departure
    from public.pax_travelers t
    where t.partnership_id = link.id and not t.draft
      -- A name by its words in any order; a CPF by how it starts.
      and (term is null
           or not exists (
             select 1 from unnest(string_to_array(term, ' ')) as word
             where word <> '' and strpos(lower(public.plain_name(t.full_name)), word) = 0)
           or (digits is not null and char_length(digits) >= 3 and t.cpf like digits || '%'))
  ), filtered as (
    select * from matched m
    where case coalesce(target_filter, 'all')
      when 'waiting_consent' then m.handed_over_at is null
        and (coalesce(m.consent, 'none') <> 'agreed' or m.reagree is not null)
      when 'missing_identity' then m.handed_over_at is null and not exists (
        select 1 from public.pax_documents d where d.traveler_id = m.id and d.kind = 'identity' and d.reading <> 'uploading')
      when 'upcoming' then m.next_departure is not null
        and m.next_departure <= (now() at time zone 'America/Sao_Paulo') + interval '48 hours'
      else true end
  ), ordered as (
    select f.*, row_number() over (order by f.next_departure nulls last, f.created_at desc) as ord
    from filtered f
  )
  -- The total counts the whole list, also for a page past its end; only the page's rows are read whole.
  select (select count(*) from ordered)::integer,
    coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.id, 'full_name', o.full_name, 'cpf', o.cpf, 'birth_date', o.birth_date, 'phone', o.phone,
          'guardian_id', o.guardian_id, 'minor', public.pax_is_minor(o.birth_date), 'consent', o.consent,
          'reagree', o.reagree,
          'next_departure', o.next_departure, 'handed_over_at', o.handed_over_at,
          'kinds', (select coalesce(jsonb_agg(distinct d.kind), '[]'::jsonb) from public.pax_documents d
                    where d.traveler_id = o.id and d.reading <> 'uploading'),
          'reading', coalesce((select bool_or(d.reading in ('pending', 'working')) from public.pax_documents d
                               where d.traveler_id = o.id), false))
        order by o.ord)
      from ordered o
      where o.ord > greatest(coalesce(target_offset, 0), 0) and o.ord <= greatest(coalesce(target_offset, 0), 0) + page_size
    ), '[]'::jsonb)
  into total, rows;
  return jsonb_build_object('rows', rows, 'total', total);
end;
$$;

revoke all on function public.pax_travelers_page(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.pax_travelers_page(uuid, text, text, integer, integer) to authenticated;

/**
 * 0083, redefined: the agency's counts; the adults whose agreement is still owed include those whose agreement in
 * force no longer covers their trips.
 */
create or replace function public.pax_overview(target_partnership uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.partner_links%rowtype;
begin
  select * into link from public.partner_links where id = target_partnership;
  if not found or not public.is_partner_member(link.partner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'travelers', (select count(*) from public.pax_travelers t
                  where t.partnership_id = link.id and t.handed_over_at is null and not t.draft),
    'adults_waiting', (
      select count(*) from public.pax_travelers t
      where t.partnership_id = link.id and t.handed_over_at is null and not t.draft
        and not public.pax_is_minor(t.birth_date)
        and exists (select 1 from public.pax_trips trip where trip.holder_id = t.id)
        and (coalesce(public.pax_consent_state(t.id), 'none') <> 'agreed' or public.pax_reagree(t.id) is not null)
    ),
    'missing_identity', (
      select count(*) from public.pax_travelers t
      where t.partnership_id = link.id and t.handed_over_at is null and not t.draft
        and not exists (select 1 from public.pax_documents d where d.traveler_id = t.id and d.kind = 'identity'
                        and d.reading <> 'uploading')
    ),
    'upcoming', (
      select count(distinct trip.id) from public.pax_trips trip join public.pax_trip_legs l on l.trip_id = trip.id
      where trip.partnership_id = link.id and l.position = 1
        and l.scheduled_departure_local between (now() at time zone 'America/Sao_Paulo') - interval '6 hours'
                                            and (now() at time zone 'America/Sao_Paulo') + interval '48 hours'
    ),
    'watched', (
      select count(*) from public.pax_trips trip
      where trip.partnership_id = link.id and public.pax_trip_state(trip.id) in ('watching', 'alerted')
    ),
    'consent_term', (select max(t.version) from public.pax_consent_terms t where t.partner_id = link.partner_id)
  );
end;
$$;

revoke all on function public.pax_overview(uuid) from public, anon;
grant execute on function public.pax_overview(uuid) to authenticated;
