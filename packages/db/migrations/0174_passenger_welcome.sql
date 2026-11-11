-- ============================================================
-- The passenger's welcome (0174), item 2.5 of the case journey plan, from
-- the owner's passenger flow of 2026-11-10: once a passenger the agency or
-- the firm registered agrees, ONE writes to them in the firm's name, once,
-- saying the firm follows their flights and what a passenger is owed by
-- ANAC's rules, with what to keep in case something goes wrong.
--
-- It is the firm's template of the notice kind `welcome`, under the rules of
-- ONE's first word (0047, 0051): the agreement, never to who asked to stop,
-- a real passenger only once the platform released its alerts, the firm's
-- number of the trip's kind. Once per WhatsApp and firm
-- (`passenger_welcomes`), whatever trips follow; what cannot go is kept as
-- skipped with why, and never tried again.
--
-- What the passenger reads of their rights is ANAC's Resolução 400 in the
-- words of Resolução 813/2026 (in force from 26/10/2026): food from two
-- hours of waiting, lodging from four when a night must be spent, and the
-- choice of another flight, the refund or another way to travel for a
-- cancellation or a delay of four hours or more; the means of communication
-- of art. 27, I, were revoked, so they are not named.
-- ============================================================

alter table public.notice_kinds drop constraint notice_kinds_kind_check;
alter table public.notice_kinds add constraint notice_kinds_kind_check check (kind in (
  'hearing_reminder', 'hearing_change', 'lawsuit_update', 'payment_alert', 'document_refused', 'flight_problem',
  'case_received', 'lawsuit_filed', 'case_questions', 'trip_departure', 'trip_arrival', 'welcome'
));

insert into public.notice_kinds (kind, position, template_base, body, footer, params, examples) values
  ('welcome', 12, 'one_boas_vindas',
   'Olá, {{1}}. Aqui é o assistente automático do escritório {{2}}. A partir de agora o escritório acompanha os voos da sua viagem e avisa você por aqui se algum deles for cancelado, mudar ou atrasar. Pelas regras da ANAC, se o voo atrasar, a companhia aérea deve dar alimentação a partir de 2 horas de espera e hospedagem a partir de 4 horas, se for preciso passar a noite; se o voo for cancelado ou atrasar 4 horas ou mais, deve oferecer outro voo, o reembolso ou outro meio de transporte. Guarde o bilhete, os comprovantes do que gastar e fotos do painel do aeroporto: eles ajudam se algo der errado.',
   'Para não receber estes avisos, responda SAIR.',
   array['first_name', 'firm'],
   array['Mariana', 'Souza Advogados'])
on conflict (kind) do nothing;

-- The test chats on now get the new kind too (0055).
do $$
declare
  chat record;
begin
  for chat in select c.org_id, c.number_id from public.test_chats c where c.status = 'active' loop
    perform public.test_chat_templates(chat.org_id, chat.number_id);
  end loop;
end;
$$;

create table public.passenger_welcomes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The WhatsApp welcomed, as the trip keeps it: once per firm, whatever trips follow.
  phone text not null,
  -- The trip whose agreement brought it; the welcome stays when the trip goes.
  trip_id uuid references public.tracked_trips (id) on delete set null,
  status text not null,
  reason text,
  message_id uuid references public.wa_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, phone),
  constraint passenger_welcomes_phone_check check (phone ~ '^[0-9]{12,15}$'),
  constraint passenger_welcomes_status_check check (status in ('sent', 'skipped')),
  constraint passenger_welcomes_reason_check check ((status = 'skipped') = (reason is not null)
    and (reason is null or reason ~ '^[a-z][a-z_]{2,40}$'))
);

alter table public.passenger_welcomes enable row level security;
create policy "passenger_welcomes_select_member" on public.passenger_welcomes
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.passenger_welcomes to authenticated;
create trigger guard_impersonation_passenger_welcomes after insert or update or delete on public.passenger_welcomes
  for each statement execute function public.guard_impersonation_readonly();

/**
 * The trips whose passenger is owed the welcome (0174): followed, agreed in the last days, of a WhatsApp the firm
 * never welcomed, the oldest agreement first; or the one trip named. With the passenger and the firm. Service role.
 */
create or replace function public.welcomes_owed(target_limit integer default 20, target_trip uuid default null)
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
      'passenger_name', t.passenger_name,
      'firm', (select o.name from public.organizations o where o.id = t.org_id)
    ) order by t.consent_at)
    from (
      select t.* from public.tracked_trips t
      where t.status in ('watching', 'alerted')
        and t.consent_at is not null
        and t.consent_at > now() - interval '3 days'
        and (target_trip is null or t.id = target_trip)
        and not exists (
          select 1 from public.passenger_welcomes w
          where w.org_id = t.org_id and w.phone = any (public.wa_phone_variants(t.phone))
        )
      order by t.consent_at
      limit greatest(least(coalesce(target_limit, 20), 100), 1)
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.welcomes_owed(integer, uuid) from public, anon, authenticated;

/**
 * Writes the passenger's welcome (0174), once per WhatsApp and firm, as the firm's template of `welcome`, under the
 * rules of ONE's first word; what cannot go is kept as skipped with why. Answers the message queued, for the outbox.
 * Service role.
 */
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
      and (n.provider = 'test') = trip.is_test
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

revoke all on function public.reserve_passenger_welcome(uuid, text[]) from public, anon, authenticated;
