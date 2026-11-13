begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- What a piece leaves to complete, and ONE's approval tried again (0245).
-- Lia's case at firm A has the piece ONE wrote with the defendant's CNPJ
-- left to complete and ONE's try to approve it spent. The firm reads what
-- it leaves to complete; once the leg read from her boarding pass names
-- the airline, ONE's approval is owed again. Firm B reads nothing of it.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2450000-0000-4000-8000-000000000001', 'ana@lima-lacunas.invalid', 'Ana Lima'),
  ('a2450000-0000-4000-8000-000000000002', 'duda@rocha-lacunas.invalid', 'Duda Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b2450000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-lacunas', 'a2450000-0000-4000-8000-000000000001'),
  ('b2450000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-lacunas', 'a2450000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2450000-0000-4000-8000-00000000000a', 'a2450000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2450000-0000-4000-8000-00000000000b', 'a2450000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2450000-0000-4000-8000-000000000001', 'b2450000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'cancellation', 'drafting');
insert into public.proceedings (id, org_id, case_id, kind, court) values
  ('f2450000-0000-4000-8000-000000000001', 'b2450000-0000-4000-8000-00000000000a', 'c2450000-0000-4000-8000-000000000001', 'juizado', 'TJGO');
insert into public.draft_templates (id, org_id, name, body) values
  ('e2450000-0000-4000-8000-000000000001', 'b2450000-0000-4000-8000-00000000000a', 'Petição inicial', 'Modelo de teste do escritório A.');
insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_id, template_name, template_body, mode, status, version, auto_approval_owed) values
  ('d2450000-0000-4000-8000-000000000001', 'b2450000-0000-4000-8000-00000000000a', 'c2450000-0000-4000-8000-000000000001',
   'f2450000-0000-4000-8000-000000000001', 'e2450000-0000-4000-8000-000000000001', 'Petição inicial', 'Modelo de teste do escritório A.',
   'ai', 'proposed', 1, false);
insert into public.case_draft_versions (org_id, draft_id, version, author, body) values
  ('b2450000-0000-4000-8000-00000000000a', 'd2450000-0000-4000-8000-000000000001', 1, 'ai',
   'Contra a ré, CNPJ [COMPLETAR: CNPJ da companhia], e de novo [COMPLETAR: CNPJ da companhia]; e [COMPLETAR: endereço da ré].');

select set_config('request.jwt.claims', '{"sub":"a2450000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  public.case_drafts_gaps('c2450000-0000-4000-8000-000000000001') -> 'd2450000-0000-4000-8000-000000000001',
  '["CNPJ da companhia", "endereço da ré"]'::jsonb,
  'the firm reads what the piece leaves to complete, once each');
reset role;

-- The leg read from her boarding pass names the airline: ONE's approval is owed again.
insert into public.flight_segments (org_id, case_id, position, flight_number, source) values
  ('b2450000-0000-4000-8000-00000000000a', 'c2450000-0000-4000-8000-000000000001', 1, 'AD4221', 'firm');
select is((select airline_iata from public.cases where id = 'c2450000-0000-4000-8000-000000000001'), 'AD',
  'the case takes the airline of its leg');
select ok((select auto_approval_owed from public.case_drafts where id = 'd2450000-0000-4000-8000-000000000001'),
  'and the piece ONE wrote is owed ONE''s approval again');

-- Nobody of another firm reads it.
select set_config('request.jwt.claims', '{"sub":"a2450000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.case_drafts_gaps('c2450000-0000-4000-8000-000000000001') $$,
  'P0002', null, 'another firm reads nothing of the piece');
select is((select count(*)::integer from public.case_drafts where case_id = 'c2450000-0000-4000-8000-000000000001'), 0,
  'nor the piece itself');
reset role;

select * from finish();
rollback;
