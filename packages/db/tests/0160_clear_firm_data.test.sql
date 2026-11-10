begin;
create extension if not exists pgtap;
select plan(30);

-- ============================================================
-- Apagar os casos e clientes do escritório (0161): who decides for the firm,
-- with the second factor, never a support visit, the word typed; everything of
-- the firm's cases, clients and conversations goes, with the agency's
-- passengers at the test chat's numbers and the children they answer for; what
-- a row that stays names (a document ONE issued), the books' and the library's
-- files, the agency's other passengers, the settings and the other firm stay.
-- Two firms: Lima clears, Rocha is never touched.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1600000-0000-4000-8000-000000000001', 'ana@lima-limpeza.invalid', 'Ana Lima'),
  ('a1600000-0000-4000-8000-000000000002', 'caio@lima-limpeza.invalid', 'Caio Lima'),
  ('a1600000-0000-4000-8000-000000000003', 'duda@rocha-limpeza.invalid', 'Duda Rocha'),
  ('a1600000-0000-4000-8000-000000000004', 'gil@sol-limpeza.invalid', 'Gil Sol'),
  ('a1600000-0000-4000-8000-000000000009', 'suporte@one-limpeza.invalid', 'Suporte')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1600000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-limpeza', 'a1600000-0000-4000-8000-000000000001'),
  ('b1600000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-limpeza', 'a1600000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1600000-0000-4000-8000-00000000000a', 'a1600000-0000-4000-8000-000000000001', 'member', 'socio'),
  ('b1600000-0000-4000-8000-00000000000a', 'a1600000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1600000-0000-4000-8000-00000000000b', 'a1600000-0000-4000-8000-000000000003', 'owner', 'socio');

-- ---------- The cases, clients and what hangs on them ----------

insert into public.people (id, org_id, full_name, cpf, phone) values
  ('d1600000-0000-4000-8000-000000000001', 'b1600000-0000-4000-8000-00000000000a', 'Maria Teste', '52998224725', '5500988880001'),
  ('d1600000-0000-4000-8000-000000000002', 'b1600000-0000-4000-8000-00000000000a', 'Lia Teste', null, null),
  ('d1600000-0000-4000-8000-000000000003', 'b1600000-0000-4000-8000-00000000000b', 'Rui Teste', '12345678909', null);
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1600000-0000-4000-8000-000000000001', 'b1600000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c1600000-0000-4000-8000-000000000002', 'b1600000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'intake');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1600000-0000-4000-8000-000000000001', 'b1600000-0000-4000-8000-00000000000a', 'c1600000-0000-4000-8000-000000000001',
   'd1600000-0000-4000-8000-000000000001', 'claimant'),
  ('e1600000-0000-4000-8000-000000000002', 'b1600000-0000-4000-8000-00000000000b', 'c1600000-0000-4000-8000-000000000002',
   'd1600000-0000-4000-8000-000000000003', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1600000-0000-4000-8000-000000000001', 'b1600000-0000-4000-8000-00000000000a', 'c1600000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '00051016820998090051', '2026-10-01');
insert into public.hearings (org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode) values
  ('b1600000-0000-4000-8000-00000000000a', 'c1600000-0000-4000-8000-000000000001', 'f1600000-0000-4000-8000-000000000001',
   'conciliacao', now() + interval '20 days', 'America/Sao_Paulo', 'videoconferencia');
insert into public.deadlines (org_id, cnj, court, case_id, proceeding_id, title, trigger, trigger_on, days, counting) values
  ('b1600000-0000-4000-8000-00000000000a', '00051016820998090051', 'TJGO', 'c1600000-0000-4000-8000-000000000001',
   'f1600000-0000-4000-8000-000000000001', 'Réplica à contestação', 'day', '2026-10-05', 15, 'business');
