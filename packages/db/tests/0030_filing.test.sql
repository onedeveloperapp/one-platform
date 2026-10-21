begin;
create extension if not exists pgtap;
select plan(22);

-- ============================================================
-- The filing package of a lawsuit and its receipt (0027). A person asks for
-- the package (the petition and the documents that go with it), the backend
-- builds it (ordered, named, cut under the limit of the court's system) and
-- a lawyer attaches the receipt the court's system gave, which marks the
-- lawsuit as filed. Two firms: nothing of one reaches the other.
--
-- Every person, firm, CPF and case number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ae100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('ae100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('ae100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('ae100000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'suporte@one.invalid', '', now(), '{}', '{"display_name":"Suporte"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('be100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'ae100000-0000-4000-8000-000000000001'),
  ('be100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'ae100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('be100000-0000-4000-8000-00000000000a', 'ae100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('be100000-0000-4000-8000-00000000000a', 'ae100000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('be100000-0000-4000-8000-00000000000b', 'ae100000-0000-4000-8000-000000000004', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2', 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- A file of a firm, stored as the backend measured it (as the service role).
create function pg_temp.stored(org uuid, purpose text, name text, mime text, bytes bigint, pages integer, mark text)
returns uuid language plpgsql as $$
declare
  reserved jsonb := public.reserve_file(org, purpose, name, mime, bytes);
begin
  perform public.confirm_file((reserved ->> 'file_id')::uuid, repeat(mark, 64), bytes, mime, pages);
  return (reserved ->> 'file_id')::uuid;
end;
$$;
-- The backend claims one package, whose wait after a passing failure is taken as over.
create function pg_temp.claim(package uuid) returns integer language plpgsql as $$
declare
  claimed integer;
begin
  update public.filing_packages set retry_after = null where id = package;
  select c.claim into claimed from public.claim_filing_packages(1, package) c;
  return claimed;
end;
$$;
-- One file of a package, as its worker names it.
create function pg_temp.item(place integer, name text, file uuid, document uuid, part integer default 1, parts integer default 1)
returns jsonb language sql as
$$ select jsonb_build_object('position', place, 'name', name, 'file_id', file, 'document_id', document, 'part', part, 'parts', parts); $$;

-- A case of each firm, each with a lawsuit not filed yet at the small-claims court of Goiás.
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('be100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02"}'::jsonb));
insert into res values ('proceeding', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "system": "projudi"}'::jsonb,
  array[pg_temp.got('case', 'party_id')::uuid]));
-- A lawsuit with no court system named yet.
insert into res values ('proceeding_bare', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "comum"}'::jsonb));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('be100000-0000-4000-8000-00000000000b', 'cancellation', null, null,
  '{"full_name": "Paulo Teste"}'::jsonb));
insert into res values ('proceeding_b', public.save_proceeding(pg_temp.got('case_b', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "system": "projudi"}'::jsonb));
reset role;

-- The files: a petition, an identity, a long scan that passes the limit, a photo, and files of firm B.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('files', jsonb_build_object(
  'petition', pg_temp.stored('be100000-0000-4000-8000-00000000000a', 'upload', 'inicial.pdf', 'application/pdf', 300000, 8, 'a'),
  'identity', pg_temp.stored('be100000-0000-4000-8000-00000000000a', 'upload', 'rg.pdf', 'application/pdf', 200000, 1, 'b'),
  'scan', pg_temp.stored('be100000-0000-4000-8000-00000000000a', 'upload', 'conversas.pdf', 'application/pdf', 9000000, 40, 'c'),
  'photo', pg_temp.stored('be100000-0000-4000-8000-00000000000a', 'upload', 'foto.jpg', 'image/jpeg', 400000, null, 'd'),
  'draft', pg_temp.stored('be100000-0000-4000-8000-00000000000a', 'upload', 'rascunho.pdf', 'application/pdf', 100000, 2, 'e'),
  'petition_b', pg_temp.stored('be100000-0000-4000-8000-00000000000b', 'upload', 'inicial-b.pdf', 'application/pdf', 300000, 8, 'f'),
  'part_b', pg_temp.stored('be100000-0000-4000-8000-00000000000b', 'filing', '02-prova-parte-1-de-2.pdf', 'application/pdf', 300000, 8, '9')
));
reset role;

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('petition', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('files', 'petition')::uuid, 'petition'));
insert into res values ('identity', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('files', 'identity')::uuid, 'identity',
  pg_temp.got('case', 'party_id')::uuid));
insert into res values ('scan', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('files', 'scan')::uuid, 'evidence'));
insert into res values ('photo', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('files', 'photo')::uuid, 'evidence'));
insert into res values ('draft', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('files', 'draft')::uuid, 'petition'));
select public.decide_case_document(pg_temp.got('petition', 'document_id')::uuid, 'accepted');
select public.decide_case_document(pg_temp.got('identity', 'document_id')::uuid, 'accepted');
select public.decide_case_document(pg_temp.got('scan', 'document_id')::uuid, 'accepted');
select public.decide_case_document(pg_temp.got('photo', 'document_id')::uuid, 'accepted');
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('petition_b', public.attach_case_document(pg_temp.got('case_b', 'case_id')::uuid, pg_temp.got('files', 'petition_b')::uuid, 'petition'));
select public.decide_case_document(pg_temp.got('petition_b', 'document_id')::uuid, 'accepted');
reset role;

