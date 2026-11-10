-- ============================================================
-- 0170_firm_passengers: the firm registers its own passengers (the case
-- journey plan, item 2.2).
--
-- A passenger of the firm's own is a person of the firm (`people`), and the
-- trip ONE follows of them is a followed trip (`tracked_trips.person_id`), as
-- an agency's passenger's is: the same reading of the flight, the same alert,
-- the same yes. Registering starts from the documents: ONE reads the identity
-- and the ticket (`caso.documento.leitura`, 0085) into the person and the
-- trip, and the documents stay with the trip (`tracked_trip_documents`) until
-- the yes opens the case, which takes them (and the person) as they are: the
-- client is asked for nothing the firm already has.
--
-- The passenger's agreement to be followed and told of a problem is recorded
-- by the firm (the channel `firm` of the followed trips, 0047), in the
-- platform's words (`platform_settings` `firm_trip_consent`) and how it was
-- given; ONE's first word to a real passenger still waits for the platform's
-- release (0051). A trip at a test chat's number is the test chat's (label
-- `escritorio`, one per firm, a new one taking its place), made to happen by
-- its tools, its days the firm's.
--
-- `firm_save_person` writes a person with no case (any person of the firm,
-- never a support visit; a CPF the firm has is that person's, answered with
-- them); `firm_follow_trip` follows a trip of a person of the firm;
-- `firm_stop_trip` stops it. A followed trip with no case makes its person a
-- lead (`people_funnel`, 0148).
-- ============================================================

alter table public.tracked_trips add column person_id uuid;
alter table public.tracked_trips add constraint tracked_trips_person_fk
  foreign key (person_id, org_id) references public.people (id, org_id) on delete set null (person_id);
create index tracked_trips_person_idx on public.tracked_trips (person_id) where person_id is not null;

create table public.tracked_trip_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  trip_id uuid not null,
  file_id uuid not null,
  kind text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (trip_id, file_id),
  foreign key (trip_id, org_id) references public.tracked_trips (id, org_id) on delete cascade,
  foreign key (file_id, org_id) references public.files (id, org_id) on delete cascade,
  constraint tracked_trip_documents_kind_check check (kind in ('identity', 'address_proof', 'ticket', 'boarding_pass'))
);
create index tracked_trip_documents_file_idx on public.tracked_trip_documents (file_id);

alter table public.tracked_trip_documents enable row level security;
create policy "tracked_trip_documents_select_member" on public.tracked_trip_documents
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.tracked_trip_documents to authenticated;
create trigger guard_impersonation_tracked_trip_documents after insert or update or delete on public.tracked_trip_documents
  for each statement execute function public.guard_impersonation_readonly();

insert into public.platform_settings (key, value, is_public)
values ('firm_trip_consent', jsonb_build_object(
  'version', '2026-11-10',
  'text', 'O passageiro concordou que o escritório acompanhe os voos desta viagem e o avise pelo WhatsApp se houver cancelamento, alteração ou atraso, com o que a companhia deve a ele.'
), true)
on conflict (key) do nothing;

/** How a passenger's agreement given to the firm is said, as the firm records it. */
create or replace function public.firm_trip_consent_how(value text)
returns boolean
language sql
immutable
as $$
  select value in ('telefone', 'whatsapp', 'presencial', 'email', 'contrato');
$$;

revoke all on function public.firm_trip_consent_how(text) from public, anon, authenticated;

/**
 * A person of the firm writes a person with no case (0170): the fields of
 * `apply_person_fields`, the full name required. A CPF the firm already has is
 * that person's: nothing is written, and the answer names them. Never a
 * support visit; on the record.
 */
create or replace function public.firm_save_person(target_org uuid, target_fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  fields jsonb := coalesce(target_fields, '{}'::jsonb);
  name text := left(regexp_replace(btrim(coalesce(target_fields ->> 'full_name', '')), '\s+', ' ', 'g'), 200);
  cpf_digits text := nullif(regexp_replace(coalesce(target_fields ->> 'cpf', ''), '\D', '', 'g'), '');
  existing uuid;
  person uuid;
  applied jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if jsonb_typeof(fields) <> 'object' or char_length(name) < 3 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'full_name');
  end if;
  if cpf_digits is not null then
    select p.id into existing from public.people p where p.org_id = target_org and p.cpf = cpf_digits;
    if existing is not null then
      return jsonb_build_object('ok', false, 'code', 'cpf_taken', 'person_id', existing);
    end if;
  end if;
  insert into public.people (org_id, full_name) values (target_org, name) returning id into person;
  applied := public.apply_person_fields(person, fields - 'full_name', 'firm');
  if not coalesce((applied ->> 'ok')::boolean, false) then
    raise exception using errcode = 'P0001', message = coalesce(applied ->> 'field', 'person');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'person.created', 'person', person::text, jsonb_build_object('from', 'firm'));
  return jsonb_build_object('ok', true, 'code', 'created', 'person_id', person);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', sqlerrm);
