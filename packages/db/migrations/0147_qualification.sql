-- ============================================================
-- 0147_qualification: ONE decides alone whether a passenger's problem
-- qualifies (`qualificacao-v1`, `@flyee/rules/qualification`; the owner's
-- decisions of 2026-11-07 and 2026-11-10), and says why.
--
-- The rule is code: the backend runs it and the database keeps what it
-- answered, never deciding by itself.
--
--   * At the passenger's yes to ONE's word about a flight: a problem that does
--     not qualify opens no case (`one_alert_not_qualified`): the answer and the
--     rule's word are kept on the alert, the passenger is kept as a person of
--     the firm with the reason (`flight_alerts.person_id`), and told in the
--     firm's name, with no promise and no advice, where the firm lets ONE answer
--     its clients; else a person is called. Anything else opens the case as
--     before.
--   * On a case: the rule's word is kept (`cases.qualification`,
--     `record_case_qualification`, by the backend that ran it), told in the
--     timeline when it changes; a case that does not qualify keeps ONE from
--     creating its lawsuits until a partner or a lawyer says the firm goes on
--     with it all the same, with the reason (`release_case_qualification`),
--     which is how the firm opens a case as an exception.
--
-- What the rule reads of a case is one reading (`case_qualification_facts`):
-- its kind of problem and flight day, the affected leg's schedule and its
-- arrival as a source said it, whether a leg was abroad, ONE's word about the
-- flight when it came from one, and the interview's answers on when the
-- airline told of it and when the passenger arrived.
-- ============================================================

alter table public.cases
  add column qualification jsonb,
  add column qualified_at timestamptz,
  add column qualification_released_by uuid references public.profiles (id) on delete set null,
  add column qualification_released_at timestamptz,
  add column qualification_release_reason text;

/** Whether a value is a word of the rule of qualification, as the database keeps it. */
create or replace function public.qualification_is_valid(value jsonb)
returns boolean
language sql
immutable
as $$
  select value is null or (
    jsonb_typeof(value) = 'object'
    and coalesce(value ->> 'rule', '') ~ '^qualificacao-v[0-9]{1,3}$'
    and value ->> 'outcome' in ('qualifies', 'not_qualified', 'pending', 'review')
    and jsonb_typeof(value -> 'reasons') = 'array'
    and jsonb_typeof(value -> 'missing') = 'array'
    and jsonb_typeof(value -> 'assumptions') = 'array'
    and not exists (
      select 1 from jsonb_array_elements(value -> 'reasons' || value -> 'missing' || value -> 'assumptions') item
      where jsonb_typeof(item) <> 'string' or item #>> '{}' !~ '^[a-z][a-z_]{2,40}$'
    )
    and octet_length(value::text) <= 2000
  );
$$;

revoke all on function public.qualification_is_valid(jsonb) from public, anon, authenticated;

alter table public.cases add constraint cases_qualification_check check (public.qualification_is_valid(qualification));
alter table public.cases add constraint cases_qualification_release_check check (
  (qualification_released_at is null) = (qualification_release_reason is null)
  and (qualification_release_reason is null or char_length(qualification_release_reason) between 8 and 500)
);

alter table public.flight_alerts
  add column qualification jsonb,
  add column person_id uuid;
alter table public.flight_alerts add constraint flight_alerts_person_fk
  foreign key (person_id, org_id) references public.people (id, org_id) on delete set null (person_id);
alter table public.flight_alerts add constraint flight_alerts_qualification_check
  check (public.qualification_is_valid(qualification));
create index flight_alerts_person_idx on public.flight_alerts (person_id) where person_id is not null;

alter table public.wa_conversation_events drop constraint wa_conversation_events_kind_check;
alter table public.wa_conversation_events add constraint wa_conversation_events_kind_check check (kind in (
  'case_opened', 'link_sent', 'person_called', 'taken_over', 'returned_to_one', 'declined', 'stopped',
  'document_joined', 'statement_joined', 'not_qualified'
));

/**
 * What the rule of qualification reads of a case (the backend's). Null for a
 * case that is not there.
 */
