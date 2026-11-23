begin;
create extension if not exists pgtap;
select plan(15);

-- ============================================================
-- The data ONE asks in the chat, said as it is (0280). Firm A's passenger
-- lacks only what the chat's check of data asks (nationality, marital
-- status, profession): ONE's to ask while it has not asked, the client's to
-- answer once it did, ONE's to come while another question waits, and the
-- client's on the link when ONE cannot ask it there. The case screen follows
-- it. Firm B's case is never firm A's.
--
-- Every person, firm and number here is invented; the CPF is one every
-- manual uses as an example.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-pergunta.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2800000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-pergunta.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2800000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-pergunta', 'a2800000-0000-4000-8000-000000000001'),
  ('b2800000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-pergunta', 'a2800000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2800000-0000-4000-8000-00000000000a', 'a2800000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2800000-0000-4000-8000-00000000000b', 'a2800000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c2800000-0000-4000-8000-00000000000a', 'b2800000-0000-4000-8000-00000000000a', 'whatsapp', 'pergunta-waba-a', 'Chat de teste',
   'connected', 'a2800000-0000-4000-8000-000000000001', now()),
  ('c2800000-0000-4000-8000-00000000000b', 'b2800000-0000-4000-8000-00000000000b', 'whatsapp', 'pergunta-waba-b', 'Chat de teste',
   'connected', 'a2800000-0000-4000-8000-000000000002', now());
-- The documents a case needs are the setting's: none here, so what the case lacks is the person's data alone.
update public.platform_settings set value = jsonb_set(value, '{required_documents}', '[]'::jsonb) where key = 'cases';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b2800000-0000-4000-8000-00000000000a',
  'c2800000-0000-4000-8000-00000000000a', 'test', 'pergunta-number-a', 'pergunta-waba-a', '5500900000281', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b2800000-0000-4000-8000-00000000000b',
  'c2800000-0000-4000-8000-00000000000b', 'test', 'pergunta-number-b', 'pergunta-waba-b', '5500900000282', 'Rocha Advocacia', 'cloud'));
reset role;

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('d2800000-0000-4000-8000-000000000001', 'b2800000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'cancellation', 'documents'),
  ('d2800000-0000-4000-8000-000000000002', 'b2800000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'cancellation', 'documents');
insert into public.people (id, org_id, full_name, cpf, birth_date, phone, postal_code, street, address_number, district, city, uf) values
  ('e2800000-0000-4000-8000-000000000001', 'b2800000-0000-4000-8000-00000000000a', 'Nídia Teste Farias', '52998224725',
   '1980-05-10', '5500988882801', '74000000', 'Rua Exemplo', '100', 'Setor Teste', 'Goiânia', 'GO'),
  ('e2800000-0000-4000-8000-000000000002', 'b2800000-0000-4000-8000-00000000000b', 'Nídia Teste Farias', '52998224725',
   '1980-05-10', '5500988882801', '74000000', 'Rua Exemplo', '100', 'Setor Teste', 'Goiânia', 'GO');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('f2800000-0000-4000-8000-000000000001', 'b2800000-0000-4000-8000-00000000000a', 'd2800000-0000-4000-8000-000000000001',
   'e2800000-0000-4000-8000-000000000001', 'claimant'),
  ('f2800000-0000-4000-8000-000000000002', 'b2800000-0000-4000-8000-00000000000b', 'd2800000-0000-4000-8000-000000000002',
   'e2800000-0000-4000-8000-000000000002', 'claimant');
insert into public.flight_segments (org_id, case_id) values
  ('b2800000-0000-4000-8000-00000000000a', 'd2800000-0000-4000-8000-000000000001'),
  ('b2800000-0000-4000-8000-00000000000b', 'd2800000-0000-4000-8000-000000000002');
-- Firm A's passenger's identity and proof of address were accepted: ONE may check her data in the chat.
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at)
select x.id::uuid, 'b2800000-0000-4000-8000-00000000000a', 'whatsapp',
       'org/b2800000-0000-4000-8000-00000000000a/whatsapp/' || x.id, x.name, 'image/jpeg', 100, 'stored', x.sha, 100,
       'image/jpeg', now() + interval '1 hour', now()
from (values ('92800000-0000-4000-8000-000000000001', 'identidade.jpg', repeat('1', 64)),
             ('92800000-0000-4000-8000-000000000002', 'comprovante.jpg', repeat('2', 64))) as x (id, name, sha);
insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, status, decided_at) values
  ('b2800000-0000-4000-8000-00000000000a', 'd2800000-0000-4000-8000-000000000001', 'f2800000-0000-4000-8000-000000000001',
   '92800000-0000-4000-8000-000000000001', 'identity', 'whatsapp', 'accepted', now()),
  ('b2800000-0000-4000-8000-00000000000a', 'd2800000-0000-4000-8000-000000000001', 'f2800000-0000-4000-8000-000000000001',
   '92800000-0000-4000-8000-000000000002', 'address_proof', 'whatsapp', 'accepted', now());
