-- A firm the operator marks as a test firm tests ONE with a real WhatsApp number (the owner, 2026-11-11): the
-- test chat leaves the screens, and what it gave a test stays, by a link of the firm's.
--
-- * The operator marks a firm as a test firm, with a note (`admin_set_test_firm`, the second factor, on the record).
--   The firm gets a link of its own (`test_firms.token`), which who manages it or a partner reads
--   (`firm_test_tools`) and which opens the firm's test tools, `/t/<token>`, and the test court, `/t/<token>/tribunal`.
-- * Every case of a test firm is a test case (`cases.is_test`, set before a case is written, and on every case it
--   has when it is marked), so the test court answers its lawsuits as it answered a test chat's (0061, through
--   `test_court_org`).
-- * Every trip ONE follows for a test firm is a test trip, its flights made to happen by the firm's tools and never
--   read at FlightAware (`watch` `simulated`), with a label of its own (0047 keeps a test trip's label unique in its
--   firm). Its alerts, welcome, day messages and hearing staff messages go through the firm's real number: a test
--   trip went through the test chat's number only, so the five functions that pair a trip with its number are
--   redefined here with that one change, word for word otherwise.
-- * `test_firm_set_legs` is the test chat's tools (0172) for a test firm: cancel, delay, depart, land or start over
--   a trip of the firm's.
-- * Unmarking a firm takes its link away; what was a test stays a test, as a test chat's case did (0061).

-- ---------- The firms marked as test firms ----------

create table public.test_firms (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  token text not null unique,
  note text not null,
  marked_by uuid references public.profiles (id) on delete set null,
  marked_at timestamptz not null default now(),
  constraint test_firms_token_check check (token ~ '^[A-Za-z0-9_-]{32,64}$'),
  constraint test_firms_note_check check (char_length(note) between 8 and 500)
);

-- Read by nobody's session: the link is handed out by `firm_test_tools` and `admin_test_firms`.
alter table public.test_firms enable row level security;
revoke all on table public.test_firms from public, anon, authenticated;
create trigger guard_impersonation_test_firms after insert or update or delete on public.test_firms
  for each statement execute function public.guard_impersonation_readonly();

/** Whether a firm is a test firm. Internal. */
create or replace function public.is_test_firm(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.test_firms f where f.org_id = target_org);
$$;

revoke all on function public.is_test_firm(uuid) from public, anon, authenticated;

/** A label of a test trip, unique in its firm (0047's index), of letters only as its check asks. */
create or replace function public.test_trip_label(target_trip uuid)
returns text
language sql
immutable
set search_path = public
as $$
  select 'viagem_' || translate(substr(md5(target_trip::text), 1, 16), '0123456789', 'ghijklmnop');
$$;

revoke all on function public.test_trip_label(uuid) from public, anon, authenticated;

-- ---------- What a test firm writes is a test ----------

create or replace function public.test_firm_marks_case()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.is_test and public.is_test_firm(new.org_id) then
    new.is_test := true;
  end if;
  return new;
end;
$$;

revoke all on function public.test_firm_marks_case() from public, anon, authenticated;

create trigger cases_test_firm before insert on public.cases
  for each row execute function public.test_firm_marks_case();

create or replace function public.test_firm_marks_trip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.is_test and public.is_test_firm(new.org_id) then
    new.is_test := true;
    new.label := public.test_trip_label(new.id);
    new.watch := 'simulated';
  end if;
  return new;
end;
$$;

revoke all on function public.test_firm_marks_trip() from public, anon, authenticated;

create trigger tracked_trips_test_firm before insert on public.tracked_trips
  for each row execute function public.test_firm_marks_trip();

-- ---------- The operator marks a firm ----------