select ok(
  pg_temp.got('petition', 'code') = 'attached'
  and (select count(*) = 4 from public.case_documents where case_id = pg_temp.got('case', 'case_id')::uuid and status = 'accepted')
  and (select max_file_bytes = 6000000 and not confirmed from public.court_systems where court = 'TJGO' and proceeding_kind = 'juizado'),
  'a petition is a document of the case like any other, and the limit of Projudi in Goiás is data nobody confirmed yet'
);

-- ---------- A person asks for the package ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ask_bare', public.request_filing_package(pg_temp.got('proceeding_bare', 'proceeding_id')::uuid,
  pg_temp.got('petition', 'document_id')::uuid));
insert into res values ('ask_no_petition', public.request_filing_package(pg_temp.got('proceeding', 'proceeding_id')::uuid,
  pg_temp.got('identity', 'document_id')::uuid));
insert into res values ('ask_draft', public.request_filing_package(pg_temp.got('proceeding', 'proceeding_id')::uuid,
  pg_temp.got('draft', 'document_id')::uuid));
insert into res values ('ask_other_firm_doc', public.request_filing_package(pg_temp.got('proceeding', 'proceeding_id')::uuid,
  pg_temp.got('petition', 'document_id')::uuid, array[pg_temp.got('petition_b', 'document_id')::uuid]));
insert into res values ('ask', public.request_filing_package(pg_temp.got('proceeding', 'proceeding_id')::uuid,
  pg_temp.got('petition', 'document_id')::uuid,
  array[pg_temp.got('identity', 'document_id')::uuid, pg_temp.got('scan', 'document_id')::uuid, pg_temp.got('identity', 'document_id')::uuid]));
reset role;

select ok(
  pg_temp.got('ask_bare', 'code') = 'forum_incomplete'
  and pg_temp.got('ask_no_petition', 'code') = 'petition_not_found'
  and pg_temp.got('ask_draft', 'code') = 'petition_not_found'
  and pg_temp.got('ask_other_firm_doc', 'code') = 'document_not_found'
  and pg_temp.got('ask', 'code') = 'requested'
  and (select status = 'requested' and court = 'TJGO' and system = 'projudi' and limit_bytes = 6000000 and not limit_confirmed
              and array_length(document_ids, 1) = 2
       from public.filing_packages where id = pg_temp.got('ask', 'package_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'filing_package_requested' and actor_type = 'person'),
  'a package is asked for a lawsuit with its court and system, an accepted petition and accepted documents of the same case'
);

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  format('select public.request_filing_package(%L, %L)', pg_temp.got('proceeding', 'proceeding_id'), pg_temp.got('petition_b', 'document_id')),
  'P0002', null,
  'another firm asks for no package of a lawsuit of this one'
);
select is((select count(*)::integer from public.filing_packages), 0, 'and reads none of its packages');
reset role;

-- A support visit asks for nothing and cancels nothing.
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('ae100000-0000-4000-8000-000000000009', 'ae100000-0000-4000-8000-000000000002', 'be100000-0000-4000-8000-00000000000a',
        'Conferindo o protocolo', 'fe100000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002', 'fe100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.request_filing_package(%L, %L)', pg_temp.got('proceeding', 'proceeding_id'), pg_temp.got('petition', 'document_id')),
  '42501', 'not_allowed_in_support_session',
  'a support visit asks for no package'
);
select throws_ok(
  format('select public.cancel_filing_package(%L)', pg_temp.got('ask', 'package_id')),
  '42501', 'not_allowed_in_support_session',
  'and cancels none'
);
reset role;

-- ---------- The backend builds it ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select count(*) from public.claim_filing_packages(5)$$, '42501', null,
  'a person never claims a package: only the backend builds it');
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim', (select jsonb_build_object('ids', jsonb_agg(c.package_id), 'claims', jsonb_agg(c.claim))
  from public.claim_filing_packages(5) c));
insert into res values ('stale_build', jsonb_build_object('nothing',
  public.filing_package_to_build(pg_temp.got('ask', 'package_id')::uuid, 9) is null));
insert into res values ('build', public.filing_package_to_build(pg_temp.got('ask', 'package_id')::uuid, 1));
insert into res values ('claim_again', jsonb_build_object('count', (select count(*) from public.claim_filing_packages(5))));
-- The long scan is cut in two parts, each under the limit: files of the firm under the `filing` purpose.
insert into res values ('parts', jsonb_build_object(
  'one', pg_temp.stored('be100000-0000-4000-8000-00000000000a', 'filing', '03-conversas-parte-1-de-2.pdf', 'application/pdf', 5000000, 22, '1'),
  'two', pg_temp.stored('be100000-0000-4000-8000-00000000000a', 'filing', '03-conversas-parte-2-de-2.pdf', 'application/pdf', 4200000, 18, '2'),
  'too_big', pg_temp.stored('be100000-0000-4000-8000-00000000000a', 'filing', 'grande.pdf', 'application/pdf', 7000000, 30, '3'),
  'no_pages', pg_temp.stored('be100000-0000-4000-8000-00000000000a', 'filing', 'sem-paginas.pdf', 'application/pdf', 900000, null, 'c')
));
reset role;

select ok(
  (select payload -> 'ids' ? pg_temp.got('ask', 'package_id') and payload -> 'claims' = '[1]'::jsonb from res where name = 'claim')
  and pg_temp.got('stale_build', 'nothing') = 'true'
  and pg_temp.got('build', 'claim') = '1' and pg_temp.got('build', 'limit_bytes') = '6000000'
  and pg_temp.got('build', 'name_max_length') = '80'
  and pg_temp.got('build', 'petition_document_id') = pg_temp.got('petition', 'document_id')
  and (select jsonb_array_length(payload -> 'documents') = 3 and jsonb_array_length(payload -> 'document_ids') = 2 from res where name = 'build')
  and (select bool_or(d ->> 'kind' = 'identity' and d ->> 'person' = 'Maria Teste' and d ->> 'mime' = 'application/pdf')
       from res, jsonb_array_elements(payload -> 'documents') d where name = 'build')
  and pg_temp.got('claim_again', 'count') = '0',
  'the backend claims a package once and reads, under that claim, the documents that go and the limit of the system'
);

