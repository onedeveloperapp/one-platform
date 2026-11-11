begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- The numbers by lawyer (0210). Lima's lawsuit has two lawyers of the firm,
-- an approved piece 82 in a hundred alike to the firm's most alike one and a
-- settlement of R$ 6.000; its other lawsuit has no lawyer named. The numbers
-- give each lawsuit its lawyers by name, how alike its piece was and the
-- settlement's value. Rocha reads nothing of Lima's.
--
-- Every person, firm, number and text here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2100000-0000-4000-8000-000000000001', 'ana@lima-num.invalid', 'Ana Lima'),
  ('a2100000-0000-4000-8000-000000000002', 'davi@lima-num.invalid', 'Davi Lima'),
  ('a2100000-0000-4000-8000-000000000003', 'edu@rocha-num.invalid', 'Edu Rocha')
) as u (id, email, name);
update public.profiles set display_name = 'Ana Lima' where id = 'a2100000-0000-4000-8000-000000000001';
update public.profiles set display_name = 'Davi Lima' where id = 'a2100000-0000-4000-8000-000000000002';
insert into public.organizations (id, name, slug, created_by) values
  ('b2100000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-num', 'a2100000-0000-4000-8000-000000000001'),
  ('b2100000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-num', 'a2100000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2100000-0000-4000-8000-00000000000a', 'a2100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2100000-0000-4000-8000-00000000000a', 'a2100000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b2100000-0000-4000-8000-00000000000b', 'a2100000-0000-4000-8000-000000000003', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2100000-0000-4000-8000-000000000001', 'b2100000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c2100000-0000-4000-8000-000000000002', 'b2100000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f2100000-0000-4000-8000-000000000001', 'b2100000-0000-4000-8000-00000000000a', 'c2100000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01'),
  ('f2100000-0000-4000-8000-000000000002', 'b2100000-0000-4000-8000-00000000000a', 'c2100000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'filed', '10003021220998090100', '2026-09-02');
insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values
  ('f2100000-0000-4000-8000-000000000001', 'a2100000-0000-4000-8000-000000000002', 'b2100000-0000-4000-8000-00000000000a'),
  ('f2100000-0000-4000-8000-000000000001', 'a2100000-0000-4000-8000-000000000001', 'b2100000-0000-4000-8000-00000000000a');
insert into public.case_drafts (org_id, case_id, proceeding_id, template_name, template_body, mode, status, version,
                                approved_version, approved_body, approved_at, alike) values
  ('b2100000-0000-4000-8000-00000000000a', 'c2100000-0000-4000-8000-000000000001', 'f2100000-0000-4000-8000-000000000001',
   'Petição inicial', 'Modelo de teste, com o texto de uma peça.', 'blank', 'approved', 1, 1,
   'Texto de teste da peça aprovada.', now(),
   '[{"draft": "a2100000-0000-4000-8000-0000000000d9", "case": "c2100000-0000-4000-8000-000000000002", "percent": 82},
     {"draft": "a2100000-0000-4000-8000-0000000000d8", "case": "c2100000-0000-4000-8000-000000000002", "percent": 40}]');
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, cents, happened_on, source) values
  ('b2100000-0000-4000-8000-00000000000a', 'c2100000-0000-4000-8000-000000000001', 'f2100000-0000-4000-8000-000000000001',
   'acordo', 600000, '2026-10-10', 'person');

select set_config('request.jwt.claims', '{"sub":"a2100000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
create temp table numbers on commit drop as
select r as row_data from jsonb_array_elements(
  public.firm_lawsuit_numbers('b2100000-0000-4000-8000-00000000000a') -> 'rows') r;
select is((select row_data -> 'lawyers' from numbers where row_data ->> 'cnj' = '10003012720998090100'),
  '["Ana Lima", "Davi Lima"]'::jsonb, 'a lawsuit names its lawyers of the firm, by name');
select is((select row_data -> 'lawyers' from numbers where row_data ->> 'cnj' = '10003021220998090100'),
  '[]'::jsonb, 'a lawsuit with no lawyer named says none');
select is((select (row_data ->> 'alike')::numeric from numbers where row_data ->> 'cnj' = '10003012720998090100'),
  82::numeric, 'how alike its approved piece was to the firm''s most alike one');
select is((select (row_data ->> 'settled_cents')::bigint from numbers where row_data ->> 'cnj' = '10003012720998090100'),
  600000::bigint, 'the settlement''s value');
reset role;

select set_config('request.jwt.claims', '{"sub":"a2100000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.firm_lawsuit_numbers('b2100000-0000-4000-8000-00000000000a')$$, '42501', null,
  'another firm reads nothing of the numbers');
reset role;

select * from finish();
rollback;
