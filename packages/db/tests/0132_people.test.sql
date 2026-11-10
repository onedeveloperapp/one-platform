begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- As pessoas do escritório (0133). In Lima, Ana is a partner and Davi does
-- the attendance. Maria has a case going with her son João, a minor; Pedro's
-- case ended and its lawsuit is closed. Anybody finds a person by a name in
-- any order, a CPF or a telephone with or without its ninth digit, and opens
-- their page; Davi records that Maria wants no marketing, and Maria takes it
-- back on her own link; only Ana, with the second factor, exports a person's
-- data or answers a request to erase them, refused while a case is going and
-- done for Pedro: his contact data and what the AI read of his document go,
-- his name and CPF stay. Rocha reads nothing of Lima's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1320000-0000-4000-8000-000000000001', 'ana@lima-pessoas.invalid', 'Ana Lima'),
  ('a1320000-0000-4000-8000-000000000002', 'davi@lima-pessoas.invalid', 'Davi Lima'),
  ('a1320000-0000-4000-8000-000000000009', 'edu@rocha-pessoas.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1320000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-pessoas', 'a1320000-0000-4000-8000-000000000001'),
  ('b1320000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-pessoas', 'a1320000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1320000-0000-4000-8000-00000000000a', 'a1320000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1320000-0000-4000-8000-00000000000a', 'a1320000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b1320000-0000-4000-8000-00000000000b', 'a1320000-0000-4000-8000-000000000009', 'owner', 'socio');

insert into public.people (id, org_id, full_name, cpf, birth_date, phone, email, city, uf) values
  ('d1320000-0000-4000-8000-000000000001', 'b1320000-0000-4000-8000-00000000000a', 'Maria Teste de Oliveira', '52998224725',
   '1990-03-10', '5562999990001', 'maria@teste.invalid', 'Goiânia', 'GO'),
  ('d1320000-0000-4000-8000-000000000002', 'b1320000-0000-4000-8000-00000000000a', 'João Teste de Oliveira', null,
   '2018-05-01', null, null, null, null),
  ('d1320000-0000-4000-8000-000000000003', 'b1320000-0000-4000-8000-00000000000a', 'Pedro Teste Souza', '12345678909',
   '1985-01-20', '556288887777', 'pedro@teste.invalid', 'Anápolis', 'GO');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1320000-0000-4000-8000-000000000001', 'b1320000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'intake'),
  ('c1320000-0000-4000-8000-000000000002', 'b1320000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1320000-0000-4000-8000-000000000001', 'b1320000-0000-4000-8000-00000000000a', 'c1320000-0000-4000-8000-000000000001',
   'd1320000-0000-4000-8000-000000000001', 'guardian'),
  ('e1320000-0000-4000-8000-000000000003', 'b1320000-0000-4000-8000-00000000000a', 'c1320000-0000-4000-8000-000000000002',
   'd1320000-0000-4000-8000-000000000003', 'claimant');
insert into public.case_parties (id, org_id, case_id, person_id, role, guardian_id) values
  ('e1320000-0000-4000-8000-000000000002', 'b1320000-0000-4000-8000-00000000000a', 'c1320000-0000-4000-8000-000000000001',
   'd1320000-0000-4000-8000-000000000002', 'claimant', 'e1320000-0000-4000-8000-000000000001');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1320000-0000-4000-8000-000000000002', 'b1320000-0000-4000-8000-00000000000a', 'c1320000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01');
update public.cases set status = 'closed', closed_at = now() where id = 'c1320000-0000-4000-8000-000000000002';
update public.proceedings set status = 'closed' where id = 'f1320000-0000-4000-8000-000000000002';

-- Pedro's identity, and what the AI read of it.
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('e2320000-0000-4000-8000-000000000001', 'b1320000-0000-4000-8000-00000000000a', 'upload',
   'org/b1320000-0000-4000-8000-00000000000a/upload/e2320000-0000-4000-8000-000000000001', 'rg.pdf', 'application/pdf',
   100, 'stored', repeat('b', 64), 100, 'application/pdf', now() + interval '1 hour', now());
insert into public.ai_runs (id, org_id, task, prompt_version_id, provider, model, input_hash, status, output, finished_at,
                            subject_type, subject_id, cost_usd_micros)