end;
$$;

revoke all on function public.firm_save_person(uuid, jsonb) from public, anon;
grant execute on function public.firm_save_person(uuid, jsonb) to authenticated;

/**
 * A person of the firm has ONE follow a trip of a person of the firm (0170):
 * its legs (one to six, each a flight, two airports, its scheduled times in
 * local time, the last arrival not past by more than a day), the way the
 * passenger agreed, and the documents the person sent for it (their own
 * uploads, kept with the trip until a case takes them). The passenger needs a
 * WhatsApp, and never one that asked the firm to stop. A trip at a test
 * chat's number is the test chat's. Never a support visit; on the record.
 */
create or replace function public.firm_follow_trip(
  target_person uuid,
  target_legs jsonb,
  target_how text,
  target_documents jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  person public.people%rowtype;
  leg jsonb;
  position_now integer := 0;
  flight text;
  origin text;
  destination text;
  departs timestamp;
  arrives timestamp;
  last_arrival timestamp;
  first_flight text;
  testing boolean;
  test_label text;
  wording text;
  new_trip uuid;
  item jsonb;
  kept integer := 0;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into person from public.people where id = target_person;
  if not found or not public.is_org_member(person.org_id) or person.erased_at is not null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if person.phone is null or person.phone !~ '^[0-9]{12,15}$' then
    return jsonb_build_object('ok', false, 'code', 'no_phone', 'field', 'phone');
  end if;
  if not public.firm_trip_consent_how(target_how) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'how');
  end if;
  if exists (
    select 1 from public.wa_optouts o
    where o.org_id = person.org_id and o.contact_wa_id = any (public.wa_phone_variants(person.phone))
  ) then
    return jsonb_build_object('ok', false, 'code', 'opted_out');
  end if;
  if jsonb_typeof(target_legs) <> 'array' or jsonb_array_length(target_legs) not between 1 and 6 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'legs');
  end if;
  for leg in select value from jsonb_array_elements(target_legs) loop
    position_now := position_now + 1;
    flight := upper(regexp_replace(coalesce(leg ->> 'flight_number', ''), '\s', '', 'g'));
    origin := upper(btrim(coalesce(leg ->> 'origin_iata', '')));
    destination := upper(btrim(coalesce(leg ->> 'destination_iata', '')));
    begin
      departs := (leg ->> 'scheduled_departure_local')::timestamp;
      arrives := (leg ->> 'scheduled_arrival_local')::timestamp;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'legs', 'leg', position_now);
    end;
    if flight !~ '^[A-Z0-9]{2}[0-9]{1,4}[A-Z]?$' or origin !~ '^[A-Z]{3}$' or destination !~ '^[A-Z]{3}$'
       or origin = destination or departs is null or arrives is null or arrives <= departs
       or arrives - departs > interval '30 hours'
       or not exists (select 1 from public.airports a where a.iata = origin)
       or not exists (select 1 from public.airports a where a.iata = destination)
       or (last_arrival is not null and departs < last_arrival) then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'legs', 'leg', position_now);
    end if;
    first_flight := coalesce(first_flight, flight);
    last_arrival := arrives;
  end loop;
  -- A trip long past is nothing to follow.
  if last_arrival < (now() at time zone 'America/Sao_Paulo') - interval '1 day' then
    return jsonb_build_object('ok', false, 'code', 'trip_past', 'field', 'legs');
  end if;
  if jsonb_typeof(coalesce(target_documents, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'documents');
  end if;

  testing := person.phone ~ '^550098888000[0-9]$'
    and exists (select 1 from public.test_chats c where c.org_id = person.org_id and c.status = 'active');
  test_label := case when testing then 'escritorio' end;
  if testing then
    delete from public.tracked_trips t where t.org_id = person.org_id and t.is_test and t.label = test_label;
  end if;
  wording := coalesce((select s.value ->> 'text' from public.platform_settings s where s.key = 'firm_trip_consent'),
    'O passageiro concordou que o escritório acompanhe os voos desta viagem e o avise pelo WhatsApp se houver um problema.')
    || ' Registrado pelo escritório: ' || target_how || '.';
  insert into public.tracked_trips (org_id, passenger_name, phone, airline_iata, is_test, label,
                                    consent_wording, consent_at, consent_channel, status, watch, person_id)
  values (person.org_id, left(person.full_name, 200), person.phone,
          (select a.iata from public.airlines a where a.iata = left(first_flight, 2)),
          testing, test_label, wording, now(), 'firm', 'watching',
          case when testing then 'simulated' else 'flightaware' end, person.id)
  returning id into new_trip;
  insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata,
                                   scheduled_departure_local, scheduled_arrival_local)
  select person.org_id, new_trip, l.ordinality::integer,
         upper(regexp_replace(l.value ->> 'flight_number', '\s', '', 'g')),
         upper(btrim(l.value ->> 'origin_iata')), upper(btrim(l.value ->> 'destination_iata')),
         (l.value ->> 'scheduled_departure_local')::timestamp, (l.value ->> 'scheduled_arrival_local')::timestamp
  from jsonb_array_elements(target_legs) with ordinality as l (value, ordinality);

  -- The documents the person sent for it: their own uploads of this firm, kept with the trip.
  for item in select value from jsonb_array_elements(coalesce(target_documents, '[]'::jsonb)) loop
    if coalesce(item ->> 'kind', '') in ('identity', 'address_proof', 'ticket', 'boarding_pass')
       and coalesce(item ->> 'file_id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and exists (
         select 1 from public.files f
         where f.id = (item ->> 'file_id')::uuid and f.org_id = person.org_id and f.purpose = 'upload'
           and f.status = 'stored' and f.uploaded_by = auth.uid()
       ) then
      insert into public.tracked_trip_documents (org_id, trip_id, file_id, kind, created_by)
      values (person.org_id, new_trip, (item ->> 'file_id')::uuid, item ->> 'kind', auth.uid())
      on conflict (trip_id, file_id) do nothing;
      kept := kept + 1;
    end if;
  end loop;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (person.org_id, auth.uid(), 'trip.followed', 'tracked_trip', new_trip::text,
    jsonb_build_object('person', person.id, 'legs', jsonb_array_length(target_legs), 'how', target_how,
      'documents', kept, 'test', testing));
  return jsonb_build_object('ok', true, 'code', 'followed', 'trip_id', new_trip, 'test', testing);
