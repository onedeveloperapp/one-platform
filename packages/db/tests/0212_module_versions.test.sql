begin;
create extension if not exists pgtap;
select plan(18);

-- ============================================================
-- The module versioned as data (0212). Version 1 of the passenger module is
-- what was in force; Lima's first case is opened under it. The operator
-- changes the documents a problem asks and a prompt of the attendant, and
-- prepares and publishes version 2: Lima's second case is opened under it
-- and reads the new documents and the new prompt, while the first keeps
-- version 1's. A published version is never edited nor deleted; withdrawn
-- for a defect, its cases read the latest published, and the last published
-- is never withdrawn. Rocha reads nothing of Lima's, and only the operator
-- reads and publishes versions.
--
-- Every person, firm, number and text here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2120000-0000-4000-8000-000000000001', 'ana@lima-versao.invalid', 'Ana Lima'),
  ('a2120000-0000-4000-8000-000000000002', 'operador@one-versao.invalid', 'Operador'),
  ('a2120000-0000-4000-8000-000000000003', 'edu@rocha-versao.invalid', 'Edu Rocha')
) as u (id, email, name);
update public.profiles set is_superadmin = true where id = 'a2120000-0000-4000-8000-000000000002';
insert into public.organizations (id, name, slug, created_by) values
  ('b2120000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-versao', 'a2120000-0000-4000-8000-000000000001'),
  ('b2120000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-versao', 'a2120000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2120000-0000-4000-8000-00000000000a', 'a2120000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2120000-0000-4000-8000-00000000000b', 'a2120000-0000-4000-8000-000000000003', 'owner', 'socio');

create temp table v (name text primary key, id uuid);
grant select, insert on v to authenticated, service_role;
insert into v select 'v1', id from public.module_versions where module = 'direito-do-passageiro' and version = 1;

select is((select status from public.module_versions where id = (select id from v where name = 'v1')), 'published',
  'version 1 is what was in force, published');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2120000-0000-4000-8000-000000000001', 'b2120000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'documents');
select is((select module_version_id from public.cases where id = 'c2120000-0000-4000-8000-000000000001'),
  (select id from v where name = 'v1'), 'a new case is opened under the latest published version');

-- The operator changes what is in force: the documents a delay asks, and the attendant's prompt.
update public.platform_settings
set value = jsonb_set(value, '{documents_by_problem,default,essential}',
  '[{"kind": "identity", "per": "claimant"}]'::jsonb)
where key = 'cases';
update public.prompt_versions set is_active = false where task = 'atendimento.conversa' and is_active;
insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active)
select task, 9000, provider, model, effort, system_prompt, output_schema, max_tokens, true
from public.prompt_versions where task = 'atendimento.conversa' order by version desc limit 1;

select set_config('request.jwt.claims', '{"sub":"a2120000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.admin_draft_module_version('direito-do-passageiro', 'Versão de teste')$$, '42501', null,
  'only the operator prepares a version');
select is((select count(*)::int from public.module_versions), 0, 'only the operator reads the versions');
reset role;

select set_config('request.jwt.claims', '{"sub":"a2120000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into v select 'v2', (public.admin_draft_module_version('direito-do-passageiro', 'Identidade só, e o atendente novo') ->> 'id')::uuid;
select is((select public.admin_publish_module_version((select id from v where name = 'v2')) ->> 'code'), 'published',
  'the operator publishes the draft');
reset role;

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2120000-0000-4000-8000-000000000002', 'b2120000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'documents');
select is((select module_version_id from public.cases where id = 'c2120000-0000-4000-8000-000000000002'),
  (select id from v where name = 'v2'), 'a case opened after it is opened under version 2');
select is(jsonb_array_length(public.case_required_documents('c2120000-0000-4000-8000-000000000002')), 1,
  'the new case asks the documents of its version');
select ok(jsonb_array_length(public.case_required_documents('c2120000-0000-4000-8000-000000000001')) > 1,
  'the case in course keeps asking what its version asked');

-- A run of the attendant takes the prompt its case's version pins; one of no case, the latest published.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select isnt((public.start_ai_run('b2120000-0000-4000-8000-00000000000a', 'atendimento.conversa', repeat('1', 64), null, 'case',
  'c2120000-0000-4000-8000-000000000001', null) -> 'prompt' ->> 'version')::int, 9000,
  'the case of version 1 keeps the prompt version 1 pinned');
select is((public.start_ai_run('b2120000-0000-4000-8000-00000000000a', 'atendimento.conversa', repeat('2', 64), null, 'case',
  'c2120000-0000-4000-8000-000000000002', null) -> 'prompt' ->> 'version')::int, 9000,
  'the case of version 2 takes the prompt version 2 pinned');
select is((public.start_ai_run('b2120000-0000-4000-8000-00000000000a', 'atendimento.conversa', repeat('3', 64), null,
  'wa_conversation', 'c2120000-0000-4000-8000-00000000000f', null) -> 'prompt' ->> 'version')::int, 9000,
  'a run of no case takes the latest published version');
reset role;

-- A published version is never edited nor deleted.
select throws_ok($$update public.module_versions set manifest = manifest || '{"x": 1}'::jsonb where version = 2 and module = 'direito-do-passageiro'$$,
  '23514', null, 'a published version is never edited');
select throws_ok($$delete from public.module_versions where version = 2 and module = 'direito-do-passageiro'$$,
  '23514', null, 'a published version is never deleted');

-- Withdrawn for a defect, its cases read the latest published; the last published stays.
select set_config('request.jwt.claims', '{"sub":"a2120000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select public.admin_withdraw_module_version((select id from v where name = 'v2'), 'Lista errada') ->> 'code'),
  'withdrawn', 'the operator withdraws a version with its reason');
select is((select public.admin_withdraw_module_version((select id from v where name = 'v1'), 'Teste') ->> 'code'),
  'last_published', 'the last published version is never withdrawn');
reset role;
select ok(jsonb_array_length(public.case_required_documents('c2120000-0000-4000-8000-000000000002')) > 1,
  'the cases of a withdrawn version read the latest published');

-- Lima reads the version of its case; Rocha nothing.
select set_config('request.jwt.claims', '{"sub":"a2120000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select public.case_module_version('b2120000-0000-4000-8000-00000000000a', 'c2120000-0000-4000-8000-000000000002')
  - 'documents' - 'module_name'),
  '{"ok": true, "module": "direito-do-passageiro", "version": 2, "withdrawn": true, "reads": 1}'::jsonb,
  'the firm reads the version its case was opened under and the one it reads');
reset role;
select set_config('request.jwt.claims', '{"sub":"a2120000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.case_module_version('b2120000-0000-4000-8000-00000000000a', 'c2120000-0000-4000-8000-000000000001')$$,
  '42501', null, 'another firm reads nothing of it');
reset role;

select * from finish();
rollback;
