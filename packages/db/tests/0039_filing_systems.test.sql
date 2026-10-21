begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- What each court's system asks of a filing package (0036): the petition's
-- own limit (the PJe of TJCE takes the petition as one PDF of up to 1.5 MB)
-- and the type of each kind of file, as the system names it. A package keeps
-- the petition's limit it was built under, and keeps no petition cut in
-- parts or over that limit, whatever a worker sends. Two firms.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ae900000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@sistemas.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('ae900000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@sistemas.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('ae900000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'olga@sistemas.invalid', '', now(), '{}', '{"display_name":"Olga Operadora"}', now(), now());
update public.profiles set is_superadmin = true where id = 'ae900000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('be900000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-sistemas', 'ae900000-0000-4000-8000-000000000001'),
  ('be900000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-sistemas', 'ae900000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('be900000-0000-4000-8000-00000000000a', 'ae900000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('be900000-0000-4000-8000-00000000000b', 'ae900000-0000-4000-8000-000000000004', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.stored(org uuid, purpose text, name text, mime text, bytes bigint, pages integer, mark text)
returns uuid language plpgsql as $$
declare
  reserved jsonb := public.reserve_file(org, purpose, name, mime, bytes);
begin
  perform public.confirm_file((reserved ->> 'file_id')::uuid, repeat(mark, 64), bytes, mime, pages);
  return (reserved ->> 'file_id')::uuid;
end;
$$;
create function pg_temp.item(place integer, name text, file uuid, document uuid, part integer default 1, parts integer default 1)
returns jsonb language sql as
$$ select jsonb_build_object('position', place, 'name', name, 'file_id', file, 'document_id', document, 'part', part, 'parts', parts); $$;

-- ---------- What the systems ask, as data ----------

select ok(
  (select bool_and(max_file_bytes = 11000000 and not confirmed and notes like '%11 MB%')
   from public.court_systems where system = 'eproc' and court in ('TJSP', 'TJSC'))
  and (select count(*) = 0 from public.court_systems where system = 'eproc' and court not in ('TJSP', 'TJSC') and max_file_bytes is not null)
  and (select bool_and(max_petition_bytes = 1500000) from public.court_systems where court = 'TJCE' and system = 'pje')
  and (select bool_and(file_types = '{"petition": "Petição inicial (INIC)"}'::jsonb) from public.court_systems where system = 'eproc')
  and (select bool_and(file_types = '{"petition": "Petição inicial"}'::jsonb) from public.court_systems where system = 'pje')
  and (select bool_and(file_types = '{}'::jsonb and max_petition_bytes is null) from public.court_systems where system = 'projudi'),
  'the limits read in the courts'' manuals are rows nobody confirmed yet, and each system names the petition its own way'
);

select pg_temp.sign_in('ae900000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.admin_set_court_system_files('TJCE', 'juizado', 2000000, '{}'::jsonb)$$,
  '42501', 'not_authorized',
  'a partner of a firm does not change what a court''s system asks'
);
reset role;

select pg_temp.sign_in('ae900000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('set_types', public.admin_set_court_system_files('TJCE', 'comum', 1500000,
  '{"petition": "Petição inicial", "power_of_attorney": "Procuração"}'::jsonb));
insert into res values ('bad_kind', public.admin_set_court_system_files('TJCE', 'comum', 1500000, '{"selfie": "Foto"}'::jsonb));
insert into res values ('bad_name', public.admin_set_court_system_files('TJCE', 'comum', 1500000, '{"identity": " "}'::jsonb));
-- The eproc of TJSP takes a file of up to 11 MB: a petition's own limit above it is no limit of a package.
insert into res values ('above_file', public.admin_set_court_system_files(
  (select court from public.court_systems where system = 'eproc' and court = 'TJSP' and max_file_bytes is not null limit 1),
  (select proceeding_kind from public.court_systems where system = 'eproc' and court = 'TJSP' and max_file_bytes is not null limit 1),
  12000000, '{}'::jsonb));
reset role;
select ok(
  pg_temp.got('set_types', 'code') = 'saved' and pg_temp.got('bad_kind', 'code') = 'invalid_value'
  and pg_temp.got('bad_name', 'code') = 'invalid_value'
  and (select file_types ->> 'power_of_attorney' = 'Procuração' from public.court_systems where court = 'TJCE' and proceeding_kind = 'comum')
  and (select count(*) = 1 from public.audit_events where action = 'admin.court_system.files_set'),
  'the operator records the type of a kind of file in a system, a kind no package knows refused'
);
select ok(
  pg_temp.got('above_file', 'code') = 'invalid_value'
  and (select bool_and(max_petition_bytes is null) from public.court_systems where system = 'eproc' and court = 'TJSP'),
  'and a petition''s own limit above the limit of a file is refused, since every file of a package keeps that one'
);

-- ---------- A package of the PJe of TJCE ----------

select pg_temp.sign_in('ae900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('be900000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Maria Teste"}'::jsonb));
insert into res values ('lawsuit', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJCE", "comarca": "Fortaleza", "forum_basis": "domicile", "system": "pje"}'::jsonb,
  array[pg_temp.got('case', 'party_id')::uuid]));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('files', jsonb_build_object(
  'large', pg_temp.stored('be900000-0000-4000-8000-00000000000a', 'upload', 'inicial.pdf', 'application/pdf', 1600000, 20, 'a'),
  'small', pg_temp.stored('be900000-0000-4000-8000-00000000000a', 'upload', 'inicial-curta.pdf', 'application/pdf', 400000, 6, 'b')
));
reset role;
select pg_temp.sign_in('ae900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('large', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('files', 'large')::uuid, 'petition'));
insert into res values ('small', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('files', 'small')::uuid, 'petition'));
select public.decide_case_document(pg_temp.got('large', 'document_id')::uuid, 'accepted');
select public.decide_case_document(pg_temp.got('small', 'document_id')::uuid, 'accepted');
insert into res values ('ask_large', public.request_filing_package(pg_temp.got('lawsuit', 'proceeding_id')::uuid,
  pg_temp.got('large', 'document_id')::uuid));
reset role;

select ok(
  pg_temp.got('ask_large', 'code') = 'requested'
  and (select petition_limit_bytes = 1500000 and limit_bytes is null and system = 'pje'
       from public.filing_packages where id = pg_temp.got('ask_large', 'package_id')::uuid),
  'a package keeps the petition''s own limit of the system it was asked for'
);

select pg_temp.as_backend();
set local role service_role;
insert into res select 'claim_large', jsonb_build_object('claim', c.claim)
  from public.claim_filing_packages(1, pg_temp.got('ask_large', 'package_id')::uuid) c;
insert into res values ('to_build', public.filing_package_to_build(pg_temp.got('ask_large', 'package_id')::uuid,
  pg_temp.got('claim_large', 'claim')::integer));
-- A worker that sends the petition whole over its limit is refused.
insert into res values ('sent_whole', public.record_filing_package(pg_temp.got('ask_large', 'package_id')::uuid,
  pg_temp.got('claim_large', 'claim')::integer, 'ready',
  jsonb_build_array(pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'large')::uuid, pg_temp.got('large', 'document_id')::uuid))));
