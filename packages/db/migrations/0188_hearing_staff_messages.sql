-- ============================================================
-- The hearing on WhatsApp, for who goes (0188), item 4.4 of the case
-- journey plan, completing 0187: the brief is told on WhatsApp beside the
-- e-mail ("Vai por e-mail e WhatsApp"), and once a hearing passed its time
-- with nothing said of it ONE asks who went for the result ("Passado o
-- horário da audiência sem relato, o ONE pede o resultado a quem foi").
--
-- Both go to who goes to the hearing: a person of the firm at the WhatsApp
-- of their profile (0187), else an attendee from outside at the one written
-- on the hearing. Each is a template of the firm's own account, as the
-- client's notices are (0038): two kinds, `hearing_brief` and
-- `hearing_result`, proposed by the platform, submitted by the firm and
-- switched on once the vendor approved them; a test case goes through the
-- test chat's number, a real one through the firm's real number. Once per
-- hearing and kind (`hearing_staff_messages`); what cannot go (no WhatsApp,
-- a request to stop, no template, no number) is kept as skipped with why
-- and never tried again. The reply is read by 0187's report.
-- ============================================================

alter table public.notice_kinds drop constraint notice_kinds_kind_check;
alter table public.notice_kinds add constraint notice_kinds_kind_check check (kind in (
  'hearing_reminder', 'hearing_change', 'lawsuit_update', 'payment_alert', 'document_refused', 'flight_problem',
  'case_received', 'lawsuit_filed', 'case_questions', 'trip_departure', 'trip_arrival', 'welcome',
  'hearing_brief', 'hearing_result'
));

insert into public.notice_kinds (kind, position, template_base, body, footer, params, examples) values
  ('hearing_brief', 13, 'one_resumo_audiencia',
   'Olá, {{1}}. O resumo da {{2}}, {{3}}, está pronto no caso e no seu e-mail: os fatos, os documentos, os pedidos e o valor para acordo. Depois da audiência, responda aqui com o resultado.',
   'Mensagem para a equipe do escritório.',
   array['first_name', 'hearing', 'moment'],
   array['Ana', 'audiência de conciliação do caso 12', 'quarta-feira, 11 de março, às 14:00']),
  ('hearing_result', 14, 'one_resultado_audiencia',
   'Olá, {{1}}. Como foi a {{2}}, {{3}}? Responda aqui com o resultado, por texto ou áudio: se houve acordo, de quanto e em quantos dias a companhia paga.',
   'Mensagem para a equipe do escritório.',
   array['first_name', 'hearing', 'moment'],
   array['Ana', 'audiência de conciliação do caso 12', 'hoje, às 14:00'])
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

create table public.hearing_staff_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  hearing_id uuid not null references public.hearings (id) on delete cascade,
  kind text not null,
  -- The WhatsApp written to, when there was one.
  phone text,
  status text not null,
  reason text,
  message_id uuid references public.wa_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (hearing_id, kind),
  constraint hearing_staff_messages_kind_check check (kind in ('hearing_brief', 'hearing_result')),
  constraint hearing_staff_messages_phone_check check (phone is null or phone ~ '^[0-9]{12,15}$'),
  constraint hearing_staff_messages_status_check check (status in ('sent', 'skipped')),
  constraint hearing_staff_messages_reason_check check ((status = 'skipped') = (reason is not null)
    and (reason is null or reason ~ '^[a-z][a-z_]{2,40}$'))
);

alter table public.hearing_staff_messages enable row level security;
create policy "hearing_staff_messages_select_member" on public.hearing_staff_messages
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.hearing_staff_messages to authenticated;
create trigger guard_impersonation_hearing_staff_messages after insert or update or delete on public.hearing_staff_messages
  for each statement execute function public.guard_impersonation_readonly();

/** The WhatsApp of who goes to a hearing (0188): a person of the firm by their profile, else the hearing's own. */
create or replace function public.hearing_staff_phone(target_hearing uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.whatsapp from public.hearings h
     join public.memberships m on m.org_id = h.org_id and m.user_id = h.attendee_user_id
     join public.profiles p on p.id = h.attendee_user_id
     where h.id = target_hearing),
    (select h.attendee_phone from public.hearings h where h.id = target_hearing)
  );
$$;

revoke all on function public.hearing_staff_phone(uuid) from public, anon, authenticated;

/**
 * The hearings whose result ONE asks for now (0188): held by nobody yet, an hour or more past their start and within
 * the last two days, of a case that did not end, with nothing reported, never asked before, of somebody with a
 * WhatsApp. With what the message says. Service role.
 */
create or replace function public.hearing_results_owed(target_limit integer default 20)
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
      'hearing_id', h.id, 'kind', h.kind, 'starts_at', h.starts_at, 'time_zone', h.time_zone, 'case_seq', c.seq,
      'attendee_name', coalesce(h.attendee_name, (select p.display_name from public.profiles p where p.id = h.attendee_user_id))
    ) order by h.starts_at)
    from (
      select h.* from public.hearings h
      join public.cases c on c.id = h.case_id and c.status not in ('closed', 'declined')
      where h.status = 'scheduled'
        and h.starts_at < now() - interval '1 hour'
        and h.starts_at > now() - interval '2 days'
        and public.hearing_staff_phone(h.id) is not null
        and not exists (select 1 from public.hearing_reports r where r.hearing_id = h.id)
        and not exists (select 1 from public.hearing_staff_messages s where s.hearing_id = h.id and s.kind = 'hearing_result')
      order by h.starts_at
      limit greatest(least(coalesce(target_limit, 20), 100), 1)
    ) h
    join public.cases c on c.id = h.case_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.hearing_results_owed(integer) from public, anon, authenticated;
grant execute on function public.hearing_results_owed(integer) to service_role;

/**
 * Writes a message of a hearing to who goes to it (0188), once per hearing and kind, as the firm's template of that
 * kind: the brief told, or the result asked. What cannot go is kept as skipped with why. Answers the message queued,
 * for the outbox. Service role.
 */
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
      and (n.provider = 'test') = coalesce(current_case.is_test, false)
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

revoke all on function public.reserve_hearing_staff_message(uuid, text, text[]) from public, anon, authenticated;
grant execute on function public.reserve_hearing_staff_message(uuid, text, text[]) to service_role;
