begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- The airline of a case read from its legs (0243). Lia's case at firm A
-- opened in the chat with no airline; the leg read from her boarding pass
-- (AD4221) names it, Azul, on the record. A case that has its airline keeps
-- it, and a leg of a code the platform does not know names none. Nothing of
-- firm A reaches firm B.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2430000-0000-4000-8000-000000000001', 'ana@lima-companhia.invalid', 'Ana Lima'),
  ('a2430000-0000-4000-8000-000000000002', 'duda@rocha-companhia.invalid', 'Duda Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b2430000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-companhia', 'a2430000-0000-4000-8000-000000000001'),
  ('b2430000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-companhia', 'a2430000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2430000-0000-4000-8000-00000000000a', 'a2430000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2430000-0000-4000-8000-00000000000b', 'a2430000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status, airline_iata) values
  ('c2430000-0000-4000-8000-000000000001', 'b2430000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'cancellation', 'documents', null),
  ('c2430000-0000-4000-8000-000000000002', 'b2430000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'documents', 'G3'),
  ('c2430000-0000-4000-8000-000000000003', 'b2430000-0000-4000-8000-00000000000a', 3, 'direito-do-passageiro', 'delay', 'documents', null);

insert into public.flight_segments (org_id, case_id, position, flight_number, source) values
  ('b2430000-0000-4000-8000-00000000000a', 'c2430000-0000-4000-8000-000000000001', 1, 'AD4221', 'firm'),
  ('b2430000-0000-4000-8000-00000000000a', 'c2430000-0000-4000-8000-000000000001', 2, 'LA3456', 'firm'),
  ('b2430000-0000-4000-8000-00000000000a', 'c2430000-0000-4000-8000-000000000002', 1, 'AD4221', 'firm'),
  ('b2430000-0000-4000-8000-00000000000a', 'c2430000-0000-4000-8000-000000000003', 1, 'ZZ1234', 'firm');

select is((select airline_iata from public.cases where id = 'c2430000-0000-4000-8000-000000000001'), 'AD',
  'a case with no airline takes the one of its first leg');
select ok(
  exists (select 1 from public.case_events where case_id = 'c2430000-0000-4000-8000-000000000001'
          and kind = 'airline_read_from_legs' and data ->> 'airline' = 'AD' and data ->> 'flight' = 'AD4221'),
  'on the record, with the flight it was read from');
select is((select airline_iata from public.cases where id = 'c2430000-0000-4000-8000-000000000002'), 'G3',
  'a case that has its airline keeps it');
select is((select airline_iata from public.cases where id = 'c2430000-0000-4000-8000-000000000003'), null,
  'a code the platform does not know names none');

-- Nobody of another firm reads it.
select set_config('request.jwt.claims', '{"sub":"a2430000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.cases where org_id = 'b2430000-0000-4000-8000-00000000000a')
  + (select count(*)::integer from public.case_events where case_id = 'c2430000-0000-4000-8000-000000000001'),
  0, 'another firm reads neither the cases nor the record');
reset role;

select * from finish();
rollback;
