-- ============================================================
-- 0074_agency_safeguards: what the review of the agency's area (0068 to 0073) found, put right.
--
-- An agreement covers who gave it and the children it was given for, at the
-- WhatsApp it was given with, and nobody else:
--
--   a trip ONE follows of an agency names along only the children its holder
--   agreed for (`pax_agreed_by`); an adult who travels along is followed on
--   the trips they hold, under their own agreement, and never goes to the
--   firm by somebody else's yes (`pax_hand_over`, `one_open_case_from_alert`);
--
--   another holder, or another WhatsApp of the holder, puts a trip back to
--   wait for that person's agreement while nothing was told of it, and the
--   passenger may agree again on their link to a trip the agency added after
--   their agreement; the link shows the end of the WhatsApp the alerts go to,
--   and the passenger may give another (`pax_link_open`, `pax_link_answer`);
--
--   taking the agreement back stops a trip already told of a problem too, and
--   a yes to the firm's word after it, or after the partnership ended, takes
--   nothing of the agency's record: a person of the firm takes it up
--   (`agency_closed`).
--
-- One firm's share of the flight reads no longer holds the others back: a firm
-- that spent it is left out of the trips claimed. Each leg is read only around
-- its own flight, so a round trip is not read through the days in between
-- (`claim_trip_watch`, `trip_legs_due`).
--
-- Forgetting a passenger also forgets what the AI read of their documents (a
-- run keeps its cost, never its answer) and touches only the trips they were
-- on; a deletion asked on the link keeps nothing of the request. The
-- passenger's rights stay on their link after their data went to the firm and
-- after the partnership ended, while the agency still keeps them
-- (`pax_link_for_rights`).
--
-- And: an upload whose answer was lost is finished by the next request or by
-- the sweep; a date a document says that is no date is left out alone; an
-- agency's abandoned upload is no firm's audit; the AI reads at most the
-- setting's documents a day for a partnership (`pax_reading_days`); a trip
-- takes at most the setting's passengers and nine children of its holder; and
-- the legs of a trip are kept in the order they fly.
-- ============================================================

-- ---------- Settings ----------

update public.platform_settings
set value = value || jsonb_build_object(
  -- The most passengers one trip of an agency takes, its holder included.
  'trip_travelers', 20,
  -- The most documents the AI reads in a day of Brasília for one partnership: the firm pays for each reading.
  'reading_daily', 300
)
where key = 'partners' and not (value ? 'trip_travelers');

-- ---------- Who an agreement covers ----------

/**
 * Whether the latest answer about a passenger is an agreement that holder gave: the holder's own, or that of a
 * child they answer for and agreed for. Internal.
 */
create or replace function public.pax_agreed_by(target_traveler uuid, target_holder uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select c.answer = 'agreed' and c.given_by is not distinct from target_holder
    from public.pax_consents c
    where c.traveler_id = target_traveler
    order by c.created_at desc, c.id desc
    limit 1
  ), false)
  and (target_traveler = target_holder or exists (
    select 1 from public.pax_travelers t
    where t.id = target_traveler and t.guardian_id = target_holder and public.pax_is_minor(t.birth_date)
  ));
$$;

revoke all on function public.pax_agreed_by(uuid, uuid) from public, anon, authenticated;

/**
 * 0070, redefined: who goes along on a trip, as a trip ONE follows names them: only the children its holder
 * agreed for, each with their name and birth date. An adult who travels along is followed on the trips they hold.
 */
create or replace function public.pax_trip_companions(target_trip uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'name', left(x.full_name, 200),
           'birth_date', to_char(x.birth_date, 'YYYY-MM-DD'),
           'pax_traveler_id', x.id
         )) order by x.created_at, x.id), '[]'::jsonb)
  from (
    select t.id, t.full_name, t.birth_date, t.created_at
    from public.pax_trip_travelers tt
    join public.pax_trips trip on trip.id = tt.trip_id
    join public.pax_travelers t on t.id = tt.traveler_id
    where tt.trip_id = target_trip and t.id <> trip.holder_id and public.pax_agreed_by(t.id, trip.holder_id)
    order by t.created_at, t.id
    -- What a trip ONE follows takes (0047); a trip of more is refused when saved.
    limit 9
  ) x;
$$;

revoke all on function public.pax_trip_companions(uuid) from public, anon, authenticated;

-- ---------- The legs, in the order they fly ----------

/** 0070, redefined: the legs as the database keeps them, numbered in the order they depart. Internal. */
create or replace function public.pax_clean_legs(target_legs jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  leg jsonb;
  kept jsonb := '[]'::jsonb;
  slot integer := 0;
  flight text;
  origin text;
  destination text;
  departure text;
  arrival text;
begin
  if jsonb_typeof(target_legs) is distinct from 'array' or jsonb_array_length(target_legs) not between 1 and 6 then
    return jsonb_build_object('ok', false, 'code', 'invalid_legs');
  end if;
  for leg in select value from jsonb_array_elements(target_legs) loop
    slot := slot + 1;
    flight := upper(regexp_replace(coalesce(leg ->> 'flight_number', ''), '\s+', '', 'g'));
    origin := upper(btrim(coalesce(leg ->> 'origin_iata', '')));
    destination := upper(btrim(coalesce(leg ->> 'destination_iata', '')));
    departure := btrim(coalesce(leg ->> 'departure', ''));
    arrival := btrim(coalesce(leg ->> 'arrival', ''));
    if flight !~ '^[A-Z0-9]{2}[0-9]{1,4}[A-Z]?$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_flight', 'position', slot);
    end if;
    if origin = destination
       or not exists (select 1 from public.airports a where a.iata = origin)
       or not exists (select 1 from public.airports a where a.iata = destination) then
      return jsonb_build_object('ok', false, 'code', 'invalid_airport', 'position', slot);
    end if;
    if departure !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$' or arrival !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_time', 'position', slot);
    end if;
    begin
      if arrival::timestamp <= departure::timestamp - interval '12 hours'
         or departure::timestamp not between timestamp '2000-01-01' and timestamp '2100-01-01' then
        return jsonb_build_object('ok', false, 'code', 'invalid_time', 'position', slot);
      end if;
    exception when invalid_datetime_format or datetime_field_overflow then
      return jsonb_build_object('ok', false, 'code', 'invalid_time', 'position', slot);
    end;
    kept := kept || jsonb_build_object('position', slot, 'flight_number', flight, 'origin_iata', origin,
      'destination_iata', destination, 'departure', departure, 'arrival', arrival);
  end loop;
  return jsonb_build_object('ok', true, 'legs', (
    select jsonb_agg(x.leg || jsonb_build_object('position', x.ord) order by x.ord)
    from (
      select k.value as leg,
             row_number() over (order by (k.value ->> 'departure')::timestamp, (k.value ->> 'position')::integer) as ord
      from jsonb_array_elements(kept) as k
    ) x
  ));
end;
$$;

revoke all on function public.pax_clean_legs(jsonb) from public, anon, authenticated;

/** The legs of a trip renumbered in the order they depart, when a leg came out of it (a spreadsheet's). Internal. */
create or replace function public.pax_order_legs(target_trip uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  legs jsonb;
begin
  select jsonb_agg(to_jsonb(l) order by l.scheduled_departure_local, l.position) into legs
  from public.pax_trip_legs l where l.trip_id = target_trip;
  if legs is null or not exists (
    select 1 from jsonb_array_elements(legs) with ordinality as x (leg, ord) where (x.leg ->> 'position')::integer <> x.ord
  ) then
    return;
  end if;
  delete from public.pax_trip_legs where trip_id = target_trip;
  insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                    scheduled_departure_local, scheduled_arrival_local)
  select target_trip, x.ord, x.leg ->> 'flight_number', x.leg ->> 'origin_iata', x.leg ->> 'destination_iata',
         (x.leg ->> 'scheduled_departure_local')::timestamp, (x.leg ->> 'scheduled_arrival_local')::timestamp
  from jsonb_array_elements(legs) with ordinality as x (leg, ord);
end;
$$;

revoke all on function public.pax_order_legs(uuid) from public, anon, authenticated;

-- ---------- The trip ONE follows, kept as the agency's is now ----------

/**
 * 0070, redefined: the trip ONE follows of an agency's trip, kept as the agency's is now while nothing was told of
 * it (`watching`): its holder's name, the children along, the legs (only when they changed, so what FlightAware
 * said of each stays). Followed only for whoever agreed, at the WhatsApp they agreed with: a holder whose agreement
 * is not in force, who has no WhatsApp or another one, waits for their agreement again. Internal.
 */
