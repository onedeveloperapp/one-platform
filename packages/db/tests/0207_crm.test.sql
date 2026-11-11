begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- The CRM of the attendance (0207). Maria wrote to Lima's WhatsApp from an
-- ad, told a cancellation and stopped answering after ONE asked the flight:
-- the ad is kept once and said in the conversation, and she is owed a
-- follow-up three hours after ONE's question, then another at twenty, never
-- a third; writing again starts the count over. João, who asked to stop, is
-- owed none; nor is a conversation a person of the firm holds. A case the
-- intake opens is of the origin `ads`. Rocha reads nothing of Lima's.
--
-- Every person, firm, number and ad here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a2070000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'ana@lima-crm.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2070000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-crm', 'a2070000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2070000-0000-4000-8000-00000000000a', 'a2070000-0000-4000-8000-000000000001', 'owner', 'socio');
insert into public.connections (id, org_id, provider, label, status) values
  ('c2070000-0000-4000-8000-000000000001', 'b2070000-0000-4000-8000-00000000000a', 'whatsapp', 'WhatsApp', 'connected');
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number)
values ('d2070000-0000-4000-8000-000000000001', 'b2070000-0000-4000-8000-00000000000a', 'c2070000-0000-4000-8000-000000000001',
        'simulator', 'phone-crm-1', 'waba-crm-1', '5562900002070');
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id, contact_name, agent, intake, intake_at,
                                     last_inbound_at, last_message_at, last_message_direction)
values
  ('e2070000-0000-4000-8000-000000000001', 'b2070000-0000-4000-8000-00000000000a', 'd2070000-0000-4000-8000-000000000001',
   '5562999992071', 'Maria Teste', 'one', '{"problema":"cancellation"}', now() - interval '4 hours',
   now() - interval '4 hours', now() - interval '3 hours 30 minutes', 'out'),
  ('e2070000-0000-4000-8000-000000000002', 'b2070000-0000-4000-8000-00000000000a', 'd2070000-0000-4000-8000-000000000001',
   '5562999992072', 'João Teste', 'one', '{"problema":"delay"}', now() - interval '4 hours',
   now() - interval '4 hours', now() - interval '3 hours 30 minutes', 'out'),
  ('e2070000-0000-4000-8000-000000000003', 'b2070000-0000-4000-8000-00000000000a', 'd2070000-0000-4000-8000-000000000001',
   '5562999992073', 'Bia Teste', 'person', '{"problema":"delay"}', now() - interval '4 hours',
   now() - interval '4 hours', now() - interval '3 hours 30 minutes', 'out');
insert into public.wa_optouts (org_id, contact_wa_id, source) values ('b2070000-0000-4000-8000-00000000000a', '5562999992072', 'keyword');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, path text[]) returns text language sql as
$$ select payload #>> got.path from res where res.name = got.name; $$;
create function pg_temp.owed() returns jsonb language sql as $$
  select coalesce(jsonb_agg(o.conversation_id order by o.conversation_id), '[]'::jsonb)
  from public.lead_followups_owed(100) o where o.org_id = 'b2070000-0000-4000-8000-00000000000a';
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res select 'ad', jsonb_build_object('kept', public.wa_record_ad_referral('e2070000-0000-4000-8000-000000000001',
  '{"source_type":"ad","source_id":"120000000000001","source_url":"https://fb.me/anuncio","headline":"Voo cancelado?","ctwa_clid":"clique","body":"texto"}'));
insert into res select 'ad_again', jsonb_build_object('kept', public.wa_record_ad_referral('e2070000-0000-4000-8000-000000000001',
  '{"source_type":"ad","source_id":"999"}'));
insert into res select 'owed', jsonb_build_object('list', pg_temp.owed());
insert into res select 'first', public.one_lead_followup('e2070000-0000-4000-8000-000000000001',
  'Oi, ainda posso te ajudar com o que aconteceu no seu voo. Qual era o número do voo?');
insert into res select 'owed_after', jsonb_build_object('list', pg_temp.owed());
reset role;

select ok(
  pg_temp.got('ad', '{kept}') = 'true' and pg_temp.got('ad_again', '{kept}') = 'false'
  and (select ad_referral = '{"source_type":"ad","source_id":"120000000000001","source_url":"https://fb.me/anuncio","headline":"Voo cancelado?","ctwa_clid":"clique"}'::jsonb
       from public.wa_conversations where id = 'e2070000-0000-4000-8000-000000000001')
  and exists (select 1 from public.wa_conversation_events where kind = 'came_from_ad' and data ->> 'reason' = 'Voo cancelado?'),
  'the ad a conversation came from is kept once, cleaned, and said in the conversation'
);

select ok(
  pg_temp.got('owed', '{list}') = '["e2070000-0000-4000-8000-000000000001"]',
  'a lead ONE asked and who went quiet is owed a follow-up; one who asked to stop or whom a person holds is not'
);

select ok(
  pg_temp.got('first', '{ok}') = 'true' and pg_temp.got('owed_after', '{list}') = '[]'
  and (select followups = 1 from public.wa_conversations where id = 'e2070000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.wa_messages where conversation_id = 'e2070000-0000-4000-8000-000000000001'
         and direction = 'out' and status = 'queued')
  and exists (select 1 from public.wa_conversation_events where kind = 'lead_followup'
                and conversation_id = 'e2070000-0000-4000-8000-000000000001'),
  'ONE follows up once, as its message, and owes no other until the next step''s hours'
);

-- Twenty hours after the first follow-up the second is owed; after it, none.
update public.wa_conversations set last_message_at = now() - interval '21 hours', last_inbound_at = now() - interval '22 hours'
where id = 'e2070000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res select 'second', public.one_lead_followup('e2070000-0000-4000-8000-000000000001', 'Sigo por aqui.');
reset role;
update public.wa_conversations set last_message_at = now() - interval '23 hours' where id = 'e2070000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res select 'third', public.one_lead_followup('e2070000-0000-4000-8000-000000000001', 'De novo.');
reset role;

select ok(
  pg_temp.got('second', '{ok}') = 'true' and pg_temp.got('third', '{code}') = 'not_owed',
  'the second follow-up comes at the next step''s hours, and there is no third'
);

-- She writes again: the count starts over.
insert into public.wa_messages (org_id, conversation_id, number_id, direction, kind, body, status, wa_message_id)
values ('b2070000-0000-4000-8000-00000000000a', 'e2070000-0000-4000-8000-000000000001',
        'd2070000-0000-4000-8000-000000000001', 'in', 'text', 'Era o voo 1234.', 'received', 'wamid.crm-1');

select ok(
  (select followups = 0 and followup_at is null from public.wa_conversations where id = 'e2070000-0000-4000-8000-000000000001'),
  'writing again starts the count of follow-ups over'
);

-- The intake opens a case: it is of the origin `ads`.
insert into public.cases (id, org_id, seq, module, incident, status, origin) values
  ('f2070000-0000-4000-8000-000000000001', 'b2070000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro',
   'cancellation', 'intake', 'organic');
update public.wa_conversations set intake_case_id = 'f2070000-0000-4000-8000-000000000001'
where id = 'e2070000-0000-4000-8000-000000000001';

select ok(
  (select origin = 'ads' from public.cases where id = 'f2070000-0000-4000-8000-000000000001'),
  'a case the intake of a conversation from an ad opens is of the origin ads'
);

select ok(
  not has_function_privilege('authenticated', 'public.lead_followups_owed(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.one_lead_followup(uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.wa_record_ad_referral(uuid, jsonb)', 'EXECUTE'),
  'only the backend keeps an ad and follows a lead up'
);

select * from finish();
rollback;