-- What the worker says is checked: a part of another firm, a part over the limit, a document nobody chose,
-- a file that is not the document's, a name that is not plain, the petition out of the first place, a
-- chosen document left out, a document short of a part, or another's claim.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('rec_other_claim', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 9, 'ready',
  jsonb_build_array(pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid))));
insert into res values ('rec_other_firm_part', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(2, '02-documento-de-identidade.pdf', pg_temp.got('files', 'identity')::uuid, pg_temp.got('identity', 'document_id')::uuid),
    pg_temp.item(3, '03-conversas.pdf', pg_temp.got('files', 'part_b')::uuid, pg_temp.got('scan', 'document_id')::uuid))));
insert into res values ('rec_too_big', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(2, '02-documento-de-identidade.pdf', pg_temp.got('files', 'identity')::uuid, pg_temp.got('identity', 'document_id')::uuid),
    pg_temp.item(3, '03-conversas.pdf', pg_temp.got('parts', 'too_big')::uuid, pg_temp.got('scan', 'document_id')::uuid))));
insert into res values ('rec_not_chosen', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(2, '02-rascunho.pdf', pg_temp.got('files', 'draft')::uuid, pg_temp.got('draft', 'document_id')::uuid))));
insert into res values ('rec_wrong_file', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'identity')::uuid, pg_temp.got('petition', 'document_id')::uuid))));
insert into res values ('rec_bad_name', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(pg_temp.item(1, 'Petição Inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid))));
insert into res values ('rec_petition_second', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(2, '02-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(1, '01-documento-de-identidade.pdf', pg_temp.got('files', 'identity')::uuid, pg_temp.got('identity', 'document_id')::uuid),
    pg_temp.item(3, '03-conversas-parte-1-de-2.pdf', pg_temp.got('parts', 'one')::uuid, pg_temp.got('scan', 'document_id')::uuid, 1, 2),
    pg_temp.item(4, '03-conversas-parte-2-de-2.pdf', pg_temp.got('parts', 'two')::uuid, pg_temp.got('scan', 'document_id')::uuid, 2, 2))));
insert into res values ('rec_document_left_out', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(2, '02-documento-de-identidade.pdf', pg_temp.got('files', 'identity')::uuid, pg_temp.got('identity', 'document_id')::uuid))));
insert into res values ('rec_part_missing', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(2, '02-documento-de-identidade.pdf', pg_temp.got('files', 'identity')::uuid, pg_temp.got('identity', 'document_id')::uuid),
    pg_temp.item(3, '03-conversas-parte-1-de-2.pdf', pg_temp.got('parts', 'one')::uuid, pg_temp.got('scan', 'document_id')::uuid, 1, 2))));
insert into res values ('rec_parts_swapped', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(2, '02-documento-de-identidade.pdf', pg_temp.got('files', 'identity')::uuid, pg_temp.got('identity', 'document_id')::uuid),
    pg_temp.item(3, '03-conversas-parte-2-de-2.pdf', pg_temp.got('parts', 'two')::uuid, pg_temp.got('scan', 'document_id')::uuid, 2, 2),
    pg_temp.item(4, '03-conversas-parte-1-de-2.pdf', pg_temp.got('parts', 'one')::uuid, pg_temp.got('scan', 'document_id')::uuid, 1, 2))));
insert into res values ('rec_parts_apart', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(2, '03-conversas-parte-1-de-2.pdf', pg_temp.got('parts', 'one')::uuid, pg_temp.got('scan', 'document_id')::uuid, 1, 2),
    pg_temp.item(3, '02-documento-de-identidade.pdf', pg_temp.got('files', 'identity')::uuid, pg_temp.got('identity', 'document_id')::uuid),
    pg_temp.item(4, '03-conversas-parte-2-de-2.pdf', pg_temp.got('parts', 'two')::uuid, pg_temp.got('scan', 'document_id')::uuid, 2, 2))));
insert into res values ('rec_same_name', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(2, '02-documento-de-identidade.pdf', pg_temp.got('files', 'identity')::uuid, pg_temp.got('identity', 'document_id')::uuid),
    pg_temp.item(3, '03-conversas.pdf', pg_temp.got('parts', 'one')::uuid, pg_temp.got('scan', 'document_id')::uuid, 1, 2),
    pg_temp.item(4, '03-conversas.pdf', pg_temp.got('parts', 'two')::uuid, pg_temp.got('scan', 'document_id')::uuid, 2, 2))));
insert into res values ('rec_gap', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(2, '02-documento-de-identidade.pdf', pg_temp.got('files', 'identity')::uuid, pg_temp.got('identity', 'document_id')::uuid),
    pg_temp.item(4, '03-conversas-parte-1-de-2.pdf', pg_temp.got('parts', 'one')::uuid, pg_temp.got('scan', 'document_id')::uuid, 1, 2),
    pg_temp.item(5, '03-conversas-parte-2-de-2.pdf', pg_temp.got('parts', 'two')::uuid, pg_temp.got('scan', 'document_id')::uuid, 2, 2))));
