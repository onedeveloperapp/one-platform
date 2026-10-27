begin;
create extension if not exists pgtap;
select plan(4);

-- ============================================================
-- A paper that came back signed goes in the filing package as its signed
-- version (0060): asked with its original, the package takes the signed
-- document the case accepted, once; an original whose envelope is still
-- open, or whose signed document the firm refused, goes as it is. Two firms.
--
-- Every person and firm here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a6500000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@assinado.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a6500000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@assinado.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b6500000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-assinado', 'a6500000-0000-4000-8000-000000000001'),
  ('b6500000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-assinado', 'a6500000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b6500000-0000-4000-8000-00000000000a', 'a6500000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b6500000-0000-4000-8000-00000000000b', 'a6500000-0000-4000-8000-000000000004', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.stored(org uuid, name text, mark text) returns uuid language plpgsql as $$
declare
  reserved jsonb := public.reserve_file(org, 'upload', name, 'application/pdf', 20000);
begin
  perform public.confirm_file((reserved ->> 'file_id')::uuid, repeat(mark, 64), 20000, 'application/pdf', 1);
  return (reserved ->> 'file_id')::uuid;
end;
$$;
-- A case of a firm with its lawsuit in the Projudi of TJGO and its petition accepted.
create function pg_temp.case_with_lawsuit(org uuid, name text) returns jsonb language plpgsql as $$
declare
  made jsonb := public.create_case(org, 'cancellation', 'LA', date '2026-10-20', jsonb_build_object('full_name', name));
  lawsuit jsonb := public.save_proceeding((made ->> 'case_id')::uuid, null,
    '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "system": "projudi"}'::jsonb,
    array[(made ->> 'party_id')::uuid]);
begin
  -- The system is ONE's, and the firm approves it (0066): a package waits for that.
  perform public.decide_court_system((lawsuit ->> 'proceeding_id')::uuid, true);
  return made || jsonb_build_object('proceeding_id', lawsuit ->> 'proceeding_id');
end;
$$;
-- A document of the case, accepted, of the claimant when it is a paper of theirs.
create function pg_temp.accepted(made jsonb, file uuid, kind text) returns uuid language plpgsql as $$
declare
  document uuid := (public.attach_case_document((made ->> 'case_id')::uuid, file, kind,
    case when kind = 'petition' then null else (made ->> 'party_id')::uuid end) ->> 'document_id')::uuid;
begin
  perform public.decide_case_document(document, 'accepted');
  return document;
end;
$$;
-- An envelope of the gov.br of a document of the case: signed into another document, or still open.
create function pg_temp.envelope(made jsonb, original uuid, status text, signed uuid) returns void language sql as $$
  insert into public.signature_envelopes (org_id, case_id, document_id, method, status, signers, signed_document_id)
  values ((select org_id from public.cases where id = (made ->> 'case_id')::uuid), (made ->> 'case_id')::uuid,
          original, 'govbr', status, '[{"position": 1, "name": "Teste"}]'::jsonb, signed);
$$;
create function pg_temp.package_documents(answer jsonb) returns uuid[] language sql as $$
  select document_ids from public.filing_packages where id = (answer ->> 'package_id')::uuid;
$$;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('files', jsonb_build_object(
  'petition_a', pg_temp.stored('b6500000-0000-4000-8000-00000000000a', 'inicial.pdf', 'a'),
  'original_a', pg_temp.stored('b6500000-0000-4000-8000-00000000000a', 'procuracao.pdf', 'b'),
  'signed_a', pg_temp.stored('b6500000-0000-4000-8000-00000000000a', 'procuracao-assinada.pdf', 'c'),
  'other_a', pg_temp.stored('b6500000-0000-4000-8000-00000000000a', 'contrato.pdf', 'd'),
  'other_signed_a', pg_temp.stored('b6500000-0000-4000-8000-00000000000a', 'contrato-assinado.pdf', 'e'),
  'petition_b', pg_temp.stored('b6500000-0000-4000-8000-00000000000b', 'inicial.pdf', 'f'),
  'original_b', pg_temp.stored('b6500000-0000-4000-8000-00000000000b', 'procuracao.pdf', '0')
));
reset role;

select pg_temp.sign_in('a6500000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a', pg_temp.case_with_lawsuit('b6500000-0000-4000-8000-00000000000a', 'Mariana Teste'));
insert into res values ('docs_a', jsonb_build_object(
  'petition', pg_temp.accepted((select payload from res where name = 'a'), pg_temp.got('files', 'petition_a')::uuid, 'petition'),
  'original', pg_temp.accepted((select payload from res where name = 'a'), pg_temp.got('files', 'original_a')::uuid, 'power_of_attorney'),
  'signed', pg_temp.accepted((select payload from res where name = 'a'), pg_temp.got('files', 'signed_a')::uuid, 'power_of_attorney'),
  'other', pg_temp.accepted((select payload from res where name = 'a'), pg_temp.got('files', 'other_a')::uuid, 'contract'),
  'other_signed', pg_temp.accepted((select payload from res where name = 'a'), pg_temp.got('files', 'other_signed_a')::uuid, 'contract')
));
-- The firm refused the signed contract: it is no signed version of anything.
select public.decide_case_document(pg_temp.got('docs_a', 'other_signed')::uuid, 'rejected', 'A assinatura não confere.');
reset role;
select pg_temp.envelope((select payload from res where name = 'a'), pg_temp.got('docs_a', 'original')::uuid, 'signed',
  pg_temp.got('docs_a', 'signed')::uuid);
select pg_temp.envelope((select payload from res where name = 'a'), pg_temp.got('docs_a', 'other')::uuid, 'signed',
  pg_temp.got('docs_a', 'other_signed')::uuid);

select pg_temp.sign_in('a6500000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b', pg_temp.case_with_lawsuit('b6500000-0000-4000-8000-00000000000b', 'Pedro Teste'));
insert into res values ('docs_b', jsonb_build_object(
  'petition', pg_temp.accepted((select payload from res where name = 'b'), pg_temp.got('files', 'petition_b')::uuid, 'petition'),
  'original', pg_temp.accepted((select payload from res where name = 'b'), pg_temp.got('files', 'original_b')::uuid, 'power_of_attorney')
));
reset role;
select pg_temp.envelope((select payload from res where name = 'b'), pg_temp.got('docs_b', 'original')::uuid, 'pending', null);

-- ---------- The packages ----------

select pg_temp.sign_in('a6500000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ask_original', public.request_filing_package(pg_temp.got('a', 'proceeding_id')::uuid,
  pg_temp.got('docs_a', 'petition')::uuid, array[pg_temp.got('docs_a', 'original')::uuid]));
reset role;
select is(pg_temp.package_documents((select payload from res where name = 'ask_original')),
  array[pg_temp.got('docs_a', 'signed')::uuid],
  'a paper asked as its original goes as the signed version the firm accepted');

select pg_temp.sign_in('a6500000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ask_both', public.request_filing_package(pg_temp.got('a', 'proceeding_id')::uuid,
  pg_temp.got('docs_a', 'petition')::uuid,
  array[pg_temp.got('docs_a', 'original')::uuid, pg_temp.got('docs_a', 'signed')::uuid]));
insert into res values ('ask_refused', public.request_filing_package(pg_temp.got('a', 'proceeding_id')::uuid,
  pg_temp.got('docs_a', 'petition')::uuid, array[pg_temp.got('docs_a', 'other')::uuid]));
reset role;
select is(pg_temp.package_documents((select payload from res where name = 'ask_both')),
  array[pg_temp.got('docs_a', 'signed')::uuid],
  'asked with both, it goes once, signed');
select is(pg_temp.package_documents((select payload from res where name = 'ask_refused')),
  array[pg_temp.got('docs_a', 'other')::uuid],
  'a signed version the firm refused is no version of the paper: the original goes');

select pg_temp.sign_in('a6500000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('ask_b', public.request_filing_package(pg_temp.got('b', 'proceeding_id')::uuid,
  pg_temp.got('docs_b', 'petition')::uuid, array[pg_temp.got('docs_b', 'original')::uuid]));
reset role;
select is(pg_temp.package_documents((select payload from res where name = 'ask_b')),
  array[pg_temp.got('docs_b', 'original')::uuid],
  'in the other firm, a paper whose envelope is still open goes as it is');

select * from finish();
rollback;
