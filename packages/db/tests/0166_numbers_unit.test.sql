begin;
create extension if not exists pgtap;
select plan(2);

-- ============================================================
-- The firm's numbers by unit (0168). Ana, a partner of Lima, reads the set
-- of the firm's lawsuits filed: each says the unit the court records, and a
-- lawsuit with none says nothing. Rocha's partner reads none of Lima's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1660000-0000-4000-8000-000000000001', 'ana@lima-vara.invalid', 'Ana Lima'),
  ('a1660000-0000-4000-8000-000000000009', 'edu@rocha-vara.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b1660000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-vara', 'a1660000-0000-4000-8000-000000000001'),
  ('b1660000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-vara', 'a1660000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1660000-0000-4000-8000-00000000000a', 'a1660000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1660000-0000-4000-8000-00000000000b', 'a1660000-0000-4000-8000-000000000009', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1660000-0000-4000-8000-000000000001', 'b1660000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c1660000-0000-4000-8000-000000000002', 'b1660000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at, unit) values
  ('f1660000-0000-4000-8000-000000000001', 'b1660000-0000-4000-8000-00000000000a', 'c1660000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01', '1º Juizado Especial Cível de Goiânia'),
  ('f1660000-0000-4000-8000-000000000002', 'b1660000-0000-4000-8000-00000000000a', 'c1660000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'filed', '10003021220998090100', '2026-09-02', null);

create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1660000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
insert into res values ('lima', public.firm_lawsuit_numbers('b1660000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  (select r ->> 'unit' = '1º Juizado Especial Cível de Goiânia' from res, jsonb_array_elements(res.value -> 'rows') r
   where res.key = 'lima' and r ->> 'id' = 'f1660000-0000-4000-8000-000000000001')
    and (select r ->> 'unit' is null from res, jsonb_array_elements(res.value -> 'rows') r
         where res.key = 'lima' and r ->> 'id' = 'f1660000-0000-4000-8000-000000000002'),
  'each lawsuit of the set says its unit, and one with none says nothing'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1660000-0000-4000-8000-000000000009', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select throws_ok(
  $$select public.firm_lawsuit_numbers('b1660000-0000-4000-8000-00000000000a')$$,
  '42501', null, 'another firm reads none of the set'
);
reset role;

select * from finish();
rollback;
