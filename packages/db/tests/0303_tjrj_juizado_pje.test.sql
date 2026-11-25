begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- ============================================================
-- A new lawsuit at a juizado of the TJRJ goes to the PJe until the eproc reaches its unit (0303). The row says the
-- PJe, with its file types and the court's schedule as its source. Firm A's lawsuit at the VI Juizado Especial Cível
-- of the Capital has the PJe, named by ONE; when the platform turns the row to the eproc (as the operator will on
-- 10/12/2026), the planned lawsuit has it again at once, and firm B's lawsuit at the civil court of the TJRJ keeps the
-- eproc of its own row throughout.
--
-- Every person, firm and number here is invented.
-- ============================================================

select is(
  (select system || ' ' || host || ' ' || (file_types ->> 'petition') || ' ' || confirmed
   from public.court_systems where court = 'TJRJ' and proceeding_kind = 'juizado'),
  'pje tjrj.pje.jus.br Petição inicial false', 'the juizado of the TJRJ has the PJe, unconfirmed, with its file types');
select ok(
  (select source ~ '10/12/2026' and notes ~ 'Macaé' from public.court_systems
   where court = 'TJRJ' and proceeding_kind = 'juizado'),
  'saying the day the eproc reaches the Capital, and the juizados already on it');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a3030000-0000-4000-8000-000000000001', 'ana@lima-pje.invalid', 'Ana Lima'),
  ('a3030000-0000-4000-8000-000000000002', 'duda@rocha-pje.invalid', 'Duda Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b3030000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-pje', 'a3030000-0000-4000-8000-000000000001'),
  ('b3030000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-pje', 'a3030000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b3030000-0000-4000-8000-00000000000a', 'a3030000-0000-4000-8000-000000000001', 'owner', 'advogado'),
  ('b3030000-0000-4000-8000-00000000000b', 'a3030000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, incident, status) values
  ('c3030000-0000-4000-8000-00000000000a', 'b3030000-0000-4000-8000-00000000000a', 1, 'cancellation', 'drafting'),
  ('c3030000-0000-4000-8000-00000000000b', 'b3030000-0000-4000-8000-00000000000b', 1, 'delay', 'drafting');
insert into public.proceedings (id, org_id, case_id, kind, court, comarca, unit, forum_basis, forum_city) values
  ('d3030000-0000-4000-8000-00000000000a', 'b3030000-0000-4000-8000-00000000000a', 'c3030000-0000-4000-8000-00000000000a',
   'juizado', 'TJRJ', 'Rio de Janeiro', 'VI Juizado Especial Cível', 'domicile', 'Rio de Janeiro'),
  ('d3030000-0000-4000-8000-00000000000b', 'b3030000-0000-4000-8000-00000000000b', 'c3030000-0000-4000-8000-00000000000b',
   'comum', 'TJRJ', 'Niterói', null, 'domicile', 'Niterói');

select is(
  (select system || ' ' || system_by_one from public.proceedings where id = 'd3030000-0000-4000-8000-00000000000a'),
  'pje true', 'a lawsuit at a juizado of the Capital has the PJe, named by ONE');

-- The platform turns the row to the eproc, as the operator will when the eproc reaches the Capital.
update public.court_systems set system = 'eproc', host = 'eproc1g.tjrj.jus.br', since = '2026-12-10',
       file_types = '{"petition": "Petição inicial (INIC)"}'::jsonb
where court = 'TJRJ' and proceeding_kind = 'juizado';

select is(
  (select system || ' ' || system_by_one from public.proceedings where id = 'd3030000-0000-4000-8000-00000000000a'),
  'eproc true', 'the planned lawsuit has the eproc at once when the row changes');
select is(
  (select system from public.proceedings where id = 'd3030000-0000-4000-8000-00000000000b'),
  'eproc', 'firm B''s lawsuit at the civil court keeps the eproc of its own row');
select ok(
  (select system_approved_at is not null and system_approved_by is null
   from public.proceedings where id = 'd3030000-0000-4000-8000-00000000000a'),
  'and firm A''s, which leaves the decision to ONE, is approved by ONE again');

select * from finish();
rollback;
