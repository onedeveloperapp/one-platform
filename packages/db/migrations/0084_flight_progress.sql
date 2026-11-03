-- ============================================================
-- 0084_flight_progress: the flight itself, step by step, for the agency;
-- and, for the firm, how many of its agencies' passengers agreed and fly,
-- in numbers.
--
-- The owner, 2026-11-03: once a passenger agreed, the agency follows their
-- flights as they happen (each leg leaving and arriving, the whole way), as
-- the firm follows a case along its steps: the steps of a flight with no
-- problem, a problem being the trip's own way (0070, 0071). And the firm
-- learns from when its agencies' passengers agreed, to foresee the cases
-- that may come: in numbers by date, nobody named (the owner's choice of
-- the same day; a passenger's name, CPF, phone or document still reaches
-- the firm only with the passenger's yes, 0071).
--
-- A leg keeps when it left and when it arrived, in its airports' local
-- times, as its source said (FlightAware's actual times, 0051, or the test
-- chat's tools, 0047): never guessed from the clock, so a leg no source said
-- left is still to leave, however late it is, and a reading that does not
-- repeat what happened erases nothing of it (a cancelled leg never left).
-- ============================================================

-- How many days ahead the agency's home and the firm's forecast look.
update public.platform_settings
set value = value || jsonb_build_object('flight_progress_days', 7)
where key = 'partners' and not (value ? 'flight_progress_days');

alter table public.tracked_legs
  -- When the leg left its origin, in that airport's local time, as its source said.
  add column departed_local timestamp,
  -- When the leg arrived at its destination, in that airport's local time, as its source said.
  add column arrived_local timestamp;

/** A local time as a source writes it ("YYYY-MM-DDTHH:MM"), or null for anything that is not one. Internal. */
create or replace function public.local_time_of(value text)
returns timestamp
language plpgsql
immutable
set search_path = public
as $$
begin
  if coalesce(value, '') !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then
    return null;
  end if;
  return left(replace(value, 'T', ' '), 16)::timestamp;
exception when others then
  return null;
end;
$$;

revoke all on function public.local_time_of(text) from public, anon, authenticated;

-- ---------- What a source said of each leg ----------

/**
 * 0051, redefined: what FlightAware said of each leg of a trip ONE follows,
 * now with when it left and when it arrived (`departed`, `arrived`, local
 * times of its airports). Service role, under the trip's claim.
 */
create or replace function public.record_trip_watch(
  target_trip uuid,
  target_claim integer,
  target_legs jsonb,
  target_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  trip public.tracked_trips%rowtype;
  item jsonb;
  state text;
  expected timestamp;
  departed timestamp;
  arrived timestamp;
  code text := nullif(left(regexp_replace(lower(coalesce(target_error, '')), '[^a-z0-9_]', '_', 'g'), 59), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into trip from public.tracked_trips t
  where t.id = target_trip and t.watch_claims = target_claim and t.watch_claimed_at is not null
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if code is not null and code !~ '^[a-z]' then
    code := 'x' || code;
  end if;
  for item in select value from jsonb_array_elements(coalesce(target_legs, '[]'::jsonb)) loop
    state := item ->> 'status';
    expected := public.local_time_of(item ->> 'estimated_arrival');
    departed := public.local_time_of(item ->> 'departed');
    arrived := public.local_time_of(item ->> 'arrived');
    if state is null or state not in ('scheduled', 'delayed', 'cancelled', 'changed', 'landed')
       or (state = 'delayed' and expected is null) then
      continue;
    end if;
    update public.tracked_legs set
      status = state,
      estimated_arrival_local = case when state in ('cancelled', 'changed') then null else expected end,
      -- What happened stays when a later reading does not repeat it; a cancelled leg never left.
      departed_local = case when state = 'cancelled' then null else coalesce(departed, departed_local) end,
      -- A leg sent elsewhere never arrived where it was going.
      arrived_local = case
        when state in ('cancelled', 'changed') then null
        when state = 'landed' then coalesce(arrived, arrived_local, expected)
        else coalesce(arrived, arrived_local)
      end,
      status_source = 'flightaware',
      status_at = now()
    where trip_id = trip.id and position::text = coalesce(item ->> 'position', '');
  end loop;
  update public.tracked_trips set watched_at = now(), watch_claimed_at = null, watch_error = code where id = trip.id;
  return jsonb_build_object('ok', true, 'trip_id', trip.id, 'org_id', trip.org_id,
                            'delay_minutes', public.flight_alerts_setting('delay_minutes', 240),
                            'legs', public.trip_legs(trip.id));
end;
$$;

revoke all on function public.record_trip_watch(uuid, integer, jsonb, text) from public, anon, authenticated;

/**
 * 0076, redefined: a tool of the test chat makes a trip's problem happen,
 * or now also its flight go as a flight with no problem goes (an item with
 * `event`: `depart`, the leg leaves at its scheduled time; `land`, it
 * arrives, at the time expected of it when it was late, else the scheduled
 * one); starting a trip over clears when its legs left and arrived.
 */
create or replace function public.test_chat_set_legs(target_token text, target_trip uuid, target_legs jsonb, target_reset boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chat jsonb := public.test_chat_by_token(target_token);
  trip public.tracked_trips%rowtype;
  talk public.wa_conversations%rowtype;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  first_day date;
  item jsonb;
  status text;
  late integer;
  event text;
begin
  if not coalesce((chat ->> 'found')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into trip from public.tracked_trips t
  where t.id = target_trip and t.org_id = (chat ->> 'org_id')::uuid and t.is_test
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'trip_not_found');
  end if;

  -- A real flight is made to happen by nothing but its source: only started over.
  if trip.watch = 'flightaware' and not coalesce(target_reset, false) then
    return jsonb_build_object('ok', false, 'code', 'real_flight');
  end if;

  -- A ready trip's flights are of today: a test run days after the chat was turned on is of its own day. A real
  -- flight keeps its own, and so does a trip an agency registered, whose days are the agency's.
  select min(l.scheduled_departure_local)::date into first_day from public.tracked_legs l where l.trip_id = trip.id;
  if trip.watch = 'simulated' and trip.pax_trip_id is null and first_day is not null and first_day <> today then
    update public.tracked_legs set
      scheduled_departure_local = scheduled_departure_local + make_interval(days => today - first_day),
      scheduled_arrival_local = scheduled_arrival_local + make_interval(days => today - first_day),
      departed_local = departed_local + make_interval(days => today - first_day),
      arrived_local = arrived_local + make_interval(days => today - first_day)
    where trip_id = trip.id;
  end if;

  if coalesce(target_reset, false) then
    update public.tracked_legs set status = 'scheduled', estimated_arrival_local = null, status_source = null, status_at = null,
                                   departed_local = null, arrived_local = null
    where trip_id = trip.id;
    delete from public.flight_alerts where trip_id = trip.id;
    update public.tracked_trips set status = 'watching', case_id = null, watched_at = null, watch_error = null
    where id = trip.id;
    -- Its conversation starts over with ONE: what was said stays, and nothing of it is answered again.
    for talk in
      select c.* from public.wa_conversations c
      where c.org_id = trip.org_id and c.number_id = (chat ->> 'number_id')::uuid
        and (c.contact_wa_id = trip.phone or c.contact_wa_id = any (public.wa_phone_variants(trip.phone)))
      for update
    loop
      perform public.withdraw_conversation_answers(talk.id, 'A viagem de teste recomeçou.');
      if talk.agent <> 'one' or talk.called_at is not null then
        insert into public.wa_conversation_events (org_id, conversation_id, kind, actor_type)
        values (talk.org_id, talk.id, 'returned_to_one', 'system');
      end if;
      update public.wa_conversations set
        agent = 'one', agent_changed_by = null, agent_changed_at = now(),
        called_reason = null, called_at = null,
        one_through = greatest(coalesce(one_through, '-infinity'::timestamptz), coalesce(last_inbound_at, '-infinity'::timestamptz), now()),
        one_claimed_at = null
      where id = talk.id;
    end loop;
  else
    if jsonb_typeof(target_legs) <> 'array' or jsonb_array_length(target_legs) = 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid_legs');
    end if;
    for item in select value from jsonb_array_elements(target_legs) loop
      event := item ->> 'event';
      if not exists (
           select 1 from public.tracked_legs l
           where l.trip_id = trip.id and l.position::text = coalesce(item ->> 'position', '')
         ) then
        return jsonb_build_object('ok', false, 'code', 'invalid_legs');
      end if;
      if event is not null then
        -- The flight going as a flight with no problem goes: a cancelled leg neither leaves nor arrives.
        if event not in ('depart', 'land') then
          return jsonb_build_object('ok', false, 'code', 'invalid_legs');
        end if;
        update public.tracked_legs l set
          departed_local = coalesce(l.departed_local, l.scheduled_departure_local),
          arrived_local = case when event = 'land' then coalesce(l.arrived_local, l.estimated_arrival_local, l.scheduled_arrival_local)
                               else l.arrived_local end,
          status = case when event = 'land' then 'landed' else l.status end,
          status_source = 'simulated',
          status_at = now()
        where l.trip_id = trip.id and l.position = (item ->> 'position')::integer and l.status <> 'cancelled';
        continue;
      end if;
      status := item ->> 'status';
      late := case when coalesce(item ->> 'late_minutes', '') ~ '^[0-9]{1,5}$' then (item ->> 'late_minutes')::integer end;
      if status is null or status not in ('scheduled', 'delayed', 'cancelled', 'changed', 'landed')
         or (status = 'delayed' and late is null) then
        return jsonb_build_object('ok', false, 'code', 'invalid_legs');
      end if;
      update public.tracked_legs set
        status = item ->> 'status',
        estimated_arrival_local = case when late is not null then scheduled_arrival_local + make_interval(mins => late) end,
        departed_local = case when item ->> 'status' = 'cancelled' then null else departed_local end,
        arrived_local = case when item ->> 'status' in ('cancelled', 'changed') then null else arrived_local end,
        status_source = 'simulated',
        status_at = now()
      where trip_id = trip.id and position = (item ->> 'position')::integer;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'org_id', trip.org_id,
    'trip_id', trip.id,
    'delay_minutes', public.flight_alerts_setting('delay_minutes', 240),
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', l.position,
        'departure', l.scheduled_departure_local,
        'arrival', l.scheduled_arrival_local,
        'status', l.status,
        'estimated_arrival', l.estimated_arrival_local
      ) order by l.position)
      from public.tracked_legs l where l.trip_id = trip.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.test_chat_set_legs(text, uuid, jsonb, boolean) from public, anon, authenticated;

-- ---------- The agency follows its passengers' flights ----------

/** A followed trip's legs as the agency reads them: scheduled, expected, left and arrived. Internal. */
create or replace function public.pax_flight_legs(target_tracked uuid)
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
    'departure', to_char(l.scheduled_departure_local, 'YYYY-MM-DD"T"HH24:MI'),
    'arrival', to_char(l.scheduled_arrival_local, 'YYYY-MM-DD"T"HH24:MI'),
    'status', l.status,
    'estimated_arrival', to_char(l.estimated_arrival_local, 'YYYY-MM-DD"T"HH24:MI'),
    'departed', to_char(l.departed_local, 'YYYY-MM-DD"T"HH24:MI'),
    'arrived', to_char(l.arrived_local, 'YYYY-MM-DD"T"HH24:MI'),
    'status_at', l.status_at
  ) order by l.position), '[]'::jsonb)
  from public.tracked_legs l where l.trip_id = target_tracked;