-- Each firm's conversation with the passenger, inside the 24 hours; firm B's check is open.
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id, last_inbound_at, chat_step) values
  ('82800000-0000-4000-8000-00000000000a', 'b2800000-0000-4000-8000-00000000000a',
   (select n.id from public.wa_numbers n where n.org_id = 'b2800000-0000-4000-8000-00000000000a'),
   '5500988882801', now() - interval '1 hour', '{}'::jsonb),
  ('82800000-0000-4000-8000-00000000000b', 'b2800000-0000-4000-8000-00000000000b',
   (select n.id from public.wa_numbers n where n.org_id = 'b2800000-0000-4000-8000-00000000000b'),
   '5500988882801', now() - interval '1 hour', '{"step": "dados"}'::jsonb);

-- Each passenger has her link already.
insert into public.client_links (org_id, case_id, person_id, token_hash, expires_at) values
  ('b2800000-0000-4000-8000-00000000000a', 'd2800000-0000-4000-8000-000000000001', 'e2800000-0000-4000-8000-000000000001',
   repeat('a', 64), now() + interval '30 days'),
  ('b2800000-0000-4000-8000-00000000000b', 'd2800000-0000-4000-8000-000000000002', 'e2800000-0000-4000-8000-000000000002',
   repeat('b', 64), now() + interval '30 days');

-- Who has the case, ONE having already looked at it: what it waits for is the subject here, not ONE's next look.
create function pg_temp.standing(firm uuid, target uuid) returns text language sql as $$
  update public.case_advances set woken_at = null, checked_at = now() where case_id = target;
  select s.holder || ' ' || coalesce(s.why, 'nada') from public.case_standing(firm, null, null) s where s.case_id = target;
$$;

-- Ana Souza, of firm A, reads the case screen.
select set_config('request.jwt.claims', '{"sub":"a2800000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- Not asked yet: ONE's to ask, never the client's.
select is(public.case_data_in_chat('d2800000-0000-4000-8000-000000000001'),
  '{"person_id": "e2800000-0000-4000-8000-000000000001", "state": "to_ask"}'::jsonb,
  'ONE asks the passenger''s data in the chat, and has not asked yet');
select is(pg_temp.standing('b2800000-0000-4000-8000-00000000000a', 'd2800000-0000-4000-8000-000000000001'), 'one data',
  'data nobody asked yet is ONE''s to ask, never what the client owes');
insert into res values ('pulse', public.case_pulse('d2800000-0000-4000-8000-000000000001'));

-- ONE asked: the client answers in the chat.
update public.wa_conversations set chat_step = '{"step": "dados"}' where id = '82800000-0000-4000-8000-00000000000a';
select isnt(public.case_pulse('d2800000-0000-4000-8000-000000000001') ->> 'stamp', (select payload ->> 'stamp' from res where name = 'pulse'),
  'the case screen reads itself again once ONE asked');
select is(public.case_data_in_chat('d2800000-0000-4000-8000-000000000001') ->> 'state', 'asked', 'asked, it waits for the answer');
select is(pg_temp.standing('b2800000-0000-4000-8000-00000000000a', 'd2800000-0000-4000-8000-000000000001'), 'client lacks',
  'once ONE asked, the client answers it');

-- Another question waits first: ONE asks the data after it.
update public.wa_conversations set chat_step = '{"step": "residence"}' where id = '82800000-0000-4000-8000-00000000000a';
select is((select d.state from public.case_chat_data('d2800000-0000-4000-8000-000000000001') d), 'later',
  'with another question waiting, ONE asks the data after it');
select is(pg_temp.standing('b2800000-0000-4000-8000-00000000000a', 'd2800000-0000-4000-8000-000000000001'), 'one nada',
  'what ONE asks later is not what the client owes now');

-- The window closed with nothing asked: ONE cannot ask it there, the client completes it on the link.
update public.wa_conversations set chat_step = '{}'::jsonb, last_inbound_at = now() - interval '3 days'
where id = '82800000-0000-4000-8000-00000000000a';
select is((select count(*)::integer from public.case_chat_data('d2800000-0000-4000-8000-000000000001')), 0,
  'outside the 24 hours ONE does not ask it in the chat');
select is(pg_temp.standing('b2800000-0000-4000-8000-00000000000a', 'd2800000-0000-4000-8000-000000000001'), 'client lacks',
  'then the client completes it on the link');

-- Something the chat does not ask is missing too: the client's, as before.
update public.wa_conversations set last_inbound_at = now() - interval '1 hour' where id = '82800000-0000-4000-8000-00000000000a';
update public.people set cpf = null where id = 'e2800000-0000-4000-8000-000000000001';
select is(pg_temp.standing('b2800000-0000-4000-8000-00000000000a', 'd2800000-0000-4000-8000-000000000001'), 'client lacks',
  'a field the chat does not ask is still the client''s');

-- The power of attorney went to be signed by gov.br and came back signed: said once, by its envelope.
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at)
select x.id::uuid, 'b2800000-0000-4000-8000-00000000000a', 'case_document',
       'org/b2800000-0000-4000-8000-00000000000a/case_document/' || x.id, x.name, 'application/pdf', 100, 'stored', x.sha, 100,
       'application/pdf', now() + interval '1 hour', now()