insert into res values ('rec_no_pages', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(2, '02-documento-de-identidade.pdf', pg_temp.got('files', 'identity')::uuid, pg_temp.got('identity', 'document_id')::uuid),
    pg_temp.item(3, '03-conversas.pdf', pg_temp.got('parts', 'no_pages')::uuid, pg_temp.got('scan', 'document_id')::uuid))));
reset role;

select ok(
  pg_temp.got('rec_other_claim', 'code') = 'not_working'
  and pg_temp.got('rec_other_firm_part', 'code') = 'invalid_items'
  and pg_temp.got('rec_too_big', 'code') = 'invalid_items'
  and pg_temp.got('rec_not_chosen', 'code') = 'invalid_items'
  and pg_temp.got('rec_wrong_file', 'code') = 'invalid_items'
  and pg_temp.got('rec_bad_name', 'code') = 'invalid_items'
  and pg_temp.got('rec_petition_second', 'code') = 'invalid_items'
  and pg_temp.got('rec_document_left_out', 'code') = 'invalid_items'
  and pg_temp.got('rec_part_missing', 'code') = 'invalid_items'
  and pg_temp.got('rec_parts_swapped', 'code') = 'invalid_items'
  and pg_temp.got('rec_parts_apart', 'code') = 'invalid_items'
  and pg_temp.got('rec_same_name', 'code') = 'invalid_items'
  and pg_temp.got('rec_gap', 'code') = 'invalid_items'
  and pg_temp.got('rec_no_pages', 'code') = 'invalid_items'
  and (select status = 'requested' from public.filing_packages where id = pg_temp.got('ask', 'package_id')::uuid)
  and not exists (select 1 from public.filing_package_items),
  'a package is only what its worker may say: PDFs of the same firm that open, under the limit, each under a plain name of its own, the petition first, and every document chosen with all its parts together and in order'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('recorded', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(2, '02-documento-de-identidade-maria-teste.pdf', pg_temp.got('files', 'identity')::uuid, pg_temp.got('identity', 'document_id')::uuid),
    pg_temp.item(3, '03-conversas-parte-1-de-2.pdf', pg_temp.got('parts', 'one')::uuid, pg_temp.got('scan', 'document_id')::uuid, 1, 2),
    pg_temp.item(4, '03-conversas-parte-2-de-2.pdf', pg_temp.got('parts', 'two')::uuid, pg_temp.got('scan', 'document_id')::uuid, 2, 2))));
insert into res values ('recorded_twice', public.record_filing_package(pg_temp.got('ask', 'package_id')::uuid, 1, 'ready', '[]'::jsonb));
reset role;

select ok(
  pg_temp.got('recorded', 'code') = 'ready'
  and pg_temp.got('recorded_twice', 'code') = 'not_working'
  and (select status = 'ready' and built_at is not null and claimed_at is null and error is null
       from public.filing_packages where id = pg_temp.got('ask', 'package_id')::uuid)
  and (select count(*) = 4 and sum(bytes) = 300000 + 200000 + 5000000 + 4200000 and max(parts) = 2
       from public.filing_package_items where package_id = pg_temp.got('ask', 'package_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'filing_package_ready' and actor_type = 'system'),
  'built, the package is its files in order, with what was cut named as parts'
);

-- A part cut for a package is nothing else: it is no document of a case.
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  public.attach_case_document(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('parts', 'one')::uuid, 'evidence') ->> 'code',
  'file_not_found',
  'a part cut for a package is never attached as a document of a case'
);
insert into res values ('today_ready', public.firm_today('be100000-0000-4000-8000-00000000000a'));
reset role;

-- ---------- What cannot go, and asking again ----------

-- A photo nobody made a PDF of: the worker names it, and the package is not ready.
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ask_2', public.request_filing_package(pg_temp.got('proceeding', 'proceeding_id')::uuid,
  pg_temp.got('petition', 'document_id')::uuid, array[pg_temp.got('photo', 'document_id')::uuid]));
reset role;
insert into res select 'replaced', jsonb_build_object(
  'status', (select status from public.filing_packages where id = pg_temp.got('ask', 'package_id')::uuid),
  'items', (select count(*) from public.filing_package_items where package_id = pg_temp.got('ask', 'package_id')::uuid),
  'parts', (select count(*) from public.files where id in (pg_temp.got('parts', 'one')::uuid, pg_temp.got('parts', 'two')::uuid)),
  'originals', (select count(*) from public.files where id in (pg_temp.got('files', 'petition')::uuid, pg_temp.got('files', 'scan')::uuid)));
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('ask_2', 'package_id')::uuid);
insert into res values ('failed', public.record_filing_package(pg_temp.got('ask_2', 'package_id')::uuid, 1, 'failed', '[]'::jsonb,
  jsonb_build_array(jsonb_build_object('document_id', pg_temp.got('photo', 'document_id'), 'code', 'not_a_pdf')), 'problems'));
reset role;

select ok(
  pg_temp.got('today_ready', 'filings_ready') = '1'
  and pg_temp.got('ask_2', 'code') = 'requested'
  and pg_temp.got('replaced', 'status') = 'cancelled' and pg_temp.got('replaced', 'items') = '0'
  and pg_temp.got('replaced', 'parts') = '0' and pg_temp.got('replaced', 'originals') = '2'
  and pg_temp.got('failed', 'code') = 'failed'
  and (select status = 'failed' and error = 'problems' and problems -> 0 ->> 'code' = 'not_a_pdf'
       from public.filing_packages where id = pg_temp.got('ask_2', 'package_id')::uuid)
  and (select count(*) = 1 from public.filing_packages
       where proceeding_id = pg_temp.got('proceeding', 'proceeding_id')::uuid and status in ('requested', 'ready', 'failed')),
  'a ready package is counted for the home; asking again replaces it and forgets the parts cut for it, never the documents; what cannot go is named'
);

