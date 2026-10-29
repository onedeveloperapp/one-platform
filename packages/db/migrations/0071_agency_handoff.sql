-- ============================================================
-- 0071_agency_handoff: a passenger an agency registered becomes the firm's client with what the agency had.
--
-- Fourth phase of the plan the owner approved on 2026-10-29. When a passenger
-- whose trip came from a travel agency (0070) says yes to the firm's word about
-- a problem with their flight, ONE opens the case as for any passenger (0048)
-- and, in the same step, hands the agency's record of that trip over to it:
--
--   each person of the trip the agency registered, found among the firm's
--   clients by a CPF and a name that is theirs (`pax_client_of`, the rule of a
--   portfolio's import), or new; a client the firm had keeps what its record
--   says and takes the agency's data only where it has none, a new one takes
--   them whole but for the WhatsApp of the conversation and a CPF the firm has
--   for somebody else; what ONE read of a document stays marked as read, now
--   of the case's document;
--
--   their documents, as documents of the case (`source` `partner`), checked
--   by ONE as any document a client sends (0024): the file stops being the
--   partner's (`files.partner_id`), so the firm reads it from then on and the
--   agency no longer does;
--
--   the case, marked as the partnership's (`cases.partnership_id`, origin
--   `agency`), and told in its timeline (`agency_handoff`).
--
-- Nothing else of the agency's list reaches the firm: only the people of that
-- trip, once its holder said yes. Because the data came from the agency and
-- not from the client, ONE waits for the client to confirm them on their link
-- ("Terminei") before it creates the lawsuits (the worker reads
-- `partnership_id`, `lib/cases/advance-work.ts`).
--
-- The test chat (0047) follows a trip of an agency as one of its own when its
-- holder's WhatsApp is the test chat's number for an agency's passenger (55 00
-- 98888-0006): the firm tests the whole way, from the agency's area to the
-- case, with no real passenger and no real flight.
-- ============================================================

-- ---------- Who wrote a person's field, and where a document came from ----------

alter table public.people drop constraint people_via_check;
alter table public.people add constraint people_via_check
  check (updated_via in ('firm', 'client', 'document', 'partner'));

alter table public.case_documents drop constraint case_documents_source_check;
alter table public.case_documents add constraint case_documents_source_check
  check (source in ('client', 'firm', 'whatsapp', 'signature', 'partner'));

-- The partnership a case came from: the agency whose passenger said yes.
alter table public.cases add column partnership_id uuid references public.partner_links (id) on delete set null;
create index cases_partnership_idx on public.cases (partnership_id) where partnership_id is not null;

/** 0024, redefined: a document an agency handed over is processed as one a client sent. */
create or replace function public.case_document_processing_default()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.processing := case
    when new.source in ('client', 'firm', 'whatsapp', 'partner') and new.envelope_id is null
         and new.kind in ('identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'other')
      then 'pending'
    else 'skipped'
  end;
  new.processing_claimed_at := null;
  new.processing_attempts := 0;
  new.processing_error := null;
  return new;
end;
$$;

revoke all on function public.case_document_processing_default() from public, anon, authenticated;

-- ---------- The handoff ----------

/** The firm's client an agency's passenger is: the same CPF under a name that is theirs (0032), or null. Internal. */
create or replace function public.pax_client_of(target_org uuid, target_traveler uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.pax_travelers t
  join public.people p on p.org_id = target_org and p.cpf = t.cpf
  where t.id = target_traveler and t.cpf is not null and public.import_names_match(p.full_name, t.full_name)
  order by p.created_at, p.id
  limit 1;
$$;

revoke all on function public.pax_client_of(uuid, uuid) from public, anon, authenticated;

/**
 * Hands an agency's record of a trip over to the case just opened from it: for each passenger
 * (`target_people`: the traveler's id to the person and the party of the case it became, and whether the person is
 * new), the data the record lacks, the marks of what ONE read, and the documents of the person and of that trip.
 * Answers how many people and the documents of the case it made. Internal.
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
begin
  for item in select key, value from jsonb_each(coalesce(target_people, '{}'::jsonb)) loop
    select * into traveler from public.pax_travelers
    where id = item.key::uuid and org_id = target_org
    for update;
    if not found then
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
 * 0048, redefined: the case of a trip whose passenger said yes, opened by ONE in the conversation it holds. A trip
 * an agency registered (0070) opens it with the agency's record handed over (`pax_hand_over`): its people found
 * among the firm's clients or new, their data and documents, the case marked as the partnership's. Everything else
 * as before: who travelled along (a child with who answers for them), each leg with the one the problem is of
 * marked, and the client's link where the firm lets ONE send it. All at once or nothing. Service role.
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
  -- The agency's trip, while its partnership with this firm goes on.
  if trip.pax_trip_id is not null then
    select t.* into pax_trip
    from public.pax_trips t
    join public.partner_links l on l.id = t.partnership_id and l.status = 'active'
    where t.id = trip.pax_trip_id and t.org_id = conversation.org_id;
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

-- ---------- The test chat follows an agency's passenger ----------

/**
 * 0070, redefined: the trip ONE follows of an agency's trip, made once its holder agreed. A holder whose WhatsApp
 * is the test chat's number for an agency's passenger (55 00 98888-0006), in a firm whose test chat is on, is
 * followed as a trip of the test chat (`agencia`, made to happen by its tools, told only through it), in place of
 * the one followed so before. Internal.
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
    if tracked.status = 'stopped' and not exists (
      select 1 from public.wa_optouts o
      where o.org_id = tracked.org_id and o.contact_wa_id = any (public.wa_phone_variants(tracked.phone))
    ) then
      update public.tracked_trips set status = 'watching', consent_wording = target_wording, consent_at = now()
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

-- ---------- What the client's link says of it ----------

/**
 * The agency a client's case came from (0070), for their link to say the data it shows came from it and ask them to
 * confirm: its name, and whether the client already said they finished. Null fields for a case no agency handed
 * over. By the link's token.
 */
create or replace function public.client_link_agency(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  agency text;
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  select p.name into agency
  from public.cases c
  join public.partner_links l on l.id = c.partnership_id
  join public.partners p on p.id = l.partner_id
  where c.id = link.case_id;
  return jsonb_build_object('ok', true, 'agency', agency, 'finished', link.finished_at is not null);
end;
$$;

revoke all on function public.client_link_agency(text) from public;
grant execute on function public.client_link_agency(text) to anon, authenticated;
