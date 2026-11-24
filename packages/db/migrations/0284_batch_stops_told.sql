-- ============================================================
-- What ONE's browser waits for is told to the lawyer (0284). The owner,
-- 2026-11-24 ("pode passar o aviso ao advogado"): a batch of ONE's own
-- browser stops for its lawyer when the court asks the code of their
-- authenticator or their e-mail (0264, `ask_filing_batch_code`: ONE waits
-- five minutes) and when ONE, still learning a system, holds its first filing
-- before anything that may send it (`hold_filing_submission`: thirty
-- minutes), and nothing reached the lawyer outside /protocolo. And a batch it
-- stopped for any reason but a person's own (a code that never came, a login
-- the court refused, a captcha, an answer that could not be read) left its
-- lawsuits to approve again with nobody told.
--
-- Each of those stops is now told to the batch's lawyer the moment the
-- browser stops, on the bell and on their WhatsApp as the firm's template of
-- a new kind for the team (`filing_batch_waits`, as 0188's and 0269's), with
-- the way to /protocolo; the court's code is never asked there, only in ONE
-- (the canvas the owner approved: "O aviso só chama"). Once per stop
-- (`filing_batch_notices`): a code asked again within ten minutes (a wrong
-- code, the court asking once more) is the same stop; what cannot go is kept
-- as skipped with why. A stop that no longer holds (the code given, the
-- filing confirmed) is not told.
-- ============================================================

alter table public.notice_kinds drop constraint notice_kinds_kind_check;
alter table public.notice_kinds add constraint notice_kinds_kind_check check (kind in (
  'hearing_reminder', 'hearing_change', 'lawsuit_update', 'payment_alert', 'document_refused', 'flight_problem',
  'case_received', 'lawsuit_filed', 'case_questions', 'trip_departure', 'trip_arrival', 'welcome',
  'hearing_brief', 'hearing_result', 'hearing_outcome', 'filing_waits', 'filing_batch_waits'
));

insert into public.notice_kinds (kind, position, template_base, body, footer, params, examples) values
  ('filing_batch_waits', 17, 'one_protocolo_espera',
   'Olá, {{1}}. O protocolo do ONE no {{2}} precisa de você: {{3}}. Abra Protocolo no ONE para seguir.',
   'Mensagem para a equipe do escritório.',
   array['first_name', 'court', 'what'],
   array['Ana', 'eproc do TJSP', 'o tribunal pediu o código do seu aplicativo'])
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

create table public.filing_batch_notices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  batch_id uuid not null references public.filing_batches (id) on delete cascade,
  -- code     the court asked the lawyer's code;
  -- confirm  ONE holds the first filing at a system it still learns, for the lawyer's word;
  -- stopped  ONE's browser stopped the batch, for a reason not a person's own.
  kind text not null,
  -- Which stop: when the code was asked, the filing held, or the batch itself.
  subject text not null,
  user_id uuid references public.profiles (id) on delete set null,
  phone text,
  status text not null,
  reason text,
  message_id uuid references public.wa_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (batch_id, kind, subject),
  constraint filing_batch_notices_kind_check check (kind in ('code', 'confirm', 'stopped')),
  constraint filing_batch_notices_subject_check check (char_length(subject) between 1 and 80),
  constraint filing_batch_notices_phone_check check (phone is null or phone ~ '^[0-9]{12,15}$'),
  constraint filing_batch_notices_status_check check (status in ('sent', 'skipped')),
  constraint filing_batch_notices_reason_check check ((status = 'skipped') = (reason is not null)
    and (reason is null or reason ~ '^[a-z][a-z_]{2,40}$'))
);

create index filing_batch_notices_org_idx on public.filing_batch_notices (org_id, created_at desc);

alter table public.filing_batch_notices enable row level security;
create policy "filing_batch_notices_select_member" on public.filing_batch_notices
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.filing_batch_notices to authenticated;
create trigger guard_impersonation_filing_batch_notices after insert or update or delete on public.filing_batch_notices
  for each statement execute function public.guard_impersonation_readonly();

/**
 * Keeps a stop of a batch of ONE's browser told to its lawyer (0284), once per stop, and writes it to their WhatsApp
 * as the firm's template of `filing_batch_waits`; what cannot go there is kept as skipped with why, and the bell rings
 * all the same. Told only while the stop holds: the code still asked, the filing still held, the batch stopped for a
 * reason not a person's own. A code asked again within ten minutes of one told is the same stop (`already`). Answers
 * the lawyer and the message queued, for the outbox. Service role.
 */
