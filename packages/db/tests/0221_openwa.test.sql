begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- A number of the platform's OpenWA (0221): a real number, as one of Meta.
-- Registered, it ends its firm's test chat and simulated number, and neither
-- is taken beside it; it counts among the firm's WhatsApp numbers; and while
-- a message of ONE to a person is being sent, the number's own messages to
-- that person wait (`wa_sending_to`). Two firms: the other keeps its test chat
-- and nothing of one reaches the other.
--
-- Every person, firm and phone here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2210000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@openwa-a.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2210000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@openwa-b.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2210000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-openwa-221', 'a2210000-0000-4000-8000-000000000001'),
  ('b2210000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-openwa-221', 'a2210000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2210000-0000-4000-8000-00000000000a', 'a2210000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2210000-0000-4000-8000-00000000000b', 'a2210000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status) values
  ('d2210000-0000-4000-8000-00000000000a', 'b2210000-0000-4000-8000-00000000000a', 'whatsapp', 'teste-a', 'Teste A', 'connected'),
  ('d2210000-0000-4000-8000-00000000000b', 'b2210000-0000-4000-8000-00000000000b', 'whatsapp', 'teste-b', 'Teste B', 'connected'),
  ('d2210000-0000-4000-8000-00000000001a', 'b2210000-0000-4000-8000-00000000000a', 'whatsapp', 'sessao-openwa-a', 'WhatsApp A', 'connected');
-- Each firm's test chat on its test number.
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number) values
  ('f2210000-0000-4000-8000-00000000000a', 'b2210000-0000-4000-8000-00000000000a', 'd2210000-0000-4000-8000-00000000000a', 'test', 'teste-221-a', 'teste-a', '5500900002211'),
  ('f2210000-0000-4000-8000-00000000000b', 'b2210000-0000-4000-8000-00000000000b', 'd2210000-0000-4000-8000-00000000000b', 'test', 'teste-221-b', 'teste-b', '5500900002212');
insert into public.test_chats (org_id, number_id, token) values
  ('b2210000-0000-4000-8000-00000000000a', 'f2210000-0000-4000-8000-00000000000a', repeat('e', 43)),
  ('b2210000-0000-4000-8000-00000000000b', 'f2210000-0000-4000-8000-00000000000b', repeat('f', 43));

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

-- 1. Firm A connects its number through OpenWA: its test chat and test number end; firm B's stay.
insert into res values ('registered', public.register_wa_number(
  'b2210000-0000-4000-8000-00000000000a', 'd2210000-0000-4000-8000-00000000001a', 'openwa',
  '8f3c2b1a-9d4e-4c7a-8b2f-1e6d5a4c3b2a', '8f3c2b1a-9d4e-4c7a-8b2f-1e6d5a4c3b2a', '5562900002213', null, 'coexistence'));
select ok(
  (select payload ->> 'code' from res where name = 'registered') = 'registered'
  and exists (select 1 from public.wa_numbers where org_id = 'b2210000-0000-4000-8000-00000000000a'
              and provider = 'openwa' and status = 'active' and mode = 'coexistence')
  and (select status = 'disconnected' and disconnect_reason = 'replaced_by_real_number'
       from public.wa_numbers where id = 'f2210000-0000-4000-8000-00000000000a')
  and (select status = 'ended' from public.test_chats where org_id = 'b2210000-0000-4000-8000-00000000000a'),
  'a number of OpenWA is a real number: it ends its firm''s test chat and test number'
);
select ok(
  (select status = 'active' from public.wa_numbers where id = 'f2210000-0000-4000-8000-00000000000b')
  and (select status = 'active' from public.test_chats where org_id = 'b2210000-0000-4000-8000-00000000000b'),
  'the other firm keeps its test chat and its test number'
);

-- 2. A test chat is not taken beside it.
insert into res values ('test_beside', public.register_wa_number(
  'b2210000-0000-4000-8000-00000000000a', 'd2210000-0000-4000-8000-00000000000a', 'test',
  'teste-221-a2', 'teste-a', '5500900002214', null, 'cloud'));
select is(
  (select payload ->> 'code' from res where name = 'test_beside'),
  'test_chat_not_allowed',
  'a test number is not taken beside a number of OpenWA'
);

-- 3. It counts among the firm's WhatsApp numbers.
select is(
  (public.usage_now('b2210000-0000-4000-8000-00000000000a') ->> 'whatsapp_numeros')::int,
  1,
  'the number of OpenWA counts among the firm''s WhatsApp numbers'
);

-- 4. While a message of ONE to a person is being sent, its id not recorded, the number's messages to that person wait.
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id) values
  ('f2220000-0000-4000-8000-00000000000a', 'b2210000-0000-4000-8000-00000000000a',
   (select id from public.wa_numbers where org_id = 'b2210000-0000-4000-8000-00000000000a' and provider = 'openwa'), '5562988880001');
insert into public.wa_messages (org_id, conversation_id, number_id, direction, kind, body, status, claimed_at) values
  ('b2210000-0000-4000-8000-00000000000a', 'f2220000-0000-4000-8000-00000000000a',
   (select id from public.wa_numbers where org_id = 'b2210000-0000-4000-8000-00000000000a' and provider = 'openwa'),
   'out', 'text', 'Olá, aqui é o escritório.', 'sending', now());
select ok(
  public.wa_sending_to((select id from public.wa_numbers where org_id = 'b2210000-0000-4000-8000-00000000000a' and provider = 'openwa'), '556288880001')
  and not public.wa_sending_to((select id from public.wa_numbers where org_id = 'b2210000-0000-4000-8000-00000000000a' and provider = 'openwa'), '5562988880009')
  and not public.wa_sending_to('f2210000-0000-4000-8000-00000000000b', '5562988880001'),
  'a message being sent to a person (with or without the ninth digit) holds the number''s own to that person, nobody else''s'
);

select * from finish();
rollback;
