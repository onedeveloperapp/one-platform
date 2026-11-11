begin;
create extension if not exists pgtap;
select plan(4);

-- ============================================================
-- The lawsuits the DJEN already shows (0208). Lima's lawyers have three
-- publications of two lawsuits it has no case of, and one of a lawsuit it
-- has: the list holds the two, each with its court, unit, class, days and
-- the airline its texts name. Who runs the attendance may not read it; Rocha
-- reads nothing of Lima's.
--
-- Every person, firm, number and text here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2080000-0000-4000-8000-000000000001', 'ana@lima-djen.invalid', 'Ana Lima'),
  ('a2080000-0000-4000-8000-000000000002', 'davi@lima-djen.invalid', 'Davi Lima'),
  ('a2080000-0000-4000-8000-000000000003', 'edu@rocha-djen.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2080000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-djen', 'a2080000-0000-4000-8000-000000000001'),
  ('b2080000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-djen', 'a2080000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2080000-0000-4000-8000-00000000000a', 'a2080000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2080000-0000-4000-8000-00000000000a', 'a2080000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b2080000-0000-4000-8000-00000000000b', 'a2080000-0000-4000-8000-000000000003', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2080000-0000-4000-8000-000000000001', 'b2080000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (org_id, case_id, kind, court, status, cnj, filed_at) values
  ('b2080000-0000-4000-8000-00000000000a', 'c2080000-0000-4000-8000-000000000001', 'juizado', 'TJGO', 'filed',
   '10003039420998090100', '2026-09-01');
insert into public.publications (org_id, hash, court, cnj, available_on, kind, body, unit, class_name) values
  ('b2080000-0000-4000-8000-00000000000a', 'hash-djen-1', 'TJGO', '10003012720998090100', current_date - 20, 'Intimação',
   'Autor: Pessoa Teste. Réu: COMPANHIA AÉREA DE TESTE SA. Cite-se.', '1º Juizado Especial Cível de Goiânia',
   'Procedimento do Juizado Especial Cível'),
  ('b2080000-0000-4000-8000-00000000000a', 'hash-djen-2', 'TJGO', '10003012720998090100', current_date - 5, 'Intimação',
   'Designada audiência de conciliação.', '1º Juizado Especial Cível de Goiânia', 'Procedimento do Juizado Especial Cível'),
  ('b2080000-0000-4000-8000-00000000000a', 'hash-djen-3', 'TJGO', '10003021220998090100', current_date - 9, 'Intimação',
   'Intime-se a parte autora.', '2º Juizado Especial Cível de Goiânia', 'Procedimento do Juizado Especial Cível'),
  ('b2080000-0000-4000-8000-00000000000a', 'hash-djen-4', 'TJGO', '10003039420998090100', current_date - 3, 'Intimação',
   'Processo que o escritório já tem.', '3º Juizado Especial Cível de Goiânia', 'Procedimento do Juizado Especial Cível');
-- The company of the test, known by its name in court.
insert into public.airlines (iata, name, country, legal_name, court_names) values
  ('ZZ', 'Companhia de Teste', 'BR', 'COMPANHIA AEREA DE TESTE SA', array['COMPANHIA AEREA DE TESTE SA'])
on conflict (iata) do update set court_names = excluded.court_names;

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, path text[]) returns text language sql as
$$ select payload #>> got.path from res where res.name = got.name; $$;
create function pg_temp.sign_in(person uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;

select pg_temp.sign_in('a2080000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res select 'lima', public.firm_djen_lawsuits('b2080000-0000-4000-8000-00000000000a', 100);
reset role;
select pg_temp.sign_in('a2080000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res select 'davi', public.firm_djen_lawsuits('b2080000-0000-4000-8000-00000000000a', 100);
reset role;

select ok(
  pg_temp.got('lima', '{total}') = '2'
  and pg_temp.got('lima', '{lawsuits,0,cnj}') = '10003012720998090100'
  and pg_temp.got('lima', '{lawsuits,0,publications}') = '2'
  and pg_temp.got('lima', '{lawsuits,0,unit}') = '1º Juizado Especial Cível de Goiânia'
  and pg_temp.got('lima', '{lawsuits,0,airline_iata}') = 'ZZ'
  and pg_temp.got('lima', '{lawsuits,1,cnj}') = '10003021220998090100'
  and pg_temp.got('lima', '{lawsuits,1,airline_iata}') is null,
  'the lawsuits the DJEN shows and the firm has no lawsuit of, the latest first, each with the airline its texts name'
);

select ok(
  not exists (select 1 from res, jsonb_array_elements(payload -> 'lawsuits') x
              where name = 'lima' and x ->> 'cnj' = '10003039420998090100'),
  'a lawsuit the firm already has is not listed'
);

select ok(pg_temp.got('davi', '{code}') = 'not_allowed', 'who runs the attendance does not bring lawsuits in');

select pg_temp.sign_in('a2080000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok($$ select public.firm_djen_lawsuits('b2080000-0000-4000-8000-00000000000a', 100) $$, '42501', null,
  'nobody reads another firm''s lawsuits');
reset role;

select * from finish();
rollback;