$$;

revoke all on function public.pax_flight_legs(uuid) from public, anon, authenticated;

/**
 * The flights of an agency's passengers as they happen, for somebody of the
 * agency: with no passenger named, the trips ONE follows now whose flights
 * are in the setting's days (from yesterday on), or are in the air, the
 * soonest first; with one (`target_traveler`), every trip of that passenger
 * ONE followed, whatever their days, but one whose agreement was taken back.
 * Each trip with its holder (the agency's own record), its locator, how ONE
 * follows it and its legs: scheduled, expected, left and arrived.
 */
create or replace function public.pax_flight_progress(target_partner uuid, target_traveler uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  days integer := greatest(public.partner_setting('flight_progress_days', 7), 1);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_partner_member(target_partner) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'days', days,
    'trips', coalesce((
      select jsonb_agg(jsonb_build_object(
        'trip_id', p.id,
        'traveler_id', p.holder_id,
        'holder', h.full_name,
        'locator', p.locator,
        'state', t.status,
        'source', t.watch,
        'legs', public.pax_flight_legs(t.id)
      ) order by first_leg.at, p.created_at)
      from public.pax_trips p
      join public.tracked_trips t on t.pax_trip_id = p.id
      join public.pax_travelers h on h.id = p.holder_id
      cross join lateral (
        select min(l.scheduled_departure_local) as at,
               max(l.scheduled_arrival_local) as until,
               bool_or(l.departed_local is not null and l.arrived_local is null and l.status <> 'cancelled') as flying
        from public.tracked_legs l where l.trip_id = t.id
      ) first_leg
      where p.partner_id = target_partner
        and (
          (target_traveler is null
           and t.status in ('watching', 'alerted')
           and (first_leg.flying
                or (first_leg.until::date >= today - 1 and first_leg.at::date <= today + days)))
          or (target_traveler is not null
              and t.status <> 'stopped'
              and (p.holder_id = target_traveler
                   or exists (select 1 from public.pax_trip_travelers tt
                              where tt.trip_id = p.id and tt.traveler_id = target_traveler)))
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.pax_flight_progress(uuid, uuid) from public, anon;
grant execute on function public.pax_flight_progress(uuid, uuid) to authenticated;

-- ---------- The firm foresees, in numbers ----------

/**
 * 0077, redefined: what a firm reads of each of its partnerships, now with
 * its forecast (`forecast`), in numbers and nobody named: how many of the
 * partnership's passengers agreed (their answer in force; a child counts as
 * the passenger they are) and from when (the first day of an agreement in
 * force, and how many were given in each of the last eight weeks), how many
 * trips ONE follows now, how many of them fly in each of the setting's next
 * days, how many legs are in the air, how many arrived today, and how many
 * trips were told of a problem and wait for the passenger's answer.
 */
create or replace function public.firm_partnership_facts(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  week date := date_trunc('week', (now() at time zone 'America/Sao_Paulo'))::date;
  days integer := greatest(public.partner_setting('flight_progress_days', 7), 1);
  manager boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  manager := public.is_superadmin() or public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]);

  return jsonb_build_object(
    'partnerships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'link_id', l.id,
        'module', l.module_key,
        'status', l.status,
        'cases_going', (
          select count(*) from public.cases c
          where c.org_id = target_org and c.partnership_id = l.id and c.status not in ('closed', 'declined')
        ),
        'cases_total', (
          select count(*) from public.cases c where c.org_id = target_org and c.partnership_id = l.id
        ),
        'awaiting_client', (
          select count(*) from public.cases c
          where c.org_id = target_org and c.partnership_id = l.id
            and c.status in ('intake', 'documents', 'signature')
            and not exists (
              select 1 from public.client_links k where k.case_id = c.id and k.finished_at is not null
            )
        ),
        'readings_today', case when manager then coalesce((
          select r.readings from public.pax_reading_days r where r.partnership_id = l.id and r.day = today
        ), 0) end,
        'flight_reads_today', case when manager then coalesce((
          select sum(t.watch_reads)::integer from public.tracked_trips t
          join public.pax_trips p on p.id = t.pax_trip_id
          where p.partnership_id = l.id and t.org_id = target_org and t.watch_day = today
        ), 0) end,
        'forecast', (
          with agreed as (
            -- Each passenger whose answer in force is a yes, and the day of that answer.
            select (latest.created_at at time zone 'America/Sao_Paulo')::date as day
            from public.pax_travelers tr
            cross join lateral (
              select c.answer, c.created_at from public.pax_consents c
              where c.traveler_id = tr.id order by c.created_at desc, c.id desc limit 1
            ) latest
            where tr.partnership_id = l.id and not tr.draft and latest.answer = 'agreed'
          ),
          followed as (
            select t.id, t.status from public.tracked_trips t
            join public.pax_trips p on p.id = t.pax_trip_id
            where p.partnership_id = l.id and t.org_id = target_org and t.status in ('watching', 'alerted')
          )
          select jsonb_build_object(
            'agreed', (select count(*) from agreed),
            'agreed_since', (select min(a.day) from agreed a),
            'agreed_weeks', (
              select jsonb_agg(jsonb_build_object(
                'week', w.start,
                'agreed', (select count(*) from agreed a where a.day >= w.start and a.day < w.start + 7)
              ) order by w.start)
              from (select (week - (n * 7))::date as start from generate_series(7, 0, -1) n) w
            ),
            'followed', (select count(*) from followed),
            'alerted', (select count(*) from followed f where f.status = 'alerted'),
            'days', (
              select jsonb_agg(jsonb_build_object(
                'day', d.day,
                'trips', (
                  select count(distinct f.id) from followed f
                  join public.tracked_legs fl on fl.trip_id = f.id
                  where fl.scheduled_departure_local::date = d.day
                )
              ) order by d.day)
              from (select (today + n)::date as day from generate_series(0, days - 1) n) d
            ),
            'in_air', (
              select count(*) from followed f join public.tracked_legs fl on fl.trip_id = f.id
              where fl.departed_local is not null and fl.arrived_local is null and fl.status <> 'cancelled'
            ),
            'arrived_today', (
              select count(*) from followed f join public.tracked_legs fl on fl.trip_id = f.id
              where fl.arrived_local::date = today
            )
          )
        )
      ) order by (l.status = 'active') desc, l.started_at desc)
      from public.partner_links l
      where l.org_id = target_org
    ), '[]'::jsonb),
    'manager', manager,
    'forecast_days', days,
    'readings_daily', case when manager then greatest(public.partner_setting('reading_daily', 300), 1) end,
    'flight_reads_today', case when manager then coalesce((
      select sum(t.watch_reads)::integer from public.tracked_trips t
      where t.org_id = target_org and t.watch_day = today
    ), 0) end,
    'flight_reads_share', case when manager then
      greatest(public.flight_alerts_setting('watch_firm_daily_reads', 150), 0) end
  );
end;
$$;

revoke all on function public.firm_partnership_facts(uuid) from public, anon;
grant execute on function public.firm_partnership_facts(uuid) to authenticated;
