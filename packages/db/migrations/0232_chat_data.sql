-- ============================================================
-- The chat's script, its fourth part (0232): the client checks their data
-- in the chat. Once their identity and proof of address were accepted and
-- ONE read what they say (0063), ONE shows it in one message for the client
-- to confirm or correct, then asks, one at a time, what the papers need and
-- no document gives (the nationality, the marital status, the profession).
-- What the client confirms clears the marks of what was read
-- (`people.read_fields`): it is theirs now, as a field they write on the
-- link is. What they correct goes through the same checks as on the link
-- (`apply_person_fields`, written by the client). Where the conversation
-- stands after the case opened is `wa_conversations.chat_step`, ONE's own:
-- the step that waits for an answer and the cases whose data was checked.
-- A firm that accepts a document by hand later is not left behind: the
-- check is owed then and ONE starts it inside the 24 hours
-- (`chat_data_checks_owed`, `one_start_data_check`).
-- ============================================================

alter table public.wa_conversations add column chat_step jsonb not null default '{}'::jsonb;
alter table public.wa_conversations add constraint wa_conversations_chat_step_check check (
  jsonb_typeof(chat_step) = 'object' and octet_length(chat_step::text) <= 2000
);

/**
 * The passenger of the case a conversation gathers and their data as the record has it (0232): what ONE shows them
 * to check. Null when there is no case being gathered or no passenger in it. Internal.
 */
create or replace function public.conversation_person_data(conversation public.wa_conversations)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case uuid := public.conversation_gathered_case(conversation);
  passenger public.case_parties%rowtype;
  person public.people%rowtype;
begin
  if current_case is null then
    return null;
  end if;
  select cp.* into passenger from public.case_parties cp join public.people p on p.id = cp.person_id
  where cp.case_id = current_case
    and p.phone = any (public.wa_phone_variants(conversation.contact_wa_id) || conversation.contact_wa_id)
  order by (cp.role = 'claimant') desc, cp.created_at, cp.id
  limit 1;
  if passenger.id is null then
    return null;
  end if;
  select * into person from public.people where id = passenger.person_id;
  return jsonb_build_object(
    'case_id', current_case,
    'person_id', person.id,
    'full_name', person.full_name,
    'cpf', person.cpf,
    'birth_date', person.birth_date,
    'minor', person.birth_date is not null and person.birth_date > (current_date - interval '18 years')::date,
    'nationality', person.nationality,
    'marital_status', person.marital_status,
    'profession', person.profession,
    'postal_code', person.postal_code,
    'street', person.street,
    'address_number', person.address_number,
    'complement', person.complement,
    'district', person.district,
    'city', person.city,
    'uf', person.uf,
    'read', coalesce((select jsonb_agg(k) from jsonb_object_keys(person.read_fields) k), '[]'::jsonb),
    -- What ONE read is there once the identity and the proof of address were accepted.
    'documents_in', exists (
      select 1 from public.case_documents d join public.case_parties x on x.id = d.party_id
      where d.case_id = current_case and x.person_id = person.id and d.kind = 'identity' and d.status = 'accepted'
    ) and exists (
      select 1 from public.case_documents d join public.case_parties x on x.id = d.party_id
      where d.case_id = current_case and x.person_id = person.id and d.kind = 'address_proof' and d.status = 'accepted'
    ),
    'checked', coalesce(conversation.chat_step -> 'checked', '[]'::jsonb) ? current_case::text,
    'step', conversation.chat_step
  );
end;
$$;

revoke all on function public.conversation_person_data(public.wa_conversations) from public, anon, authenticated;