from (values ('92800000-0000-4000-8000-000000000003', 'procuracao.pdf', repeat('3', 64)),
             ('92800000-0000-4000-8000-000000000004', 'procuracao-assinada.pdf', repeat('4', 64))) as x (id, name, sha);
insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status, decided_at) values
  ('72800000-0000-4000-8000-000000000001', 'b2800000-0000-4000-8000-00000000000a', 'd2800000-0000-4000-8000-000000000001',
   'f2800000-0000-4000-8000-000000000001', '92800000-0000-4000-8000-000000000003', 'power_of_attorney', 'firm', 'accepted', now());
insert into public.signature_envelopes (id, org_id, case_id, document_id, method, status, signers) values
  ('62800000-0000-4000-8000-000000000001', 'b2800000-0000-4000-8000-00000000000a', 'd2800000-0000-4000-8000-000000000001',
   '72800000-0000-4000-8000-000000000001', 'govbr', 'received', '[{"position": 1, "name": "Nídia Teste Farias"}]');
insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, status, envelope_id) values
  ('b2800000-0000-4000-8000-00000000000a', 'd2800000-0000-4000-8000-000000000001', 'f2800000-0000-4000-8000-000000000001',
   '92800000-0000-4000-8000-000000000004', 'power_of_attorney', 'client', 'received', '62800000-0000-4000-8000-000000000001');
select is(pg_temp.standing('b2800000-0000-4000-8000-00000000000a', 'd2800000-0000-4000-8000-000000000001'), 'firm signature_check',
  'a paper sent back signed is the firm''s to confirm on its envelope, never also a document to check');

-- Two firms.
select throws_ok($$ select public.case_data_in_chat('d2800000-0000-4000-8000-000000000002') $$, 'P0002', 'case_not_found',
  'firm A never reads firm B''s case');
select is((select count(*)::integer from public.case_standing('b2800000-0000-4000-8000-00000000000a', null, null) s
           where s.case_id = 'd2800000-0000-4000-8000-000000000002'), 0, 'firm B''s case is never firm A''s');
select is(pg_temp.standing('b2800000-0000-4000-8000-00000000000b', 'd2800000-0000-4000-8000-000000000002'), 'client lacks',
  'firm B''s passenger answers what ONE asked her');
select ok(
  not has_function_privilege('authenticated', 'public.case_chat_data(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.case_chat_data(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.case_data_in_chat(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.case_data_in_chat(uuid)', 'EXECUTE'),
  'the rule is the database''s own; the case screen reads it as a member');

select * from finish();
rollback;
