begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- ============================================================
-- A member reads who took on the sources of a piece (0305), with the rest of the piece, as the case screen asks for
-- it. Firm A's lawyer reads the four columns of 0299 on their firm's piece; firm B's partner reads no piece of
-- firm A's.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a3050000-0000-4000-8000-000000000001', 'ana@lima-colunas.invalid', 'Ana Lima'),
  ('a3050000-0000-4000-8000-000000000002', 'duda@rocha-colunas.invalid', 'Duda Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b3050000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-colunas', 'a3050000-0000-4000-8000-000000000001'),
  ('b3050000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-colunas', 'a3050000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b3050000-0000-4000-8000-00000000000a', 'a3050000-0000-4000-8000-000000000001', 'owner', 'advogado'),
  ('b3050000-0000-4000-8000-00000000000b', 'a3050000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, incident, status) values
  ('c3050000-0000-4000-8000-00000000000a', 'b3050000-0000-4000-8000-00000000000a', 1, 'cancellation', 'drafting');
insert into public.proceedings (id, org_id, case_id, kind, court) values
  ('d3050000-0000-4000-8000-00000000000a', 'b3050000-0000-4000-8000-00000000000a', 'c3050000-0000-4000-8000-00000000000a',
   'juizado', 'TJRJ');
insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_name, template_body, mode, status, version,
                                checked_version) values
  ('e3050000-0000-4000-8000-00000000000a', 'b3050000-0000-4000-8000-00000000000a', 'c3050000-0000-4000-8000-00000000000a',
   'd3050000-0000-4000-8000-00000000000a', 'Inicial', 'Texto do modelo da inicial do escritório.', 'blank', 'proposed', 1, 1);

select ok(
  (select bool_and(has_column_privilege('authenticated', 'public.case_drafts', c, 'select'))
   from unnest(array['sources_taken_version', 'sources_taken_by', 'sources_taken_at', 'sources_taken_keys']) as c),
  'a member may read the four columns of who took on the sources');

select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'a3050000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select lives_ok(
  $$select id, status, version, updated_at, sources_taken_version, sources_taken_by, sources_taken_at, sources_taken_keys
    from public.case_drafts where case_id = 'c3050000-0000-4000-8000-00000000000a'$$,
  'the lawyer reads the piece with who took on its sources, as the case screen asks for it');
select is(
  (select count(*)::integer from public.case_drafts
   where case_id = 'c3050000-0000-4000-8000-00000000000a' and sources_taken_version is null and sources_taken_keys = '{}'),
  1, 'the lawyer reads that nobody took on the sources of their firm''s piece');
reset role;

select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'a3050000-0000-4000-8000-000000000002', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select is(
  (select count(*)::integer from public.case_drafts where org_id = 'b3050000-0000-4000-8000-00000000000a'), 0,
  'firm B reads no piece of firm A''s');
reset role;

select * from finish();
rollback;
