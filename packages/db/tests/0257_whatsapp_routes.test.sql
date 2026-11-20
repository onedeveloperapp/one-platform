begin;
create extension if not exists pgtap;
select plan(16);

-- ============================================================
-- The way of a new contact (0257). The backend keeps where the routing of a conversation it holds stands, merged,
-- and the way it took on the conversation's record; a conversation it does not hold, or a way that is none, is
-- refused. A message that is nothing of a client goes to the team with no urgency: a person answers, nobody is called.
-- Firm B's conversation is untouched by A's, and nobody but the backend calls either function. The task that reads the
-- subject has its instructions in force, and the firm's words of the three new messages exist.
--
-- Every person, firm, number and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2570000-0000-4000-8000-000000000001', 'ana@souza-rotas.invalid', 'Ana Souza'),
  ('a2570000-0000-4000-8000-000000000002', 'caio@rocha-rotas.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2570000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-rotas', 'a2570000-0000-4000-8000-000000000001'),
  ('b2570000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-rotas', 'a2570000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2570000-0000-4000-8000-00000000000a', 'a2570000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2570000-0000-4000-8000-00000000000b', 'a2570000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status) values
  ('d2570000-0000-4000-8000-00000000000a', 'b2570000-0000-4000-8000-00000000000a', 'whatsapp', 'sessao-257-a', 'WhatsApp A', 'connected'),
  ('d2570000-0000-4000-8000-00000000000b', 'b2570000-0000-4000-8000-00000000000b', 'whatsapp', 'sessao-257-b', 'WhatsApp B', 'connected');
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number) values
  ('f2570000-0000-4000-8000-00000000000a', 'b2570000-0000-4000-8000-00000000000a', 'd2570000-0000-4000-8000-00000000000a', 'openwa', 'sessao-257-a', 'sessao-257-a', '5562900002571'),
  ('f2570000-0000-4000-8000-00000000000b', 'b2570000-0000-4000-8000-00000000000b', 'd2570000-0000-4000-8000-00000000000b', 'openwa', 'sessao-257-b', 'sessao-257-b', '5562900002572');
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id, contact_name, last_inbound_at, last_message_at, last_message_direction) values
  ('c2570000-0000-4000-8000-00000000000a', 'b2570000-0000-4000-8000-00000000000a', 'f2570000-0000-4000-8000-00000000000a', '5562999992571', 'Contato A', now(), now(), 'in'),
  ('c2570000-0000-4000-8000-00000000000b', 'b2570000-0000-4000-8000-00000000000b', 'f2570000-0000-4000-8000-00000000000b', '5562999992572', 'Contato B', now(), now(), 'in');
-- The backend holds both, as its claim of a turn does.
update public.wa_conversations set one_claimed_at = now(), one_claims = 1
where id in ('c2570000-0000-4000-8000-00000000000a', 'c2570000-0000-4000-8000-00000000000b');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- ---------- Where the routing stands ----------

select is(
  public.record_conversation_route('c2570000-0000-4000-8000-00000000000a', 1, '{"greeted": true}', 'greet') ->> 'code',
  'kept', 'the backend keeps that ONE greeted'
);
select is(
  public.record_conversation_route('c2570000-0000-4000-8000-00000000000a', 1, '{"asked": "familia"}', 'ask', 'Família e sucessões') ->> 'code',
  'kept', 'and that it asked what the person needs'
);
select is(
  (select route from public.wa_conversations where id = 'c2570000-0000-4000-8000-00000000000a'),
  '{"greeted": true, "asked": "familia"}'::jsonb, 'merged, each kept'
);
select is(
  (select array_agg(e.data ->> 'way' || ':' || coalesce(e.data ->> 'area', '') order by e.created_at, e.data ->> 'way' desc)
   from public.wa_conversation_events e
   where e.conversation_id = 'c2570000-0000-4000-8000-00000000000a' and e.kind = 'routed'),
  array['greet:', 'ask:Família e sucessões'], 'with the way taken on the conversation''s record'
);
select is(
  public.record_conversation_route('c2570000-0000-4000-8000-00000000000a', 2, '{"greeted": true}') ->> 'code',
  'not_working', 'never for a conversation the backend does not hold'
);
select is(
  public.record_conversation_route('c2570000-0000-4000-8000-00000000000a', 1, '{}', 'pular') ->> 'code',
  'invalid_route', 'nor a way that is none'
);
select is(
  public.record_conversation_route('c2570000-0000-4000-8000-00000000000a', 1, '[1]') ->> 'code',
  'invalid_route', 'nor a state that is no object'
);

-- ---------- Set aside ----------

select is(
  public.one_set_aside('c2570000-0000-4000-8000-00000000000a', 1, 'A mensagem não parece de um cliente.') ->> 'code',
  'set_aside', 'a message that is nothing of a client is set aside'
);
select is(
  (select array[agent::text, (called_at is null and called_reason is null)::text] from public.wa_conversations
   where id = 'c2570000-0000-4000-8000-00000000000a'),
  array['person', 'true'],
  'a person answers from then on, and nobody is called'
);
select is(
  (select count(*)::integer from public.wa_conversation_events
   where conversation_id = 'c2570000-0000-4000-8000-00000000000a' and kind = 'set_aside'
     and data ->> 'reason' = 'A mensagem não parece de um cliente.'),
  1, 'the reason on the conversation''s record'
);
select is(
  (select array[route::text, agent::text] from public.wa_conversations where id = 'c2570000-0000-4000-8000-00000000000b'),
  array['{}', 'one'], 'firm B''s conversation is untouched'
);

reset role;

-- ---------- Nobody else, and what the routing reads ----------

select ok(
  not has_function_privilege('authenticated', 'public.record_conversation_route(uuid, integer, jsonb, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.record_conversation_route(uuid, integer, jsonb, text, text)', 'execute'),
  'nobody but the backend keeps the routing'
);
select ok(
  not has_function_privilege('authenticated', 'public.one_set_aside(uuid, integer, text)', 'execute')
  and not has_function_privilege('anon', 'public.one_set_aside(uuid, integer, text)', 'execute'),
  'nor sets a conversation aside'
);
select is(
  (select model from public.prompt_versions where task = 'atendimento.assunto' and is_active),
  'claude-haiku-5-5', 'the task that reads the subject has its instructions in force'
);
select ok(
  not exists (select 1 from public.product_modules m where 'atendimento.assunto' = any (m.version_tasks)),
  'the core''s, in no module''s version'
);
select is(
  (select array_agg(key order by position) from public.one_messages where key in ('greeting', 'ask_summary', 'not_attended')),
  array['greeting', 'ask_summary', 'not_attended'], 'the firm says its own words of the three new messages'
);

select * from finish();
rollback;
