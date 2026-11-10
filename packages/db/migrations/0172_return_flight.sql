-- ============================================================
-- The way back is still followed (0172), item 2.4 of the case journey plan,
-- by the owner's decision of 2026-11-07: a trip whose problem became a case
-- was read no more, and a trip had one alert per kind of problem, so a round
-- trip whose outbound became a case was never told of a problem on its
-- return.
--
-- An alert is of a journey of the trip (`flight_alerts.journey`, the rule's
-- `flight-problem-v4` numbering them in the order they fly, and `legs`, the
-- positions of that journey), one per journey and kind; the yes to it opens
-- a case with that journey's legs alone and says which case each leg went
-- into (`tracked_legs.case_id`, `flight_alerts.case_id`). A trip with a case
-- keeps being read while it has a leg no case took (`claim_trip_watch`), a
-- problem there is told as any other (`record_flight_alert`,
-- `reserve_flight_alert`), and its yes opens another case of the same
-- passenger (`one_open_case_from_alert`, `one_alert_not_qualified`); the
-- trip keeps its first case and stays `case_opened`. A no or a stop to the
-- alert of such a trip ends what was left of it (`tracked_trips.rest_closed`),
-- never the case it had. The trips that became cases before 0172 took every
-- leg into their case, and are read no more.
-- ============================================================

alter table public.flight_alerts add column journey integer not null default 1;
alter table public.flight_alerts add column legs integer[];
alter table public.flight_alerts add column case_id uuid;
alter table public.flight_alerts add constraint flight_alerts_case_fkey
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete set null (case_id);
alter table public.flight_alerts add constraint flight_alerts_journey_check check (journey between 1 and 20);
alter table public.flight_alerts add constraint flight_alerts_legs_check check (
  legs is null or (cardinality(legs) between 1 and 20 and 0 < all (legs))
);
alter table public.flight_alerts drop constraint flight_alerts_trip_id_kind_key;
alter table public.flight_alerts add constraint flight_alerts_trip_journey_kind_key unique (trip_id, journey, kind);

alter table public.tracked_legs add column case_id uuid;
alter table public.tracked_legs add constraint tracked_legs_case_fkey
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete set null (case_id);

-- A no or a stop to the alert of a trip that already became a case: what was left of it is followed no more.
alter table public.tracked_trips add column rest_closed boolean not null default false;

-- The cases opened before took every leg of their trip.
update public.tracked_legs l set case_id = t.case_id
from public.tracked_trips t
where t.id = l.trip_id and t.case_id is not null and l.case_id is null;
update public.flight_alerts a set case_id = t.case_id
from public.tracked_trips t
where t.id = a.trip_id and t.case_id is not null and a.answer = 'yes' and a.case_id is null;

/** Whether a trip has a leg no case took: what is left of a trip that became a case, still followed. Internal. */
create or replace function public.trip_has_open_legs(target_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tracked_legs l where l.trip_id = target_trip and l.case_id is null);
$$;

revoke all on function public.trip_has_open_legs(uuid) from public, anon, authenticated;

/** Whether a trip is still read: one followed, or one that became a case and keeps a leg no case took. Internal. */
create or replace function public.trip_still_followed(target_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select t.status in ('watching', 'alerted')
           or (t.status = 'case_opened' and not t.rest_closed and public.trip_has_open_legs(t.id))
    from public.tracked_trips t where t.id = target_trip
  ), false);
$$;

revoke all on function public.trip_still_followed(uuid) from public, anon, authenticated;

drop function public.record_flight_alert(uuid, text, integer, integer, text);

/**
 * Keeps the alert of a problem the rule found on a journey of a trip (0047, 0172): one per journey and kind. A
 * journey a case took already, or a trip no longer followed, keeps nothing. The backend's.
 */
create or replace function public.record_flight_alert(
  target_trip uuid,
  target_kind text,
  target_leg integer,
  target_delay integer,
  target_rule text,
  target_journey integer default 1,
  target_legs integer[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  trip public.tracked_trips%rowtype;
  alert uuid;
  legs integer[] := case when target_legs is null or cardinality(target_legs) = 0 then null else target_legs end;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into trip from public.tracked_trips t where t.id = target_trip for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'trip_not_found');
  end if;
  if target_kind is null or target_kind not in ('cancelled', 'changed', 'delayed')
     or target_rule is null or target_rule !~ '^[a-z][a-z0-9-]{2,40}$'
     or (target_delay is not null and target_delay not between 0 and 20160)
     or target_journey is null or target_journey not between 1 and 20
     or (legs is not null and (cardinality(legs) > 20 or not 0 < all (legs))) then
    return jsonb_build_object('ok', false, 'code', 'invalid_alert');
  end if;
  if not public.trip_still_followed(trip.id) then
    return jsonb_build_object('ok', true, 'code', 'trip_closed');
  end if;
  -- A journey a case took is that case's: a trip that became one is told only of what no case took.
  if trip.status = 'case_opened' and (
       legs is null
       or exists (select 1 from public.tracked_legs l
                  where l.trip_id = trip.id and l.position = any (legs) and l.case_id is not null)
     ) then
    return jsonb_build_object('ok', true, 'code', 'covered');
  end if;
  insert into public.flight_alerts (org_id, trip_id, kind, leg_position, delay_minutes, rule_version, journey, legs)
  values (trip.org_id, trip.id, target_kind, target_leg, target_delay, target_rule, target_journey, legs)
  on conflict (trip_id, journey, kind) do nothing
  returning id into alert;
  if alert is null then
    return jsonb_build_object('ok', true, 'code', 'already_known');
  end if;
  return jsonb_build_object('ok', true, 'code', 'recorded', 'alert_id', alert);
end;
$$;

revoke all on function public.record_flight_alert(uuid, text, integer, integer, text, integer, integer[]) from public, anon, authenticated;

-- ---------- What is left of a trip that became a case is read ----------

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
              where l.trip_id = t.id and l.status not in ('landed', 'cancelled') and l.case_id is null
                and now() >= (l.scheduled_departure_local at time zone 'America/Sao_Paulo') - make_interval(hours => before_hours)
                and now() <= (l.scheduled_arrival_local at time zone 'America/Sao_Paulo') + make_interval(hours => after_hours)
             ) as legs
      from public.tracked_trips t
      where t.watch = 'flightaware' and public.trip_still_followed(t.id)
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

