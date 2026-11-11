begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- The copy of the firms' files (0205). A stored file is due a copy ten
-- minutes after it was stored; a reserved one is not. The backend records the
-- copy; a file whose record went is not recorded. When a copied file's record
-- goes, the removal of its copy is queued in the same statement, and the
-- backend clears it. Nobody of a firm reads either table.
--
-- Every person, firm and file here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a2050000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'ana@lima-copia.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2050000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-copia', 'a2050000-0000-4000-8000-000000000001');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2050000-0000-4000-8000-00000000000a', 'a2050000-0000-4000-8000-000000000001', 'owner', 'socio');
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                          detected_mime, uploaded_by, expires_at, confirmed_at)
values
  ('f2050000-0000-4000-8000-000000000001', 'b2050000-0000-4000-8000-00000000000a', 'case_document',
   'b2050000-0000-4000-8000-00000000000a/case_document/f2050000-0000-4000-8000-000000000001', 'identidade.pdf',
   'application/pdf', 1000, 'stored', repeat('a', 64), 1000, 'application/pdf',
   'a2050000-0000-4000-8000-000000000001', now() + interval '1 day', now() - interval '1 hour'),
  ('f2050000-0000-4000-8000-000000000002', 'b2050000-0000-4000-8000-00000000000a', 'case_document',
   'b2050000-0000-4000-8000-00000000000a/case_document/f2050000-0000-4000-8000-000000000002', 'conta.pdf',
   'application/pdf', 1000, 'stored', repeat('b', 64), 1000, 'application/pdf',
   'a2050000-0000-4000-8000-000000000001', now() + interval '1 day', now() - interval '1 minute'),
  ('f2050000-0000-4000-8000-000000000003', 'b2050000-0000-4000-8000-00000000000a', 'case_document',
   'b2050000-0000-4000-8000-00000000000a/case_document/f2050000-0000-4000-8000-000000000003', 'bilhete.pdf',
   'application/pdf', 1000, 'reserved', null, null, null,
   'a2050000-0000-4000-8000-000000000001', now() + interval '1 day', null);

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res select 'due', jsonb_build_object('ids', (select jsonb_agg(file_id) from public.files_to_copy(100)
  where file_id::text like 'f2050000%'));
insert into res select 'recorded', jsonb_build_object('ok', public.record_file_copy('f2050000-0000-4000-8000-000000000001',
  'b2050000-0000-4000-8000-00000000000a/case_document/f2050000-0000-4000-8000-000000000001'));
insert into res select 'gone', jsonb_build_object('ok', public.record_file_copy('f2050000-0000-4000-8000-000000000009', 'x/y'));
reset role;

select ok(
  (select payload -> 'ids' = '["f2050000-0000-4000-8000-000000000001"]'::jsonb from res where name = 'due'),
  'a stored file is due a copy some minutes after it was stored; a reserved one is not'
);

select ok(
  (select (payload ->> 'ok')::boolean from res where name = 'recorded')
  and not (select (payload ->> 'ok')::boolean from res where name = 'gone')
  and exists (select 1 from public.file_copies where file_id = 'f2050000-0000-4000-8000-000000000001'),
  'the backend records a copy of a file that still is, and none of one that went'
);

delete from public.files where id = 'f2050000-0000-4000-8000-000000000001';

select ok(
  not exists (select 1 from public.file_copies where file_id = 'f2050000-0000-4000-8000-000000000001')
  and exists (select 1 from public.file_copy_removals
              where storage_path = 'b2050000-0000-4000-8000-00000000000a/case_document/f2050000-0000-4000-8000-000000000001'),
  'a file whose record goes queues the removal of its copy'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.finish_file_copy_removal(r.id, true) from public.file_copy_removals_due(10) r
where r.storage_path like 'b2050000%';
reset role;

select ok(
  not exists (select 1 from public.file_copy_removals where storage_path like 'b2050000%'),
  'and once the backend removed it, it is forgotten'
);

select ok(
  not has_table_privilege('authenticated', 'public.file_copies', 'SELECT')
  and not has_table_privilege('authenticated', 'public.file_copy_removals', 'SELECT')
  and not has_function_privilege('authenticated', 'public.files_to_copy(integer)', 'EXECUTE'),
  'only the backend reads and writes the copies'
);

select * from finish();
rollback;