create or replace function public.reserve_filing_batch_notice(
  target_batch uuid,
  target_kind text,
  target_subject text,
  target_params text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  batch public.filing_batches%rowtype;
  notice public.notice_kinds%rowtype;
  template public.wa_templates%rowtype;
  sender public.wa_numbers%rowtype;
  testing boolean;
  waiting boolean;
  phone text;
  conversation uuid;
  message uuid;
  kept uuid;
  rendered text;
  skip text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_kind is null or target_kind not in ('code', 'confirm', 'stopped')
     or target_subject is null or char_length(target_subject) not between 1 and 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  select * into batch from public.filing_batches where id = target_batch for update;
  if not found or batch.way <> 'browser' or batch.person_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if exists (
    select 1 from public.filing_batch_notices n
    where n.batch_id = batch.id and n.kind = target_kind
      and (n.subject = target_subject or (target_kind = 'code' and n.created_at > now() - interval '10 minutes'))
  ) then
    return jsonb_build_object('ok', true, 'code', 'already');
  end if;
  -- Told only while the stop holds.
  waiting := case target_kind
    when 'code' then batch.status = 'awaiting_code'
    when 'confirm' then exists (
      select 1 from public.filing_submissions s
      where s.batch_id = batch.id and s.id::text = target_subject and s.status = 'confirming')
    else batch.status = 'stopped'
      and coalesce(batch.error, 'stopped') not in ('by_person', 'by_lawyer', 'by_person_code')
  end;
  if not coalesce(waiting, false) then
    return jsonb_build_object('ok', true, 'code', 'not_waiting');
  end if;

  -- A batch of test cases goes through the test chat's number, a real one through the firm's real number (0220).
  testing := exists (
    select 1 from public.filing_submissions s join public.cases k on k.id = s.case_id
    where s.batch_id = batch.id and coalesce(k.is_test, false)
  ) and not public.is_test_firm(batch.org_id);
  select p.whatsapp into phone from public.profiles p where p.id = batch.person_id;
  select * into notice from public.notice_kinds k where k.kind = 'filing_batch_waits';
  select t.* into template from public.wa_templates t
  join public.firm_notice_kinds k on k.template_id = t.id
  where k.org_id = batch.org_id and k.kind = 'filing_batch_waits' and k.enabled
    and t.status = 'approved' and t.category = 'utility';
  if found then
    select n.* into sender from public.wa_numbers n
    join public.connections cn on cn.id = n.connection_id and cn.status = 'connected'
    where n.org_id = batch.org_id and n.waba_id = template.waba_id and n.status = 'active'
      and (n.provider = 'test') = testing
    order by n.connected_at
    limit 1;
  end if;

  skip := case
    when phone is null then 'no_phone'
    when exists (
      select 1 from public.wa_optouts o
      where o.org_id = batch.org_id and o.contact_wa_id = any (public.wa_phone_variants(phone))
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
    insert into public.filing_batch_notices (org_id, batch_id, kind, subject, user_id, phone, status, reason)
    values (batch.org_id, batch.id, target_kind, target_subject, batch.person_id, phone, 'skipped', skip)
    on conflict (batch_id, kind, subject) do nothing
    returning id into kept;
    if kept is null then
      return jsonb_build_object('ok', true, 'code', 'already');
    end if;
    insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
    values (batch.org_id, null, 'system', 'filing_batch.told', 'filing_batch', batch.id::text,
            jsonb_build_object('kind', target_kind, 'whatsapp', skip));
    return jsonb_build_object('ok', true, 'code', 'skipped', 'reason', skip, 'user_id', batch.person_id);
  end if;

  select wc.id into conversation from public.wa_conversations wc
  where wc.number_id = sender.id and wc.contact_wa_id = any (public.wa_phone_variants(phone))
  order by wc.last_inbound_at desc nulls last
  limit 1;
  if conversation is null then
    conversation := public.wa_open_conversation(batch.org_id, sender.id, phone, null);
  end if;

  rendered := public.notice_rendered(template.body, target_params);
  insert into public.wa_messages (
    org_id, conversation_id, number_id, direction, origin, kind, body, template_id, template_name, template_params, status
  ) values (
    batch.org_id, conversation, sender.id, 'out', 'cloud', 'template', rendered, template.id, template.name,
    to_jsonb(target_params), 'queued'
  )
  returning id into message;
  update public.wa_conversations set
    last_message_at = now(),
    last_message_preview = public.wa_preview('template', rendered),
    last_message_direction = 'out'
  where id = conversation
    and not (last_message_direction = 'in' and last_inbound_at is not null and last_inbound_at >= last_message_at);

  insert into public.filing_batch_notices (org_id, batch_id, kind, subject, user_id, phone, status, message_id)
  values (batch.org_id, batch.id, target_kind, target_subject, batch.person_id, phone, 'sent', message);
  insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (batch.org_id, null, 'system', 'filing_batch.told', 'filing_batch', batch.id::text,
          jsonb_build_object('kind', target_kind, 'whatsapp', 'sent'));
  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message, 'user_id', batch.person_id);
end;
$$;

revoke all on function public.reserve_filing_batch_notice(uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function public.reserve_filing_batch_notice(uuid, text, text, text[]) to service_role;
