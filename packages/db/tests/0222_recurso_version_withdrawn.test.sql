begin;
create extension if not exists pgtap;
select plan(4);

-- ============================================================
-- Os casos em curso seguem o recurso que pede a justiça gratuita (0222).
-- A case of each firm was opened under the module's first version, whose
-- recurso asks nothing of free justice: that version is withdrawn for the
-- defect, with the reason, and each case reads the latest published, whose
-- recurso has the request, with the same documents and the same versions of
-- the AI tasks. The latest version stays published, and no member of a firm
-- reads the versions.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2220000-0000-4000-8000-000000000001', 'ana@souza-versao.invalid', 'Ana Souza'),
  ('a2220000-0000-4000-8000-000000000002', 'caio@rocha-versao.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2220000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-versao', 'a2220000-0000-4000-8000-000000000001'),
  ('b2220000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-versao', 'a2220000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2220000-0000-4000-8000-00000000000a', 'a2220000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2220000-0000-4000-8000-00000000000b', 'a2220000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2220000-0000-4000-8000-000000000001', 'b2220000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c2220000-0000-4000-8000-000000000002', 'b2220000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'filed');
-- Both opened before the recurso asked free justice, under the first version.
update public.cases set module_version_id = (
  select v.id from public.module_versions v where v.module = 'direito-do-passageiro' and v.version = 1)
where id in ('c2220000-0000-4000-8000-000000000001', 'c2220000-0000-4000-8000-000000000002');

create function pg_temp.v(n integer) returns public.module_versions language sql as $$
  select * from public.module_versions where module = 'direito-do-passageiro' and version = n;
$$;

select ok(
  (pg_temp.v(1)).status = 'withdrawn'
    and (pg_temp.v(1)).withdraw_reason like 'O recurso não pedia a justiça gratuita%'
    and strpos((pg_temp.v(1)).manifest #>> '{pieces,kinds,recurso,model}', '[[GRATUIDADE]]') = 0
    and (select v.status = 'published' and strpos(v.manifest #>> '{pieces,kinds,recurso,model}', '[[GRATUIDADE]]') > 0
         from public.module_versions v
         where v.module = 'direito-do-passageiro'
         order by v.version desc limit 1),
  'the version whose recurso asked nothing is withdrawn for it, its manifest unchanged, and the latest stays published'
);

select ok(
  (select bool_and(strpos(public.case_module_manifest(c.id) #>> '{pieces,kinds,recurso,model}', '[[GRATUIDADE]]') > 0)
   from public.cases c where c.id in ('c2220000-0000-4000-8000-000000000001', 'c2220000-0000-4000-8000-000000000002')),
  'a case of each firm opened under it writes its recurso with the request'
);

-- The version that took its cases changed the recurso alone (a later version may publish another task's prompt).
select ok(
  (select bool_and(public.case_module_manifest(c.id) -> 'documents' = (pg_temp.v(1)).manifest -> 'documents')
   from public.cases c where c.id in ('c2220000-0000-4000-8000-000000000001', 'c2220000-0000-4000-8000-000000000002'))
    and (pg_temp.v(2)).manifest -> 'prompts' = (pg_temp.v(1)).manifest -> 'prompts'
    and (pg_temp.v(2)).manifest -> 'documents' = (pg_temp.v(1)).manifest -> 'documents',
  'and keeps the documents it asks and the versions of its AI tasks'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a2220000-0000-4000-8000-000000000002', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select is((select count(*)::int from public.module_versions), 0, 'no member of a firm reads the versions of a module');
reset role;

select * from finish();
rollback;