create or replace function public.pax_sync_tracked_trip(target_trip uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  trip public.pax_trips%rowtype;
  holder public.pax_travelers%rowtype;
  tracked public.tracked_trips%rowtype;
  first_flight text;
begin
  select * into trip from public.pax_trips where id = target_trip;
  select * into tracked from public.tracked_trips where pax_trip_id = target_trip for update;
  if trip.id is null or tracked.id is null or tracked.status <> 'watching' then
    return;
  end if;
  select * into holder from public.pax_travelers where id = trip.holder_id;
  select l.flight_number into first_flight from public.pax_trip_legs l where l.trip_id = trip.id order by l.position limit 1;
  if first_flight is null or holder.phone is null or holder.phone <> tracked.phone
     or not public.pax_agreed_by(holder.id, holder.id) then
    delete from public.tracked_trips where id = tracked.id;
    return;
  end if;
  update public.tracked_trips set
    passenger_name = left(holder.full_name, 200),
    airline_iata = left(first_flight, 2),
    companions = public.pax_trip_companions(trip.id)
  where id = tracked.id;
  if exists (
    select l.position, l.flight_number, l.origin_iata, l.destination_iata, l.scheduled_departure_local, l.scheduled_arrival_local
    from public.pax_trip_legs l where l.trip_id = trip.id
    except
    select k.position, k.flight_number, k.origin_iata, k.destination_iata, k.scheduled_departure_local, k.scheduled_arrival_local
    from public.tracked_legs k where k.trip_id = tracked.id
  ) or exists (
    select k.position, k.flight_number, k.origin_iata, k.destination_iata, k.scheduled_departure_local, k.scheduled_arrival_local
    from public.tracked_legs k where k.trip_id = tracked.id
    except
    select l.position, l.flight_number, l.origin_iata, l.destination_iata, l.scheduled_departure_local, l.scheduled_arrival_local
    from public.pax_trip_legs l where l.trip_id = trip.id
  ) then
    delete from public.tracked_legs where trip_id = tracked.id;
    insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                     scheduled_departure_local, scheduled_arrival_local)
    select tracked.org_id, tracked.id, l.position, l.flight_number, l.origin_iata, l.destination_iata,
           l.scheduled_departure_local, l.scheduled_arrival_local
    from public.pax_trip_legs l where l.trip_id = trip.id;
  end if;
end;
$$;

revoke all on function public.pax_sync_tracked_trip(uuid) from public, anon, authenticated;

/** A passenger's name, WhatsApp, birth date or adult changed: the trips they are on that ONE follows are kept as they are now. */
create or replace function public.pax_travelers_sync_trips()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  each_trip uuid;
begin
  for each_trip in
    select distinct tt.trip_id
    from public.pax_trip_travelers tt
    join public.tracked_trips t on t.pax_trip_id = tt.trip_id and t.status = 'watching'
    where tt.traveler_id = new.id
  loop
    perform public.pax_sync_tracked_trip(each_trip);
  end loop;
  return null;
end;
$$;

revoke all on function public.pax_travelers_sync_trips() from public, anon, authenticated;

create trigger pax_travelers_sync_trips
  after update of full_name, phone, birth_date, guardian_id on public.pax_travelers
  for each row
  when (old.full_name is distinct from new.full_name or old.phone is distinct from new.phone
        or old.birth_date is distinct from new.birth_date or old.guardian_id is distinct from new.guardian_id)
  execute function public.pax_travelers_sync_trips();

/**
 * 0070, redefined: the agency adds a trip, or changes one. A trip takes at most the setting's passengers and nine
 * children of its holder; its legs are kept in the order they fly; another holder of a trip ONE follows waits for
 * that person's own agreement. A trip ONE told of a problem changes no more here.
 */
create or replace function public.pax_save_trip(
  target_partnership uuid,
  target_trip uuid,
  target_holder uuid,
  target_travelers uuid[],
  target_locator text,
  target_legs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.partner_links%rowtype;
  holder public.pax_travelers%rowtype;
  trip public.pax_trips%rowtype;
  legs jsonb;
  leg jsonb;
  clean_locator text := nullif(upper(regexp_replace(coalesce(target_locator, ''), '\s+', '', 'g')), '');
  others uuid[] := coalesce(target_travelers, '{}');
  most integer := least(greatest(public.partner_setting('trip_travelers', 20), 2), 50);
  state text;
begin
  link := public.pax_partnership_for_writer(target_partnership);
  select * into holder from public.pax_travelers where id = target_holder and partnership_id = link.id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'traveler_not_found', 'field', 'holder');
  end if;
  if public.pax_is_minor(holder.birth_date) then
    return jsonb_build_object('ok', false, 'code', 'holder_is_minor', 'field', 'holder');
  end if;
  if exists (select 1 from unnest(others) as other (id)
             where not exists (select 1 from public.pax_travelers t where t.id = other.id and t.partnership_id = link.id)) then
    return jsonb_build_object('ok', false, 'code', 'traveler_not_found', 'field', 'travelers');
  end if;
  if (select count(*) from (select holder.id as id union select unnest(others)) x) > most then
    return jsonb_build_object('ok', false, 'code', 'too_many_travelers', 'field', 'travelers');
  end if;
  if (select count(*) from public.pax_travelers t
      where t.id = any (others) and t.id <> holder.id and t.guardian_id = holder.id and public.pax_is_minor(t.birth_date)) > 9 then
    return jsonb_build_object('ok', false, 'code', 'too_many_children', 'field', 'travelers');
  end if;
  if clean_locator is not null and clean_locator !~ '^[A-Z0-9]{5,8}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_locator', 'field', 'locator');
  end if;
  legs := public.pax_clean_legs(target_legs);
  if not (legs ->> 'ok')::boolean then
    return legs;
  end if;

  if target_trip is null then
    insert into public.pax_trips (partner_id, partnership_id, org_id, holder_id, locator, created_by)
    values (link.partner_id, link.id, link.org_id, holder.id, clean_locator, auth.uid())
    returning * into trip;
  else
    select * into trip from public.pax_trips where id = target_trip and partnership_id = link.id for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'trip_not_found');
    end if;
    state := public.pax_trip_state(trip.id);
    if state not in ('waiting_consent', 'watching') then
      return jsonb_build_object('ok', false, 'code', 'trip_locked');
    end if;
    -- What ONE followed was the agreement of the holder before: the new one's own is waited for.
    if trip.holder_id <> holder.id then
      delete from public.tracked_trips where pax_trip_id = trip.id and status = 'watching';
    end if;
    update public.pax_trips set holder_id = holder.id, locator = clean_locator where id = trip.id;
  end if;

  delete from public.pax_trip_travelers where trip_id = trip.id;
  insert into public.pax_trip_travelers (trip_id, traveler_id)
  select trip.id, x.id from (select holder.id as id union select unnest(others)) x
  on conflict do nothing;
  delete from public.pax_trip_legs where trip_id = trip.id;
  for leg in select value from jsonb_array_elements(legs -> 'legs') loop
    insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                      scheduled_departure_local, scheduled_arrival_local)
    values (trip.id, (leg ->> 'position')::integer, leg ->> 'flight_number', leg ->> 'origin_iata',
            leg ->> 'destination_iata', (leg ->> 'departure')::timestamp, (leg ->> 'arrival')::timestamp);
  end loop;
  perform public.pax_sync_tracked_trip(trip.id);
  if target_trip is null then
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (null, auth.uid(), 'pax.trip.added', 'pax_trip', trip.id::text, jsonb_build_object('partner', link.partner_id));
  end if;
  return jsonb_build_object('ok', true, 'code', case when target_trip is null then 'added' else 'saved' end, 'trip_id', trip.id);
end;
$$;

revoke all on function public.pax_save_trip(uuid, uuid, uuid, uuid[], text, jsonb) from public, anon;
grant execute on function public.pax_save_trip(uuid, uuid, uuid, uuid[], text, jsonb) to authenticated;

-- ---------- Following, and stopping ----------

/**
 * 0071, redefined: the trip ONE follows of an agency's trip, made or kept once its holder agreed, at the WhatsApp
 * on record (the one the passenger saw, or gave, on their link). Agreeing again keeps a trip followed under the new
 * words (`refreshed`); a trip whose following stopped is followed again, unless that WhatsApp asked the firm's
 * number to stop writing. The test chat's number for an agency's passenger is followed by the firm's test chat.
 * Internal.
 */
