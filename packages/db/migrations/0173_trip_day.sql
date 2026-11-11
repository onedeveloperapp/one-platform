-- ============================================================
-- The day of the trip (0173), item 2.6 of the case journey plan, from the
-- owner's passenger flow of 2026-11-10: ONE writes to the passenger of a
-- trip it follows about two hours before each journey leaves, wishing a good
-- trip and saying the firm follows it, and half an hour after it lands,
-- asking whether all went well. Each goes once per journey, as the firm's
-- template of its notice kind (`trip_departure`, `trip_arrival`), under the
-- rules of ONE's first word (0047, 0051): the passenger's agreement, never to
-- who asked to stop, a real passenger only once the platform released its
-- alerts, the firm's number of the trip's kind. A journey whose problem the
-- passenger was told of is written nothing more of that day: the alert says
-- what matters.
--
-- When each goes is the app's to decide, from the legs' moments at their own
-- airports (`trip_day_trips`); what may go is the database's
-- (`reserve_trip_day_message`), which keeps each answer, sent or skipped
-- with why, so a journey is never written twice (`trip_day_messages`).
-- ============================================================

alter table public.notice_kinds drop constraint notice_kinds_kind_check;
alter table public.notice_kinds add constraint notice_kinds_kind_check check (kind in (
  'hearing_reminder', 'hearing_change', 'lawsuit_update', 'payment_alert', 'document_refused', 'flight_problem',
  'case_received', 'lawsuit_filed', 'case_questions', 'trip_departure', 'trip_arrival'
));

insert into public.notice_kinds (kind, position, template_base, body, footer, params, examples) values
  ('trip_departure', 10, 'one_boa_viagem',
   'Olá, {{1}}. Aqui é o assistente automático do escritório {{2}}. Boa viagem. O seu voo {{3}} sai em cerca de duas horas. O escritório acompanha o voo e avisa você por aqui se ele for cancelado, mudar ou atrasar.',
   'Para não receber estes avisos, responda SAIR.',
   array['first_name', 'firm', 'flight'],
   array['Mariana', 'Souza Advogados', 'LA 3456 de Goiânia (GYN) para São Paulo (GRU), de 22/10/2099']),
  ('trip_arrival', 11, 'one_chegada',
   'Olá, {{1}}. Aqui é o assistente automático do escritório {{2}}. O seu voo {{3}} já deve ter chegado. Correu tudo bem? Se algo deu errado, como um atraso, uma conexão perdida ou um problema com a bagagem, responda contando o que aconteceu.',
   'Para não receber estes avisos, responda SAIR.',
   array['first_name', 'firm', 'flight'],
   array['Mariana', 'Souza Advogados', 'LA 3456 de Goiânia (GYN) para São Paulo (GRU), de 22/10/2099'])
on conflict (kind) do nothing;

-- The test chats on now get the new kinds too (0055).
do $$
declare
  chat record;
begin
  for chat in select c.org_id, c.number_id from public.test_chats c where c.status = 'active' loop
    perform public.test_chat_templates(chat.org_id, chat.number_id);
  end loop;
end;
$$;

create table public.trip_day_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  trip_id uuid not null,
  journey integer not null,
  kind text not null,
  status text not null,
  reason text,
  message_id uuid references public.wa_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (trip_id, journey, kind),
  foreign key (trip_id, org_id) references public.tracked_trips (id, org_id) on delete cascade,
  constraint trip_day_messages_kind_check check (kind in ('departure', 'arrival')),
  constraint trip_day_messages_status_check check (status in ('sent', 'skipped')),
  constraint trip_day_messages_journey_check check (journey between 1 and 20),
  constraint trip_day_messages_reason_check check ((status = 'skipped') = (reason is not null)
    and (reason is null or reason ~ '^[a-z][a-z_]{2,40}$'))
);