-- A passing failure waits before it is tried again, and the last attempt is final.
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ask_3', public.request_filing_package(pg_temp.got('proceeding', 'proceeding_id')::uuid,
  pg_temp.got('petition', 'document_id')::uuid, array[pg_temp.got('identity', 'document_id')::uuid]));
reset role;
update public.platform_settings set value = jsonb_set(value, '{max_attempts}', '2') where key = 'filing';
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('ask_3', 'package_id')::uuid);
insert into res values ('retry_1', public.record_filing_package(pg_temp.got('ask_3', 'package_id')::uuid, 1, 'retry', '[]'::jsonb, '[]'::jsonb, 'store_unavailable'));
insert into res values ('held_back', jsonb_build_object('count',
  (select count(*) from public.claim_filing_packages(5, pg_temp.got('ask_3', 'package_id')::uuid))));
reset role;
insert into res select 'waits', jsonb_build_object('minutes', round(extract(epoch from (retry_after - now())) / 60), 'status', status)
from public.filing_packages where id = pg_temp.got('ask_3', 'package_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('second_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('ask_3', 'package_id')::uuid)));
insert into res values ('old_claim', public.record_filing_package(pg_temp.got('ask_3', 'package_id')::uuid, 1, 'retry', '[]'::jsonb, '[]'::jsonb, 'store_unavailable'));
insert into res values ('retry_last', public.record_filing_package(pg_temp.got('ask_3', 'package_id')::uuid, 2, 'retry', '[]'::jsonb, '[]'::jsonb, 'store_unavailable'));
reset role;

select ok(
  pg_temp.got('retry_1', 'code') = 'retry' and pg_temp.got('held_back', 'count') = '0'
  and pg_temp.got('waits', 'minutes') = '5' and pg_temp.got('waits', 'status') = 'requested'
  and pg_temp.got('second_claim', 'claim') = '2'
  and pg_temp.got('old_claim', 'code') = 'not_working'
  and pg_temp.got('retry_last', 'code') = 'failed'
  and (select status = 'failed' and error = 'store_unavailable' and claimed_at is null
       from public.filing_packages where id = pg_temp.got('ask_3', 'package_id')::uuid),
  'a passing failure waits before the next attempt, an old claim says nothing, and the last attempt is final'
);

-- A package nobody finishes building is given up; a part no package names is forgotten once it is old,
-- never while it may still be on its way into a package.
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ask_5', public.request_filing_package(pg_temp.got('proceeding', 'proceeding_id')::uuid,
  pg_temp.got('petition', 'document_id')::uuid, array[pg_temp.got('identity', 'document_id')::uuid]));
reset role;
update public.platform_settings set value = jsonb_set(value, '{max_attempts}', '1') where key = 'filing';
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('ask_5', 'package_id')::uuid);
insert into res values ('orphan', jsonb_build_object(
  'old', pg_temp.stored('be100000-0000-4000-8000-00000000000a', 'filing', 'parte-perdida.pdf', 'application/pdf', 1000000, 4, '4'),
  'fresh', pg_temp.stored('be100000-0000-4000-8000-00000000000a', 'filing', 'parte-a-caminho.pdf', 'application/pdf', 1000000, 4, '5')));
reset role;
update public.filing_packages set claimed_at = now() - interval '2 hours' where id = pg_temp.got('ask_5', 'package_id')::uuid;
update public.files set created_at = now() - interval '2 hours' where id = pg_temp.got('orphan', 'old')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('given_up', jsonb_build_object('count',
  (select count(*) from public.claim_filing_packages(5, pg_temp.got('ask_5', 'package_id')::uuid))));
reset role;
update public.platform_settings set value = jsonb_set(value, '{max_attempts}', '3') where key = 'filing';

select ok(
  pg_temp.got('given_up', 'count') = '0'
  and (select status = 'failed' and error = 'abandoned' and claimed_at is null
       from public.filing_packages where id = pg_temp.got('ask_5', 'package_id')::uuid)
  and not exists (select 1 from public.files where id = pg_temp.got('orphan', 'old')::uuid)
  and exists (select 1 from public.files where id = pg_temp.got('orphan', 'fresh')::uuid)
  and exists (select 1 from public.files where id = pg_temp.got('parts', 'too_big')::uuid)
  and exists (select 1 from public.files where id = pg_temp.got('files', 'identity')::uuid),
  'a claim nobody finished is given up in the end; a part no package names is forgotten once old, and one just cut is left alone'
);

-- A person gives a package up: its parts go with it.
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ask_6', public.request_filing_package(pg_temp.got('proceeding', 'proceeding_id')::uuid,
  pg_temp.got('petition', 'document_id')::uuid, array[pg_temp.got('scan', 'document_id')::uuid]));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('ask_6', 'package_id')::uuid);
insert into res values ('parts_6', jsonb_build_object(
  'one', pg_temp.stored('be100000-0000-4000-8000-00000000000a', 'filing', '02-prova-parte-1-de-2.pdf', 'application/pdf', 5000000, 22, '6'),
  'two', pg_temp.stored('be100000-0000-4000-8000-00000000000a', 'filing', '02-prova-parte-2-de-2.pdf', 'application/pdf', 4200000, 18, '7')));
