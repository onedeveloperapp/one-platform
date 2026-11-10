begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- Os números do escritório (0136). Lima filed two lawsuits: one judged for
-- the client, recorded by a person, with a value per claimant; one judged
-- against, read by ONE and checked by nobody; a third is a test case. Ana, a
-- partner, reads the set the numbers are made of, the test case out unless
-- asked; Davi, of the attendance, reads none; who reads the books reads each
-- case's fees and costs. Rocha reads nothing of Lima's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1350000-0000-4000-8000-000000000001', 'ana@lima-numeros.invalid', 'Ana Lima'),
  ('a1350000-0000-4000-8000-000000000002', 'davi@lima-numeros.invalid', 'Davi Lima'),
  ('a1350000-0000-4000-8000-000000000009', 'edu@rocha-numeros.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1350000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-numeros', 'a1350000-0000-4000-8000-000000000001'),
  ('b1350000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-numeros', 'a1350000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1350000-0000-4000-8000-00000000000a', 'a1350000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1350000-0000-4000-8000-00000000000a', 'a1350000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b1350000-0000-4000-8000-00000000000b', 'a1350000-0000-4000-8000-000000000009', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status, airline_iata, is_test) values
  ('c1350000-0000-4000-8000-000000000001', 'b1350000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed', 'LA', false),
  ('c1350000-0000-4000-8000-000000000002', 'b1350000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'cancellation', 'filed', 'G3', false),
  ('c1350000-0000-4000-8000-000000000003', 'b1350000-0000-4000-8000-00000000000a', 3, 'direito-do-passageiro', 'delay', 'filed', 'LA', true);
insert into public.proceedings (id, org_id, case_id, kind, court, comarca, status, cnj, filed_at) values
  ('f1350000-0000-4000-8000-000000000001', 'b1350000-0000-4000-8000-00000000000a', 'c1350000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'Goiânia', 'filed', '10003012720998090100', '2026-03-01'),
  ('f1350000-0000-4000-8000-000000000002', 'b1350000-0000-4000-8000-00000000000a', 'c1350000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'Anápolis', 'filed', '10003021220998090100', '2026-04-01'),
  ('f1350000-0000-4000-8000-000000000003', 'b1350000-0000-4000-8000-00000000000a', 'c1350000-0000-4000-8000-000000000003',
   'juizado', 'TJGO', 'Goiânia', 'filed', '10003039420998090100', '2026-05-01');
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, result, cents, per_claimant, happened_on, source, by_one, confirmed) values
  ('b1350000-0000-4000-8000-00000000000a', 'c1350000-0000-4000-8000-000000000001', 'f1350000-0000-4000-8000-000000000001',
   'sentenca', 'procedente', 500000, true, '2026-07-01', 'person', false, true),
  ('b1350000-0000-4000-8000-00000000000a', 'c1350000-0000-4000-8000-000000000002', 'f1350000-0000-4000-8000-000000000002',
   'sentenca', 'improcedente', null, false, '2026-08-01', 'rule', true, true);
insert into public.case_costs (org_id, case_id, description, cents, spent_on, paid_by) values
  ('b1350000-0000-4000-8000-00000000000a', 'c1350000-0000-4000-8000-000000000001', 'Custas do recurso', 32000, '2026-07-10', 'firm');

create function pg_temp.sign_in(person uuid, aal text default 'aal2')
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal)::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.as_person(person uuid, name text, call text) returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;

select pg_temp.as_person('a1350000-0000-4000-8000-000000000001', 'numbers',
  $$public.firm_lawsuit_numbers('b1350000-0000-4000-8000-00000000000a')$$);
select pg_temp.as_person('a1350000-0000-4000-8000-000000000001', 'with-tests',
  $$public.firm_lawsuit_numbers('b1350000-0000-4000-8000-00000000000a', true)$$);
select ok(
  (select jsonb_array_length(value -> 'rows') = 2 from res where key = 'numbers')
    and (select jsonb_array_length(value -> 'rows') = 3 from res where key = 'with-tests')
    and pg_temp.got('numbers', '{rows,0,result}') = 'improcedente' and pg_temp.got('numbers', '{rows,0,judged_checked}') = 'false'
    and pg_temp.got('numbers', '{rows,0,unchecked}') = '1'
    and pg_temp.got('numbers', '{rows,1,value_cents}') = '500000' and pg_temp.got('numbers', '{rows,1,judged_checked}') = 'true'
    and pg_temp.got('numbers', '{rows,1,comarca}') = 'Goiânia',
  'the set behind the numbers: each lawsuit filed, its judgment and whether a person checked it; the test cases out unless asked'
);

select pg_temp.as_person('a1350000-0000-4000-8000-000000000002', 'davi',
  $$public.firm_lawsuit_numbers('b1350000-0000-4000-8000-00000000000a')$$);
select is(pg_temp.got('davi', '{code}'), 'not_allowed', 'the attendance reads no number of the firm');

select pg_temp.as_person('a1350000-0000-4000-8000-000000000001', 'margins',
  $$public.firm_case_margins('b1350000-0000-4000-8000-00000000000a')$$);
select pg_temp.as_person('a1350000-0000-4000-8000-000000000002', 'davi-margins',
  $$public.firm_case_margins('b1350000-0000-4000-8000-00000000000a')$$);
select ok(
  pg_temp.got('margins', '{0,costs_cents}') = '32000' and pg_temp.got('margins', '{0,margin_cents}') = '-32000'
    and (select value is null from res where key = 'davi-margins'),
  'who reads the books reads each case''s fees, direct costs and margin; nobody else'
);

select pg_temp.sign_in('a1350000-0000-4000-8000-000000000009');
set local role authenticated;
select throws_ok($$ select public.firm_lawsuit_numbers('b1350000-0000-4000-8000-00000000000a') $$, '42501', null,
  'nobody of another firm reads its numbers');
select throws_ok($$ select public.firm_case_margins('b1350000-0000-4000-8000-00000000000a') $$, '42501', null,
  'nor its margins');
reset role;

select * from finish();
rollback;