insert into public.publications (org_id, hash, court, cnj, available_on, kind, body, lawyer_ids) values
  ('b1600000-0000-4000-8000-00000000000a', 'hashlimpeza0000001abcdefghijkl', 'TJGO', '00051016820998090051', current_date,
   'Intimação', 'Texto de teste.', array['a1600000-0000-4000-8000-000000000002']::uuid[]),
  ('b1600000-0000-4000-8000-00000000000b', 'hashlimpeza0000002abcdefghijkl', 'TJGO', '00051025320998090051', current_date,
   'Intimação', 'Texto de teste.', array['a1600000-0000-4000-8000-000000000003']::uuid[]);
insert into public.import_batches (id, org_id, file_name) values
  ('aa160000-0000-4000-8000-00000000000a', 'b1600000-0000-4000-8000-00000000000a', 'carteira-lima.xlsx');

-- Lima's files: a client's document of the case, a photo of the conversation, a document ONE issued (whose public
-- code still answers), a statement of the books and a document sent for a model of the library. Rocha's one.
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, pages, expires_at, confirmed_at)
select f.id::uuid, f.org::uuid, f.purpose, 'org/' || f.org || '/' || f.purpose || '/' || f.id, f.name,
       'application/pdf', 100, 'stored', repeat(f.mark, 64), 100, 'application/pdf', 1, now() + interval '1 hour', now()
from (values
  ('a2160000-0000-4000-8000-000000000001', 'b1600000-0000-4000-8000-00000000000a', 'upload', 'identidade-maria.pdf', 'a'),
  ('a2160000-0000-4000-8000-000000000002', 'b1600000-0000-4000-8000-00000000000a', 'whatsapp', 'foto.pdf', 'b'),
  ('a2160000-0000-4000-8000-000000000003', 'b1600000-0000-4000-8000-00000000000a', 'issued', 'procuracao.pdf', 'c'),
  ('a2160000-0000-4000-8000-000000000004', 'b1600000-0000-4000-8000-00000000000a', 'finance', 'extrato.pdf', 'd'),
  ('a2160000-0000-4000-8000-000000000005', 'b1600000-0000-4000-8000-00000000000a', 'model_source', 'modelo.pdf', 'e'),
  ('a2160000-0000-4000-8000-000000000006', 'b1600000-0000-4000-8000-00000000000b', 'upload', 'identidade-rui.pdf', 'f')
) as f (id, org, purpose, name, mark);
insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status) values
  ('ad160000-0000-4000-8000-000000000001', 'b1600000-0000-4000-8000-00000000000a', 'c1600000-0000-4000-8000-000000000001',
   'e1600000-0000-4000-8000-000000000001', 'a2160000-0000-4000-8000-000000000001', 'identity', 'client', 'received'),
  ('ad160000-0000-4000-8000-000000000002', 'b1600000-0000-4000-8000-00000000000b', 'c1600000-0000-4000-8000-000000000002',
   'e1600000-0000-4000-8000-000000000002', 'a2160000-0000-4000-8000-000000000006', 'identity', 'client', 'received');
insert into public.issued_documents (org_id, kind, title, status, verify_code, file_id, content_hash, idempotency_key, issued_at) values
  ('b1600000-0000-4000-8000-00000000000a', 'procuracao', 'Procuração de Maria', 'issued', 'HJKMNPQRSTVW',
   'a2160000-0000-4000-8000-000000000003', repeat('c', 64), 'limpeza-procuracao', now());

-- The WhatsApp: a number, Maria's conversation with a photo, a request to stop; Rocha's conversation.
insert into public.wa_numbers (id, org_id, provider, phone_number_id, waba_id, display_phone_number, status, disconnected_at) values
  ('a5160000-0000-4000-8000-000000000001', 'b1600000-0000-4000-8000-00000000000a', 'test', 'pn-lima-limpeza', 'waba-lima', '5500988880099', 'disconnected', now()),
  ('a5160000-0000-4000-8000-000000000002', 'b1600000-0000-4000-8000-00000000000b', 'test', 'pn-rocha-limpeza', 'waba-rocha', '5500988880098', 'disconnected', now());
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id) values
  ('a6160000-0000-4000-8000-000000000001', 'b1600000-0000-4000-8000-00000000000a', 'a5160000-0000-4000-8000-000000000001', '5500988880001'),
  ('a6160000-0000-4000-8000-000000000002', 'b1600000-0000-4000-8000-00000000000b', 'a5160000-0000-4000-8000-000000000002', '5562999990002');