create or replace function public.pax_follow_trip(target_trip uuid, target_wording text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  trip public.pax_trips%rowtype;
  holder public.pax_travelers%rowtype;
  tracked public.tracked_trips%rowtype;
  first_flight text;
  new_id uuid;
  testing boolean;
begin
  select * into trip from public.pax_trips where id = target_trip for update;
  select * into holder from public.pax_travelers where id = trip.holder_id;
  select l.flight_number into first_flight from public.pax_trip_legs l where l.trip_id = trip.id order by l.position limit 1;
  if first_flight is null then
    return 'no_legs';
  end if;
  if holder.phone is null then
    return 'no_phone';
  end if;
  select * into tracked from public.tracked_trips where pax_trip_id = trip.id for update;
  if tracked.id is not null then
    if tracked.status = 'watching' then
      update public.tracked_trips set phone = holder.phone, consent_wording = target_wording, consent_at = now()
      where id = tracked.id;
      perform public.pax_sync_tracked_trip(trip.id);
      return 'refreshed';
    end if;
    if tracked.status = 'stopped' and not exists (
      select 1 from public.wa_optouts o
      where o.org_id = tracked.org_id and o.contact_wa_id = any (public.wa_phone_variants(holder.phone))
    ) then
      update public.tracked_trips
      set status = 'watching', phone = holder.phone, consent_wording = target_wording, consent_at = now()
      where id = tracked.id;
      perform public.pax_sync_tracked_trip(trip.id);
      return 'followed_again';
    end if;
    return 'already';
  end if;
  testing := holder.phone = '5500988880006'
    and exists (select 1 from public.test_chats c where c.org_id = trip.org_id and c.status = 'active');
  if testing then
    delete from public.tracked_trips t where t.org_id = trip.org_id and t.is_test and t.label = 'agencia';
  end if;
  insert into public.tracked_trips (org_id, passenger_name, phone, companions, airline_iata, is_test, label,
                                    consent_wording, consent_at, consent_channel, status, watch, pax_trip_id)
  values (trip.org_id, left(holder.full_name, 200), holder.phone, public.pax_trip_companions(trip.id),
          left(first_flight, 2), testing, case when testing then 'agencia' end, target_wording, now(), 'agency',
          'watching', case when testing then 'simulated' else 'flightaware' end, trip.id)
  returning id into new_id;
  insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                   scheduled_departure_local, scheduled_arrival_local)
  select trip.org_id, new_id, l.position, l.flight_number, l.origin_iata, l.destination_iata,
         l.scheduled_departure_local, l.scheduled_arrival_local
  from public.pax_trip_legs l where l.trip_id = trip.id;
  return 'followed';
end;
$$;

revoke all on function public.pax_follow_trip(uuid, text) from public, anon, authenticated;

/**
 * 0070, redefined: follows every trip of a holder who agreed, and stops following those of a holder who did not or
 * took it back, a trip already told of a problem included. Internal.
 */
