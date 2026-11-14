begin;
create extension if not exists pgtap;
select plan(4);

-- ============================================================
-- Who has a case while ONE asks the account after the signature (0252).
-- Firm A has a delay with no account, nothing signed and no lawsuit: ONE
-- asks the account in the chat once something is signed, so the case is
-- not the client's for it; a lost bag, a problem ONE does not interview,
-- still waits on the client's account. Firm B's case is not firm A's.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2520000-0000-4000-8000-000000000001', 'ana@lima-relato.invalid', 'Ana Lima'),
  ('a2520000-0000-4000-8000-000000000002', 'duda@rocha-relato.invalid', 'Duda Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2520000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-relato', 'a2520000-0000-4000-8000-000000000001'),
  ('b2520000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-relato', 'a2520000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2520000-0000-4000-8000-00000000000a', 'a2520000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2520000-0000-4000-8000-00000000000b', 'a2520000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2520000-0000-4000-8000-000000000001', 'b2520000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'intake'),
  ('c2520000-0000-4000-8000-000000000002', 'b2520000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'baggage_lost', 'intake'),
  ('c2520000-0000-4000-8000-000000000003', 'b2520000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'intake');

create temp table standing as
select * from public.case_standing('b2520000-0000-4000-8000-00000000000a', null, null);

select is(
  (select holder || ' ' || coalesce(why, 'nada') from standing where case_id = 'c2520000-0000-4000-8000-000000000001'),
  'one nada',
  'a delay whose account ONE asks after the signature is not the client''s for it');
select is(
  (select holder || ' ' || why from standing where case_id = 'c2520000-0000-4000-8000-000000000002'),
  'client account',
  'a problem ONE does not interview still waits on the client''s account');
select is(
  (select count(*)::integer from standing where case_id = 'c2520000-0000-4000-8000-000000000003'),
  0, 'firm B''s case is never firm A''s');
select ok(
  not has_function_privilege('authenticated', 'public.case_standing(uuid, text, uuid[])', 'EXECUTE')
  and not has_function_privilege('anon', 'public.case_standing(uuid, text, uuid[])', 'EXECUTE'),
  'only the database''s own functions read it');

select * from finish();
rollback;