select public.record_filing_package(pg_temp.got('ask_6', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(2, '02-prova-parte-1-de-2.pdf', pg_temp.got('parts_6', 'one')::uuid, pg_temp.got('scan', 'document_id')::uuid, 1, 2),
    pg_temp.item(3, '02-prova-parte-2-de-2.pdf', pg_temp.got('parts_6', 'two')::uuid, pg_temp.got('scan', 'document_id')::uuid, 2, 2)));
reset role;
-- However old, a part a package names is not forgotten by the sweep.
update public.files set created_at = now() - interval '2 hours'
where id in (pg_temp.got('parts_6', 'one')::uuid, pg_temp.got('parts_6', 'two')::uuid);
select pg_temp.as_backend();
set local role service_role;
select count(*) from public.claim_filing_packages(5);
reset role;
insert into res select 'named_parts', jsonb_build_object('left',
  (select count(*) from public.files where id in (pg_temp.got('parts_6', 'one')::uuid, pg_temp.got('parts_6', 'two')::uuid)));

-- Another lawsuit of the same case gets its court and its package. A part of another package is not its own.
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('proceeding_bare', 'proceeding_id')::uuid,
  '{"kind": "comum", "court": "TJGO", "system": "projudi"}'::jsonb);
insert into res values ('ask_h', public.request_filing_package(pg_temp.got('proceeding_bare', 'proceeding_id')::uuid,
  pg_temp.got('petition', 'document_id')::uuid, array[pg_temp.got('scan', 'document_id')::uuid]));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('ask_h', 'package_id')::uuid);
insert into res values ('rec_part_of_another', public.record_filing_package(pg_temp.got('ask_h', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(2, '02-prova-parte-1-de-2.pdf', pg_temp.got('parts_6', 'one')::uuid, pg_temp.got('scan', 'document_id')::uuid, 1, 2),
    pg_temp.item(3, '02-prova-parte-2-de-2.pdf', pg_temp.got('parts_6', 'two')::uuid, pg_temp.got('scan', 'document_id')::uuid, 2, 2))));
insert into res values ('parts_h', jsonb_build_object(
  'one', pg_temp.stored('be100000-0000-4000-8000-00000000000a', 'filing', '02-prova-parte-1-de-2.pdf', 'application/pdf', 5000000, 22, 'a'),
  'two', pg_temp.stored('be100000-0000-4000-8000-00000000000a', 'filing', '02-prova-parte-2-de-2.pdf', 'application/pdf', 4200000, 18, 'b')));
insert into res values ('rec_h', public.record_filing_package(pg_temp.got('ask_h', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(2, '02-prova-parte-1-de-2.pdf', pg_temp.got('parts_h', 'one')::uuid, pg_temp.got('scan', 'document_id')::uuid, 1, 2),
    pg_temp.item(3, '02-prova-parte-2-de-2.pdf', pg_temp.got('parts_h', 'two')::uuid, pg_temp.got('scan', 'document_id')::uuid, 2, 2))));
reset role;
-- Somebody records that lawsuit as filed by hand, in the lawsuit itself: its package has nothing left to do.
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('filed_by_hand', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('proceeding_bare', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'comum', 'court', 'TJGO', 'system', 'projudi', 'status', 'filed', 'cnj', '5000303-76.2099.8.09.0051',
    'filed_at', (now() at time zone 'America/Sao_Paulo')::date)));
reset role;

select ok(
  pg_temp.got('named_parts', 'left') = '2'
  and pg_temp.got('rec_part_of_another', 'code') = 'invalid_items'
  and pg_temp.got('rec_h', 'code') = 'ready'
  and pg_temp.got('filed_by_hand', 'code') = 'saved'
  and (select status = 'cancelled' from public.filing_packages where id = pg_temp.got('ask_h', 'package_id')::uuid)
  and not exists (select 1 from public.filing_package_items where package_id = pg_temp.got('ask_h', 'package_id')::uuid)
  and not exists (select 1 from public.files where id in (pg_temp.got('parts_h', 'one')::uuid, pg_temp.got('parts_h', 'two')::uuid))
  and (select status = 'ready' from public.filing_packages where id = pg_temp.got('ask_6', 'package_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'filing_package_cancelled' and actor_type = 'system'),
  'a part a package names is its own and is never forgotten; a lawsuit recorded as filed by hand gives up the package it had in course'
);

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('cancel', public.cancel_filing_package(pg_temp.got('ask_6', 'package_id')::uuid));
insert into res values ('cancel_twice', public.cancel_filing_package(pg_temp.got('ask_6', 'package_id')::uuid));
reset role;

select ok(
  pg_temp.got('cancel', 'code') = 'cancelled' and pg_temp.got('cancel_twice', 'code') = 'package_closed'
  and (select status = 'cancelled' from public.filing_packages where id = pg_temp.got('ask_6', 'package_id')::uuid)
  and not exists (select 1 from public.filing_package_items where package_id = pg_temp.got('ask_6', 'package_id')::uuid)
  and not exists (select 1 from public.files where id in (pg_temp.got('parts_6', 'one')::uuid, pg_temp.got('parts_6', 'two')::uuid))
  and exists (select 1 from public.files where id = pg_temp.got('files', 'scan')::uuid)
  and exists (select 1 from public.case_events where kind = 'filing_package_cancelled' and actor_type = 'person'),
  'a package given up takes its parts with it, and leaves the documents of the case'
);

-- ---------- The receipt ----------

-- A package ready to file, and the proof the court's system gave.
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ask_4', public.request_filing_package(pg_temp.got('proceeding', 'proceeding_id')::uuid,
  pg_temp.got('petition', 'document_id')::uuid, array[pg_temp.got('identity', 'document_id')::uuid]));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.claim(pg_temp.got('ask_4', 'package_id')::uuid);