-- ---------- And its alert goes ----------

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

revoke all on function public.reserve_flight_alert(uuid, integer, text[]) from public, anon, authenticated;

-- ---------- A no or a stop ends what was left, never the case ----------

create or replace function public.answer_flight_alert(target_conversation uuid, target_claim integer, target_answer text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  alert public.flight_alerts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_answer is null or target_answer not in ('yes', 'no', 'stop') then
    return jsonb_build_object('ok', false, 'code', 'invalid_answer');
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into alert from public.flight_alerts a where a.id = public.conversation_pending_alert(conversation.id) for update;
  if alert.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_alert');
  end if;
  update public.flight_alerts set answer = target_answer, answered_at = now() where id = alert.id;
  perform public.withdraw_conversation_answers(conversation.id, 'O passageiro respondeu ao aviso, e o ONE seguiu a resposta.');
  if target_answer = 'no' then
    update public.tracked_trips
    set status = case when status = 'case_opened' then status else 'declined' end,
        rest_closed = rest_closed or status = 'case_opened'
    where id = alert.trip_id;
    insert into public.wa_conversation_events (org_id, conversation_id, kind, actor_type)
    values (conversation.org_id, conversation.id, 'declined', 'system');
  elsif target_answer = 'stop' then
    update public.tracked_trips
    set status = case when status = 'case_opened' then status else 'stopped' end,
        rest_closed = rest_closed or status = 'case_opened'
    where id = alert.trip_id;
    insert into public.wa_optouts (org_id, contact_wa_id, source)
    values (conversation.org_id, conversation.contact_wa_id, 'keyword')
    on conflict (org_id, contact_wa_id) do nothing;
    insert into public.wa_conversation_events (org_id, conversation_id, kind, actor_type)
    values (conversation.org_id, conversation.id, 'stopped', 'system');
  end if;
  return jsonb_build_object('ok', true, 'code', 'answered', 'alert_id', alert.id, 'trip_id', alert.trip_id);
end;
$$;

revoke all on function public.answer_flight_alert(uuid, integer, text) from public, anon, authenticated;

-- ---------- The yes opens the case of the alert's journey ----------

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
  -- The yes to an alert opens one case; a trip that became a case may still have another journey's (0172).
  if alert.case_id is not null or (trip.status = 'case_opened' and alert.legs is null) then
    return jsonb_build_object('ok', false, 'code', 'already_opened', 'case_id', coalesce(alert.case_id, trip.case_id));
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
  -- The yes to an alert opens one case; a trip that became a case may still have another journey's (0172).
  if alert.case_id is not null or (trip.status = 'case_opened' and alert.legs is null) then
    return jsonb_build_object('ok', false, 'code', 'already_opened', 'case_id', coalesce(alert.case_id, trip.case_id));
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

  -- The legs of the alert's journey (0172), or every leg for an alert from before.
  select max(l.position) into last_position from public.tracked_legs l
  where l.trip_id = trip.id and (alert.legs is null or l.position = any (alert.legs));
  incident := case alert.kind
    when 'cancelled' then 'cancellation'
    when 'delayed' then case
      when last_position > 1 and exists (
        select 1 from public.tracked_legs l where l.trip_id = trip.id and l.position < last_position and l.status = 'delayed'
          and (alert.legs is null or l.position = any (alert.legs))
      ) then 'missed_connection' else 'delay' end
    else 'other' end;
  airline := (select a.iata from public.airlines a where a.iata = trip.airline_iata and a.active);
  flight_day := (select min(l.scheduled_departure_local)::date from public.tracked_legs l
                 where l.trip_id = trip.id and (alert.legs is null or l.position = any (alert.legs)));

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

  for leg in select * from public.tracked_legs l
             where l.trip_id = trip.id and (alert.legs is null or l.position = any (alert.legs))
             order by l.position loop
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
  -- The trip keeps its first case; each alert and each leg says the case it went into (0172).
  update public.tracked_trips set status = 'case_opened', case_id = coalesce(case_id, new_case) where id = trip.id;
  update public.flight_alerts set case_id = new_case where id = alert.id;
  update public.tracked_legs set case_id = new_case
  where trip_id = trip.id and case_id is null and (alert.legs is null or position = any (alert.legs));
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

-- ---------- A test trip started over frees its legs ----------

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

revoke all on function public.test_chat_set_legs(text, uuid, jsonb, boolean) from public, anon, authenticated;
