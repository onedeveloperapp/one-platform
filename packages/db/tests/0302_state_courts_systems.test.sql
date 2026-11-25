begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- ============================================================
-- The systems the platform's table lacked for five state courts and kinds (0302). Every state court has a system for
-- the juizado and for the civil court, with the file types of its system (the TJRJ's juizado as 0303 corrected it).
-- Firm A, which approves the system ONE names, plans a lawsuit at the juizado of the TJMG: ONE names the eproc, the
-- firm's lawyer approves it. Firm B leaves the decision to ONE: its lawsuit at the juizado of the TJRR has the Projudi,
-- approved by ONE at once, whatever firm A decided of its own.
--
-- Every person, firm and number here is invented.
-- ============================================================

select is(
  (select array_agg(court || ':' || proceeding_kind || '=' || system order by court, proceeding_kind)
   from public.court_systems
   where (court, proceeding_kind) in (('TJRJ', 'juizado'), ('TJDFT', 'juizado'), ('TJMG', 'juizado'),
                                      ('TJRR', 'comum'), ('TJRR', 'juizado'))),
  array['TJDFT:juizado=pje', 'TJMG:juizado=eproc', 'TJRJ:juizado=pje', 'TJRR:comum=projudi', 'TJRR:juizado=projudi'],
  'the five rows the table lacked have their systems');
select ok(not exists (
  select 1 from public.courts c cross join (values ('juizado'), ('comum')) as k (kind)
  where c.acronym like 'TJ%'
    and not exists (select 1 from public.court_systems s where s.court = c.acronym and s.proceeding_kind = k.kind)),
  'every state court has a system for the juizado and for the civil court');
select ok((select bool_and(case system
                             when 'eproc' then file_types = '{"petition": "Petição inicial (INIC)"}'::jsonb
                             when 'pje' then file_types = '{"petition": "Petição inicial"}'::jsonb
                             else file_types = '{}'::jsonb and max_petition_bytes is null end)
           from public.court_systems
           where (court, proceeding_kind) in (('TJRJ', 'juizado'), ('TJDFT', 'juizado'), ('TJMG', 'juizado'),
                                              ('TJRR', 'comum'), ('TJRR', 'juizado'))),
  'each with the file types of its system');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a3020000-0000-4000-8000-000000000001', 'ana@lima-sistemas.invalid', 'Ana Lima'),
  ('a3020000-0000-4000-8000-000000000002', 'duda@rocha-sistemas.invalid', 'Duda Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b3020000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-sistemas', 'a3020000-0000-4000-8000-000000000001'),
  ('b3020000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-sistemas', 'a3020000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b3020000-0000-4000-8000-00000000000a', 'a3020000-0000-4000-8000-000000000001', 'owner', 'advogado'),
  ('b3020000-0000-4000-8000-00000000000b', 'a3020000-0000-4000-8000-000000000002', 'owner', 'socio');
-- Firm A approves the system ONE names; firm B leaves it to ONE, as every firm does by default.
insert into public.firm_autonomy (org_id, decision, mode) values
  ('b3020000-0000-4000-8000-00000000000a', 'court_system', 'approval');
insert into public.cases (id, org_id, seq, incident, status) values
  ('c3020000-0000-4000-8000-00000000000a', 'b3020000-0000-4000-8000-00000000000a', 1, 'cancellation', 'drafting'),
  ('c3020000-0000-4000-8000-00000000000b', 'b3020000-0000-4000-8000-00000000000b', 1, 'delay', 'drafting');
insert into public.proceedings (id, org_id, case_id, kind, court, comarca, forum_basis, forum_city) values
  ('d3020000-0000-4000-8000-00000000000a', 'b3020000-0000-4000-8000-00000000000a', 'c3020000-0000-4000-8000-00000000000a',
   'juizado', 'TJMG', 'Belo Horizonte', 'domicile', 'Belo Horizonte'),
  ('d3020000-0000-4000-8000-00000000000b', 'b3020000-0000-4000-8000-00000000000b', 'c3020000-0000-4000-8000-00000000000b',
   'juizado', 'TJRR', 'Boa Vista', 'domicile', 'Boa Vista');

select is(
  (select system || ' ' || system_by_one || ' ' || (system_approved_at is null)
   from public.proceedings where id = 'd3020000-0000-4000-8000-00000000000a'),
  'eproc true true', 'a lawsuit at the juizado of the TJMG has the eproc, named by ONE, for the firm to approve');

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;

select pg_temp.sign_in('a3020000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.decide_court_system('d3020000-0000-4000-8000-00000000000a', true) ->> 'code', 'approved',
  'and the firm''s lawyer approves it');
reset role;

select is(
  (select system || ' ' || system_by_one || ' ' || (system_approved_at is not null) || ' ' || (system_approved_by is null)
   from public.proceedings where id = 'd3020000-0000-4000-8000-00000000000b'),
  'projudi true true true', 'a lawsuit of firm B at the juizado of the TJRR has the Projudi, approved by ONE at once');
select is(
  (select system_approved_by from public.proceedings where id = 'd3020000-0000-4000-8000-00000000000a'),
  'a3020000-0000-4000-8000-000000000001'::uuid, 'each firm''s lawsuit keeps its own decision');

select * from finish();
rollback;