select public.record_filing_package(pg_temp.got('ask_4', 'package_id')::uuid, 1, 'ready',
  jsonb_build_array(
    pg_temp.item(1, '01-peticao-inicial.pdf', pg_temp.got('files', 'petition')::uuid, pg_temp.got('petition', 'document_id')::uuid),
    pg_temp.item(2, '02-documento-de-identidade-maria-teste.pdf', pg_temp.got('files', 'identity')::uuid, pg_temp.got('identity', 'document_id')::uuid)));
insert into res values ('receipts', jsonb_build_object(
  'ana', public.reserve_file('be100000-0000-4000-8000-00000000000a', 'upload', 'recibo.pdf', 'application/pdf', 90000) ->> 'file_id',
  'bia', public.reserve_file('be100000-0000-4000-8000-00000000000a', 'upload', 'recibo-bia.pdf', 'application/pdf', 90000) ->> 'file_id',
  'davi', public.reserve_file('be100000-0000-4000-8000-00000000000b', 'upload', 'recibo-davi.pdf', 'application/pdf', 90000) ->> 'file_id'));
select public.confirm_file(pg_temp.got('receipts', 'ana')::uuid, repeat('7', 64), 90000, 'application/pdf', 1);
select public.confirm_file(pg_temp.got('receipts', 'bia')::uuid, repeat('8', 64), 90000, 'application/pdf', 1);
select public.confirm_file(pg_temp.got('receipts', 'davi')::uuid, repeat('0', 64), 90000, 'application/pdf', 1);
reset role;
-- Who uploaded each receipt; and a file Ana uploaded that is already a document of the case.
update public.files set uploaded_by = 'ae100000-0000-4000-8000-000000000001'
where id in (pg_temp.got('receipts', 'ana')::uuid, pg_temp.got('files', 'draft')::uuid);
update public.files set uploaded_by = 'ae100000-0000-4000-8000-000000000002' where id = pg_temp.got('receipts', 'bia')::uuid;
update public.files set uploaded_by = 'ae100000-0000-4000-8000-000000000004' where id = pg_temp.got('receipts', 'davi')::uuid;

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  format('select public.attach_filing_receipt(%L, %L, %L, current_date)', pg_temp.got('ask_4', 'package_id'),
    pg_temp.got('receipts', 'davi'), '5000202-39.2099.8.09.0051'),
  'P0002', null,
  'a lawyer of another firm attaches no receipt to a package of this one'
);
reset role;

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('receipt_not_lawyer', public.attach_filing_receipt(pg_temp.got('ask_4', 'package_id')::uuid,
  pg_temp.got('receipts', 'bia')::uuid, '5000202-39.2099.8.09.0051', (now() at time zone 'America/Sao_Paulo')::date));
reset role;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('receipt_others_file', public.attach_filing_receipt(pg_temp.got('ask_4', 'package_id')::uuid,
  pg_temp.got('receipts', 'bia')::uuid, '5000202-39.2099.8.09.0051', (now() at time zone 'America/Sao_Paulo')::date));
insert into res values ('receipt_used_file', public.attach_filing_receipt(pg_temp.got('ask_4', 'package_id')::uuid,
  pg_temp.got('files', 'draft')::uuid, '5000202-39.2099.8.09.0051', (now() at time zone 'America/Sao_Paulo')::date));
insert into res values ('receipt_bad_cnj', public.attach_filing_receipt(pg_temp.got('ask_4', 'package_id')::uuid,
  pg_temp.got('receipts', 'ana')::uuid, '5000202-40.2099.8.09.0051', (now() at time zone 'America/Sao_Paulo')::date));
insert into res values ('receipt_other_court', public.attach_filing_receipt(pg_temp.got('ask_4', 'package_id')::uuid,
  pg_temp.got('receipts', 'ana')::uuid, '1000404-60.2099.8.26.0100', (now() at time zone 'America/Sao_Paulo')::date));
insert into res values ('receipt_future', public.attach_filing_receipt(pg_temp.got('ask_4', 'package_id')::uuid,
  pg_temp.got('receipts', 'ana')::uuid, '5000202-39.2099.8.09.0051', (now() at time zone 'America/Sao_Paulo')::date + 2));
insert into res values ('receipt_before_case', public.attach_filing_receipt(pg_temp.got('ask_4', 'package_id')::uuid,
  pg_temp.got('receipts', 'ana')::uuid, '5000202-39.2099.8.09.0051', (now() at time zone 'America/Sao_Paulo')::date - 400));
insert into res values ('receipt_not_ready', public.attach_filing_receipt(pg_temp.got('ask_3', 'package_id')::uuid,
  pg_temp.got('receipts', 'ana')::uuid, '5000202-39.2099.8.09.0051', (now() at time zone 'America/Sao_Paulo')::date));
reset role;

-- The lawsuit moves to another system after the package was built: the package no longer says what it is.
update public.proceedings set system = 'pje' where id = pg_temp.got('proceeding', 'proceeding_id')::uuid;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('receipt_moved', public.attach_filing_receipt(pg_temp.got('ask_4', 'package_id')::uuid,
  pg_temp.got('receipts', 'ana')::uuid, '5000202-39.2099.8.09.0051', (now() at time zone 'America/Sao_Paulo')::date));
reset role;
update public.proceedings set system = 'projudi' where id = pg_temp.got('proceeding', 'proceeding_id')::uuid;
-- A document of the package is refused after the build.
update public.case_documents set status = 'rejected', rejected_reason = 'Ilegível.' where id = pg_temp.got('identity', 'document_id')::uuid;
select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('receipt_refused_doc', public.attach_filing_receipt(pg_temp.got('ask_4', 'package_id')::uuid,
  pg_temp.got('receipts', 'ana')::uuid, '5000202-39.2099.8.09.0051', (now() at time zone 'America/Sao_Paulo')::date));
