begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- ============================================================
-- A partner or a lawyer takes on the sources a piece cites and the library does not cover (0299). Firm A's initial
-- cites the CDC, which the platform's library covers, and the Código Brasileiro de Aeronáutica, which it does not:
-- it is held. Who attends the firm takes nothing on; the lawyer, for the version they read, takes it on, and the
-- piece goes on, who and which kept and said on the case's trail. A new version is read again. Firm B takes nothing
-- of firm A's.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2990000-0000-4000-8000-000000000001', 'ana@lima-fontes.invalid', 'Ana Lima'),
  ('a2990000-0000-4000-8000-000000000002', 'duda@rocha-fontes.invalid', 'Duda Rocha'),
  ('a2990000-0000-4000-8000-000000000003', 'caio@lima-fontes.invalid', 'Caio Atende')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2990000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-fontes', 'a2990000-0000-4000-8000-000000000001'),
  ('b2990000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-fontes', 'a2990000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2990000-0000-4000-8000-00000000000a', 'a2990000-0000-4000-8000-000000000001', 'owner', 'advogado'),
  ('b2990000-0000-4000-8000-00000000000a', 'a2990000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b2990000-0000-4000-8000-00000000000b', 'a2990000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, incident, status) values
  ('c2990000-0000-4000-8000-00000000000a', 'b2990000-0000-4000-8000-00000000000a', 1, 'cancellation', 'drafting');
insert into public.proceedings (id, org_id, case_id, kind, court) values
  ('d2990000-0000-4000-8000-00000000000a', 'b2990000-0000-4000-8000-00000000000a', 'c2990000-0000-4000-8000-00000000000a',
   'juizado', 'TJRJ');
insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_name, template_body, mode, status, version,
                                checked_version) values
  ('e2990000-0000-4000-8000-00000000000a', 'b2990000-0000-4000-8000-00000000000a', 'c2990000-0000-4000-8000-00000000000a',
   'd2990000-0000-4000-8000-00000000000a', 'Inicial', 'Texto do modelo da inicial do escritório.', 'blank', 'proposed', 1, 1);
insert into public.case_draft_versions (org_id, draft_id, version, author, body) values
  ('b2990000-0000-4000-8000-00000000000a', 'e2990000-0000-4000-8000-00000000000a', 1, 'person',
   'A companhia responde pelo art. 14 da Lei nº 8.078 e pelo art. 256 da Lei nº 7.565.');
insert into public.case_draft_citations (org_id, draft_id, version, position, kind, number, article, key, raw) values
  ('b2990000-0000-4000-8000-00000000000a', 'e2990000-0000-4000-8000-00000000000a', 1, 0, 'lei', '8078', '14', 'lei::8078#14',
   'art. 14 da Lei nº 8.078'),
  ('b2990000-0000-4000-8000-00000000000a', 'e2990000-0000-4000-8000-00000000000a', 1, 1, 'lei', '7565', '256', 'lei::7565#256',
   'art. 256 da Lei nº 7.565');

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;

select is(public.case_draft_state_blocker('e2990000-0000-4000-8000-00000000000a'), 'citations_not_verified',
  'a piece citing what the library does not cover is held');

-- ---------- Who takes them on ----------

select pg_temp.sign_in('a2990000-0000-4000-8000-000000000003');
set local role authenticated;
select is(public.take_draft_sources('e2990000-0000-4000-8000-00000000000a', 1) ->> 'code', 'not_allowed',
  'who attends the firm takes no source on');
select pg_temp.sign_in('a2990000-0000-4000-8000-000000000001');
select is(public.take_draft_sources('e2990000-0000-4000-8000-00000000000a', 2) ->> 'code', 'draft_changed',
  'a version other than the one read is read again');
select is(public.take_draft_sources('e2990000-0000-4000-8000-00000000000a', 1) -> 'sources', '["lei::7565#256"]'::jsonb,
  'the lawyer takes on, for the version they read, the source the library does not cover, and only it');
reset role;

select is(public.case_draft_state_blocker('e2990000-0000-4000-8000-00000000000a'), null,
  'the piece goes on to its approval');
select is(
  (select sources_taken_version || ' ' || sources_taken_by::text || ' ' || array_to_string(sources_taken_keys, ',')
   from public.case_drafts where id = 'e2990000-0000-4000-8000-00000000000a'),
  '1 a2990000-0000-4000-8000-000000000001 lei::7565#256', 'who took it on, which version and which source are kept');
select ok(exists (
  select 1 from public.case_events
  where case_id = 'c2990000-0000-4000-8000-00000000000a' and kind = 'draft_sources_taken' and actor_type = 'person'
    and data -> 'sources' = '["lei::7565#256"]'::jsonb),
  'and said on the case''s trail');

-- ---------- A new version is read again ----------

insert into public.case_draft_versions (org_id, draft_id, version, author, body) values
  ('b2990000-0000-4000-8000-00000000000a', 'e2990000-0000-4000-8000-00000000000a', 2, 'person',
   'A companhia responde pelo art. 256 da Lei nº 7.565, agora com mais um parágrafo.');
insert into public.case_draft_citations (org_id, draft_id, version, position, kind, number, article, key, raw) values
  ('b2990000-0000-4000-8000-00000000000a', 'e2990000-0000-4000-8000-00000000000a', 2, 0, 'lei', '7565', '256', 'lei::7565#256',
   'art. 256 da Lei nº 7.565');
update public.case_drafts set version = 2, checked_version = 2 where id = 'e2990000-0000-4000-8000-00000000000a';
select is(public.case_draft_state_blocker('e2990000-0000-4000-8000-00000000000a'), 'citations_not_verified',
  'a new version is held again until its own sources are taken on');

-- ---------- Each firm its own ----------

select pg_temp.sign_in('a2990000-0000-4000-8000-000000000002');
set local role authenticated;
select is(public.take_draft_sources('e2990000-0000-4000-8000-00000000000a', 2) ->> 'code', 'draft_not_found',
  'firm B takes nothing of firm A''s');
select throws_ok($$select public.case_draft_uncovered_keys('e2990000-0000-4000-8000-00000000000a', 2)$$,
  '42501', null, 'nobody of a firm calls the rule of the sources directly');
reset role;

select * from finish();
rollback;