insert into public.wa_messages (org_id, conversation_id, number_id, direction, kind, body, status, media_file_id) values
  ('b1600000-0000-4000-8000-00000000000a', 'a6160000-0000-4000-8000-000000000001', 'a5160000-0000-4000-8000-000000000001',
   'in', 'image', null, 'received', 'a2160000-0000-4000-8000-000000000002');
insert into public.wa_optouts (org_id, contact_wa_id, source) values
  ('b1600000-0000-4000-8000-00000000000a', '5500988880009', 'manual'),
  ('b1600000-0000-4000-8000-00000000000b', '5562999990008', 'manual');
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, is_test, label, consent_wording, consent_at, consent_channel) values
  ('ae160000-0000-4000-8000-00000000000a', 'b1600000-0000-4000-8000-00000000000a', 'Passageira Teste', '5500988880001', 'LA', true,
   'cancelamento', 'Concordo em receber avisos sobre a viagem que cadastrei.', now(), 'test');

-- The AI's check of Maria's document, waiting in the queue, and a model ONE prepared, which stays.
insert into public.ai_runs (id, org_id, task, prompt_version_id, provider, model, input_hash, subject_type, subject_id, status, output, cost_usd_micros, finished_at)
select r.id::uuid, 'b1600000-0000-4000-8000-00000000000a', r.task, v.id, v.provider, v.model, repeat('a', 64), r.subject_type, r.subject_id,
       'succeeded', '{"resposta": "teste"}'::jsonb, 1200, now()
from (values
  ('a7160000-0000-4000-8000-000000000001', 'caso.documento.conferencia', 'case_document', 'ad160000-0000-4000-8000-000000000001'),
  ('a7160000-0000-4000-8000-000000000002', 'biblioteca.modelo.marcacao', 'template_import', 'a8160000-0000-4000-8000-000000000001')
) as r (id, task, subject_type, subject_id)
join lateral (select * from public.prompt_versions p where p.task = r.task order by p.version limit 1) v on true;
insert into public.approvals (org_id, run_id, task, approver_functions) values
  ('b1600000-0000-4000-8000-00000000000a', 'a7160000-0000-4000-8000-000000000001', 'caso.documento.conferencia',
   array['socio', 'advogado']::public.firm_function[]);

-- The bell: a line to Maria's case goes, one to the team's settings stays.
insert into public.notifications (user_id, title, href) values
  ('a1600000-0000-4000-8000-000000000001', 'Documento para conferir', '/casos/c1600000-0000-4000-8000-000000000001'),
  ('a1600000-0000-4000-8000-000000000001', 'Convite aceito', '/settings/team');

-- ---------- The partner agency ----------

insert into public.partners (id, name) values ('c1600000-0000-4000-8000-0000000000aa', 'Viagens Sol');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('a9160000-0000-4000-8000-00000000000a', 'c1600000-0000-4000-8000-0000000000aa', 'b1600000-0000-4000-8000-00000000000a', 'direito-do-passageiro');
insert into public.partner_members (partner_id, user_id, role) values
  ('c1600000-0000-4000-8000-0000000000aa', 'a1600000-0000-4000-8000-000000000004', 'owner');
-- Bia at the test chat's number with her son Leo; Gabi at a real WhatsApp, who stays the agency's.
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, phone) values
  ('ab160000-0000-4000-8000-000000000001', 'c1600000-0000-4000-8000-0000000000aa', 'a9160000-0000-4000-8000-00000000000a',
   'b1600000-0000-4000-8000-00000000000a', 'Bia Teste', '5500988880006'),
  ('ab160000-0000-4000-8000-000000000003', 'c1600000-0000-4000-8000-0000000000aa', 'a9160000-0000-4000-8000-00000000000a',
   'b1600000-0000-4000-8000-00000000000a', 'Gabi Teste', '5562999990077');