reset role;
update public.case_documents set status = 'accepted', rejected_reason = null where id = pg_temp.got('identity', 'document_id')::uuid;

select ok(
  pg_temp.got('receipt_not_lawyer', 'code') = 'not_a_lawyer'
  and pg_temp.got('receipt_others_file', 'code') = 'file_not_found'
  and pg_temp.got('receipt_used_file', 'code') = 'file_not_found'
  and pg_temp.got('receipt_bad_cnj', 'code') = 'invalid_cnj'
  and pg_temp.got('receipt_other_court', 'code') = 'cnj_of_another_court'
  and pg_temp.got('receipt_future', 'code') = 'invalid_date'
  and pg_temp.got('receipt_before_case', 'code') = 'invalid_date'
  and pg_temp.got('receipt_not_ready', 'code') = 'package_not_ready'
  and pg_temp.got('receipt_moved', 'code') = 'package_outdated'
  and pg_temp.got('receipt_refused_doc', 'code') = 'package_outdated'
  and not exists (select 1 from public.filing_receipts)
  and (select status = 'planned' and cnj is null from public.proceedings where id = pg_temp.got('proceeding', 'proceeding_id')::uuid),
  'a receipt is attached by a lawyer of the firm, with a file of their own that is nothing else, the number of that court, a day that has come, to a ready package of the lawsuit as it is now'
);

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('receipt', public.attach_filing_receipt(pg_temp.got('ask_4', 'package_id')::uuid,
  pg_temp.got('receipts', 'ana')::uuid, '5000202-39.2099.8.09.0051', (now() at time zone 'America/Sao_Paulo')::date));
insert into res values ('receipt_twice', public.attach_filing_receipt(pg_temp.got('ask_4', 'package_id')::uuid,
  pg_temp.got('receipts', 'ana')::uuid, '5000202-39.2099.8.09.0051', (now() at time zone 'America/Sao_Paulo')::date));
insert into res values ('ask_filed', public.request_filing_package(pg_temp.got('proceeding', 'proceeding_id')::uuid,
  pg_temp.got('petition', 'document_id')::uuid));
insert into res values ('cancel_filed', public.cancel_filing_package(pg_temp.got('ask_4', 'package_id')::uuid));
insert into res values ('today_filed', public.firm_today('be100000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  pg_temp.got('receipt', 'code') = 'filed'
  and pg_temp.got('receipt_twice', 'code') = 'package_not_ready'
  and pg_temp.got('ask_filed', 'code') = 'already_filed'
  and pg_temp.got('cancel_filed', 'code') = 'package_closed'
  and pg_temp.got('today_filed', 'filings_ready') = '0'
  and (select status = 'filed' from public.filing_packages where id = pg_temp.got('ask_4', 'package_id')::uuid)
  and (select status = 'filed' and cnj = '50002023920998090051' and filed_at = (now() at time zone 'America/Sao_Paulo')::date
              and comarca = 'Goiânia' and system = 'projudi' and forum_basis = 'domicile'
       from public.proceedings where id = pg_temp.got('proceeding', 'proceeding_id')::uuid)
  and (select count(*) = 1 and bool_and(cnj = '50002023920998090051' and recorded_by = 'ae100000-0000-4000-8000-000000000001')
       from public.filing_receipts where package_id = pg_temp.got('ask_4', 'package_id')::uuid)
  and (select count(*) = 1 from public.proceeding_parties where proceeding_id = pg_temp.got('proceeding', 'proceeding_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'filing_receipt_attached' and actor_type = 'person'),
  'with its receipt the lawsuit is filed under that number, keeping what it already said, and the package is closed'
);

-- ---------- A case that ends ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('ask_b', public.request_filing_package(pg_temp.got('proceeding_b', 'proceeding_id')::uuid,
  pg_temp.got('petition_b', 'document_id')::uuid));
insert into res values ('decline_b', public.set_case_status(pg_temp.got('case_b', 'case_id')::uuid, 'declined',
  'O passageiro não tem direito a indenização.'));
reset role;

select ok(
  pg_temp.got('ask_b', 'code') = 'requested' and pg_temp.got('decline_b', 'ok') = 'true'
  and (select status = 'cancelled' from public.filing_packages where id = pg_temp.got('ask_b', 'package_id')::uuid),
  'a case that ends gives up the package it had in course'
);

-- ---------- The other firm ----------

select pg_temp.sign_in('ae100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('seen_by_b', jsonb_build_object(
  'packages', (select count(*) from public.filing_packages where org_id <> 'be100000-0000-4000-8000-00000000000b'),
  'items', (select count(*) from public.filing_package_items),
  'receipts', (select count(*) from public.filing_receipts),
  'ready', public.firm_today('be100000-0000-4000-8000-00000000000b') ->> 'filings_ready'));
select throws_ok(
  format('select public.cancel_filing_package(%L)', pg_temp.got('ask_2', 'package_id')),
  'P0002', null,
  'another firm cancels no package of this one'
);
reset role;

select ok(
  pg_temp.got('seen_by_b', 'packages') = '0' and pg_temp.got('seen_by_b', 'items') = '0'
  and pg_temp.got('seen_by_b', 'receipts') = '0' and pg_temp.got('seen_by_b', 'ready') = '0',
  'and reads none of its packages, files or receipts'
);

select * from finish();
rollback;
