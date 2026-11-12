-- ============================================================
-- The chat's script, its sixth part (0234): who travelled along. A child
-- the passenger named in the intake (with an age under 18) joins the case
-- the passenger's "Quero seguir" opens, as a claimant the passenger answers
-- for (as an alert's companion does, 0071), and ONE asks the child's
-- certidão or RG by the child's name; the birth date comes from it. An
-- adult who travelled along is asked to write to the firm themself: each
-- adult tells their case and signs their own power of attorney, and ONE
-- writes to nobody whose number a client gave (the owner's choice of
-- 2026-11-12, until the opinion on soliciting clients says otherwise).
-- What the case still owes calls a claimant someone answers for a child
-- even before the birth date is read (`conversation_papers_owed`, redefined
-- from 0230).
-- ============================================================

drop function public.one_open_case_from_intake(uuid, integer, text, text);

/**
 * Opens the case of an intake (replaces 0227's): and each child the passenger named joins it as a claimant they
 * answer for (0234). Service role.
 */
create or replace function public.one_open_case_from_intake(
  target_conversation uuid,
  target_claim integer,
  target_token_hash text,
  target_body text,
  target_children jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  facts jsonb;
  incident text;
  airline text;
  flight_day date;
  next_seq integer;
  new_case uuid;
  person uuid;
  segment uuid;
  applied jsonb;
  link_made jsonb;
  message uuid;
  body text;
  linked boolean := false;
  flight text;
  child jsonb;
  child_name text;
  child_person uuid;
  guardian_party uuid;
  passenger_party uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if conversation.intake_case_id is not null then
    return jsonb_build_object('ok', false, 'code', 'already_opened', 'case_id', conversation.intake_case_id);
  end if;
  if exists (
    select 1 from public.case_parties cp
    join public.cases c on c.id = cp.case_id and c.status not in ('closed', 'declined')
    join public.people p on p.id = cp.person_id
    where c.org_id = conversation.org_id and p.phone = any (public.wa_phone_variants(conversation.contact_wa_id))
  ) then
    return jsonb_build_object('ok', false, 'code', 'has_case');
  end if;
  facts := conversation.intake;
  incident := facts ->> 'problema';
  if incident is null or incident not in ('delay', 'cancellation', 'overbooking', 'missed_connection', 'downgrade',
                                          'baggage_lost', 'baggage_damaged', 'baggage_delayed', 'other')
     or char_length(coalesce(facts ->> 'nome', '')) < 2 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  if public.firm_autonomy_mode(conversation.org_id, 'open_case_from_chat') <> 'auto' then
    return jsonb_build_object('ok', false, 'code', 'by_person');
  end if;
  flight := upper(regexp_replace(coalesce(facts ->> 'voo', ''), '\s', '', 'g'));
  airline := (select a.iata from public.airlines a
              where a.active and (a.iata = upper(left(flight, 2))
                                  or a.iata = upper(btrim(coalesce(facts ->> 'companhia', '')))
                                  or lower(a.name) = lower(btrim(coalesce(facts ->> 'companhia', ''))))
              order by (a.iata = upper(left(flight, 2))) desc
              limit 1);
  flight_day := case when coalesce(facts ->> 'data', '') ~ '^\d{4}-\d{2}-\d{2}$' then (facts ->> 'data')::date end;

  perform set_config('one.system_case', '', true);
  perform 1 from public.organizations where id = conversation.org_id for no key update;
  select coalesce(max(c.seq), 0) + 1 into next_seq from public.cases c where c.org_id = conversation.org_id;
  insert into public.cases (org_id, seq, incident, airline_iata, flight_date, origin)
  values (conversation.org_id, next_seq, incident, airline, flight_day, 'organic')
  returning id into new_case;
  perform set_config('one.system_case', new_case::text, true);

  person := public.intake_person(conversation);
  if person is null then
    raise exception 'no_person' using errcode = 'P0001';
  end if;
  perform public.apply_person_fields(person, jsonb_build_object('phone', conversation.contact_wa_id), 'firm');
  insert into public.case_parties (org_id, case_id, person_id, role)
  values (conversation.org_id, new_case, person, 'claimant')
  returning id into passenger_party;

  -- Each child who travelled along, as told (0234): a claimant the passenger answers for, the birth date and the rest
  -- read from the certidão or the RG asked next. An adult who travelled along writes to the firm themself.
  for child in select value from jsonb_array_elements(
      case when jsonb_typeof(target_children) = 'array' then target_children else '[]'::jsonb end) loop
    child_name := left(regexp_replace(btrim(coalesce(child ->> 'name', '')), '\s+', ' ', 'g'), 200);
    if char_length(child_name) < 3 or child_name !~ '[[:alpha:]]' then
      continue;
    end if;
    if guardian_party is null then
      insert into public.case_parties (org_id, case_id, person_id, role)
      values (conversation.org_id, new_case, person, 'guardian')
      returning id into guardian_party;
    end if;
    insert into public.people (org_id, full_name, updated_via)
    values (conversation.org_id, child_name, 'firm')
    returning id into child_person;
    insert into public.case_parties (org_id, case_id, person_id, role, guardian_id)
    values (conversation.org_id, new_case, child_person, 'claimant', guardian_party);
  end loop;

  -- The leg as the passenger told it, when its flight is one; the documents complete it.
  if flight ~ '^[A-Z0-9]{2}[0-9]{1,4}[A-Z]?$' then
    insert into public.flight_segments (org_id, case_id, position, source)
    values (conversation.org_id, new_case, 1, 'firm')
    returning id into segment;
    applied := public.apply_segment_fields(segment, jsonb_strip_nulls(jsonb_build_object(
      'flight_number', flight,
      'origin_iata', case when upper(coalesce(facts ->> 'origem', '')) ~ '^[A-Z]{3}$'
                          and exists (select 1 from public.airports a where a.iata = upper(facts ->> 'origem'))
                          then upper(facts ->> 'origem') end,
      'destination_iata', case when upper(coalesce(facts ->> 'destino', '')) ~ '^[A-Z]{3}$'
                               and exists (select 1 from public.airports a where a.iata = upper(facts ->> 'destino'))
                               then upper(facts ->> 'destino') end,
      'affected', true
    )), 'firm');
    if not coalesce((applied ->> 'ok')::boolean, false) then
      delete from public.flight_segments where id = segment;
    end if;
  end if;

  perform public.record_case_event(conversation.org_id, new_case, 'created', 'system',
    jsonb_build_object('seq', next_seq, 'incident', incident, 'from', 'conversation'));
  update public.wa_conversations set intake_case_id = new_case where id = conversation.id;
  insert into public.wa_conversation_events (org_id, conversation_id, kind, actor_type, data)
  values (conversation.org_id, conversation.id, 'case_opened', 'system', jsonb_build_object('case_id', new_case, 'seq', next_seq));

  if public.firm_autonomy_mode(conversation.org_id, 'send_client_link') = 'auto'
     and target_token_hash ~ '^[0-9a-f]{64}$' and nullif(btrim(coalesce(target_body, '')), '') is not null then
    link_made := public.create_client_link(new_case, person, target_token_hash);
    if coalesce((link_made ->> 'ok')::boolean, false) then
      -- A firm's own words may still carry {caso} (0191).
      body := replace(target_body, '{caso}', next_seq::text);
      message := public.one_message(conversation, body, null, null);
      insert into public.wa_conversation_events (org_id, conversation_id, kind, actor_type, data)
      values (conversation.org_id, conversation.id, 'link_sent', 'system', jsonb_build_object('case_id', new_case));
      linked := true;
    end if;
  end if;
  perform set_config('one.system_case', '', true);

  return jsonb_build_object('ok', true, 'code', case when linked then 'opened' else 'opened_without_link' end,
                            'case_id', new_case, 'seq', next_seq, 'message_id', message);
exception when sqlstate 'P0001' then
  perform set_config('one.system_case', '', true);
  return jsonb_build_object('ok', false, 'code', sqlerrm);
end;
$$;

revoke all on function public.one_open_case_from_intake(uuid, integer, text, text, jsonb) from public, anon, authenticated;

/**
 * What the case a conversation gathers still owes of its documents (replaces 0230's: a claimant someone answers for
 * is a child before the birth date is read, 0234), for ONE to ask the next one in the chat:
 * each essential of the case's version (`case_required_documents`) by whose it is (each claimant's, the passenger's,
 * the case's), with the name to ask it by, whether that person is the passenger or a child, and whether the last one
 * sent was refused; the dispensables and where each stands; whether the case waits for its signature. Service role,
 * for the conversation the backend holds.
 */
create or replace function public.conversation_papers_owed(target_conversation uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  current_case uuid;
  passenger public.case_parties%rowtype;
  phones text[];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  current_case := public.conversation_gathered_case(conversation);
  if current_case is null then
    return jsonb_build_object('ok', true, 'code', 'no_case');
  end if;
  phones := public.wa_phone_variants(conversation.contact_wa_id) || conversation.contact_wa_id;
  select cp.* into passenger from public.case_parties cp join public.people p on p.id = cp.person_id
  where cp.case_id = current_case and p.phone = any (phones)
  order by (cp.role = 'claimant') desc, cp.created_at, cp.id
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'code', 'case',
    'case_id', current_case,
    'waits_signature', public.case_waits_signature(current_case),
    'owed', coalesce((
      with needs as (
        select n.ordinality as position, n.value ->> 'kind' as kind, coalesce(n.value ->> 'per', 'case') as per,
               array[n.value ->> 'kind']
                 || coalesce(array(select jsonb_array_elements_text(
                      case when jsonb_typeof(n.value -> 'or') = 'array' then n.value -> 'or' else '[]'::jsonb end)), '{}') as kinds
        from jsonb_array_elements(public.case_required_documents(current_case)) with ordinality as n (value, ordinality)
        where jsonb_typeof(n.value) = 'object' and n.value ? 'kind'
      ), slots as (
        -- Each claimant for a paper of each claimant; the passenger for theirs; the case once.
        select nd.position, nd.kind, nd.per, nd.kinds, cp.id as party_id, cp.person_id, cp.created_at as party_at
        from needs nd
        join public.case_parties cp on cp.case_id = current_case
          and ((nd.per = 'claimant' and cp.role = 'claimant') or (nd.per = 'holder' and cp.id = passenger.id))
        union all
        select nd.position, nd.kind, nd.per, nd.kinds, null, null, null
        from needs nd where nd.per not in ('claimant', 'holder')
      )
      select jsonb_agg(jsonb_build_object(
        'kind', s.kind,
        'per', s.per,
        'name', p.full_name,
        'own', s.person_id is not distinct from passenger.person_id or s.per = 'case',
        'minor', (p.birth_date is not null and p.birth_date > (current_date - interval '18 years')::date)
                 or exists (select 1 from public.case_parties g where g.id = s.party_id and g.guardian_id is not null),
        'rejected', exists (
          select 1 from public.case_documents d
          where d.case_id = current_case and d.kind = any (s.kinds) and d.status = 'rejected'
            and (s.party_id is null or d.party_id = s.party_id)
        )
      ) order by s.position, (s.person_id is not distinct from passenger.person_id) desc, s.party_at)
      from slots s
      left join public.people p on p.id = s.person_id
      where not exists (
        select 1 from public.case_documents d
        where d.case_id = current_case and d.kind = any (s.kinds) and d.status <> 'rejected'
          and case s.per
                when 'case' then true
                when 'holder' then d.party_id in (
                  select x.id from public.case_parties x where x.case_id = current_case and x.person_id = s.person_id)
                else d.party_id = s.party_id
              end
      )
    ), '[]'::jsonb),
    'dispensables', public.case_dispensables(current_case)
  );
end;
$$;

revoke all on function public.conversation_papers_owed(uuid, integer) from public, anon, authenticated;