alter table public.trip_day_messages enable row level security;
-- The firm reads what was written of a trip it reads (an agency's trip only once it became a case, 0070).
create policy "trip_day_messages_select_member" on public.trip_day_messages
  for select to authenticated
  using (public.is_org_member(org_id) and exists (select 1 from public.tracked_trips t where t.id = trip_id));
grant select on table public.trip_day_messages to authenticated;
create trigger guard_impersonation_trip_day_messages after insert or update or delete on public.trip_day_messages
  for each statement execute function public.guard_impersonation_readonly();

/** A leg's local moment at its airport, as an instant: the airport's offset, Brasília's where it is not known. */
create or replace function public.leg_instant(local timestamp, airport text)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select (local - make_interval(mins => coalesce(
    (select a.utc_offset_minutes from public.airports a where a.iata = airport), -180))) at time zone 'UTC';
$$;

revoke all on function public.leg_instant(timestamp, text) from public, anon, authenticated;

/**
 * The trips whose day may owe a word now (0173): followed (0172's rule), with a leg leaving in the next hours or
 * landed in the last ones, each leg with its moments as instants and as its airports say them, the passenger, the
 * firm and what was written of the trip already. The app decides which journey owes what. One trip named is read
 * whatever its hours (the test chat, where the tester makes a leg leave or land). Service role.
 */
create or replace function public.trip_day_trips(target_limit integer default 50, target_trip uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'trip_id', t.id,
      'test', t.is_test,
      'passenger_name', t.passenger_name,
      'firm', (select o.name from public.organizations o where o.id = t.org_id),
      'legs', (
        select jsonb_agg(jsonb_build_object(
          'position', l.position, 'flight_number', l.flight_number,
          'origin', l.origin_iata, 'destination', l.destination_iata,
          'origin_city', (select a.city from public.airports a where a.iata = l.origin_iata),
          'destination_city', (select a.city from public.airports a where a.iata = l.destination_iata),
          'departure', to_char(l.scheduled_departure_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
          'arrival', to_char(l.scheduled_arrival_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
          'status', l.status,
          'estimated_arrival', to_char(l.estimated_arrival_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
          'departure_at', public.leg_instant(l.scheduled_departure_local, l.origin_iata),
          'arrival_at', public.leg_instant(coalesce(l.arrived_local, l.estimated_arrival_local, l.scheduled_arrival_local),
                                           l.destination_iata),
          'case_id', l.case_id
        ) order by l.position)
        from public.tracked_legs l where l.trip_id = t.id
      ),
      'written', coalesce((
        select jsonb_agg(jsonb_build_object('journey', m.journey, 'kind', m.kind))
        from public.trip_day_messages m where m.trip_id = t.id
      ), '[]'::jsonb),
      'alerted', coalesce((
        select jsonb_agg(distinct a.journey) from public.flight_alerts a where a.trip_id = t.id and a.status = 'sent'
      ), '[]'::jsonb)
    ))
    from (
      select t.* from public.tracked_trips t
      where public.trip_still_followed(t.id)
        and t.consent_at is not null
        and (target_trip is null or t.id = target_trip)
        and (target_trip is not null or exists (
          select 1 from public.tracked_legs l
          where l.trip_id = t.id and l.case_id is null and (
            public.leg_instant(l.scheduled_departure_local, l.origin_iata) between now() and now() + interval '2 hours 30 minutes'
            or public.leg_instant(coalesce(l.arrived_local, l.estimated_arrival_local, l.scheduled_arrival_local), l.destination_iata)
               between now() - interval '3 hours' and now()
          )
        ))
      order by t.id
      limit greatest(least(coalesce(target_limit, 50), 200), 1)
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.trip_day_trips(integer, uuid) from public, anon, authenticated;

/**
 * Writes the word of a journey's day (0173), once: the firm's template of its kind, approved and on, from the firm's
 * number of the trip's kind, to a passenger who agreed and never asked to stop, a real one only once the platform
 * released its alerts, and never of a journey whose problem the passenger was told of. What cannot go is kept as
 * skipped with why, so it is never tried again. Answers the message queued, for the outbox. Service role.
 */
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
      and (n.provider = 'test') = trip.is_test
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

revoke all on function public.reserve_trip_day_message(uuid, integer, text, text[]) from public, anon, authenticated;
