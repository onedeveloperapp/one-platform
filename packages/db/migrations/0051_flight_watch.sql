-- ============================================================
-- 0051_flight_watch: ONE follows a trip's flights at FlightAware, and its
-- first word to a real passenger waits for the platform's release.
--
-- The adjustments before the tests, phase 4 (the plan of 2026-10-22): what
-- a flight ONE follows is doing comes from FlightAware's AeroAPI, with the
-- platform's key, read for each trip from some hours before its first
-- departure to some hours after its last arrival, at the setting's
-- interval, within a daily ceiling of reads (AeroAPI bills each one); what
-- it says of each leg is kept on the leg, and the rule of 0047
-- (`flight-problem-v1`) decides whether there is a problem to tell. The
-- test chat's four ready trips are still made to happen by its tools; a
-- test chat may also follow a real flight (its fifth trip, `voo_real`), so
-- the firm sees ONE find a real problem by itself before any real passenger
-- is written to.
--
-- ONE's first word to a real passenger (a trip that is not a test) waits
-- for the platform's release, which the operator gives with the note of
-- the legal opinion on soliciting clients (the OAB's Code of Ethics, art.
-- 7, and Provimento 205/2021) and may take back: until then such an alert
-- is kept and skipped as `not_released`, so the firm sees what ONE would
-- have told.
-- ============================================================

update public.platform_settings
set value = value || jsonb_build_object(
  -- How often a trip in its window is read, and a claim not recorded within these minutes is taken again.
  'watch_minutes', 20,
  'watch_stale_minutes', 10,
  -- The window: from these hours before its first departure to these after its last scheduled arrival.
  'watch_before_hours', 6,
  'watch_after_hours', 12,
  -- The most legs the platform reads at FlightAware in a day of Brasília: each read is billed.
  'watch_daily_reads', 400,
  -- ONE's first word to a real passenger waits for the operator's release.
  'released', false
)
where key = 'flight_alerts' and not (value ? 'watch_minutes');

-- ---------- How a trip's flights are known ----------

alter table public.tracked_trips
  -- simulated: the test chat's tools make what happens; flightaware: read at FlightAware.
  add column watch text not null default 'flightaware',
  add column watched_at timestamptz,
  add column watch_claims integer not null default 0,
  add column watch_claimed_at timestamptz,
  add column watch_error text,
  -- The legs read at FlightAware on the day of Brasília in `watch_day`: the platform's ceiling counts them.
  add column watch_day date,
  add column watch_reads integer not null default 0,
  add constraint tracked_trips_watch_check check (watch in ('simulated', 'flightaware')),
  add constraint tracked_trips_watch_real_check check (is_test or watch = 'flightaware'),
  add constraint tracked_trips_watch_error_check check (watch_error is null or watch_error ~ '^[a-z][a-z0-9_]{1,59}$'),
  add constraint tracked_trips_watch_reads_check check (watch_reads >= 0);

-- The test chat's four ready trips are made to happen by its tools, never read anywhere.
update public.tracked_trips set watch = 'simulated'
where is_test and label in ('cancelamento', 'familia', 'conexao', 'internacional');

create index tracked_trips_watch_idx on public.tracked_trips (watched_at nulls first)
  where watch = 'flightaware' and status in ('watching', 'alerted');

/** The setting's word on a real passenger: released by the operator, or not yet. */
create or replace function public.flight_alerts_released()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (ps.value ->> 'released')::boolean from public.platform_settings ps where ps.key = 'flight_alerts'), false);
$$;

revoke all on function public.flight_alerts_released() from public, anon, authenticated;

/**
 * The four ready trips of a test chat (0047), each made to happen by the
 * test chat's tools (`simulated`).
 */