create or replace function public.admin_set_test_firm(
  target_org uuid,
  target_on boolean,
  target_note text,
  target_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  note text := nullif(regexp_replace(btrim(coalesce(target_note, '')), '\s+', ' ', 'g'), '');
  cases_marked integer := 0;
  trips_marked integer := 0;
begin
  if caller is null or not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if target_on is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if note is null or char_length(note) < 8 or char_length(note) > 500 or note ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'code', 'note_required');
  end if;
  if not exists (select 1 from public.organizations o where o.id = target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if target_on then
    if coalesce(target_token, '') !~ '^[A-Za-z0-9_-]{32,64}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid');
    end if;
    insert into public.test_firms (org_id, token, note, marked_by)
    values (target_org, target_token, note, caller)
    on conflict (org_id) do update set note = excluded.note, marked_by = excluded.marked_by, marked_at = now();
    -- What the firm has is a test from now on: its cases, and the trips ONE follows for it.
    update public.cases set is_test = true where org_id = target_org and not is_test;
    get diagnostics cases_marked = row_count;
    update public.tracked_trips set
      is_test = true,
      label = public.test_trip_label(id),
      watch = 'simulated',
      watch_error = null
    where org_id = target_org and not is_test;
    get diagnostics trips_marked = row_count;
  else
    delete from public.test_firms where org_id = target_org;
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, case when target_on then 'test_firm.marked' else 'test_firm.unmarked' end,
          'organization', target_org::text,
          jsonb_build_object('note', note, 'cases_marked', cases_marked, 'trips_marked', trips_marked));

  return jsonb_build_object('ok', true, 'code', case when target_on then 'marked' else 'unmarked' end,
                            'cases_marked', cases_marked, 'trips_marked', trips_marked);
end;
$$;

revoke all on function public.admin_set_test_firm(uuid, boolean, text, text) from public, anon;
grant execute on function public.admin_set_test_firm(uuid, boolean, text, text) to authenticated;

/** The test firms, for the operator's console: each with its note, who marked it and when, and its link. */
create or replace function public.admin_test_firms()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'org_id', f.org_id, 'token', f.token, 'note', f.note, 'marked_at', f.marked_at,
      'marked_by', (select p.display_name from public.profiles p where p.id = f.marked_by)
    ) order by f.marked_at desc)
    from public.test_firms f
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_test_firms() from public, anon;
grant execute on function public.admin_test_firms() to authenticated;

/**
 * Whether the person's firm is a test firm, for anybody of it; and its link, for who manages it or a partner
 * (never a support visit), who opens the test tools and the test court with it.
 */
create or replace function public.firm_test_tools(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  firm public.test_firms%rowtype;
  keeper boolean;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into firm from public.test_firms f where f.org_id = target_org;
  if not found then
    return jsonb_build_object('test', false);
  end if;
  keeper := public.test_chat_keeper(target_org, auth.uid()) and not public.is_impersonated();
  return jsonb_build_object(
    'test', true,
    'since', firm.marked_at,
    'token', case when keeper then firm.token end,
    'real_number', exists (
      select 1 from public.wa_numbers n
      where n.org_id = target_org and n.status = 'active' and n.provider not in ('simulator', 'test')
    )
  );
end;
$$;

revoke all on function public.firm_test_tools(uuid) from public, anon;
grant execute on function public.firm_test_tools(uuid) to authenticated;

-- ---------- The firm's link: the test court and the test tools ----------

/** The firm of a test court's link: an active test chat's (0061), or a test firm's. Internal. */
create or replace function public.test_court_org(target_token text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select c.org_id
     from public.test_chats c
     join public.wa_numbers n on n.id = c.number_id and n.status = 'active'
     where coalesce(target_token, '') ~ '^[A-Za-z0-9_-]{32,64}$' and c.token = target_token and c.status = 'active'),
    (select f.org_id from public.test_firms f
     where coalesce(target_token, '') ~ '^[A-Za-z0-9_-]{32,64}$' and f.token = target_token)
  );
$$;