reset role;

select ok(
  pg_temp.got('to_build', 'petition_limit_bytes') = '1500000'
  and pg_temp.got('sent_whole', 'code') = 'invalid_items'
  and (select status = 'requested' and not exists (select 1 from public.filing_package_items i where i.package_id = p.id)
       from public.filing_packages p where p.id = pg_temp.got('ask_large', 'package_id')::uuid),
  'the backend reads the petition''s limit, and a petition over it is never kept in a package'
);

-- The petition within the limit goes.
select pg_temp.sign_in('ae900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ask_small', public.request_filing_package(pg_temp.got('lawsuit', 'proceeding_id')::uuid,
  pg_temp.got('small', 'document_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res select 'claim_small', jsonb_build_object('claim', c.claim)
  from public.claim_filing_packages(1, pg_temp.got('ask_small', 'package_id')::uuid) c;
insert into res values ('sent_small', public.record_filing_package(pg_temp.got('ask_small', 'package_id')::uuid,
  pg_temp.got('claim_small', 'claim')::integer, 'ready',
  jsonb_build_array(pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'small')::uuid, pg_temp.got('small', 'document_id')::uuid))));
reset role;
select ok(
  pg_temp.got('sent_small', 'code') = 'ready'
  and (select status = 'ready' from public.filing_packages where id = pg_temp.got('ask_small', 'package_id')::uuid)
  and (select status = 'cancelled' from public.filing_packages where id = pg_temp.got('ask_large', 'package_id')::uuid),
  'a petition within its limit goes, and asking again replaced the package that could not be built'
);

-- ---------- Two firms ----------

select pg_temp.sign_in('ae900000-0000-4000-8000-000000000004');
set local role authenticated;
select ok(
  (select count(*) = 0 from public.filing_packages)
  and (select count(*) > 0 from public.court_systems where system = 'pje'),
  'another firm reads the systems, which are everybody''s, and none of the firm''s packages'
);
reset role;

select * from finish();
rollback;