create or replace function public.seed_test_trips(target_org uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  firm text := (select o.name from public.organizations o where o.id = target_org);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  wording text;
  trip uuid;
  made integer := 0;
begin
  wording := 'Concordo em receber, pelo WhatsApp do escritório ' || firm
    || ', avisos sobre a viagem que cadastrei, como atrasos e cancelamentos, e sei que posso parar quando quiser respondendo SAIR.';

  if not exists (select 1 from public.tracked_trips t where t.org_id = target_org and t.is_test and t.label = 'cancelamento') then
    insert into public.tracked_trips (org_id, passenger_name, phone, airline_iata, is_test, label, consent_wording, consent_at,
                                      consent_channel, watch)
    values (target_org, 'Mariana Teste', '5500988880001', 'LA', true, 'cancelamento', wording, now(), 'test', 'simulated')
    returning id into trip;
    insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                     scheduled_departure_local, scheduled_arrival_local)
    values (target_org, trip, 1, 'LA3456', 'GRU', 'REC', today + time '08:10', today + time '11:25');
    made := made + 1;
  end if;

  if not exists (select 1 from public.tracked_trips t where t.org_id = target_org and t.is_test and t.label = 'familia') then
    insert into public.tracked_trips (org_id, passenger_name, phone, companions, airline_iata, is_test, label,
                                      consent_wording, consent_at, consent_channel, watch)
    values (target_org, 'Rafael Teste', '5500988880002',
            jsonb_build_array(jsonb_build_object('name', 'Laura Teste',
              'birth_date', to_char(today - interval '7 years' - interval '120 days', 'YYYY-MM-DD'))),
            'G3', true, 'familia', wording, now(), 'test', 'simulated')
    returning id into trip;
    insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                     scheduled_departure_local, scheduled_arrival_local)
    values (target_org, trip, 1, 'G31450', 'BSB', 'GIG', today + time '14:00', today + time '15:45');
    made := made + 1;
  end if;

  if not exists (select 1 from public.tracked_trips t where t.org_id = target_org and t.is_test and t.label = 'conexao') then
    insert into public.tracked_trips (org_id, passenger_name, phone, airline_iata, is_test, label, consent_wording, consent_at,
                                      consent_channel, watch)
    values (target_org, 'Lúcia Teste', '5500988880003', 'AD', true, 'conexao', wording, now(), 'test', 'simulated')
    returning id into trip;
    insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                     scheduled_departure_local, scheduled_arrival_local)
    values (target_org, trip, 1, 'AD4120', 'CNF', 'VCP', today + time '07:00', today + time '08:20'),
           (target_org, trip, 2, 'AD2735', 'VCP', 'POA', today + time '09:30', today + time '11:05');
    made := made + 1;
  end if;

  if not exists (select 1 from public.tracked_trips t where t.org_id = target_org and t.is_test and t.label = 'internacional') then
    insert into public.tracked_trips (org_id, passenger_name, phone, airline_iata, is_test, label, consent_wording, consent_at,
                                      consent_channel, watch)
    values (target_org, 'Pedro Teste', '5500988880004', 'LA', true, 'internacional', wording, now(), 'test', 'simulated')
    returning id into trip;
    insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                     scheduled_departure_local, scheduled_arrival_local)
    values (target_org, trip, 1, 'LA8084', 'GRU', 'LIS', today + time '23:55', today + 1 + time '14:10');
    made := made + 1;
  end if;

  return made;
end;
$$;

revoke all on function public.seed_test_trips(uuid) from public, anon, authenticated;

-- ---------- Reading the flights ----------

/** The legs of a trip as the reading and the rule take them, in order. */
create or replace function public.trip_legs(target_trip uuid)
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
  from public.tracked_legs l where l.trip_id = target_trip;
$$;

revoke all on function public.trip_legs(uuid) from public, anon, authenticated;

