begin;
create extension if not exists pgtap;
select plan(6);

-- ============================================================
-- As ferramentas de simulação (0138). Lima has only a test case: Maria's,
-- filed, its release received and her part passed on, a power of attorney
-- waiting to be signed. The test court hands what a bank would show of it by
-- the test chat's link; Pessoas counts the test case while Lima has no real
-- one, and says so; a person of Lima simulates the signature of the paper of
-- the test case, never of a real one. Rocha's link opens nothing of Lima's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1370000-0000-4000-8000-000000000001', 'ana@lima-simulacao.invalid', 'Ana Lima'),
  ('a1370000-0000-4000-8000-000000000009', 'edu@rocha-simulacao.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1370000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-simulacao', 'a1370000-0000-4000-8000-000000000001'),
  ('b1370000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-simulacao', 'a1370000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1370000-0000-4000-8000-00000000000a', 'a1370000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1370000-0000-4000-8000-00000000000b', 'a1370000-0000-4000-8000-000000000009', 'owner', 'socio');

insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c2370000-0000-4000-8000-00000000000a', 'b1370000-0000-4000-8000-00000000000a', 'whatsapp', 'test-waba-la', 'Chat de teste',
   'connected', 'a1370000-0000-4000-8000-000000000001', now()),
  ('c2370000-0000-4000-8000-00000000000b', 'b1370000-0000-4000-8000-00000000000b', 'whatsapp', 'test-waba-ro', 'Chat de teste',
   'connected', 'a1370000-0000-4000-8000-000000000009', now());

create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.sign_in(person uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;
create function pg_temp.backend() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role": "service_role"}', true);
$$;
create function pg_temp.as_person(person uuid, name text, call text) returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;
create function pg_temp.as_backend(name text, call text) returns void language plpgsql as $$
begin
  perform pg_temp.backend();
  set local role service_role;
  execute format('insert into res values (%L, to_jsonb((%s)))', name, call);
  reset role;
end;
$$;

select pg_temp.as_backend('number_a', $$public.register_wa_number('b1370000-0000-4000-8000-00000000000a',
  'c2370000-0000-4000-8000-00000000000a', 'test', 'test-number-la', 'test-waba-la', '5500900000137', 'Lima Advocacia', 'cloud')$$);
select pg_temp.as_backend('number_b', $$public.register_wa_number('b1370000-0000-4000-8000-00000000000b',
  'c2370000-0000-4000-8000-00000000000b', 'test', 'test-number-ro', 'test-waba-ro', '5500900000138', 'Rocha Advogados', 'cloud')$$);
insert into public.test_chats (org_id, number_id, token) values
  ('b1370000-0000-4000-8000-00000000000a', pg_temp.got('number_a', '{number_id}')::uuid, 'link-do-teste-da-lima-simulacao-0001'),
  ('b1370000-0000-4000-8000-00000000000b', pg_temp.got('number_b', '{number_id}')::uuid, 'link-do-teste-da-rocha-simulacao-002');

-- Maria's test case: filed, its release received, her part passed on, a paper to sign.
insert into public.people (id, org_id, full_name, cpf, birth_date) values
  ('d1370000-0000-4000-8000-000000000001', 'b1370000-0000-4000-8000-00000000000a', 'Maria Teste', '52998224725', '1990-03-10');
insert into public.cases (id, org_id, seq, module, incident, status, origin, is_test) values
  ('c1370000-0000-4000-8000-000000000001', 'b1370000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed', 'agency', true);
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1370000-0000-4000-8000-000000000001', 'b1370000-0000-4000-8000-00000000000a', 'c1370000-0000-4000-8000-000000000001',
   'd1370000-0000-4000-8000-000000000001', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1370000-0000-4000-8000-000000000001', 'b1370000-0000-4000-8000-00000000000a', 'c1370000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01');
insert into public.lawsuit_facts (id, org_id, case_id, proceeding_id, kind, release_kind, cents, happened_on, source,
                                  received_cents, received_on) values
  ('a9370000-0000-4000-8000-000000000001', 'b1370000-0000-4000-8000-00000000000a', 'c1370000-0000-4000-8000-000000000001',
   'f1370000-0000-4000-8000-000000000001', 'alvara', 'alvara', 1000000, current_date - 3, 'person', 1000000, current_date - 2);
insert into public.money_releases (id, org_id, case_id, proceeding_id, fact_id, path, received_cents, received_on, status) values
  ('a6370000-0000-4000-8000-000000000001', 'b1370000-0000-4000-8000-00000000000a', 'c1370000-0000-4000-8000-000000000001',
   'f1370000-0000-4000-8000-000000000001', 'a9370000-0000-4000-8000-000000000001', 'firm', 1000000, current_date - 2, 'split');
insert into public.money_shares (org_id, release_id, case_id, person_id, gross_cents, fees_cents, payable_cents, status) values
  ('b1370000-0000-4000-8000-00000000000a', 'a6370000-0000-4000-8000-000000000001', 'c1370000-0000-4000-8000-000000000001',
   'd1370000-0000-4000-8000-000000000001', 1000000, 300000, 700000, 'owed');
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('e2370000-0000-4000-8000-000000000001', 'b1370000-0000-4000-8000-00000000000a', 'upload',
   'org/b1370000-0000-4000-8000-00000000000a/upload/e2370000-0000-4000-8000-000000000001', 'procuracao.pdf', 'application/pdf',
   100, 'stored', repeat('d', 64), 100, 'application/pdf', now() + interval '1 hour', now());
insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status) values
  ('a7370000-0000-4000-8000-000000000001', 'b1370000-0000-4000-8000-00000000000a', 'c1370000-0000-4000-8000-000000000001',
   'e2370000-0000-4000-8000-000000000001', 'power_of_attorney', 'firm', 'accepted');