create or replace function public.case_qualification_facts(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  leg public.flight_segments%rowtype;
  alert record;
  followed timestamp;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found then
    return null;
  end if;
  select * into leg from public.flight_segments s
  where s.case_id = current_case.id order by s.affected desc, s.position limit 1;
  select a.kind, a.delay_minutes, a.leg_position, a.trip_id into alert
  from public.flight_alerts a join public.tracked_trips t on t.id = a.trip_id
  where t.case_id = current_case.id
  order by a.created_at desc limit 1;
  if alert.trip_id is not null then
    select l.arrived_local into followed from public.tracked_legs l
    where l.trip_id = alert.trip_id and l.position = coalesce(alert.leg_position, l.position) and l.arrived_local is not null
    order by l.position desc limit 1;
  end if;
  return jsonb_build_object(
    'case_id', current_case.id,
    'status', current_case.status,
    'incident', current_case.incident,
    'flight_date', coalesce(current_case.flight_date, leg.scheduled_departure_local::date),
    'alert', case when alert.kind is not null then jsonb_build_object('kind', alert.kind, 'delay_minutes', alert.delay_minutes) end,
    'scheduled_departure', to_char(leg.scheduled_departure_local, 'YYYY-MM-DD"T"HH24:MI'),
    'scheduled_arrival', to_char(leg.scheduled_arrival_local, 'YYYY-MM-DD"T"HH24:MI'),
    'actual_arrival', to_char(coalesce(leg.actual_arrival_local, followed), 'YYYY-MM-DD"T"HH24:MI'),
    -- A leg to or from an airport abroad makes the flight international; with no leg, nobody knows.
    'international', case
      when not exists (select 1 from public.flight_segments s where s.case_id = current_case.id) then null
      else exists (
        select 1 from public.flight_segments s
        join public.airports a on a.iata in (s.origin_iata, s.destination_iata)
        where s.case_id = current_case.id and a.country <> 'BR'
      )
    end,
    'answers', coalesce((
      select jsonb_object_agg(a.question, jsonb_build_object(
        'status', a.status, 'sim_nao', a.facts ->> 'sim_nao', 'quando', a.facts ->> 'quando'))
      from public.case_interviews i
      join public.case_interview_answers a on a.interview_id = i.id
      where i.case_id = current_case.id and a.question in ('aviso_local', 'aviso_quando', 'chegada')
    ), '{}'::jsonb),
    'qualification', current_case.qualification,
    'released', current_case.qualification_released_at is not null
  );
end;
$$;

revoke all on function public.case_qualification_facts(uuid) from public, anon, authenticated;
grant execute on function public.case_qualification_facts(uuid) to service_role;

/**
 * The rule's word on a case, kept by the backend that ran it: written when it
 * says something new, and told in the timeline when what it decided changes.
 */
create or replace function public.record_case_qualification(target_case uuid, target_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_result is null or not public.qualification_is_valid(target_result) then
    return jsonb_build_object('ok', false, 'code', 'invalid_result');
  end if;
  select * into current_case from public.cases where id = target_case for no key update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if current_case.qualification is not distinct from target_result then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  update public.cases set qualification = target_result, qualified_at = now() where id = current_case.id;
  if current_case.qualification ->> 'outcome' is distinct from target_result ->> 'outcome' then
    perform public.record_case_event(current_case.org_id, current_case.id, 'qualified', 'system',
      jsonb_build_object('outcome', target_result ->> 'outcome', 'reasons', target_result -> 'reasons'));
  end if;
  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.record_case_qualification(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_case_qualification(uuid, jsonb) to service_role;

/**
 * A partner or a lawyer says the firm goes on with a case the rule did not
 * qualify (or left to a person), with the reason: ONE carries it on from
 * then. Never a support visit; on the record and in the timeline.
 */
create or replace function public.release_case_qualification(target_case uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case for no key update;
  if not found or not public.is_org_member(current_case.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(current_case.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if current_case.status in ('closed', 'declined') then
    return jsonb_build_object('ok', false, 'code', 'closed');
  end if;
  if coalesce(current_case.qualification ->> 'outcome', '') not in ('not_qualified', 'review') then
    return jsonb_build_object('ok', false, 'code', 'nothing_to_release');
  end if;
  if current_case.qualification_released_at is not null then
    return jsonb_build_object('ok', true, 'code', 'released_before');
  end if;
  if reason is null or char_length(reason) not between 8 and 500 then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'field', 'reason');
  end if;
  update public.cases set
    qualification_released_by = auth.uid(),
    qualification_released_at = now(),
    qualification_release_reason = reason
  where id = current_case.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'case.qualification_released', 'case', current_case.id::text,
    jsonb_build_object('outcome', current_case.qualification ->> 'outcome', 'reasons', current_case.qualification -> 'reasons'));
  perform public.record_case_event(current_case.org_id, current_case.id, 'qualification_released', 'person',
    jsonb_build_object('outcome', current_case.qualification ->> 'outcome'));
  perform public.wake_case_advance(current_case.id);
  return jsonb_build_object('ok', true, 'code', 'released');
end;
$$;

revoke all on function public.release_case_qualification(uuid, text) from public, anon;
grant execute on function public.release_case_qualification(uuid, text) to authenticated;

/**
 * The passenger said yes to ONE's word about a flight, and the rule says the
 * problem does not qualify (the backend's, under the conversation's claim):
 * no case is opened; the answer and the rule's word are kept on the alert;
 * the passenger is kept as a person of the firm (the one with that WhatsApp,
 * or a new one with the name the trip has), the reason with them; the
 * conversation tells it; and the firm's message goes where the firm lets ONE
 * answer its clients (`reply_client`), else a person is called.
 */
create or replace function public.one_alert_not_qualified(
  target_conversation uuid,
  target_claim integer,
  target_alert uuid,
  target_result jsonb,
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
  person uuid;
  applied jsonb;
  message uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_result is null or not public.qualification_is_valid(target_result)
     or target_result ->> 'outcome' <> 'not_qualified' then
    return jsonb_build_object('ok', false, 'code', 'invalid_result');
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
  if alert.qualification is not null then
    return jsonb_build_object('ok', true, 'code', 'answered_before');
  end if;

  -- The passenger: the firm's person with this WhatsApp, or a new one with the trip's name.
  select p.id into person from public.people p
  where p.org_id = conversation.org_id and p.phone is not null
    and p.phone = any (public.wa_phone_variants(trip.phone))
  order by p.created_at
  limit 1;
  if person is null then
    insert into public.people (org_id, full_name)
    values (conversation.org_id, left(regexp_replace(btrim(trip.passenger_name), '\s+', ' ', 'g'), 200))
    returning id into person;
    applied := public.apply_person_fields(person, jsonb_build_object('phone', trip.phone), 'firm');
    if not coalesce((applied ->> 'ok')::boolean, false) then
      raise exception 'passenger_not_saved' using errcode = 'P0001';
    end if;
  end if;

  update public.flight_alerts
  set answer = 'yes', answered_at = coalesce(answered_at, now()), qualification = target_result, person_id = person
  where id = alert.id;
  perform public.withdraw_conversation_answers(conversation.id, 'O passageiro respondeu ao aviso, e o ONE seguiu a resposta.');
  insert into public.wa_conversation_events (org_id, conversation_id, kind, actor_type, data)
  values (conversation.org_id, conversation.id, 'not_qualified', 'system',
    jsonb_build_object('alert', alert.id, 'reasons', target_result -> 'reasons'));

  if public.firm_autonomy_mode(conversation.org_id, 'reply_client') <> 'auto'
     or nullif(btrim(coalesce(target_body, '')), '') is null then
    return jsonb_build_object('ok', true, 'code', 'not_qualified_by_person', 'person_id', person);
  end if;
  message := public.one_message(conversation, left(btrim(target_body), 4000), null, null);
  return jsonb_build_object('ok', true, 'code', 'not_qualified', 'message_id', message, 'person_id', person);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'code', sqlerrm);
end;
$$;

revoke all on function public.one_alert_not_qualified(uuid, integer, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.one_alert_not_qualified(uuid, integer, uuid, jsonb, text) to service_role;