/**
 * Claims the trips whose flights are read now, under a number each: read at
 * FlightAware, still waiting for what happens (or told of a problem, as a
 * later one is another fact), inside their window (from the setting's hours
 * before the first departure to its hours after the last scheduled arrival,
 * the local times taken as Brasília's, a window wide enough for any zone of
 * the country), not read within the setting's minutes (one named is read at
 * once), within what is left of the platform's daily reads, the least
 * recently read first. Service role.
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
  used integer;
  candidate public.tracked_trips%rowtype;
  legs integer;
  claim_number integer;
  claimed jsonb := '[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select coalesce(sum(t.watch_reads), 0) into used from public.tracked_trips t where t.watch_day = today;
  for candidate in
    select t.* from public.tracked_trips t
    where t.watch = 'flightaware' and t.status in ('watching', 'alerted')
      and (target_trip is null or t.id = target_trip)
      and (t.watch_claimed_at is null or t.watch_claimed_at < now() - make_interval(mins => stale))
      and (target_trip is not null or t.watched_at is null or t.watched_at < now() - make_interval(mins => every))
      and exists (select 1 from public.tracked_legs l where l.trip_id = t.id)
      and now() >= (select min(l.scheduled_departure_local) from public.tracked_legs l where l.trip_id = t.id)
                     at time zone 'America/Sao_Paulo' - make_interval(hours => before_hours)
      and now() <= (select max(l.scheduled_arrival_local) from public.tracked_legs l where l.trip_id = t.id)
                     at time zone 'America/Sao_Paulo' + make_interval(hours => after_hours)
    order by t.watched_at nulls first, t.id
    limit least(greatest(coalesce(target_limit, 10), 1), 50)
  loop
    select count(*) into legs from public.tracked_legs l where l.trip_id = candidate.id;
    exit when used + legs > ceiling;
    update public.tracked_trips t set
      watch_claimed_at = clock_timestamp(),
      watch_claims = t.watch_claims + 1,
      watch_reads = case when t.watch_day = today then t.watch_reads + legs else legs end,
      watch_day = today
    where t.id = candidate.id
      and (t.watch_claimed_at is null or t.watch_claimed_at < now() - make_interval(mins => stale))
    returning t.watch_claims into claim_number;
    if claim_number is not null then
      used := used + legs;
      claimed := claimed || jsonb_build_array(jsonb_build_object(
        'trip_id', candidate.id, 'claim', claim_number, 'org_id', candidate.org_id,
        'legs', public.trip_legs(candidate.id)));
    end if;
    claim_number := null;
  end loop;
  return claimed;
end;
$$;

revoke all on function public.claim_trip_watch(integer, uuid) from public, anon, authenticated;

/**
 * What FlightAware said of a claimed trip's legs, kept on each leg it spoke
 * of (its state and when the leg is now expected, in the local time of its
 * destination), the trip read now, with what kept the reading from being
 * whole when something did. Answers the legs as the rule takes them. Service
 * role.
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
    expected := case
      when coalesce(item ->> 'estimated_arrival', '') ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}'
      then (item ->> 'estimated_arrival')::timestamp end;
    if state is null or state not in ('scheduled', 'delayed', 'cancelled', 'changed', 'landed')
       or (state = 'delayed' and expected is null) then
      continue;
    end if;
    update public.tracked_legs set
      status = state,
      estimated_arrival_local = case when state in ('cancelled', 'changed') then null else expected end,
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

/** A claim given back: FlightAware did not answer, or its key was refused; the reading spent nothing of the trip. */
create or replace function public.release_trip_watch(target_trip uuid, target_claim integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.tracked_trips set watch_claimed_at = null
  where id = target_trip and watch_claims = target_claim and watch_claimed_at is not null
    and auth.role() = 'service_role';
$$;

revoke all on function public.release_trip_watch(uuid, integer) from public, anon, authenticated;

-- ---------- The first word, and its release ----------

/**
 * Reserves the template of ONE's first word on a trip's problem (0047), now
 * skipping an alert of a real passenger (a trip that is not a test) while
 * the platform has not released ONE's first word to real passengers
 * (`not_released`). Service role.
 */
create or replace function public.reserve_flight_alert(target_alert uuid, target_claim integer, target_params text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  alert public.flight_alerts%rowtype;
  trip public.tracked_trips%rowtype;
  notice public.notice_kinds%rowtype;
  template public.wa_templates%rowtype;
  sender public.wa_numbers%rowtype;
  conversation uuid;
  message uuid;
  rendered text;
  values_ok boolean;
  skip text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into alert from public.flight_alerts a
  where a.id = target_alert and a.status = 'due' and a.claims = target_claim and a.claimed_at is not null
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into trip from public.tracked_trips t where t.id = alert.trip_id;
  select * into notice from public.notice_kinds k where k.kind = 'flight_problem';
  values_ok := target_params is not null and cardinality(target_params) = cardinality(notice.params)
    and array_position(target_params, null) is null
    and not exists (
      select 1 from unnest(target_params) as v(value)
      where public.notice_value(v.value) is null or public.notice_value(v.value) <> v.value
    );

  select t.* into template from public.wa_templates t
  join public.firm_notice_kinds k on k.template_id = t.id
  where k.org_id = alert.org_id and k.kind = 'flight_problem' and k.enabled
    and t.status = 'approved' and t.category = 'utility';
  if found then
    select n.* into sender from public.wa_numbers n
    join public.connections cn on cn.id = n.connection_id and cn.status = 'connected'
    where n.org_id = alert.org_id and n.waba_id = template.waba_id and n.status = 'active'
      and (n.provider = 'test') = trip.is_test
    order by n.connected_at
    limit 1;
  end if;

  skip := case
    when trip.status in ('case_opened', 'declined', 'stopped') then 'trip_closed'
    when not trip.is_test and not public.flight_alerts_released() then 'not_released'
    when trip.consent_at is null then 'no_consent'
    when exists (
      select 1 from public.wa_optouts o
      where o.org_id = alert.org_id and o.contact_wa_id = any (public.wa_phone_variants(trip.phone))
    ) then 'opted_out'
    when template.id is null then 'no_template'
    when sender.id is null then 'no_number'
    when not values_ok or template.param_count <> cardinality(target_params) then 'invalid_values'
  end;
  if skip is not null then
    update public.flight_alerts set status = 'skipped', reason = skip, claimed_at = null where id = alert.id;
    return jsonb_build_object('ok', true, 'code', 'skipped', 'reason', skip);
  end if;

  select wc.id into conversation from public.wa_conversations wc
  where wc.number_id = sender.id and wc.contact_wa_id = any (public.wa_phone_variants(trip.phone))
  order by wc.last_inbound_at desc nulls last
  limit 1;
  if conversation is null then
    conversation := public.wa_open_conversation(alert.org_id, sender.id, trip.phone, trip.passenger_name);
  end if;

  rendered := public.notice_rendered(template.body, target_params);
  insert into public.wa_messages (
    org_id, conversation_id, number_id, direction, origin, kind, body, template_id, template_name, template_params, status
  ) values (
    alert.org_id, conversation, sender.id, 'out', 'cloud', 'template', rendered, template.id, template.name,
    to_jsonb(target_params), 'queued'
  )
  returning id into message;

  update public.wa_conversations set
    last_message_at = now(),
    last_message_preview = public.wa_preview('template', rendered),
    last_message_direction = 'out'
  where id = conversation
    and not (last_message_direction = 'in' and last_inbound_at is not null and last_inbound_at >= last_message_at);

  update public.flight_alerts set status = 'sent', message_id = message, sent_at = now(), claimed_at = null
  where id = alert.id;
  update public.tracked_trips set status = 'alerted' where id = trip.id and status = 'watching';

  insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (alert.org_id, null, 'system', 'flight_alert.sent', 'flight_alert', alert.id::text,
          jsonb_build_object('kind', alert.kind, 'test', trip.is_test));
  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message, 'conversation_id', conversation);
end;
$$;

revoke all on function public.reserve_flight_alert(uuid, integer, text[]) from public, anon, authenticated;

/**
 * The operator releases ONE's first word to real passengers, with the note
 * of the legal opinion it rests on, or takes the release back (with why).
 * The platform's operator, with the second factor, never a support visit; on
 * the record.
 */
create or replace function public.admin_set_flight_alerts_release(target_released boolean, target_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  note text := nullif(btrim(left(coalesce(target_note, ''), 1000)), '');
begin
  if not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if target_released is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_choice');
  end if;
  if note is null or char_length(note) < 10 then
    return jsonb_build_object('ok', false, 'code', 'note_required');
  end if;
  update public.platform_settings set value = value || jsonb_build_object(
    'released', target_released, 'released_at', now(), 'released_by', auth.uid(), 'released_note', note)
  where key = 'flight_alerts';
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, auth.uid(), case when target_released then 'flight_alerts.released' else 'flight_alerts.held' end,
          'platform_setting', 'flight_alerts', jsonb_build_object('note', note));
  return jsonb_build_object('ok', true, 'code', case when target_released then 'released' else 'held' end);
end;
$$;

revoke all on function public.admin_set_flight_alerts_release(boolean, text) from public, anon;
grant execute on function public.admin_set_flight_alerts_release(boolean, text) to authenticated;

/**
 * What the operator reads of the flights ONE follows: whether its first word
 * to real passengers is released (when, by whom, on what note), the reads
 * at FlightAware today against the ceiling, and how many trips it follows
 * there, real and of test chats.
 */
create or replace function public.admin_flight_watch_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  settings jsonb := coalesce((select ps.value from public.platform_settings ps where ps.key = 'flight_alerts'), '{}'::jsonb);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'released', coalesce((settings ->> 'released')::boolean, false),
    'released_at', settings ->> 'released_at',
    'released_by', (select coalesce(p.display_name, '') from public.profiles p where p.id::text = settings ->> 'released_by'),
    'released_note', settings ->> 'released_note',
    'reads_today', (select coalesce(sum(t.watch_reads), 0) from public.tracked_trips t where t.watch_day = today),
    'daily_reads', public.flight_alerts_setting('watch_daily_reads', 400),
    'following_real', (select count(*) from public.tracked_trips t
                       where t.watch = 'flightaware' and not t.is_test and t.status in ('watching', 'alerted')),
    'following_test', (select count(*) from public.tracked_trips t
                       where t.watch = 'flightaware' and t.is_test and t.status in ('watching', 'alerted')),
    'held_alerts', (select count(*) from public.flight_alerts a where a.status = 'skipped' and a.reason = 'not_released')
  );