create or replace function public.pax_follow_holder(target_holder uuid, target_agreed boolean, target_wording text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  each_trip uuid;
  followed integer := 0;
begin
  for each_trip in select t.id from public.pax_trips t where t.holder_id = target_holder order by t.created_at loop
    if target_agreed then
      if public.pax_follow_trip(each_trip, target_wording) in ('followed', 'followed_again', 'refreshed') then
        followed := followed + 1;
      end if;
    else
      update public.tracked_trips set status = 'stopped'
      where pax_trip_id = each_trip and status in ('watching', 'alerted');
    end if;
  end loop;
  return followed;
end;
$$;

revoke all on function public.pax_follow_holder(uuid, boolean, text) from public, anon, authenticated;

-- ---------- The passenger's link ----------

/**
 * The link of a token through which its passenger takes, or has deleted, what the agency keeps of them: open, or
 * closed only because its partnership ended (and then the holder's latest), within its time. Internal.
 */
create or replace function public.pax_link_for_rights(target_token text)
returns public.pax_confirm_links
language sql
stable
security definer
set search_path = public
as $$
  select l.*
  from public.pax_confirm_links l
  join public.partner_links p on p.id = l.partnership_id
  where l.id = (public.pax_link_by_token(target_token)).id
    and l.expires_at > now()
    and (l.ended_at is null or (p.status = 'ended' and not exists (
      select 1 from public.pax_confirm_links n where n.holder_id = l.holder_id and n.created_at > l.created_at)));
$$;

revoke all on function public.pax_link_for_rights(text) from public, anon, authenticated;

/**
 * 0070, redefined: what the passenger's link shows, now with the end of the WhatsApp the alerts go to (the
 * holder's, `phone_end`), and, on a link its partnership's end closed, whether the passenger may still take or
 * delete what the agency keeps (`rights`).
 */
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
 * 0070, redefined: the passenger answers on their link. An agreement goes to the WhatsApp on record, which the page
 * shows by its end, or to the one the passenger writes here (theirs from then on); one is needed.
 */
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
  end if;
  select t.id into term from public.pax_consent_terms t where t.partner_id = link.partner_id order by t.version desc limit 1;
  for person in select p.id from public.pax_link_people(holder.id) p loop
    insert into public.pax_consents (partner_id, org_id, traveler_id, given_by, term_id, wording, answer, confirm_link_id, evidence)
    values (link.partner_id, link.org_id, person, holder.id, term, wording, target_answer, link.id,
            case when jsonb_typeof(target_evidence) = 'object' and octet_length(target_evidence::text) <= 2000
                 then target_evidence else '{}'::jsonb end);
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

/** 0072, redefined: what the passenger's link hands them of what is kept, also after the partnership ended. */
create or replace function public.pax_link_export(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.pax_confirm_links%rowtype := public.pax_link_for_rights(target_token);
begin
  if link.id is null then
    return jsonb_build_object('ok', false, 'code', 'link_not_found');
  end if;
  return jsonb_build_object('ok', true, 'code', 'exported', 'data', coalesce((
    select jsonb_agg(public.pax_kept_of(p.id) order by (p.id = link.holder_id) desc)
    from public.pax_link_people(link.holder_id) p), '[]'::jsonb));
end;
$$;

revoke all on function public.pax_link_export(text) from public;
grant execute on function public.pax_link_export(text) to anon, authenticated;

/**
 * 0072, redefined: the passenger has what is kept of them and of the children they answer for deleted, also after
 * the partnership ended. Nothing of the request stays on the record but the count (the evidence the app may still
 * send is not kept). Service role.
 */
create or replace function public.pax_link_forget(target_token text, target_evidence jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.pax_confirm_links%rowtype;
  person uuid;
  forgotten integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  link := public.pax_link_for_rights(target_token);
  if link.id is null then
    return jsonb_build_object('ok', false, 'code', 'link_not_found');
  end if;
  -- The children first: once their adult is gone, nothing would say they are theirs.
  for person in
    select p.id from public.pax_link_people(link.holder_id) p order by (p.id = link.holder_id)
  loop
    perform public.pax_forget(person, 'passenger_request');
    forgotten := forgotten + 1;
  end loop;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, null, 'pax.link.forgotten', 'partner', link.partner_id::text, jsonb_build_object('people', forgotten));
  return jsonb_build_object('ok', true, 'code', 'forgotten', 'people', forgotten);
end;
$$;

revoke all on function public.pax_link_forget(text, jsonb) from public, anon, authenticated;

-- ---------- Forgetting a passenger ----------

/**
 * 0072, redefined: forgets a passenger of an agency. What the AI read of their documents goes with them (each run
 * keeps its cost, never its answer), and only the trips of somebody else they were on are kept as they are now.
 * Internal.
 */
create or replace function public.pax_forget(target_traveler uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  traveler public.pax_travelers%rowtype;
  removed integer := 0;
  trips integer := 0;
  documents text[];
  others uuid[];
  each_trip uuid;
begin
  select * into traveler from public.pax_travelers where id = target_traveler for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select coalesce(array_agg(d.id::text), '{}') into documents from public.pax_documents d where d.traveler_id = traveler.id;
  update public.ai_runs r set output = null
  where r.org_id = traveler.org_id and r.subject_type = 'pax_document' and r.subject_id = any (documents)
    and r.output is not null;
  -- The files the agency still holds: their records first, their bytes for the backend.
  with gone as (
    delete from public.files f
    using public.pax_documents d
    where d.traveler_id = traveler.id and d.file_id = f.id and d.case_document_id is null and f.partner_id is not null
    returning f.storage_path
  ), listed as (
    insert into public.pax_file_removals (storage_path)
    select storage_path from gone
    on conflict (storage_path) do nothing
    returning 1
  )
  select count(*) into removed from gone;
  -- The trips they hold: followed no more, and deleted unless a case opened from them.
  delete from public.tracked_trips t
  using public.pax_trips p
  where p.holder_id = traveler.id and t.pax_trip_id = p.id and t.status <> 'case_opened';
  delete from public.pax_trips p where p.holder_id = traveler.id;
  get diagnostics trips = row_count;
  -- A trip of somebody else they travelled on is the holder's: ONE follows it as it is now.
  select coalesce(array_agg(distinct tt.trip_id), '{}') into others
  from public.pax_trip_travelers tt where tt.traveler_id = traveler.id;
  delete from public.pax_trip_travelers tt where tt.traveler_id = traveler.id;
  delete from public.pax_travelers where id = traveler.id;
  foreach each_trip in array others loop
    perform public.pax_sync_tracked_trip(each_trip);
  end loop;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'pax.traveler.forgotten', 'partner', traveler.partner_id::text,
          jsonb_build_object('reason', target_reason, 'files', removed, 'trips', trips,
                             'handed_over', traveler.handed_over_at is not null));
  return jsonb_build_object('ok', true, 'code', 'forgotten', 'files', removed);
end;
$$;

revoke all on function public.pax_forget(uuid, text) from public, anon, authenticated;

-- ---------- The handoff ----------

/**
 * 0071, redefined: hands an agency's record of a trip over to the case just opened from it, for each passenger its
 * holder's agreement in force covers (the holder, and the children they agreed for); anybody else is left with the
 * agency. Internal.
 */
create or replace function public.pax_hand_over(target_org uuid, target_case uuid, target_trip uuid, target_people jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  traveler public.pax_travelers%rowtype;
  person_row public.people%rowtype;
  fields jsonb;
  field text;
  written text[];
  document public.pax_documents%rowtype;
  case_document uuid;
  documents uuid[] := '{}';
  marks jsonb;
  handed integer := 0;
  holder uuid := (select p.holder_id from public.pax_trips p where p.id = target_trip);
begin
  for item in select key, value from jsonb_each(coalesce(target_people, '{}'::jsonb)) loop
    select * into traveler from public.pax_travelers
    where id = item.key::uuid and org_id = target_org
    for update;
    if not found or holder is null or not public.pax_agreed_by(traveler.id, holder) then
      continue;
    end if;
    select * into person_row from public.people where id = (item.value ->> 'person')::uuid and org_id = target_org;
    if not found then
      continue;
    end if;

    fields := jsonb_strip_nulls(jsonb_build_object(
      'full_name', traveler.full_name, 'cpf', traveler.cpf, 'birth_date', to_char(traveler.birth_date, 'YYYY-MM-DD'),
      'email', traveler.email, 'phone', traveler.phone, 'nationality', traveler.nationality,
      'postal_code', traveler.postal_code, 'street', traveler.street, 'address_number', traveler.address_number,
      'complement', traveler.complement, 'district', traveler.district, 'city', traveler.city, 'uf', traveler.uf
    ));
    written := '{}';
    for field in select jsonb_object_keys(fields) loop
      if coalesce((item.value ->> 'new')::boolean, false) then
        -- A new client takes the agency's record, but for the WhatsApp the conversation gave.
        if field = 'phone' and person_row.phone is not null then
          continue;
        end if;
      elsif (to_jsonb(person_row) -> field) is not null and (to_jsonb(person_row) -> field) <> 'null'::jsonb then
        -- A client the firm had keeps what its record says.
        continue;
      end if;
      if field = 'cpf' and exists (
        select 1 from public.people p where p.org_id = target_org and p.cpf = traveler.cpf and p.id <> person_row.id
      ) then
        continue;
      end if;
      -- Field by field: one value the case's rules refuse never keeps the others out.
      if coalesce((public.apply_person_fields(person_row.id, jsonb_build_object(field, fields ->> field), 'partner')
                   ->> 'ok')::boolean, false) then
        written := written || field;
      end if;
    end loop;

    -- The person's own documents, and those of this trip; each once.
    for document in
      select d.* from public.pax_documents d
      join public.files f on f.id = d.file_id
      where d.traveler_id = traveler.id and d.reading <> 'uploading' and d.case_document_id is null
        and f.status = 'stored' and (d.trip_id is null or d.trip_id = target_trip)
      order by d.created_at, d.id
      for update of d
    loop
      update public.files set partner_id = null where id = document.file_id;
      insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, status)
      values (target_org, target_case,
              -- A ticket is of the trip; the rest of the person.
              case when document.kind = 'ticket' then null else (item.value ->> 'party')::uuid end,
              document.file_id, document.kind, 'partner', 'received')
      returning id into case_document;
      update public.pax_documents set case_document_id = case_document where id = document.id;
      documents := documents || case_document;
    end loop;

    -- What ONE read of a document of the agency stays marked as read, of the case's document now, for what was
    -- written from it.
    select coalesce(jsonb_object_agg(mark.key, jsonb_build_object('document', d.case_document_id, 'kind', d.kind)), '{}'::jsonb)
    into marks
    from jsonb_each(traveler.read_fields) as mark (key, value)
    join public.pax_documents d on d.id::text = mark.value ->> 'document'
    where mark.key = any (written) and d.case_document_id is not null;
    if marks <> '{}'::jsonb then
      update public.people set read_fields = read_fields || marks where id = person_row.id;
    end if;

    update public.pax_travelers
    set case_id = target_case, handed_over_at = coalesce(handed_over_at, now())
    where id = traveler.id;
    handed := handed + 1;
  end loop;
  return jsonb_build_object('people', handed, 'documents', to_jsonb(documents));
end;
$$;

revoke all on function public.pax_hand_over(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

/**
 * 0071, redefined: the case of a trip whose passenger said yes. A trip of an agency opens it with the agency's
 * record only while its partnership goes on and its holder's agreement is in force, and with only the children
 * that agreement covers; a yes after either ended takes nothing of the agency's record, and is a person's of the
 * firm to take up (`agency_closed`). Everything else as before. Service role.
 */
create or replace function public.one_open_case_from_alert(
  target_conversation uuid,
  target_claim integer,
  target_alert uuid,
  target_token_hash text,
  target_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  alert public.flight_alerts%rowtype;
  trip public.tracked_trips%rowtype;
  pax_trip public.pax_trips%rowtype;
  next_seq integer;
  new_case uuid;
  person uuid;
  party uuid;
  guardian_party uuid;
  companion jsonb;
  companion_person uuid;
  companion_party uuid;
  companion_traveler uuid;
  reused boolean;
  people_map jsonb := '{}'::jsonb;
  handoff jsonb;
  applied jsonb;
  leg public.tracked_legs%rowtype;
  segment uuid;
  last_position integer;
  incident text;
  airline text;
  flight_day date;
  minor boolean;
  link_made jsonb;
  message uuid;
  body text;
  linked boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into alert from public.flight_alerts a where a.id = target_alert and a.org_id = conversation.org_id for update;
  if alert.id is null or alert.status <> 'sent' or coalesce(alert.answer, 'yes') <> 'yes' then
    return jsonb_build_object('ok', false, 'code', 'no_alert');
  end if;
  select * into trip from public.tracked_trips t where t.id = alert.trip_id for update;
  if trip.status = 'case_opened' or trip.case_id is not null then
    return jsonb_build_object('ok', false, 'code', 'already_opened', 'case_id', trip.case_id);
  end if;
  if trip.phone <> all (public.wa_phone_variants(conversation.contact_wa_id))
     and conversation.contact_wa_id <> all (public.wa_phone_variants(trip.phone)) then
    return jsonb_build_object('ok', false, 'code', 'no_alert');
  end if;
  update public.flight_alerts set answer = 'yes', answered_at = coalesce(answered_at, now()) where id = alert.id;
  perform public.withdraw_conversation_answers(conversation.id, 'O passageiro respondeu ao aviso, e o ONE seguiu a resposta.');
  if public.firm_autonomy_mode(conversation.org_id, 'open_case_from_chat') <> 'auto' then
    return jsonb_build_object('ok', false, 'code', 'by_person');
  end if;
  -- The agency's trip, while its partnership with this firm goes on and its holder's agreement is in force.
  if trip.consent_channel = 'agency' then
    if trip.pax_trip_id is not null then
      select t.* into pax_trip
      from public.pax_trips t
      join public.partner_links l on l.id = t.partnership_id and l.status = 'active'
      where t.id = trip.pax_trip_id and t.org_id = conversation.org_id;
    end if;
    if pax_trip.id is null or not public.pax_agreed_by(pax_trip.holder_id, pax_trip.holder_id) then
      return jsonb_build_object('ok', false, 'code', 'agency_closed');
    end if;
  end if;

  select max(l.position) into last_position from public.tracked_legs l where l.trip_id = trip.id;
  incident := case alert.kind
    when 'cancelled' then 'cancellation'
    when 'delayed' then case
      when last_position > 1 and exists (
        select 1 from public.tracked_legs l where l.trip_id = trip.id and l.position < last_position and l.status = 'delayed'
      ) then 'missed_connection' else 'delay' end
    else 'other' end;
  airline := (select a.iata from public.airlines a where a.iata = trip.airline_iata and a.active);
  flight_day := (select min(l.scheduled_departure_local)::date from public.tracked_legs l where l.trip_id = trip.id);

  perform set_config('one.system_case', '', true);
  -- One number at a time per firm, as a person's case is numbered (`create_case`).
  perform 1 from public.organizations where id = conversation.org_id for no key update;
  select coalesce(max(c.seq), 0) + 1 into next_seq from public.cases c where c.org_id = conversation.org_id;
  insert into public.cases (org_id, seq, incident, airline_iata, flight_date, origin, partnership_id)
  values (conversation.org_id, next_seq, incident, airline, flight_day,
          case when pax_trip.id is not null then 'agency' end, pax_trip.partnership_id)
  returning id into new_case;
  perform set_config('one.system_case', new_case::text, true);

  -- The passenger: the firm's client the agency's record is, or a new one.
  person := case when pax_trip.id is not null then public.pax_client_of(conversation.org_id, pax_trip.holder_id) end;
  reused := person is not null;
  if person is null then
    insert into public.people (org_id, full_name)
    values (conversation.org_id, left(regexp_replace(btrim(trip.passenger_name), '\s+', ' ', 'g'), 200))
    returning id into person;
  end if;
  applied := public.apply_person_fields(person, jsonb_build_object('phone', trip.phone), 'firm');
  if not coalesce((applied ->> 'ok')::boolean, false) then
    raise exception 'passenger_not_saved' using errcode = 'P0001';
  end if;
  insert into public.case_parties (org_id, case_id, person_id, role)
  values (conversation.org_id, new_case, person, 'claimant')
  returning id into party;
  if pax_trip.id is not null then
    people_map := people_map || jsonb_build_object(pax_trip.holder_id::text,
      jsonb_build_object('person', person, 'party', party, 'new', not reused));
  end if;

  for companion in select value from jsonb_array_elements(trip.companions) loop
    companion_traveler := case
      when pax_trip.id is not null and coalesce(companion ->> 'pax_traveler_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (companion ->> 'pax_traveler_id')::uuid
    end;
    -- Of an agency's trip, only a child its holder's agreement in force covers.
    if pax_trip.id is not null
       and (companion_traveler is null or not public.pax_agreed_by(companion_traveler, pax_trip.holder_id)) then
      continue;
    end if;
    companion_person := case when companion_traveler is not null then public.pax_client_of(conversation.org_id, companion_traveler) end;
    reused := companion_person is not null;
    -- The same person twice in a trip is one claimant of the case.
    if reused and exists (
      select 1 from public.case_parties cp where cp.case_id = new_case and cp.person_id = companion_person and cp.role = 'claimant'
    ) then
      continue;
    end if;
    if companion_person is null then
      insert into public.people (org_id, full_name)
      values (conversation.org_id, left(regexp_replace(btrim(coalesce(companion ->> 'name', 'Acompanhante')), '\s+', ' ', 'g'), 200))
      returning id into companion_person;
    end if;
    minor := coalesce(companion ->> 'birth_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and (companion ->> 'birth_date')::date > (current_date - interval '18 years')::date;
    if not reused and coalesce(companion ->> 'birth_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      applied := public.apply_person_fields(companion_person, jsonb_build_object('birth_date', companion ->> 'birth_date'), 'firm');
    end if;
    if minor then
      if guardian_party is null then
        insert into public.case_parties (org_id, case_id, person_id, role)
        values (conversation.org_id, new_case, person, 'guardian')
        returning id into guardian_party;
      end if;
      insert into public.case_parties (org_id, case_id, person_id, role, guardian_id)
      values (conversation.org_id, new_case, companion_person, 'claimant', guardian_party)
      returning id into companion_party;
    else
      insert into public.case_parties (org_id, case_id, person_id, role)
      values (conversation.org_id, new_case, companion_person, 'claimant')
      returning id into companion_party;
    end if;
    if companion_traveler is not null then
      people_map := people_map || jsonb_build_object(companion_traveler::text,
        jsonb_build_object('person', companion_person, 'party', companion_party, 'new', not reused));
    end if;
  end loop;

  for leg in select * from public.tracked_legs l where l.trip_id = trip.id order by l.position loop
    insert into public.flight_segments (org_id, case_id, position, source)
    values (conversation.org_id, new_case, leg.position, 'firm')
    returning id into segment;
    applied := public.apply_segment_fields(segment, jsonb_strip_nulls(jsonb_build_object(
      'flight_number', leg.flight_number,
      'origin_iata', leg.origin_iata,
      'destination_iata', leg.destination_iata,
      'scheduled_departure_local', to_char(leg.scheduled_departure_local, 'YYYY-MM-DD"T"HH24:MI'),
      'scheduled_arrival_local', to_char(leg.scheduled_arrival_local, 'YYYY-MM-DD"T"HH24:MI'),
      'actual_arrival_local', case when leg.status = 'delayed' then to_char(leg.estimated_arrival_local, 'YYYY-MM-DD"T"HH24:MI') end,
      'affected', leg.position = coalesce(alert.leg_position, last_position)
    )), 'firm');
    if not coalesce((applied ->> 'ok')::boolean, false) then
      raise exception 'leg_not_saved' using errcode = 'P0001';
    end if;
  end loop;

  perform public.record_case_event(conversation.org_id, new_case, 'created', 'system',
    jsonb_build_object('seq', next_seq, 'incident', incident, 'from', 'conversation'));
  if pax_trip.id is not null then
    handoff := public.pax_hand_over(conversation.org_id, new_case, pax_trip.id, people_map);
    perform public.record_case_event(conversation.org_id, new_case, 'agency_handoff', 'system',
      jsonb_build_object('people', handoff -> 'people', 'documents', jsonb_array_length(handoff -> 'documents')));
  end if;
  update public.tracked_trips set status = 'case_opened', case_id = new_case where id = trip.id;
  insert into public.wa_conversation_events (org_id, conversation_id, kind, actor_type, data)
  values (conversation.org_id, conversation.id, 'case_opened', 'system', jsonb_build_object('case_id', new_case, 'seq', next_seq));

  if public.firm_autonomy_mode(conversation.org_id, 'send_client_link') = 'auto'
     and target_token_hash ~ '^[0-9a-f]{64}$' and nullif(btrim(coalesce(target_body, '')), '') is not null then
    link_made := public.create_client_link(new_case, person, target_token_hash);
    if coalesce((link_made ->> 'ok')::boolean, false) then
      body := replace(target_body, '{caso}', next_seq::text);
      message := public.one_message(conversation, body, null, null);
      insert into public.wa_conversation_events (org_id, conversation_id, kind, actor_type, data)
      values (conversation.org_id, conversation.id, 'link_sent', 'system', jsonb_build_object('case_id', new_case));
      linked := true;
    end if;
  end if;
  perform set_config('one.system_case', '', true);

  return jsonb_build_object('ok', true, 'code', case when linked then 'opened' else 'opened_without_link' end,
                            'case_id', new_case, 'seq', next_seq, 'message_id', message,
                            'documents', coalesce(handoff -> 'documents', '[]'::jsonb));
exception when sqlstate 'P0001' then
  perform set_config('one.system_case', '', true);
  return jsonb_build_object('ok', false, 'code', sqlerrm);
end;
$$;

revoke all on function public.one_open_case_from_alert(uuid, integer, uuid, text, text) from public, anon, authenticated;

-- ---------- The flight reads ----------

/**
 * The legs of a trip read now: each not landed nor cancelled, inside its own window (the setting's hours before
 * its departure to its hours after its scheduled arrival, the local times taken as Brasília's), as `trip_legs`
 * gives them. Internal.
 */
create or replace function public.trip_legs_due(target_trip uuid, target_before integer, target_after integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'position', l.position,
    'flight_number', l.flight_number,
    'origin', l.origin_iata,
    'destination', l.destination_iata,
    'departure', l.scheduled_departure_local,
    'arrival', l.scheduled_arrival_local,
    'status', l.status,
    'estimated_arrival', l.estimated_arrival_local
  ) order by l.position), '[]'::jsonb)
  from public.tracked_legs l
  where l.trip_id = target_trip and l.status not in ('landed', 'cancelled')
    and now() >= (l.scheduled_departure_local at time zone 'America/Sao_Paulo') - make_interval(hours => target_before)
    and now() <= (l.scheduled_arrival_local at time zone 'America/Sao_Paulo') + make_interval(hours => target_after);
$$;

revoke all on function public.trip_legs_due(uuid, integer, integer) from public, anon, authenticated;

/**
 * 0072, redefined: the trips due a reading at FlightAware. Each leg is read only inside its own window (a round
 * trip is not read through the days in between), and counted alone; a firm that spent its share of the day is
 * left out before the trips are chosen, so its trips never hold another firm's back. Service role.
 */
create or replace function public.claim_trip_watch(target_limit integer default 10, target_trip uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  every integer := greatest(public.flight_alerts_setting('watch_minutes', 20), 1);
  stale integer := greatest(public.flight_alerts_setting('watch_stale_minutes', 10), 1);
  before_hours integer := greatest(public.flight_alerts_setting('watch_before_hours', 6), 0);
  after_hours integer := greatest(public.flight_alerts_setting('watch_after_hours', 12), 0);
  ceiling integer := greatest(public.flight_alerts_setting('watch_daily_reads', 400), 0);
  firm_ceiling integer := greatest(public.flight_alerts_setting('watch_firm_daily_reads', 150), 0);
  used integer;
  firm_used jsonb;
  candidate record;
  of_firm integer;
  claim_number integer;
  claimed jsonb := '[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select coalesce(sum(t.watch_reads), 0) into used from public.tracked_trips t where t.watch_day = today;
  select coalesce(jsonb_object_agg(x.org_id, x.reads), '{}'::jsonb) into firm_used
  from (select t.org_id, sum(t.watch_reads) as reads from public.tracked_trips t
        where t.watch_day = today group by t.org_id) x;
  for candidate in
    select due.id, due.org_id, due.legs
    from (
      select t.id, t.org_id, t.watched_at,
             (select count(*)::integer from public.tracked_legs l
              where l.trip_id = t.id and l.status not in ('landed', 'cancelled')
                and now() >= (l.scheduled_departure_local at time zone 'America/Sao_Paulo') - make_interval(hours => before_hours)
                and now() <= (l.scheduled_arrival_local at time zone 'America/Sao_Paulo') + make_interval(hours => after_hours)
             ) as legs
      from public.tracked_trips t
      where t.watch = 'flightaware' and t.status in ('watching', 'alerted')
        and (target_trip is null or t.id = target_trip)
        and (t.watch_claimed_at is null or t.watch_claimed_at < now() - make_interval(mins => stale))
        and (target_trip is not null or t.watched_at is null or t.watched_at < now() - make_interval(mins => every))
    ) due
    where due.legs > 0
      and coalesce((firm_used ->> due.org_id::text)::integer, 0) + due.legs <= firm_ceiling
    order by due.watched_at nulls first, due.id
    limit least(greatest(coalesce(target_limit, 10), 1), 50)
  loop
    continue when used + candidate.legs > ceiling;
    of_firm := coalesce((firm_used ->> candidate.org_id::text)::integer, 0);
    -- This firm spent its share within this sweep: the next trip may be another firm's.
    continue when of_firm + candidate.legs > firm_ceiling;
    update public.tracked_trips t set
      watch_claimed_at = clock_timestamp(),
      watch_claims = t.watch_claims + 1,
      watch_reads = case when t.watch_day = today then t.watch_reads + candidate.legs else candidate.legs end,
      watch_day = today
    where t.id = candidate.id
      and (t.watch_claimed_at is null or t.watch_claimed_at < now() - make_interval(mins => stale))
    returning t.watch_claims into claim_number;
    if claim_number is not null then
      used := used + candidate.legs;
      firm_used := firm_used || jsonb_build_object(candidate.org_id::text, of_firm + candidate.legs);
      claimed := claimed || jsonb_build_array(jsonb_build_object(
        'trip_id', candidate.id, 'claim', claim_number, 'org_id', candidate.org_id,
        'legs', public.trip_legs_due(candidate.id, before_hours, after_hours)));
    end if;
    claim_number := null;
  end loop;
  return claimed;
end;
$$;

revoke all on function public.claim_trip_watch(integer, uuid) from public, anon, authenticated;

-- ---------- The documents the AI reads ----------

/** How many documents the AI was asked to read for a partnership in a day of Brasília. Backend only. */
create table public.pax_reading_days (
  partnership_id uuid not null references public.partner_links (id) on delete cascade,
  day date not null,
  readings integer not null default 0,
  primary key (partnership_id, day),
  constraint pax_reading_days_readings_check check (readings >= 0)
);

alter table public.pax_reading_days enable row level security;
revoke all on table public.pax_reading_days from anon, authenticated;

/**
 * 0070, redefined: the documents the backend reads now, each under a numbered claim, within the setting's readings
 * of a day for each partnership (a partnership that spent them waits for the next day, the others go on). An upload
 * whose bytes were measured and whose answer never reached its document is taken up here: kept, it is read; refused,
 * it goes with its file. Service role.
 */
create or replace function public.claim_pax_document_readings(target_limit integer default 5, target_document uuid default null)
returns table (document_id uuid, claim integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  attempts integer := greatest(public.partner_setting('reading_attempts', 3), 1);
  minutes integer := greatest(public.partner_setting('reading_claim_minutes', 15), 1);
  daily integer := greatest(public.partner_setting('reading_daily', 300), 1);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.pax_documents d set reading = 'pending'
  from public.files f
  where f.id = d.file_id and d.reading = 'uploading' and f.status = 'stored'
    and f.created_at < now() - interval '10 minutes';
  delete from public.files f
  using public.pax_documents d
  where d.file_id = f.id and d.reading = 'uploading' and f.status = 'rejected' and f.partner_id is not null;
  update public.pax_documents d
  set reading = case when d.reading_attempts >= attempts then 'failed' else 'pending' end,
      reading_error = case when d.reading_attempts >= attempts then 'abandoned' else d.reading_error end,
      reading_claimed_at = null
  where d.reading = 'working' and d.reading_claimed_at < now() - make_interval(mins => minutes);
  return query
  with tally as (
    select r.partnership_id, r.readings from public.pax_reading_days r where r.day = today
  ), ranked as (
    select d.id, t.partnership_id, d.created_at,
           row_number() over (partition by t.partnership_id order by d.created_at, d.id) as nth,
           coalesce(x.readings, 0) as spent
    from public.pax_documents d
    join public.pax_travelers t on t.id = d.traveler_id
    left join tally x on x.partnership_id = t.partnership_id
    where d.reading = 'pending' and (target_document is null or d.id = target_document)
  ), chosen as (
    select ranked.id, ranked.partnership_id from ranked
    where ranked.spent + ranked.nth <= daily
    order by ranked.created_at, ranked.id
    limit greatest(least(coalesce(target_limit, 5), 50), 1)
  ), taken as (
    update public.pax_documents d
    set reading = 'working', reading_claims = d.reading_claims + 1, reading_claimed_at = now(),
        reading_attempts = d.reading_attempts + 1
    from chosen where d.id = chosen.id and d.reading = 'pending'
    returning d.id, d.reading_claims, chosen.partnership_id
  ), counted as (
    insert into public.pax_reading_days (partnership_id, day, readings)
    select taken.partnership_id, today, count(*)::integer from taken group by taken.partnership_id
    on conflict (partnership_id, day) do update set readings = public.pax_reading_days.readings + excluded.readings
    returning 1
  )
  select taken.id, taken.reading_claims from taken;
end;
$$;

revoke all on function public.claim_pax_document_readings(integer, uuid) from public, anon, authenticated;

/**
 * 0070, redefined: what a document read says of its passenger, written where the record has nothing; a birth date
 * that is no date is left out alone, so what else the document says is still written. Internal.
 */
create or replace function public.pax_apply_reading(target_document uuid, target_output jsonb)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  document public.pax_documents%rowtype;
  traveler public.pax_travelers%rowtype;
  data jsonb := target_output -> 'dados_lidos';
  read_value text;
  fields jsonb := '{}'::jsonb;
  cleaned jsonb;
  applied jsonb;
  written text[] := '{}';
  address jsonb;
  leg jsonb;
  legs jsonb := '[]'::jsonb;
begin
  select * into document from public.pax_documents where id = target_document;
  if not found or coalesce(target_output ->> 'confere_tipo', '') <> 'sim'
     or coalesce((target_output ->> 'legivel')::boolean, false) is not true then
    return written;
  end if;
  select * into traveler from public.pax_travelers where id = document.traveler_id for update;
  if not found or traveler.handed_over_at is not null then
    return written;
  end if;

  if document.kind = 'identity' and jsonb_typeof(data) = 'object' then
    read_value := regexp_replace(btrim(coalesce(data ->> 'nome_completo', '')), '\s+', ' ', 'g');
    if read_value <> '' and not traveler.read_fields ? 'full_name' then
      read_value := public.completed_name(traveler.full_name, read_value);
      if read_value is not null then
        fields := fields || jsonb_build_object('full_name', read_value);
      end if;
    end if;
    read_value := regexp_replace(coalesce(data ->> 'cpf', ''), '\D', '', 'g');
    if traveler.cpf is null and read_value ~ '^[0-9]{11}$' and public.cpf_is_valid(read_value) and not exists (
      select 1 from public.pax_travelers t where t.partnership_id = traveler.partnership_id and t.cpf = read_value
    ) then
      fields := fields || jsonb_build_object('cpf', read_value);
    end if;
    read_value := btrim(coalesce(data ->> 'data_nascimento', ''));
    if traveler.birth_date is null and read_value <> ''
       and coalesce((public.pax_clean_fields(jsonb_build_object('birth_date', read_value)) ->> 'ok')::boolean, false) then
      fields := fields || jsonb_build_object('birth_date', read_value);
    end if;
    read_value := lower(regexp_replace(btrim(coalesce(data ->> 'nacionalidade', '')), '\s+', ' ', 'g'));
    if traveler.nationality is null and read_value <> ''
       and not public.pax_is_minor(coalesce(traveler.birth_date, nullif(fields ->> 'birth_date', '')::date)) then
      fields := fields || jsonb_build_object('nationality', read_value);
    end if;
  elsif document.kind = 'address_proof' and jsonb_typeof(data) = 'object'
        and traveler.postal_code is null and traveler.street is null and traveler.city is null then
    address := jsonb_strip_nulls(jsonb_build_object(
      'postal_code', nullif(regexp_replace(coalesce(data ->> 'cep', ''), '\D', '', 'g'), ''),
      'street', nullif(regexp_replace(btrim(coalesce(data ->> 'logradouro', '')), '\s+', ' ', 'g'), ''),
      'address_number', nullif(regexp_replace(btrim(coalesce(data ->> 'numero', '')), '\s+', ' ', 'g'), ''),
      'complement', nullif(regexp_replace(btrim(coalesce(data ->> 'complemento', '')), '\s+', ' ', 'g'), ''),
      'district', nullif(regexp_replace(btrim(coalesce(data ->> 'bairro', '')), '\s+', ' ', 'g'), ''),
      'city', nullif(regexp_replace(btrim(coalesce(data ->> 'cidade', '')), '\s+', ' ', 'g'), ''),
      'uf', nullif(upper(btrim(coalesce(data ->> 'uf', ''))), '')
    ));
    if address ? 'postal_code' and address ? 'street' and address ? 'city' and address ? 'uf' then
      fields := fields || address;
    end if;
  elsif public.pax_kind_of_trip(document.kind) and document.trip_id is not null
        and not exists (select 1 from public.pax_trip_legs l where l.trip_id = document.trip_id)
        and jsonb_typeof(target_output -> 'trechos') = 'array' then
    for leg in select value from jsonb_array_elements(target_output -> 'trechos') limit 6 loop
      legs := legs || jsonb_build_object(
        'flight_number', leg ->> 'voo', 'origin_iata', leg ->> 'origem', 'destination_iata', leg ->> 'destino',
        'departure', leg ->> 'saida_prevista', 'arrival', leg ->> 'chegada_prevista');
    end loop;
    legs := public.pax_clean_legs(legs);
    if (legs ->> 'ok')::boolean then
      for leg in select value from jsonb_array_elements(legs -> 'legs') loop
        insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                          scheduled_departure_local, scheduled_arrival_local)
        values (document.trip_id, (leg ->> 'position')::integer, leg ->> 'flight_number', leg ->> 'origin_iata',
                leg ->> 'destination_iata', (leg ->> 'departure')::timestamp, (leg ->> 'arrival')::timestamp);
      end loop;
      perform public.pax_sync_tracked_trip(document.trip_id);
      written := written || 'legs'::text;
    end if;
  end if;

  if fields <> '{}'::jsonb then
    cleaned := public.pax_clean_fields(fields);
    if (cleaned ->> 'ok')::boolean then
      applied := public.pax_apply_fields(traveler.id, cleaned -> 'values', 'document');
      if (applied ->> 'ok')::boolean then
        written := written || array(select jsonb_array_elements_text(applied -> 'changed'));
      end if;
    end if;
  end if;
  if cardinality(array_remove(written, 'legs')) > 0 then
    update public.pax_travelers
    set read_fields = read_fields || (
      select jsonb_object_agg(field, jsonb_build_object('document', document.id, 'kind', document.kind))
      from unnest(array_remove(written, 'legs')) as field
    )
    where id = traveler.id;
  end if;
  return written;
end;
$$;

revoke all on function public.pax_apply_reading(uuid, jsonb) from public, anon, authenticated;

-- ---------- An upload ----------

/**
 * 0070, redefined: what the backend finishes of an upload, now also one whose bytes were already measured and
 * whose answer never reached its document (`file_status` says which): the next request ends it. Service role.
 */
drop function public.pax_upload_to_finish(uuid, text);
create function public.pax_upload_to_finish(target_file uuid, target_token text default null)
returns table (file_id uuid, storage_path text, declared_mime text, partner_id uuid, created_by uuid, file_status text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.pax_confirm_links%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_token is not null then
    link := public.pax_link_by_token(target_token);
    if link.id is null then
      return;
    end if;
  end if;
  return query
  select f.id, f.storage_path, f.declared_mime, d.partner_id, d.created_by, f.status
  from public.pax_documents d
  join public.files f on f.id = d.file_id
  where d.file_id = target_file and d.reading = 'uploading' and f.status in ('reserved', 'stored', 'rejected')
    and (target_token is null or (d.source = 'passenger'
         and d.traveler_id in (select p.id from public.pax_link_people(link.holder_id) p)));
end;
$$;

revoke all on function public.pax_upload_to_finish(uuid, text) from public, anon, authenticated;

/** 0070, redefined: what became of an upload once measured; a file refused goes with its document. Service role. */
create or replace function public.pax_document_uploaded(target_file uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  file public.files%rowtype;
  document public.pax_documents%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into document from public.pax_documents where file_id = target_file for update;
  select * into file from public.files where id = target_file;
  if document.id is null or file.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if document.reading <> 'uploading' then
    return jsonb_build_object('ok', true, 'code', 'already_' || document.reading, 'document_id', document.id);
  end if;
  if file.status = 'stored' then
    update public.pax_documents set reading = 'pending' where id = document.id;
    return jsonb_build_object('ok', true, 'code', 'pending', 'document_id', document.id);
  end if;
  if file.status = 'rejected' then
    delete from public.files where id = file.id and partner_id is not null;
    delete from public.pax_documents where id = document.id;
    return jsonb_build_object('ok', false, 'code', 'rejected', 'reason', file.rejected_reason);
  end if;
  return jsonb_build_object('ok', false, 'code', 'not_measured');
end;
$$;

revoke all on function public.pax_document_uploaded(uuid) from public, anon, authenticated;

/** 0018, redefined: a reservation that expired goes; one an agency held is in no firm's audit trail. Service role. */
create or replace function public.expire_file_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  with stale as (
    select f.id from public.files f
    where f.status = 'reserved' and f.expires_at < now()
    order by f.expires_at
    limit 1000
    for update skip locked
  ),
  gone as (
    delete from public.files f using stale where f.id = stale.id
    returning f.id, f.org_id, f.purpose, f.partner_id
  ),
  audited as (
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    select case when gone.partner_id is null then gone.org_id end, null, 'file.expired', 'file', gone.id::text,
           jsonb_build_object('purpose', gone.purpose)
    from gone
    returning 1
  )
  select count(*)::integer into removed from audited;
  return removed;
end;
$$;

revoke all on function public.expire_file_reservations() from public, anon, authenticated;

-- ---------- A spreadsheet ----------

/**
 * 0073, redefined: the lines of a spreadsheet, written for a partnership. A line refuses to touch a trip ONE told
 * of a problem (`trip_locked`) or one that already takes the setting's passengers (`too_many_travelers`), and the
 * legs a spreadsheet adds are kept in the order they fly. Internal.
 */
create or replace function public.pax_import_rows_core(target_partnership uuid, target_rows jsonb, target_via text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.partner_links%rowtype;
  row_data jsonb;
  line integer;
  cleaned jsonb;
  row_values jsonb;
  found_traveler uuid;
  trip public.pax_trips%rowtype;
  row_locator text;
  legs jsonb;
  leg jsonb;
  added integer := 0;
  matched integer := 0;
  trips_added integer := 0;
  legs_added integer := 0;
  problems jsonb := '[]'::jsonb;
  next_position integer;
  most integer := least(greatest(public.partner_setting('trip_travelers', 20), 2), 50);
  -- The counts before a line: a line undone by an error counts nothing.
  counted integer[];
begin
  select * into link from public.partner_links where id = target_partnership;
  if jsonb_typeof(target_rows) is distinct from 'array'
     or jsonb_array_length(target_rows) > greatest(public.partner_setting('import_rows_per_call', 200), 1) then
    return jsonb_build_object('ok', false, 'code', 'invalid_rows');
  end if;
  for row_data in select value from jsonb_array_elements(target_rows) loop
    line := case when coalesce(row_data ->> 'line', '') ~ '^[0-9]{1,7}$' then (row_data ->> 'line')::integer end;
    counted := array[added, matched, trips_added, legs_added];
    begin
      cleaned := public.pax_clean_fields(jsonb_strip_nulls(jsonb_build_object(
        'full_name', row_data ->> 'nome', 'cpf', row_data ->> 'cpf', 'birth_date', row_data ->> 'nascimento',
        'phone', row_data ->> 'whatsapp', 'email', row_data ->> 'email')));
      if not (cleaned ->> 'ok')::boolean then
        problems := problems || jsonb_build_object('line', line, 'code', cleaned ->> 'code', 'field', cleaned ->> 'field');
        continue;
      end if;
      row_values := cleaned -> 'values';
      if not row_values ? 'full_name' then
        problems := problems || jsonb_build_object('line', line, 'code', 'invalid_name', 'field', 'full_name');
        continue;
      end if;
      found_traveler := null;
      if row_values ->> 'cpf' is not null then
        select t.id into found_traveler from public.pax_travelers t where t.partnership_id = link.id and t.cpf = row_values ->> 'cpf';
      end if;
      if found_traveler is null and row_values ->> 'birth_date' is not null then
        select t.id into found_traveler from public.pax_travelers t
        where t.partnership_id = link.id and public.plain_name(t.full_name) = public.plain_name(row_values ->> 'full_name')
          and t.birth_date = (row_values ->> 'birth_date')::date
        limit 1;
      end if;
      if found_traveler is null then
        insert into public.pax_travelers (partner_id, partnership_id, org_id, full_name, created_by)
        values (link.partner_id, link.id, link.org_id, row_values ->> 'full_name', auth.uid())
        returning id into found_traveler;
        perform public.pax_apply_fields(found_traveler, row_values - 'full_name', 'partner');
        added := added + 1;
      else
        -- What the spreadsheet says fills what the record lacks; what is on record stays.
        perform public.pax_apply_fields(found_traveler, (
          select coalesce(jsonb_object_agg(item.key, item.value), '{}'::jsonb)
          from jsonb_each(row_values - 'full_name') as item
          where to_jsonb(t) -> item.key = 'null'::jsonb
        ), 'partner')
        from public.pax_travelers t where t.id = found_traveler;
        matched := matched + 1;
      end if;

      row_locator := nullif(upper(regexp_replace(coalesce(row_data ->> 'localizador', ''), '\s+', '', 'g')), '');
      if row_locator is not null then
        if row_locator !~ '^[A-Z0-9]{5,8}$' then
          problems := problems || jsonb_build_object('line', line, 'code', 'invalid_locator', 'field', 'locator');
          continue;
        end if;
        select * into trip from public.pax_trips t where t.partnership_id = link.id and t.locator = row_locator
        order by t.created_at limit 1 for update;
        if trip.id is null then
          if public.pax_is_minor((row_values ->> 'birth_date')::date) then
            problems := problems || jsonb_build_object('line', line, 'code', 'holder_is_minor', 'field', 'nascimento');
            continue;
          end if;
          insert into public.pax_trips (partner_id, partnership_id, org_id, holder_id, locator, created_by)
          values (link.partner_id, link.id, link.org_id, found_traveler, row_locator, auth.uid())
          returning * into trip;
          trips_added := trips_added + 1;
        elsif public.pax_trip_state(trip.id) not in ('waiting_consent', 'watching') then
          -- A trip ONE told of a problem, or whose passenger went to the firm, changes no more.
          problems := problems || jsonb_build_object('line', line, 'code', 'trip_locked', 'field', 'locator');
          trip := null;
          continue;
        end if;
        if not exists (select 1 from public.pax_trip_travelers tt where tt.trip_id = trip.id and tt.traveler_id = found_traveler)
           and (select count(*) from public.pax_trip_travelers tt where tt.trip_id = trip.id) >= most then
          problems := problems || jsonb_build_object('line', line, 'code', 'too_many_travelers', 'field', 'locator');
          trip := null;
          continue;
        end if;
        insert into public.pax_trip_travelers (trip_id, traveler_id) values (trip.id, found_traveler) on conflict do nothing;
        if coalesce(row_data ->> 'voo', '') <> '' then
          legs := public.pax_clean_legs(jsonb_build_array(jsonb_build_object(
            'flight_number', row_data ->> 'voo', 'origin_iata', row_data ->> 'origem',
            'destination_iata', row_data ->> 'destino', 'departure', row_data ->> 'partida',
            'arrival', row_data ->> 'chegada')));
          if not (legs ->> 'ok')::boolean then
            problems := problems || jsonb_build_object('line', line, 'code', legs ->> 'code', 'field', 'leg');
            trip := null;
            continue;
          end if;
          leg := legs -> 'legs' -> 0;
          if not exists (
            select 1 from public.pax_trip_legs l where l.trip_id = trip.id and l.flight_number = leg ->> 'flight_number'
              and l.scheduled_departure_local = (leg ->> 'departure')::timestamp
          ) then
            select coalesce(max(l.position), 0) + 1 into next_position from public.pax_trip_legs l where l.trip_id = trip.id;
            if next_position > 6 then
              problems := problems || jsonb_build_object('line', line, 'code', 'too_many_legs', 'field', 'leg');
            else
              insert into public.pax_trip_legs (trip_id, position, flight_number, origin_iata, destination_iata,
                                                scheduled_departure_local, scheduled_arrival_local)
              values (trip.id, next_position, leg ->> 'flight_number', leg ->> 'origin_iata', leg ->> 'destination_iata',
                      (leg ->> 'departure')::timestamp, (leg ->> 'arrival')::timestamp);
              perform public.pax_order_legs(trip.id);
              legs_added := legs_added + 1;
            end if;
          end if;
        end if;
        perform public.pax_sync_tracked_trip(trip.id);
        trip := null;
      end if;
    exception when others then
      added := counted[1];
      matched := counted[2];
      trips_added := counted[3];
      legs_added := counted[4];
      problems := problems || jsonb_build_object('line', line, 'code', 'not_written');
      trip := null;
    end;
  end loop;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, auth.uid(), 'pax.import', 'partner', link.partner_id::text,
          jsonb_build_object('added', added, 'matched', matched, 'trips', trips_added, 'legs', legs_added,
                             'refused', jsonb_array_length(problems), 'via', target_via));
  return jsonb_build_object('ok', true, 'code', 'imported', 'added', added, 'matched', matched,
                            'trips_added', trips_added, 'legs_added', legs_added, 'problems', problems);
end;
$$;

revoke all on function public.pax_import_rows_core(uuid, jsonb, text) from public, anon, authenticated;
