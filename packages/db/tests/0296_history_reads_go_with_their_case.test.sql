begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

-- ============================================================
-- The reading of a lawsuit's history goes with its case (0296). Firm A's case, its lawsuit and the reading of its
-- history are written and the case removed in one transaction, as the undoing of an import does: nothing fails, and
-- the reading goes with them. Firm B's case keeps its own, and firm B reads nothing of firm A's.
--
-- Every firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2960000-0000-4000-8000-000000000001', 'ana@lima-historico.invalid', 'Ana Lima'),
  ('a2960000-0000-4000-8000-000000000002', 'duda@rocha-historico.invalid', 'Duda Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2960000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-historico', 'a2960000-0000-4000-8000-000000000001'),
  ('b2960000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-historico', 'a2960000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2960000-0000-4000-8000-00000000000a', 'a2960000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2960000-0000-4000-8000-00000000000b', 'a2960000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, incident) values
  ('c2960000-0000-4000-8000-00000000000a', 'b2960000-0000-4000-8000-00000000000a', 1, 'delay'),
  ('c2960000-0000-4000-8000-00000000000b', 'b2960000-0000-4000-8000-00000000000b', 1, 'delay');
insert into public.proceedings (id, org_id, case_id, kind, court) values
  ('d2960000-0000-4000-8000-00000000000a', 'b2960000-0000-4000-8000-00000000000a', 'c2960000-0000-4000-8000-00000000000a', 'juizado', 'TJGO'),
  ('d2960000-0000-4000-8000-00000000000b', 'b2960000-0000-4000-8000-00000000000b', 'c2960000-0000-4000-8000-00000000000b', 'juizado', 'TJSP');
insert into public.proceeding_history_reads (org_id, proceeding_id, case_id) values
  ('b2960000-0000-4000-8000-00000000000a', 'd2960000-0000-4000-8000-00000000000a', 'c2960000-0000-4000-8000-00000000000a'),
  ('b2960000-0000-4000-8000-00000000000b', 'd2960000-0000-4000-8000-00000000000b', 'c2960000-0000-4000-8000-00000000000b');

select is(
  (select confdeltype::text from pg_constraint where conname = 'proceeding_history_reads_case_id_org_id_fkey'),
  'c', 'the key to the case takes the reading with the case');

select lives_ok($$delete from public.cases where id = 'c2960000-0000-4000-8000-00000000000a'$$,
  'a case removed in the transaction that wrote its lawsuit and its reading is removed whole');
select is(
  (select string_agg(org_id::text, ', ') from public.proceeding_history_reads where proceeding_id::text like 'd2960000%'),
  'b2960000-0000-4000-8000-00000000000b', 'the reading went with firm A''s case, and firm B''s keeps its own');

select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'a2960000-0000-4000-8000-000000000002', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select is((select count(*)::integer from public.cases where org_id = 'b2960000-0000-4000-8000-00000000000a'), 0,
  'firm B reads nothing of firm A''s cases');
reset role;

select * from finish();
rollback;