select 'a5320000-0000-4000-8000-000000000001', 'b1320000-0000-4000-8000-00000000000a', 'plataforma.verificacao', v.id,
       v.provider, v.model, repeat('c', 64), 'succeeded', '{"nome": "Pedro Teste Souza"}'::jsonb, now(),
       'case_document', 'a7320000-0000-4000-8000-000000000001', 1234
from public.prompt_versions v where v.task = 'plataforma.verificacao' and v.is_active;
insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status, party_id) values
  ('a7320000-0000-4000-8000-000000000001', 'b1320000-0000-4000-8000-00000000000a', 'c1320000-0000-4000-8000-000000000002',
   'e2320000-0000-4000-8000-000000000001', 'identity', 'client', 'accepted', 'e1320000-0000-4000-8000-000000000003');

-- Maria's link.
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at) values
  ('a8320000-0000-4000-8000-000000000001', 'b1320000-0000-4000-8000-00000000000a', 'c1320000-0000-4000-8000-000000000001',
   'd1320000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-da-maria', 'UTF8')), 'hex'), now() + interval '30 days');

create function pg_temp.sign_in(person uuid, aal text default 'aal2')
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal)::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.as_person(person uuid, name text, call text, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person, aal);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;

-- ---------- The search ----------

select pg_temp.as_person('a1320000-0000-4000-8000-000000000002', 'by-name',
  $$public.firm_people_search('b1320000-0000-4000-8000-00000000000a', 'oliveira maria')$$);
select pg_temp.as_person('a1320000-0000-4000-8000-000000000002', 'by-cpf',
  $$public.firm_people_search('b1320000-0000-4000-8000-00000000000a', '529.982.247-25')$$);
select pg_temp.as_person('a1320000-0000-4000-8000-000000000002', 'by-phone',
  $$public.firm_people_search('b1320000-0000-4000-8000-00000000000a', '(62) 98888-7777')$$);
select pg_temp.as_person('a1320000-0000-4000-8000-000000000009', 'rocha-search',
  $$public.firm_people_search('b1320000-0000-4000-8000-00000000000b', 'maria')$$);
select ok(
  pg_temp.got('by-name', '{people,0,id}') = 'd1320000-0000-4000-8000-000000000001'
    and pg_temp.got('by-name', '{people,0,active}') = 'true'
    and pg_temp.got('by-cpf', '{people,0,id}') = 'd1320000-0000-4000-8000-000000000001'
    and pg_temp.got('by-phone', '{people,0,id}') = 'd1320000-0000-4000-8000-000000000003'
    and pg_temp.got('rocha-search', '{people}') = '[]',
  'a person is found by a name in any order, a CPF and a telephone with or without its ninth digit; only in their firm'
);

-- ---------- The page ----------

select pg_temp.as_person('a1320000-0000-4000-8000-000000000002', 'page-joao',
  $$public.firm_person('b1320000-0000-4000-8000-00000000000a', 'd1320000-0000-4000-8000-000000000002')$$);
select pg_temp.as_person('a1320000-0000-4000-8000-000000000002', 'page-pedro',
  $$public.firm_person('b1320000-0000-4000-8000-00000000000a', 'd1320000-0000-4000-8000-000000000003')$$);
select ok(
  pg_temp.got('page-joao', '{minor}') = 'true' and pg_temp.got('page-joao', '{cases,0,roles,0}') = 'claimant'
    and pg_temp.got('page-pedro', '{active}') = 'false' and pg_temp.got('page-pedro', '{lawsuits,0,status}') = 'closed'
    and pg_temp.got('page-pedro', '{documents,0,kind}') = 'identity'
    and pg_temp.got('page-pedro', '{may,data}') = 'false' and pg_temp.got('page-pedro', '{requests}') = '[]',
  'the page of a person has their cases, lawsuits and documents; only who decides for the firm handles their data'
);

-- ---------- Marketing ----------

select pg_temp.as_person('a1320000-0000-4000-8000-000000000002', 'off',
  $$public.set_person_marketing('b1320000-0000-4000-8000-00000000000a', 'd1320000-0000-4000-8000-000000000001', true, 'telefone')$$);