insert into public.pax_travelers (id, partner_id, partnership_id, org_id, full_name, guardian_id) values
  ('ab160000-0000-4000-8000-000000000002', 'c1600000-0000-4000-8000-0000000000aa', 'a9160000-0000-4000-8000-00000000000a',
   'b1600000-0000-4000-8000-00000000000a', 'Leo Teste', 'ab160000-0000-4000-8000-000000000001');
insert into public.pax_trips (partner_id, partnership_id, org_id, holder_id) values
  ('c1600000-0000-4000-8000-0000000000aa', 'a9160000-0000-4000-8000-00000000000a', 'b1600000-0000-4000-8000-00000000000a', 'ab160000-0000-4000-8000-000000000001'),
  ('c1600000-0000-4000-8000-0000000000aa', 'a9160000-0000-4000-8000-00000000000a', 'b1600000-0000-4000-8000-00000000000a', 'ab160000-0000-4000-8000-000000000003');
insert into public.files (id, org_id, partner_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at)
select f.id::uuid, 'b1600000-0000-4000-8000-00000000000a', 'c1600000-0000-4000-8000-0000000000aa', 'pax_document',
       'org/b1600000-0000-4000-8000-00000000000a/pax_document/' || f.id, f.name, 'image/jpeg', 2000, 'stored',
       repeat(f.mark, 64), 2000, 'image/jpeg', now() + interval '1 hour', now()
from (values
  ('a2160000-0000-4000-8000-000000000011', 'rg-bia.jpg', '1'),
  ('a2160000-0000-4000-8000-000000000013', 'rg-gabi.jpg', '3')
) as f (id, name, mark);
insert into public.pax_documents (id, partner_id, org_id, traveler_id, kind, file_id, source, reading) values
  ('ac160000-0000-4000-8000-000000000001', 'c1600000-0000-4000-8000-0000000000aa', 'b1600000-0000-4000-8000-00000000000a',
   'ab160000-0000-4000-8000-000000000001', 'identity', 'a2160000-0000-4000-8000-000000000011', 'partner', 'pending'),
  ('ac160000-0000-4000-8000-000000000003', 'c1600000-0000-4000-8000-0000000000aa', 'b1600000-0000-4000-8000-00000000000a',
   'ab160000-0000-4000-8000-000000000003', 'identity', 'a2160000-0000-4000-8000-000000000013', 'partner', 'pending');
insert into public.notifications (user_id, title, href) values
  ('a1600000-0000-4000-8000-000000000004', 'Documento lido', '/parceiro/passageiros/ab160000-0000-4000-8000-000000000001'),
  ('a1600000-0000-4000-8000-000000000004', 'Documento lido', '/parceiro/passageiros/ab160000-0000-4000-8000-000000000003');

create function pg_temp.sign_in(person uuid, aal text default 'aal2', session uuid default null)
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal, 'session_id', session))::text, true);
$$;

create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated;

create function pg_temp.got(which text, path text[])
returns text language sql as $$
  select value #>> path from res where key = which;
$$;

-- ---------- Who may ----------

select ok(not has_function_privilege('anon', 'public.clear_firm_data(uuid, text)', 'execute'),
  'nobody signed out may clear a firm');