/** The passenger's data of the case a conversation gathers (0232). Service role, for the conversation the backend holds. */
create or replace function public.conversation_person(target_conversation uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  data jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  data := public.conversation_person_data(conversation);
  if data is null then
    return jsonb_build_object('ok', true, 'code', 'no_case');
  end if;
  return jsonb_build_object('ok', true, 'code', 'person') || data;
end;
$$;

revoke all on function public.conversation_person(uuid, integer) from public, anon, authenticated;

/**
 * Where the conversation stands after the case opened (0232): the step that waits for an answer, replaced whole, and
 * a case whose data the client finished checking added to `checked`. Service role, for the conversation the backend
 * holds.
 */
create or replace function public.record_chat_step(
  target_conversation uuid,
  target_claim integer,
  target_step jsonb,
  target_checked uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  checked jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if jsonb_typeof(coalesce(target_step, '{}'::jsonb)) <> 'object' or octet_length(coalesce(target_step, '{}'::jsonb)::text) > 1000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  checked := coalesce(conversation.chat_step -> 'checked', '[]'::jsonb);
  if target_checked is not null and not checked ? target_checked::text then
    checked := checked || to_jsonb(target_checked::text);
  end if;
  update public.wa_conversations
  set chat_step = (coalesce(target_step, '{}'::jsonb) - 'checked') || jsonb_build_object('checked', checked)
  where id = conversation.id;
  return jsonb_build_object('ok', true, 'code', 'kept');
end;
$$;

revoke all on function public.record_chat_step(uuid, integer, jsonb, uuid) from public, anon, authenticated;

/**
 * The client writes their own data in the chat (0232), through the same checks as on their link (written by the
 * client); with `target_confirm`, what ONE read is theirs now and its marks go. Service role, for the conversation
 * the backend holds.
 */
create or replace function public.one_person_fields(
  target_conversation uuid,
  target_claim integer,
  target_fields jsonb,
  target_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  data jsonb;
  person uuid;
  written jsonb := jsonb_build_object('ok', true, 'changed', '[]'::jsonb);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  data := public.conversation_person_data(conversation);
  if data is null then
    return jsonb_build_object('ok', false, 'code', 'no_case');
  end if;
  person := (data ->> 'person_id')::uuid;
  perform set_config('one.system_case', data ->> 'case_id', true);
  if jsonb_typeof(coalesce(target_fields, '{}'::jsonb)) = 'object' and coalesce(target_fields, '{}'::jsonb) <> '{}'::jsonb then
    written := public.apply_person_fields(person, target_fields, 'client');
    if not coalesce((written ->> 'ok')::boolean, false) then
      perform set_config('one.system_case', '', true);
      return written;
    end if;
  end if;
  if target_confirm then
    update public.people set read_fields = '{}'::jsonb where id = person and read_fields <> '{}'::jsonb;
    perform public.record_case_event(conversation.org_id, (data ->> 'case_id')::uuid, 'person_confirmed', 'client',
      jsonb_build_object('person', person, 'from', 'conversation'));
  end if;
  perform set_config('one.system_case', '', true);
  return jsonb_build_object('ok', true, 'code', 'kept', 'changed', coalesce(written -> 'changed', '[]'::jsonb));
end;
$$;

revoke all on function public.one_person_fields(uuid, integer, jsonb, boolean) from public, anon, authenticated;

/**
 * The checks of data ONE owes in the chat (0232): a conversation ONE carries inside the 24 hours, of a case being
 * gathered whose passenger's identity and proof of address were accepted, whose data was not checked yet and with no
 * step waiting for another answer. With the data to show. Service role.
 */
create or replace function public.chat_data_checks_owed(target_limit integer default 20)
returns table (conversation_id uuid, person jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  select x.id, x.data
  from (
    select wc.id, public.conversation_person_data(wc) as data, wc.last_inbound_at
    from public.wa_conversations wc
    join public.wa_numbers n on n.id = wc.number_id and n.status = 'active'
    where wc.agent = 'one'
      and public.wa_window_open(wc.last_inbound_at)
      and coalesce(wc.chat_step ->> 'step', '') = ''
      and not exists (select 1 from public.wa_optouts o where o.org_id = wc.org_id and o.contact_wa_id = wc.contact_wa_id)
  ) x
  where x.data is not null and (x.data ->> 'documents_in')::boolean and not (x.data ->> 'checked')::boolean
    and not (x.data ->> 'minor')::boolean
  order by x.last_inbound_at
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;

revoke all on function public.chat_data_checks_owed(integer) from public, anon, authenticated;
grant execute on function public.chat_data_checks_owed(integer) to service_role;

/**
 * ONE starts the check of data in the chat (0232): only while it is still owed (checked again under the
 * conversation's lock), the step it waits on kept in the same transaction as the message. Service role.
 */
create or replace function public.one_start_data_check(target_conversation uuid, target_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  message uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.chat_data_checks_owed(100) o where o.conversation_id = target_conversation) then
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  select * into conversation from public.wa_conversations where id = target_conversation for update;
  update public.wa_conversations set chat_step = chat_step || '{"step": "dados"}'::jsonb where id = conversation.id;
  message := public.one_message(conversation, target_body, null, null);
  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message);
exception when sqlstate 'P0001' then
  return jsonb_build_object('ok', false, 'code', sqlerrm);
end;
$$;

revoke all on function public.one_start_data_check(uuid, text) from public, anon, authenticated;
grant execute on function public.one_start_data_check(uuid, text) to service_role;