select pg_temp.as_person('a1320000-0000-4000-8000-000000000002', 'off-bad',
  $$public.set_person_marketing('b1320000-0000-4000-8000-00000000000a', 'd1320000-0000-4000-8000-000000000001', true, 'pombo')$$);
select ok(
  pg_temp.got('off', '{ok}') = 'true' and pg_temp.got('off-bad', '{code}') = 'invalid_data'
    and (select marketing_off_how = 'telefone' and marketing_off_at is not null from public.people
         where id = 'd1320000-0000-4000-8000-000000000001'),
  'anybody of the firm records that a person wants no marketing, saying how'
);

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
insert into res values ('link-on', public.client_link_marketing('token-da-maria', false));
insert into res values ('link-off', public.client_link_marketing('token-da-maria', true));
reset role;
select ok(
  pg_temp.got('link-on', '{off}') = 'false' and pg_temp.got('link-off', '{off}') = 'true'
    and (select marketing_off_how = 'link' from public.people where id = 'd1320000-0000-4000-8000-000000000001'),
  'the person says it on their own link, and takes it back there'
);

-- ---------- The data of a person ----------

select pg_temp.as_person('a1320000-0000-4000-8000-000000000002', 'export-davi',
  $$public.person_data_export('b1320000-0000-4000-8000-00000000000a', 'd1320000-0000-4000-8000-000000000003', 'email')$$);
select pg_temp.as_person('a1320000-0000-4000-8000-000000000001', 'export-aal1',
  $$public.person_data_export('b1320000-0000-4000-8000-00000000000a', 'd1320000-0000-4000-8000-000000000003', 'email')$$, 'aal1');
select pg_temp.as_person('a1320000-0000-4000-8000-000000000001', 'export',
  $$public.person_data_export('b1320000-0000-4000-8000-00000000000a', 'd1320000-0000-4000-8000-000000000003', 'email')$$);
select ok(
  pg_temp.got('export-davi', '{code}') = 'not_allowed' and pg_temp.got('export-aal1', '{code}') = 'second_factor'
    and pg_temp.got('export', '{person,full_name}') = 'Pedro Teste Souza'
    and pg_temp.got('export', '{lawsuits,0,cnj}') = '10003012720998090100'
    and exists (select 1 from public.person_data_requests where kind = 'export' and status = 'done'),
  'only who decides for the firm, with the second factor, exports everything the firm keeps of a person; on the record'
);

select pg_temp.as_person('a1320000-0000-4000-8000-000000000001', 'erase-maria',
  $$public.erase_person('b1320000-0000-4000-8000-00000000000a', 'd1320000-0000-4000-8000-000000000001', 'whatsapp')$$);
select ok(
  pg_temp.got('erase-maria', '{code}') = 'open_lawsuit'
    and (select phone is not null from public.people where id = 'd1320000-0000-4000-8000-000000000001')
    and exists (select 1 from public.person_data_requests where kind = 'erase' and status = 'refused' and refusal = 'open_lawsuit'),
  'an erasure is refused, with its reason and on the record, while a case of the person is going'
);

select pg_temp.as_person('a1320000-0000-4000-8000-000000000001', 'erase-pedro',
  $$public.erase_person('b1320000-0000-4000-8000-00000000000a', 'd1320000-0000-4000-8000-000000000003', 'email')$$);
select ok(
  pg_temp.got('erase-pedro', '{ok}') = 'true'
    and (select full_name = 'Pedro Teste Souza' and cpf = '12345678909' and phone is null and email is null and city is null
           and birth_date is null and erased_at is not null
         from public.people where id = 'd1320000-0000-4000-8000-000000000003')
    and (select output is null and cost_usd_micros = 1234 from public.ai_runs where id = 'a5320000-0000-4000-8000-000000000001'),
  'an erasure keeps the name and the CPF the law keeps, and takes out the rest and what the AI read, the cost kept'
);

-- ---------- The other firm ----------

select pg_temp.sign_in('a1320000-0000-4000-8000-000000000009');
set local role authenticated;
select throws_ok(
  $$ select public.firm_person('b1320000-0000-4000-8000-00000000000a', 'd1320000-0000-4000-8000-000000000001') $$,
  '42501', null, 'nobody of another firm opens a person''s page');
select is((select count(*)::integer from public.person_data_requests), 0, 'nor reads the requests about their data');
reset role;

select * from finish();
rollback;