end;
$$;

revoke all on function public.admin_flight_watch_status() from public, anon;
grant execute on function public.admin_flight_watch_status() to authenticated;

-- ---------- A real flight in the test chat ----------

/**
 * The test chat follows a real flight (its fifth trip, `voo_real`): the
 * legs the app read at FlightAware for the flight and day the tester named,
 * with the agreement of the test chat's passengers; a flight named before
 * gives way to the new one, with what was told of it. Read at FlightAware
 * as a real passenger's would be, and told in the test chat, which reaches
 * nobody. Service role, by the link's secret.
 */
create or replace function public.test_chat_follow_flight(target_token text, target_legs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chat jsonb := public.test_chat_by_token(target_token);
  org uuid;
  firm text;
  trip uuid;
  item jsonb;
  airline text;
  wording text;
begin
  if not coalesce((chat ->> 'found')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  org := (chat ->> 'org_id')::uuid;
  firm := chat ->> 'firm';
  if jsonb_typeof(target_legs) <> 'array' or jsonb_array_length(target_legs) not between 1 and 6 then
    return jsonb_build_object('ok', false, 'code', 'invalid_legs');
  end if;
  airline := left(coalesce(target_legs -> 0 ->> 'flight_number', ''), 2);
  if airline !~ '^[A-Z0-9]{2}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_legs');
  end if;
  wording := 'Concordo em receber, pelo WhatsApp do escritório ' || firm
    || ', avisos sobre a viagem que cadastrei, como atrasos e cancelamentos, e sei que posso parar quando quiser respondendo SAIR.';

  delete from public.tracked_trips t where t.org_id = org and t.is_test and t.label = 'voo_real';
  insert into public.tracked_trips (org_id, passenger_name, phone, airline_iata, is_test, label, consent_wording, consent_at,
                                    consent_channel, watch)
  values (org, 'Sofia Teste', '5500988880005', airline, true, 'voo_real', wording, now(), 'test', 'flightaware')
  returning id into trip;
  for item in select value from jsonb_array_elements(target_legs) loop
    insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                     scheduled_departure_local, scheduled_arrival_local)
    values (org, trip, (item ->> 'position')::integer, item ->> 'flight_number', item ->> 'origin', item ->> 'destination',
            (item ->> 'departure')::timestamp, (item ->> 'arrival')::timestamp);
  end loop;
  return jsonb_build_object('ok', true, 'code', 'following', 'trip_id', trip);