select pg_temp.sign_in('a1600000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('lawyer', public.clear_firm_data('b1600000-0000-4000-8000-00000000000a', 'apagar'));
insert into res values ('lawyer-preview', public.firm_clear_preview('b1600000-0000-4000-8000-00000000000a'));
reset role;
select is(pg_temp.got('lawyer', '{code}'), 'not_allowed', 'a lawyer of a firm with a partner does not clear it');
select is(pg_temp.got('lawyer-preview', '{code}'), 'not_allowed', 'nor reads what a clearing would take');

select pg_temp.sign_in('a1600000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$ select public.clear_firm_data('b1600000-0000-4000-8000-00000000000a', 'apagar') $$,
  '42501', null, 'who decides for another firm cannot clear this one');
reset role;

select pg_temp.sign_in('a1600000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
insert into res values ('no-factor', public.clear_firm_data('b1600000-0000-4000-8000-00000000000a', 'apagar'));
insert into res values ('preview', public.firm_clear_preview('b1600000-0000-4000-8000-00000000000a'));
reset role;
select is(pg_temp.got('no-factor', '{code}'), 'second_factor', 'a partner whose session did not confirm the second factor is told so');
select is(pg_temp.got('preview', '{second_factor}'), 'false', 'the confirmation knows the second factor is still owed');
select is(
  (select value -> 'counts' from res where key = 'preview'),
  '{"cases": 1, "people": 2, "conversations": 1, "publications": 1, "deadlines": 1, "hearings": 1, "imports": 1, "agency_passengers": 2}'::jsonb,
  'the confirmation counts what would go: the firm''s own, and the agency''s passenger at the test number with her son');

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a1600000-0000-4000-8000-000000000009', 'a1600000-0000-4000-8000-000000000001', 'b1600000-0000-4000-8000-00000000000a',
        'Conferindo o escritório', 'f2160000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a1600000-0000-4000-8000-000000000001', 'aal2', 'f2160000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('visit', public.clear_firm_data('b1600000-0000-4000-8000-00000000000a', 'apagar'));
reset role;
select is(pg_temp.got('visit', '{code}'), 'support_visit', 'a support visit never clears a firm');

select pg_temp.sign_in('a1600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('no-word', public.clear_firm_data('b1600000-0000-4000-8000-00000000000a', 'apaga'));
reset role;
select is(pg_temp.got('no-word', '{code}'), 'confirm_missing', 'nothing goes until the word is typed');
select is((select count(*)::int from public.cases where org_id = 'b1600000-0000-4000-8000-00000000000a'), 1,
  'a refusal takes nothing');

-- ---------- The clearing ----------

select pg_temp.sign_in('a1600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('cleared', public.clear_firm_data('b1600000-0000-4000-8000-00000000000a', ' Apagar '));
reset role;
select is(pg_temp.got('cleared', '{code}'), 'cleared', 'the partner clears the firm with the second factor and the word');

select is(
  (select jsonb_build_object(
     'cases', (select count(*) from public.cases where org_id = 'b1600000-0000-4000-8000-00000000000a'),
     'people', (select count(*) from public.people where org_id = 'b1600000-0000-4000-8000-00000000000a'),
     'conversations', (select count(*) from public.wa_conversations where org_id = 'b1600000-0000-4000-8000-00000000000a'),
     'optouts', (select count(*) from public.wa_optouts where org_id = 'b1600000-0000-4000-8000-00000000000a'),
     'publications', (select count(*) from public.publications where org_id = 'b1600000-0000-4000-8000-00000000000a'),
     'deadlines', (select count(*) from public.deadlines where org_id = 'b1600000-0000-4000-8000-00000000000a'),
     'hearings', (select count(*) from public.hearings where org_id = 'b1600000-0000-4000-8000-00000000000a'),
     'imports', (select count(*) from public.import_batches where org_id = 'b1600000-0000-4000-8000-00000000000a'),
     'trips', (select count(*) from public.tracked_trips where org_id = 'b1600000-0000-4000-8000-00000000000a'))),
  '{"cases": 0, "people": 0, "conversations": 0, "optouts": 0, "publications": 0, "deadlines": 0, "hearings": 0, "imports": 0, "trips": 0}'::jsonb,
  'the firm has no case, client, conversation, request to stop, publication, deadline, hearing, import or followed trip left');

select is(
  (select array_agg(full_name order by full_name) from public.pax_travelers where partner_id = 'c1600000-0000-4000-8000-0000000000aa'),
  array['Gabi Teste'],
  'the agency keeps the passenger at a real WhatsApp, and loses the one at the test number with her son');
select is((select count(*)::int from public.pax_trips where partner_id = 'c1600000-0000-4000-8000-0000000000aa'), 1,
  'the trips of the passenger who went go with her');
select ok(exists (select 1 from public.pax_documents where id = 'ac160000-0000-4000-8000-000000000003'),
  'the document of the passenger who stays stays');

select is(
  (select array_agg(name order by name) from public.files where org_id = 'b1600000-0000-4000-8000-00000000000a'),
  array['extrato.pdf', 'modelo.pdf', 'procuracao.pdf', 'rg-gabi.jpg'],
  'the books'', the library''s, the issued document''s and the remaining passenger''s files stay; the rest go');
select is(
  (select array_agg(p order by p) from jsonb_array_elements_text((select value -> 'paths' from res where key = 'cleared')) p),
  array['org/b1600000-0000-4000-8000-00000000000a/pax_document/a2160000-0000-4000-8000-000000000011',
        'org/b1600000-0000-4000-8000-00000000000a/upload/a2160000-0000-4000-8000-000000000001',
        'org/b1600000-0000-4000-8000-00000000000a/whatsapp/a2160000-0000-4000-8000-000000000002'],
  'the answer names the bytes to remove');
select is(
  (select count(*)::int from public.pax_file_removals where storage_path like 'org/b1600000-0000-4000-8000-00000000000a/%'),
  3, 'and the sweep is owed them too, in case the app does not remove them at once');
select ok(exists (select 1 from public.issued_documents where verify_code = 'HJKMNPQRSTVW'),
  'a document ONE issued still answers its public code');

select is((select output from public.ai_runs where id = 'a7160000-0000-4000-8000-000000000001'), null,
  'the AI''s answer about a document that went is forgotten');
select is((select cost_usd_micros::int from public.ai_runs where id = 'a7160000-0000-4000-8000-000000000001'), 1200,
  'and its run keeps its cost');
select ok(not exists (select 1 from public.approvals where run_id = 'a7160000-0000-4000-8000-000000000001'),
  'it leaves the firm''s queue');
select isnt((select output from public.ai_runs where id = 'a7160000-0000-4000-8000-000000000002'), null,
  'a model the library prepared keeps its answer');

select is(
  (select array_agg(href order by href) from public.notifications
   where user_id in ('a1600000-0000-4000-8000-000000000001', 'a1600000-0000-4000-8000-000000000004')),
  array['/parceiro/passageiros/ab160000-0000-4000-8000-000000000003', '/settings/team'],
  'the bell keeps only what does not lead to what went');

select is(
  (select metadata ->> 'cases' from public.audit_events
   where org_id = 'b1600000-0000-4000-8000-00000000000a' and action = 'firm.data_cleared'),
  '1', 'the clearing is on the record with how many went');
select ok(
  (select metadata::text !~ 'Maria|Bia|5299822|98888' from public.audit_events
   where org_id = 'b1600000-0000-4000-8000-00000000000a' and action = 'firm.data_cleared'),
  'and nothing of anybody');

-- ---------- The other firm ----------

select is(
  (select jsonb_build_object(
     'cases', (select count(*) from public.cases where org_id = 'b1600000-0000-4000-8000-00000000000b'),
     'people', (select count(*) from public.people where org_id = 'b1600000-0000-4000-8000-00000000000b'),
     'conversations', (select count(*) from public.wa_conversations where org_id = 'b1600000-0000-4000-8000-00000000000b'),
     'optouts', (select count(*) from public.wa_optouts where org_id = 'b1600000-0000-4000-8000-00000000000b'),
     'publications', (select count(*) from public.publications where org_id = 'b1600000-0000-4000-8000-00000000000b'),
     'files', (select count(*) from public.files where org_id = 'b1600000-0000-4000-8000-00000000000b'))),
  '{"cases": 1, "people": 1, "conversations": 1, "optouts": 1, "publications": 1, "files": 1}'::jsonb,
  'the other firm keeps everything');

-- ---------- Again ----------

select pg_temp.sign_in('a1600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('again', public.clear_firm_data('b1600000-0000-4000-8000-00000000000a', 'apagar'));
reset role;
select is(pg_temp.got('again', '{counts,cases}'), '0', 'clearing a firm with nothing left takes nothing');
select is(jsonb_array_length((select value -> 'paths' from res where key = 'again')), 0, 'and names no bytes');

-- A new case after the clearing starts the firm's numbering again.
select is(
  (select coalesce(max(seq), 0) + 1 from public.cases where org_id = 'b1600000-0000-4000-8000-00000000000a'),
  1, 'the next case of the firm is its case 1');

select * from finish();
rollback;
