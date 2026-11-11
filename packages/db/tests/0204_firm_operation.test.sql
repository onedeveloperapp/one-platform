begin;
create extension if not exists pgtap;
select plan(4);

-- ============================================================
-- The firms' console, by firm (0204). The operator reads Lima's operation:
-- its open real cases against its tier, its people, the cost of its AI this
-- month, its connections and whether it let the support in. A person of a
-- firm reads nothing of it, nor of another firm.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2040000-0000-4000-8000-000000000001', 'ana@lima-console.invalid', 'Ana Lima'),
  ('a2040000-0000-4000-8000-000000000003', 'edu@rocha-console.invalid', 'Edu Rocha'),
  ('a2040000-0000-4000-8000-000000000009', 'operador@console.invalid', 'Operador')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2040000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-console', 'a2040000-0000-4000-8000-000000000001'),
  ('b2040000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-console', 'a2040000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2040000-0000-4000-8000-00000000000a', 'a2040000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2040000-0000-4000-8000-00000000000b', 'a2040000-0000-4000-8000-000000000003', 'owner', 'socio');
update public.profiles set is_superadmin = true where id = 'a2040000-0000-4000-8000-000000000009';
insert into public.cases (org_id, seq, module, incident, status, is_test) values
  ('b2040000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'intake', false),
  ('b2040000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed', false),
  ('b2040000-0000-4000-8000-00000000000a', 3, 'direito-do-passageiro', 'delay', 'intake', true);
insert into public.support_authorizations (org_id, granted_by, ends_at) values
  ('b2040000-0000-4000-8000-00000000000a', 'a2040000-0000-4000-8000-000000000001', now() + interval '2 hours');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, path text[]) returns text language sql as
$$ select payload #>> got.path from res where res.name = got.name; $$;
create function pg_temp.sign_in(person uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;

select pg_temp.sign_in('a2040000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res select 'lima', public.admin_firm_operation('b2040000-0000-4000-8000-00000000000a');
insert into res select 'rocha', public.admin_firm_operation('b2040000-0000-4000-8000-00000000000b');
reset role;

select ok(
  pg_temp.got('lima', '{usage,0,metric}') = 'processos_ativos' and pg_temp.got('lima', '{usage,0,now}') = '2'
  and pg_temp.got('lima', '{usage,1,now}') = '1'
  and pg_temp.got('lima', '{cases,going}') = '2' and pg_temp.got('lima', '{cases,tests}') = '1'
  and pg_temp.got('lima', '{ai,cost_usd_micros_month}') = '0'
  and pg_temp.got('lima', '{support_until}') is not null,
  'the operator reads a firm''s use, its cases, its AI''s cost and whether it let the support in'
);

select ok(
  pg_temp.got('rocha', '{support_until}') is null and pg_temp.got('rocha', '{cases,going}') = '0',
  'each firm is read by itself'
);

select pg_temp.sign_in('a2040000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$ select public.admin_firm_operation('b2040000-0000-4000-8000-00000000000a') $$, '42501', null,
  'a person of a firm reads no firm''s operation, not even their own here');
select throws_ok($$ select public.admin_firm_operation('b2040000-0000-4000-8000-00000000000b') $$, '42501', null,
  'nor another firm''s');
reset role;

select * from finish();
rollback;