/** The test firm of a link, with its real number when it has one. The backend's. */
create or replace function public.test_firm_by_token(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  firm public.test_firms%rowtype;
  firm_number public.wa_numbers%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if coalesce(target_token, '') !~ '^[A-Za-z0-9_-]{32,64}$' then
    return jsonb_build_object('found', false);
  end if;
  select * into firm from public.test_firms f where f.token = target_token;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  select * into firm_number from public.wa_numbers n
  where n.org_id = firm.org_id and n.status = 'active' and n.provider not in ('simulator', 'test')
  order by n.connected_at desc nulls last, n.created_at desc
  limit 1;
  return jsonb_build_object(
    'found', true,
    'org_id', firm.org_id,
    'number_id', firm_number.id,
    'display_phone_number', firm_number.display_phone_number,
    'provider', firm_number.provider
  );
end;
$$;

revoke all on function public.test_firm_by_token(text) from public, anon, authenticated;

/**
 * The firm's test tools: its name, its real number, and the trips ONE follows for it now (the latest 40), each
 * with its legs as they stand and the end of the passenger's WhatsApp only. The backend's, by the firm's link.
 */
create or replace function public.test_firm_view(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  firm jsonb := public.test_firm_by_token(target_token);
  org uuid;
begin
  if not coalesce((firm ->> 'found')::boolean, false) then
    return jsonb_build_object('found', false);
  end if;
  org := (firm ->> 'org_id')::uuid;
  return jsonb_build_object(
    'found', true,
    'firm', (select o.name from public.organizations o where o.id = org),
    'number', case when firm ->> 'number_id' is null then null
                   else jsonb_build_object('phone', firm ->> 'display_phone_number', 'provider', firm ->> 'provider') end,
    'delay_minutes', public.flight_alerts_setting('delay_minutes', 240),
    'trips', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'passenger', t.passenger_name,
        'phone_end', right(t.phone, 4),
        'status', t.status,
        'from_agency', t.pax_trip_id is not null,
        'case_id', t.case_id,
        'created_at', t.created_at,
        'legs', coalesce((
          select jsonb_agg(jsonb_build_object(
            'position', l.position,
            'flight', l.flight_number,
            'origin', l.origin_iata,
            'destination', l.destination_iata,
            'departure', l.scheduled_departure_local,
            'arrival', l.scheduled_arrival_local,
            'status', l.status,
            'estimated_arrival', l.estimated_arrival_local,
            'departed', l.departed_local,
            'arrived', l.arrived_local
          ) order by l.position)
          from public.tracked_legs l where l.trip_id = t.id
        ), '[]'::jsonb)
      ) order by t.created_at desc)
      from (
        select * from public.tracked_trips t
        where t.org_id = org and t.is_test and t.status <> 'stopped'
        order by t.created_at desc
        limit 40
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.test_firm_view(text) from public, anon, authenticated;

-- ---------- The test tools of a test firm ----------

/**
 * Makes a test trip of a test firm's happen, or starts it over: the test chat's tools (`test_chat_set_legs`, 0172)
 * by the firm's link. A trip of an agency or of the firm keeps its own days; starting over gives its conversation
 * on the firm's real number back to ONE. The backend's.
 */
create or replace function public.test_firm_set_legs(target_token text, target_trip uuid, target_legs jsonb, target_reset boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chat jsonb := public.test_firm_by_token(target_token);
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

  -- (Copied from test_chat_set_legs of 0172.) A ready trip's flights are of today: a test run days after the chat was turned on is of its own day. A real
  -- flight keeps its own, and so does a trip an agency registered, whose days are the agency's, or one the firm
  -- registered for its own passenger (0170), whose days are the firm's.
  select min(l.scheduled_departure_local)::date into first_day from public.tracked_legs l where l.trip_id = trip.id;
  if trip.watch = 'simulated' and trip.pax_trip_id is null and trip.person_id is null
     and first_day is not null and first_day <> today then
    update public.tracked_legs set
      scheduled_departure_local = scheduled_departure_local + make_interval(days => today - first_day),
      scheduled_arrival_local = scheduled_arrival_local + make_interval(days => today - first_day),
      departed_local = departed_local + make_interval(days => today - first_day),
      arrived_local = arrived_local + make_interval(days => today - first_day)
    where trip_id = trip.id;
  end if;

  if coalesce(target_reset, false) then
    update public.tracked_legs set status = 'scheduled', estimated_arrival_local = null, status_source = null, status_at = null,
                                   departed_local = null, arrived_local = null, case_id = null
    where trip_id = trip.id;
    delete from public.flight_alerts where trip_id = trip.id;
    update public.tracked_trips set status = 'watching', case_id = null, rest_closed = false, watched_at = null, watch_error = null
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

revoke all on function public.test_firm_set_legs(text, uuid, jsonb, boolean) from public, anon, authenticated;

-- ---------- A test trip of a test firm goes through its real number ----------
-- Each function below is its latest version word for word, but for the one line that pairs the trip (or the case)
-- with the number it goes through.

-- From 0172.
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
      and (n.provider = 'test') = (trip.is_test and not public.is_test_firm(trip.org_id))
    order by n.connected_at
    limit 1;
  end if;

  skip := case
    when not public.trip_still_followed(trip.id) then 'trip_closed'
    when trip.status = 'case_opened' and (alert.legs is null or exists (
      select 1 from public.tracked_legs l
      where l.trip_id = trip.id and l.position = any (alert.legs) and l.case_id is not null
    )) then 'trip_closed'
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

-- From 0173.
create or replace function public.reserve_trip_day_message(
  target_trip uuid,
  target_journey integer,
  target_kind text,
  target_params text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  trip public.tracked_trips%rowtype;
  notice_kind text := case target_kind when 'departure' then 'trip_departure' when 'arrival' then 'trip_arrival' end;
  notice public.notice_kinds%rowtype;
  template public.wa_templates%rowtype;
  sender public.wa_numbers%rowtype;
  conversation uuid;
  message uuid;
  rendered text;
  skip text;
  row_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if notice_kind is null or target_journey is null or target_journey not between 1 and 20 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  select * into trip from public.tracked_trips t where t.id = target_trip for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if exists (select 1 from public.trip_day_messages m
             where m.trip_id = trip.id and m.journey = target_journey and m.kind = target_kind) then
    return jsonb_build_object('ok', true, 'code', 'already');
  end if;
  select * into notice from public.notice_kinds k where k.kind = notice_kind;
  select t.* into template from public.wa_templates t
  join public.firm_notice_kinds k on k.template_id = t.id
  where k.org_id = trip.org_id and k.kind = notice_kind and k.enabled
    and t.status = 'approved' and t.category = 'utility';
  if found then
    select n.* into sender from public.wa_numbers n
    join public.connections cn on cn.id = n.connection_id and cn.status = 'connected'
    where n.org_id = trip.org_id and n.waba_id = template.waba_id and n.status = 'active'
      and (n.provider = 'test') = (trip.is_test and not public.is_test_firm(trip.org_id))
    order by n.connected_at
    limit 1;
  end if;

  skip := case
    when not public.trip_still_followed(trip.id) then 'trip_closed'
    when exists (select 1 from public.flight_alerts a
                 where a.trip_id = trip.id and a.journey = target_journey and a.status = 'sent') then 'problem_told'
    when not trip.is_test and not public.flight_alerts_released() then 'not_released'
    when trip.consent_at is null then 'no_consent'
    when exists (
      select 1 from public.wa_optouts o
      where o.org_id = trip.org_id and o.contact_wa_id = any (public.wa_phone_variants(trip.phone))
    ) then 'opted_out'
    when template.id is null then 'no_template'
    when sender.id is null then 'no_number'
    when target_params is null or cardinality(target_params) <> cardinality(notice.params)
         or template.param_count <> cardinality(target_params)
         or array_position(target_params, null) is not null
         or exists (select 1 from unnest(target_params) as v(value)
                    where public.notice_value(v.value) is null or public.notice_value(v.value) <> v.value)
      then 'invalid_values'
  end;
  if skip is not null then
    insert into public.trip_day_messages (org_id, trip_id, journey, kind, status, reason)
    values (trip.org_id, trip.id, target_journey, target_kind, 'skipped', skip)
    on conflict (trip_id, journey, kind) do nothing;
    return jsonb_build_object('ok', true, 'code', 'skipped', 'reason', skip);
  end if;

  select wc.id into conversation from public.wa_conversations wc
  where wc.number_id = sender.id and wc.contact_wa_id = any (public.wa_phone_variants(trip.phone))
  order by wc.last_inbound_at desc nulls last
  limit 1;
  if conversation is null then
    conversation := public.wa_open_conversation(trip.org_id, sender.id, trip.phone, trip.passenger_name);
  end if;

  rendered := public.notice_rendered(template.body, target_params);
  insert into public.wa_messages (
    org_id, conversation_id, number_id, direction, origin, kind, body, template_id, template_name, template_params, status
  ) values (
    trip.org_id, conversation, sender.id, 'out', 'cloud', 'template', rendered, template.id, template.name,
    to_jsonb(target_params), 'queued'
  )
  returning id into message;
  update public.wa_conversations set
    last_message_at = now(),
    last_message_preview = public.wa_preview('template', rendered),
    last_message_direction = 'out'
  where id = conversation
    and not (last_message_direction = 'in' and last_inbound_at is not null and last_inbound_at >= last_message_at);

  insert into public.trip_day_messages (org_id, trip_id, journey, kind, status, message_id)
  values (trip.org_id, trip.id, target_journey, target_kind, 'sent', message)
  returning id into row_id;
  insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (trip.org_id, null, 'system', 'trip_day.' || target_kind, 'tracked_trip', trip.id::text,
          jsonb_build_object('journey', target_journey, 'test', trip.is_test));
  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message, 'conversation_id', conversation);
end;
$$;

-- From 0174.
create or replace function public.reserve_passenger_welcome(target_trip uuid, target_params text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  trip public.tracked_trips%rowtype;
  notice public.notice_kinds%rowtype;
  template public.wa_templates%rowtype;
  sender public.wa_numbers%rowtype;
  conversation uuid;
  message uuid;
  rendered text;
  skip text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into trip from public.tracked_trips t where t.id = target_trip for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  -- One firm's welcomes of a WhatsApp are written one at a time.
  perform pg_advisory_xact_lock(hashtextextended('welcome:' || trip.org_id::text || ':' || right(trip.phone, 8), 0));
  if exists (select 1 from public.passenger_welcomes w
             where w.org_id = trip.org_id and w.phone = any (public.wa_phone_variants(trip.phone))) then
    return jsonb_build_object('ok', true, 'code', 'already');
  end if;
  select * into notice from public.notice_kinds k where k.kind = 'welcome';
  select t.* into template from public.wa_templates t
  join public.firm_notice_kinds k on k.template_id = t.id
  where k.org_id = trip.org_id and k.kind = 'welcome' and k.enabled
    and t.status = 'approved' and t.category = 'utility';
  if found then
    select n.* into sender from public.wa_numbers n
    join public.connections cn on cn.id = n.connection_id and cn.status = 'connected'
    where n.org_id = trip.org_id and n.waba_id = template.waba_id and n.status = 'active'
      and (n.provider = 'test') = (trip.is_test and not public.is_test_firm(trip.org_id))
    order by n.connected_at
    limit 1;
  end if;

  skip := case
    when trip.status not in ('watching', 'alerted') then 'trip_closed'
    when not trip.is_test and not public.flight_alerts_released() then 'not_released'
    when trip.consent_at is null then 'no_consent'
    when exists (
      select 1 from public.wa_optouts o
      where o.org_id = trip.org_id and o.contact_wa_id = any (public.wa_phone_variants(trip.phone))
    ) then 'opted_out'
    when template.id is null then 'no_template'
    when sender.id is null then 'no_number'
    when target_params is null or cardinality(target_params) <> cardinality(notice.params)
         or template.param_count <> cardinality(target_params)
         or array_position(target_params, null) is not null
         or exists (select 1 from unnest(target_params) as v(value)
                    where public.notice_value(v.value) is null or public.notice_value(v.value) <> v.value)
      then 'invalid_values'
  end;
  if skip is not null then
    -- A trip that closed, or a release not given yet, may still be welcomed by a later trip: only what the
    -- passenger or the firm decided is kept for good.
    if skip in ('opted_out', 'no_template', 'no_number', 'invalid_values') then
      insert into public.passenger_welcomes (org_id, phone, trip_id, status, reason)
      values (trip.org_id, trip.phone, trip.id, 'skipped', skip)
      on conflict (org_id, phone) do nothing;
    end if;
    return jsonb_build_object('ok', true, 'code', 'skipped', 'reason', skip);
  end if;

  select wc.id into conversation from public.wa_conversations wc
  where wc.number_id = sender.id and wc.contact_wa_id = any (public.wa_phone_variants(trip.phone))
  order by wc.last_inbound_at desc nulls last
  limit 1;
  if conversation is null then
    conversation := public.wa_open_conversation(trip.org_id, sender.id, trip.phone, trip.passenger_name);
  end if;

  rendered := public.notice_rendered(template.body, target_params);
  insert into public.wa_messages (
    org_id, conversation_id, number_id, direction, origin, kind, body, template_id, template_name, template_params, status
  ) values (
    trip.org_id, conversation, sender.id, 'out', 'cloud', 'template', rendered, template.id, template.name,
    to_jsonb(target_params), 'queued'
  )
  returning id into message;
  update public.wa_conversations set
    last_message_at = now(),
    last_message_preview = public.wa_preview('template', rendered),
    last_message_direction = 'out'
  where id = conversation
    and not (last_message_direction = 'in' and last_inbound_at is not null and last_inbound_at >= last_message_at);

  insert into public.passenger_welcomes (org_id, phone, trip_id, status, message_id)
  values (trip.org_id, trip.phone, trip.id, 'sent', message);
  insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (trip.org_id, null, 'system', 'passenger.welcomed', 'tracked_trip', trip.id::text,
          jsonb_build_object('test', trip.is_test));
  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message, 'conversation_id', conversation);
end;
$$;

-- From 0188.
create or replace function public.reserve_hearing_staff_message(target_hearing uuid, target_kind text, target_params text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hearing public.hearings%rowtype;
  current_case public.cases%rowtype;
  notice public.notice_kinds%rowtype;
  template public.wa_templates%rowtype;
  sender public.wa_numbers%rowtype;
  phone text;
  conversation uuid;
  message uuid;
  rendered text;
  skip text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_kind not in ('hearing_brief', 'hearing_result') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  select * into hearing from public.hearings where id = target_hearing for update;
  if not found or hearing.case_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if exists (select 1 from public.hearing_staff_messages s where s.hearing_id = hearing.id and s.kind = target_kind) then
    return jsonb_build_object('ok', true, 'code', 'already');
  end if;
  select * into current_case from public.cases where id = hearing.case_id;
  phone := public.hearing_staff_phone(hearing.id);
  select * into notice from public.notice_kinds k where k.kind = target_kind;
  select t.* into template from public.wa_templates t
  join public.firm_notice_kinds k on k.template_id = t.id
  where k.org_id = hearing.org_id and k.kind = target_kind and k.enabled
    and t.status = 'approved' and t.category = 'utility';
  if found then
    select n.* into sender from public.wa_numbers n
    join public.connections cn on cn.id = n.connection_id and cn.status = 'connected'
    where n.org_id = hearing.org_id and n.waba_id = template.waba_id and n.status = 'active'
      and (n.provider = 'test') = (coalesce(current_case.is_test, false) and not public.is_test_firm(current_case.org_id))
    order by n.connected_at
    limit 1;
  end if;

  skip := case
    when hearing.status <> 'scheduled' then 'not_scheduled'
    when phone is null then 'no_phone'
    when exists (
      select 1 from public.wa_optouts o
      where o.org_id = hearing.org_id and o.contact_wa_id = any (public.wa_phone_variants(phone))
    ) then 'opted_out'
    when template.id is null then 'no_template'
    when sender.id is null then 'no_number'
    when target_params is null or cardinality(target_params) <> cardinality(notice.params)
         or template.param_count <> cardinality(target_params)
         or array_position(target_params, null) is not null
         or exists (select 1 from unnest(target_params) as v(value)
                    where public.notice_value(v.value) is null or public.notice_value(v.value) <> v.value)
      then 'invalid_values'
  end;
  if skip is not null then
    insert into public.hearing_staff_messages (org_id, hearing_id, kind, phone, status, reason)
    values (hearing.org_id, hearing.id, target_kind, phone, 'skipped', skip)
    on conflict (hearing_id, kind) do nothing;
    return jsonb_build_object('ok', true, 'code', 'skipped', 'reason', skip);
  end if;

  select wc.id into conversation from public.wa_conversations wc
  where wc.number_id = sender.id and wc.contact_wa_id = any (public.wa_phone_variants(phone))
  order by wc.last_inbound_at desc nulls last
  limit 1;
  if conversation is null then
    conversation := public.wa_open_conversation(hearing.org_id, sender.id, phone, null);
  end if;

  rendered := public.notice_rendered(template.body, target_params);
  insert into public.wa_messages (
    org_id, conversation_id, number_id, direction, origin, kind, body, template_id, template_name, template_params, status
  ) values (
    hearing.org_id, conversation, sender.id, 'out', 'cloud', 'template', rendered, template.id, template.name,
    to_jsonb(target_params), 'queued'
  )
  returning id into message;
  update public.wa_conversations set
    last_message_at = now(),
    last_message_preview = public.wa_preview('template', rendered),
    last_message_direction = 'out'
  where id = conversation
    and not (last_message_direction = 'in' and last_inbound_at is not null and last_inbound_at >= last_message_at);

  insert into public.hearing_staff_messages (org_id, hearing_id, kind, phone, status, message_id)
  values (hearing.org_id, hearing.id, target_kind, phone, 'sent', message);
  perform public.record_case_event(hearing.org_id, hearing.case_id,
    case target_kind when 'hearing_brief' then 'hearing_brief_sent' else 'hearing_result_asked' end, 'system',
    jsonb_build_object('hearing', hearing.id));
  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message, 'conversation_id', conversation);
end;
$$;

-- From 0048.
create or replace function public.conversation_pending_alert(target_conversation uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.id from public.wa_conversations c
  join public.wa_numbers n on n.id = c.number_id
  join public.tracked_trips t on t.org_id = c.org_id and t.phone = any (public.wa_phone_variants(c.contact_wa_id))
    and (t.is_test and not public.is_test_firm(t.org_id)) = (n.provider = 'test')
  join public.flight_alerts a on a.trip_id = t.id and a.status = 'sent' and a.answer is null
  where c.id = target_conversation
  order by a.sent_at desc nulls last, a.created_at desc
  limit 1;
$$;
