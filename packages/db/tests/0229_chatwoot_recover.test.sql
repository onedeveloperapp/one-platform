begin;
create extension if not exists pgtap;
select plan(6);

-- ============================================================
-- The panel of attendance heals what it lost (0229). Firm A has two
-- conversations of one contact in its panel; taking one out of ONE takes its
-- conversation out of the panel and keeps the contact, which the other still
-- has; taking the other takes the contact too. A conversation the panel lost
-- is forgotten and marked to be written again. Firm B's panel is untouched.
--
-- Every person, firm and phone here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2290000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@recupera-a.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2290000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@recupera-b.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2290000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-recupera-229', 'a2290000-0000-4000-8000-000000000001'),
  ('b2290000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-recupera-229', 'a2290000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2290000-0000-4000-8000-00000000000a', 'a2290000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2290000-0000-4000-8000-00000000000b', 'a2290000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status) values
  ('d2290000-0000-4000-8000-00000000000a', 'b2290000-0000-4000-8000-00000000000a', 'whatsapp', 'sessao-229-a', 'WhatsApp A', 'connected'),
  ('d2290000-0000-4000-8000-00000000000c', 'b2290000-0000-4000-8000-00000000000a', 'whatsapp', 'sessao-229-c', 'WhatsApp C', 'connected'),
  ('d2290000-0000-4000-8000-00000000000b', 'b2290000-0000-4000-8000-00000000000b', 'whatsapp', 'sessao-229-b', 'WhatsApp B', 'connected');
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number) values
  ('f2290000-0000-4000-8000-00000000000a', 'b2290000-0000-4000-8000-00000000000a', 'd2290000-0000-4000-8000-00000000000a', 'openwa', 'sessao-229-a', 'sessao-229-a', '5562900002291'),
  ('f2290000-0000-4000-8000-00000000000c', 'b2290000-0000-4000-8000-00000000000a', 'd2290000-0000-4000-8000-00000000000c', 'openwa', 'sessao-229-c', 'sessao-229-c', '5562900002293'),
  ('f2290000-0000-4000-8000-00000000000b', 'b2290000-0000-4000-8000-00000000000b', 'd2290000-0000-4000-8000-00000000000b', 'openwa', 'sessao-229-b', 'sessao-229-b', '5562900002292');
insert into public.chatwoot_accounts (org_id, status, account_id, service_user_id, phone_user_id, inbox_id) values
  ('b2290000-0000-4000-8000-00000000000a', 'ready', 9201, 9202, 9203, 9204),
  ('b2290000-0000-4000-8000-00000000000b', 'ready', 9301, 9302, 9303, 9304);
-- Two conversations of the same client in A (two numbers), one in B.
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id, last_inbound_at, last_message_at, chatwoot_conversation_id, chatwoot_contact_id, chatwoot_agent) values
  ('c2290000-0000-4000-8000-00000000000a', 'b2290000-0000-4000-8000-00000000000a', 'f2290000-0000-4000-8000-00000000000a', '5562999992291', now(), now(), 1, 70, 'one'),
  ('c2290000-0000-4000-8000-00000000000c', 'b2290000-0000-4000-8000-00000000000a', 'f2290000-0000-4000-8000-00000000000c', '5562999992291', now(), now(), 2, 70, 'one'),
  ('c2290000-0000-4000-8000-00000000000b', 'b2290000-0000-4000-8000-00000000000b', 'f2290000-0000-4000-8000-00000000000b', '5562999992291', now(), now(), 1, 70, 'one');
insert into public.wa_messages (org_id, conversation_id, number_id, direction, kind, body, status, chatwoot_message_id) values
  ('b2290000-0000-4000-8000-00000000000a', 'c2290000-0000-4000-8000-00000000000c', 'f2290000-0000-4000-8000-00000000000c', 'in', 'text', 'Oi', 'received', 992901),
  ('b2290000-0000-4000-8000-00000000000b', 'c2290000-0000-4000-8000-00000000000b', 'f2290000-0000-4000-8000-00000000000b', 'in', 'text', 'Oi', 'received', 993001);

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);

-- 1. One of two conversations of a contact goes: its conversation leaves the panel, the contact stays.
delete from public.wa_conversations where id = 'c2290000-0000-4000-8000-00000000000a';
select ok(
  exists (select 1 from public.chatwoot_deletions where kind = 'conversation' and account_id = 9201 and target_id = 1)
  and not exists (select 1 from public.chatwoot_deletions where kind = 'contact' and account_id = 9201),
  'a conversation taken out of ONE leaves the panel, and the contact another conversation has stays'
);

-- 2. The contact is in use while a conversation of the firm has it, and only in its own firm's account.
select ok(
  public.chatwoot_contact_in_use(9201, 70)
  and not public.chatwoot_contact_in_use(9201, 71)
  and public.chatwoot_contact_in_use(9301, 70),
  'a contact is in use while a conversation of the firm of that account has it'
);

-- 3. The conversation the panel lost is forgotten, and marked to be written again.
select public.chatwoot_forget_conversation('c2290000-0000-4000-8000-00000000000c');
select ok(
  (select chatwoot_conversation_id is null and chatwoot_contact_id is null and chatwoot_agent is null
     and chatwoot_dirty_at is not null and chatwoot_failures = 0 and chatwoot_retry_at is null
   from public.wa_conversations where id = 'c2290000-0000-4000-8000-00000000000c')
  and (select chatwoot_message_id is null from public.wa_messages where conversation_id = 'c2290000-0000-4000-8000-00000000000c'),
  'a conversation the panel lost is forgotten there, its messages to be written again'
);
select ok(
  (select chatwoot_conversation_id = 1 from public.wa_conversations where id = 'c2290000-0000-4000-8000-00000000000b')
  and (select chatwoot_message_id = 993001 from public.wa_messages where conversation_id = 'c2290000-0000-4000-8000-00000000000b'),
  'nothing of another firm''s panel is forgotten'
);

-- 4. The last conversation of the contact goes (B's): its conversation and its contact leave B's panel.
delete from public.wa_conversations where id = 'c2290000-0000-4000-8000-00000000000b';
select ok(
  exists (select 1 from public.chatwoot_deletions where kind = 'conversation' and account_id = 9301 and target_id = 1)
  and exists (select 1 from public.chatwoot_deletions where kind = 'contact' and account_id = 9301 and target_id = 70),
  'the last conversation of a contact takes the contact out of the panel too'
);

-- 5. No session runs these.
select ok(
  not has_function_privilege('authenticated', 'public.chatwoot_forget_conversation(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.chatwoot_contact_in_use(integer, integer)', 'execute'),
  'no session forgets a conversation of the panel or asks about its contacts'
);

select * from finish();
rollback;