end;
$$;

revoke all on function public.firm_follow_trip(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.firm_follow_trip(uuid, jsonb, text, jsonb) to authenticated;

/** A person of the firm stops ONE following a trip of a person of the firm (0170). Never a support visit. */
create or replace function public.firm_stop_trip(target_trip uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  trip public.tracked_trips%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into trip from public.tracked_trips where id = target_trip for update;
  if not found or trip.person_id is null or not public.is_org_member(trip.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if trip.status not in ('watching', 'alerted') then
    return jsonb_build_object('ok', true, 'code', 'stopped_before');
  end if;
  update public.tracked_trips set status = 'stopped' where id = trip.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (trip.org_id, auth.uid(), 'trip.stopped', 'tracked_trip', trip.id::text, jsonb_build_object('person', trip.person_id));
  return jsonb_build_object('ok', true, 'code', 'stopped');
end;
$$;

revoke all on function public.firm_stop_trip(uuid) from public, anon;
grant execute on function public.firm_stop_trip(uuid) to authenticated;

-- ---------- The yes takes the firm's person and documents ----------

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
  kept_documents jsonb := '[]'::jsonb;
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
  -- A passenger the firm registered itself (0170) is the firm's person already: no second record of them.
  if person is null and trip.person_id is not null and exists (
    select 1 from public.people p where p.id = trip.person_id and p.org_id = conversation.org_id and p.erased_at is null
  ) then
    person := trip.person_id;
  end if;
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
  -- The documents the firm kept with the trip (0170) are the case's now, each of its kind and person: ONE checks
  -- them as any document that arrives, and the client is not asked for them again.
  with moved as (
    insert into public.case_documents (org_id, case_id, file_id, kind, source, status, party_id)
    select conversation.org_id, new_case, d.file_id, d.kind, 'firm', 'received',
           case when d.kind in ('identity', 'address_proof') then party end
    from public.tracked_trip_documents d
    where d.trip_id = trip.id
    returning id
  )
  select coalesce(jsonb_agg(to_jsonb(moved.id)), '[]'::jsonb) into kept_documents from moved;
  delete from public.tracked_trip_documents where trip_id = trip.id;
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
                            'documents', coalesce(handoff -> 'documents', '[]'::jsonb) || kept_documents);
exception when sqlstate 'P0001' then
  perform set_config('one.system_case', '', true);
  return jsonb_build_object('ok', false, 'code', sqlerrm);
end;
$$;

revoke all on function public.one_open_case_from_alert(uuid, integer, uuid, text, text) from public, anon, authenticated;

-- ---------- A trip's documents are in use ----------

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
     or exists (select 1 from public.case_costs c where c.file_id = file.id)
     -- The document of a bill or an entry of the books (0140).
     or exists (select 1 from public.finance_bills b where b.file_id = file.id)
     or exists (select 1 from public.finance_entries e where e.file_id = file.id)
     -- A document of a trip of a person the firm registered, before any case (0170).
     or exists (select 1 from public.tracked_trip_documents d where d.file_id = file.id) then
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

-- ---------- A followed trip makes a lead ----------

create or replace function public.people_funnel(target_org uuid)
returns table (person_id uuid, point text, reasons text[])
language sql
stable
security definer
set search_path = public
as $$
  with cut as materialized (
    select not public.firm_has_real_case(target_org) as tests
  ), cases_of as materialized (
    select cp.person_id, c.id as case_id, c.status, c.qualification, c.qualification_released_at
    from public.case_parties cp
    join public.cases c on c.id = cp.case_id
    cross join cut
    where c.org_id = target_org and cp.role in ('claimant', 'guardian') and (cut.tests or not c.is_test)
  ), signed as materialized (
    select distinct co.person_id
    from cases_of co
    join public.case_closings(target_org) cl on cl.case_id = co.case_id
    where cl.signed_at is not null
    union
    select distinct co.person_id
    from cases_of co
    join public.proceedings p on p.case_id = co.case_id
    where p.status in ('filed', 'closed')
  ), held as materialized (
    -- A case the rule did not qualify, nobody having gone on with it, is no lead.
    select co.person_id, co.case_id, co.qualification -> 'reasons' as reasons
    from cases_of co
    where co.qualification ->> 'outcome' = 'not_qualified' and co.qualification_released_at is null
  ), going as materialized (
    select distinct co.person_id
    from cases_of co
    where co.status not in ('closed', 'declined')
      and not exists (select 1 from held h where h.case_id = co.case_id)
  ), refused_alerts as materialized (
    select a.person_id, a.qualification -> 'reasons' as reasons
    from public.flight_alerts a
    where a.org_id = target_org and a.person_id is not null and a.qualification ->> 'outcome' = 'not_qualified'
  ), followed as materialized (
    -- A passenger the firm registered and whose trip ONE follows with their agreement (0170), and no case yet.
    select distinct t.person_id
    from public.tracked_trips t
    cross join cut
    where t.org_id = target_org and t.person_id is not null and t.status in ('watching', 'alerted')
      and (cut.tests or not t.is_test)
      and not exists (select 1 from cases_of co where co.person_id = t.person_id)
  ), talked as materialized (
    -- Who wrote to the firm's WhatsApp, by the number the firm has for them, and has no case.
    select distinct p.id as person_id
    from public.people p
    join public.wa_conversations w on w.org_id = p.org_id
    where p.org_id = target_org and p.phone is not null and w.last_inbound_at is not null
      and w.contact_wa_id = any (public.wa_phone_variants(p.phone))
      and not exists (select 1 from cases_of co where co.person_id = p.id)
  )
  select p.id,
    case
      when exists (select 1 from signed s where s.person_id = p.id) then 'cliente'
      when exists (select 1 from going g where g.person_id = p.id)
        or exists (select 1 from followed fw where fw.person_id = p.id)
        or (exists (select 1 from talked t where t.person_id = p.id)
            and not exists (select 1 from refused_alerts r where r.person_id = p.id)) then 'lead'
      when exists (select 1 from held h where h.person_id = p.id)
        or exists (select 1 from refused_alerts r where r.person_id = p.id) then 'nao_qualificado'
      else 'contato'
    end,
    coalesce((
      select array_agg(distinct reason)
      from (
        select jsonb_array_elements_text(h.reasons) as reason from held h where h.person_id = p.id
        union all
        select jsonb_array_elements_text(r.reasons) from refused_alerts r where r.person_id = p.id
      ) x
    ), '{}')
  from public.people p
  where p.org_id = target_org;
$$;

revoke all on function public.people_funnel(uuid) from public, anon, authenticated;

-- ---------- The test chat keeps the days of the firm's own passenger ----------

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