insert into public.signature_envelopes (id, org_id, case_id, document_id, method, status, signers) values
  ('a8370000-0000-4000-8000-000000000001', 'b1370000-0000-4000-8000-00000000000a', 'c1370000-0000-4000-8000-000000000001',
   'a7370000-0000-4000-8000-000000000001', 'govbr', 'pending',
   '[{"position": 1, "person_id": "d1370000-0000-4000-8000-000000000001", "name": "Maria Teste"}]');

-- ---------- The statement ----------

select pg_temp.as_backend('statement', $$public.test_court_statement('link-do-teste-da-lima-simulacao-0001')$$);
select pg_temp.as_backend('statement-rocha', $$public.test_court_statement('link-do-teste-da-rocha-simulacao-002')$$);
select pg_temp.as_backend('statement-none', $$public.test_court_statement('link-que-nao-existe-de-ninguem-0000')$$);
select ok(
  pg_temp.got('statement', '{releases,0,cents}') = '1000000' and pg_temp.got('statement', '{releases,0,court}') = 'TJGO'
    and pg_temp.got('statement', '{transfers,0,cents}') = '700000' and pg_temp.got('statement', '{transfers,0,cpf}') = '52998224725'
    and pg_temp.got('statement-rocha', '{releases}') = '[]'
    and (select value is null from res where key = 'statement-none'),
  'the test court hands what a bank would show of the firm''s test cases, by its link only'
);
select pg_temp.sign_in('a1370000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$ select public.test_court_statement('link-do-teste-da-lima-simulacao-0001') $$, '42501', null,
  'only the backend reads it');
reset role;

-- ---------- Pessoas counts the test case while there is no real one ----------

select pg_temp.as_person('a1370000-0000-4000-8000-000000000001', 'numbers',
  $$public.firm_people_numbers('b1370000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('numbers', '{tests_counted}') = 'true' and pg_temp.got('numbers', '{origins,agency}') = '1',
  'with no real case, the screen Pessoas counts the test case and says so'
);
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1370000-0000-4000-8000-000000000002', 'b1370000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'intake');
select pg_temp.as_person('a1370000-0000-4000-8000-000000000001', 'numbers-real',
  $$public.firm_people_numbers('b1370000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('numbers-real', '{tests_counted}') = 'false' and pg_temp.got('numbers-real', '{origins}') = '{}',
  'once a real case exists, the test cases leave the numbers and the segments'
);

-- ---------- The simulated signature ----------

select pg_temp.as_person('a1370000-0000-4000-8000-000000000001', 'simulate',
  $$public.test_signature_to_simulate('a8370000-0000-4000-8000-000000000001')$$);
select ok(
  pg_temp.got('simulate', '{ok}') = 'true'
    and pg_temp.got('simulate', '{storage_path}') = 'org/b1370000-0000-4000-8000-00000000000a/upload/e2370000-0000-4000-8000-000000000001'
    and exists (select 1 from public.audit_events where action = 'signature.simulated'),
  'a paper of a test case may be signed in one click, on the record'
);
update public.cases set is_test = false where id = 'c1370000-0000-4000-8000-000000000001';
select pg_temp.as_person('a1370000-0000-4000-8000-000000000001', 'simulate-real',
  $$public.test_signature_to_simulate('a8370000-0000-4000-8000-000000000001')$$);
select is(pg_temp.got('simulate-real', '{code}'), 'not_test', 'never the paper of a real case');

select * from finish();
rollback;