exception
  when check_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow
    or not_null_violation or unique_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_legs');
end;
$$;

revoke all on function public.test_chat_follow_flight(text, jsonb) from public, anon, authenticated;

/**
 * The legs of a test trip as the page's tools set them, or the trip started
 * over (0047, 0049), now keeping a real flight (`voo_real`, read at
 * FlightAware) to what its source says: its day is never moved, no tool
 * makes it happen, and started over it is read again at once. Service role,
 * by the link's secret.
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
  -- flight keeps its own.
  select min(l.scheduled_departure_local)::date into first_day from public.tracked_legs l where l.trip_id = trip.id;
  if trip.watch = 'simulated' and first_day is not null and first_day <> today then
    update public.tracked_legs set
      scheduled_departure_local = scheduled_departure_local + make_interval(days => today - first_day),
      scheduled_arrival_local = scheduled_arrival_local + make_interval(days => today - first_day)
    where trip_id = trip.id;
  end if;

  if coalesce(target_reset, false) then
    update public.tracked_legs set status = 'scheduled', estimated_arrival_local = null, status_source = null, status_at = null
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
      status := item ->> 'status';
      late := case when coalesce(item ->> 'late_minutes', '') ~ '^[0-9]{1,5}$' then (item ->> 'late_minutes')::integer end;
      if status is null or status not in ('scheduled', 'delayed', 'cancelled', 'changed', 'landed')
         or (status = 'delayed' and late is null)
         or not exists (
           select 1 from public.tracked_legs l
           where l.trip_id = trip.id and l.position::text = coalesce(item ->> 'position', '')
         ) then
        return jsonb_build_object('ok', false, 'code', 'invalid_legs');
      end if;
      update public.tracked_legs set
        status = item ->> 'status',
        estimated_arrival_local = case when late is not null then scheduled_arrival_local + make_interval(mins => late) end,
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
