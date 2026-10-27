begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

-- ============================================================
-- The files of a filing package signed by ONE with the cloud signature of a
-- lawyer who signs the lawsuit (0042).
--
-- A package built of a system that takes signed files (the Projudi of TJGO)
-- owes its signature from the moment it is built where the firm lets ONE
-- sign; it waits while no lawyer of its lawsuit has an authorization in
-- force, and owes it again once one has. The backend claims it under a
-- number, reads its files with who signs them, opens a use bound to that
-- claim and that lawyer, and records the .p7s only for that use over those
-- very files, each .p7s a stored file of the firm named by nothing else. The
-- .p7s go only to the lawyer whose certificate signed them. A lawyer of the
-- lawsuit asks ONE to sign with their own authorization and nobody else's,
-- also to file it themself when a colleague signed (the colleague's files
-- go); a request of somebody who no longer signs the lawsuit stands no
-- more. A passing failure is tried again, a claim that never came back
-- spends its try, then the package waits for a person. A firm that keeps
-- the signature to a person has a lawyer of the lawsuit ask for it, with
-- the second factor, never from a support visit. A package given up
-- forgets its .p7s with its parts. Two firms: neither reaches the other's.
--
-- Every person, firm, CPF and token here is invented: the CPFs are the ones
-- every manual uses as examples.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a8200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'paula@souza.invalid', '', now(), '{}', '{"display_name":"Paula Souza"}', now(), now()),
  ('a8200000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'lucas@souza.invalid', '', now(), '{}', '{"display_name":"Lucas Lima"}', now(), now()),
  ('a8200000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'tania@souza.invalid', '', now(), '{}', '{"display_name":"Tania Reis"}', now(), now()),
  ('a8200000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'marcos@rocha.invalid', '', now(), '{}', '{"display_name":"Marcos Rocha"}', now(), now()),
  ('a8200000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a8200000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('b8200000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-pacote', 'a8200000-0000-4000-8000-000000000001'),
  ('b8200000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-pacote', 'a8200000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b8200000-0000-4000-8000-00000000000b', 'a8200000-0000-4000-8000-000000000004', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert, update on res to authenticated, service_role, anon;

create function pg_temp.sign_in(who uuid, level text default 'aal2', session text default null)
returns void language sql as
$$
  select set_config(
    'request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level, 'session_id', session))::text,
    true
  );
$$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, key text) returns text language sql as
$$ select payload ->> key from res where res.name = got.name; $$;
create function pg_temp.stored(org uuid, purpose text, name text, mime text, mark text) returns uuid language plpgsql as $$
declare
  reserved jsonb := public.reserve_file(org, purpose, name, mime, 1000);
begin
  perform public.confirm_file((reserved ->> 'file_id')::uuid, repeat(mark, 64), 1000, mime, case when mime = 'application/pdf' then 1 end);
  return (reserved ->> 'file_id')::uuid;
end;
$$;
create function pg_temp.package(name text) returns public.filing_packages language sql as
$$ select * from public.filing_packages p where p.id = (select (payload ->> 'id')::uuid from res where res.name = package.name); $$;
create function pg_temp.claim(package uuid) returns integer language plpgsql as $$
declare
  claimed integer;
begin
  select c.claim into claimed from public.claim_package_signatures(1, package) c;
  return claimed;
end;
$$;

-- A lawsuit of each firm, of the Projudi of TJGO, with a package built: a petition and one more file.
create function pg_temp.lawsuit(org uuid, owner uuid, signer uuid, name text, marks text[]) returns void language plpgsql as $$
declare
  made jsonb;
  saved jsonb;
  files uuid[] := '{}';
  documents uuid[] := '{}';
  file uuid;
  attached jsonb;
  mark text;
  package uuid := gen_random_uuid();
begin
  perform pg_temp.sign_in(owner);
  set local role authenticated;
  made := public.create_case(org, 'delay', 'G3', date '2026-09-20',
    '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02"}'::jsonb);
  saved := public.save_proceeding((made ->> 'case_id')::uuid, null,
    '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "system": "projudi"}'::jsonb,
    array[(made ->> 'party_id')::uuid]);
  -- The system is ONE's, and the firm approves it (0066): a package waits for that.
  perform public.decide_court_system((saved ->> 'proceeding_id')::uuid, true);
  reset role;
  foreach mark in array marks loop
    perform pg_temp.as_backend();
    set local role service_role;
    file := pg_temp.stored(org, 'upload', 'arquivo-' || mark || '.pdf', 'application/pdf', mark);
    reset role;
    perform pg_temp.sign_in(owner);
    set local role authenticated;
    attached := public.attach_case_document((made ->> 'case_id')::uuid, file,
      case when cardinality(files) = 0 then 'petition' else 'evidence' end);
    perform public.decide_case_document((attached ->> 'document_id')::uuid, 'accepted');
    reset role;
    files := files || file;
    documents := documents || (attached ->> 'document_id')::uuid;
  end loop;
  insert into public.proceeding_lawyers (proceeding_id, user_id, org_id)
  values ((saved ->> 'proceeding_id')::uuid, signer, org);
  insert into public.filing_packages (id, org_id, case_id, proceeding_id, court, system, kind, status, petition_document_id)
  values (package, org, (made ->> 'case_id')::uuid, (saved ->> 'proceeding_id')::uuid, 'TJGO', 'projudi', 'juizado',
          'requested', documents[1]);
  for i in 1 .. cardinality(files) loop
    insert into public.filing_package_items (org_id, package_id, position, name, file_id, document_id, bytes)
    values (org, package, i, lpad(i::text, 2, '0') || '-arquivo.pdf', files[i], documents[i], 1000);
  end loop;
  update public.filing_packages set status = 'ready', built_at = now() where id = package;
  insert into res values (name, jsonb_build_object('id', package, 'case_id', made ->> 'case_id'));
end;
$$;

select pg_temp.lawsuit('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000001',
  'a8200000-0000-4000-8000-000000000002', 'package_a', array['a', 'b']);
select pg_temp.lawsuit('b8200000-0000-4000-8000-00000000000b', 'a8200000-0000-4000-8000-000000000004',
  'a8200000-0000-4000-8000-000000000004', 'package_b', array['c']);

-- ---------- What a system takes, and what a firm lets ONE do ----------

select ok(
  (select signature_status = 'due' and signature_attempts = 0 and signature_claimed_at is null
   from pg_temp.package('package_a'))
  and (select signature_status = 'due' from pg_temp.package('package_b')),
  'a package built owes its signature at once where the firm lets ONE sign'
);

-- The same package, had somebody of the attendance asked for it: built again, and swept.
update public.filing_packages set requested_by = 'a8200000-0000-4000-8000-000000000003', signature_status = null,
  status = 'requested'
where id = (select id from pg_temp.package('package_a'));
update public.filing_packages set status = 'ready' where id = (select id from pg_temp.package('package_a'));
select pg_temp.as_backend();
set local role service_role;
select public.claim_package_signatures(5, (select id from pg_temp.package('package_a')));
reset role;
select ok(
  (select signature_status is null and signature_claimed_at is null from pg_temp.package('package_a')),
  'what somebody of the team who is no partner nor lawyer asked for, ONE signs only when a lawyer of the lawsuit asks'
);
-- As ONE asked for it, as the rest of this file has it.
update public.filing_packages set requested_by = null, status = 'requested' where id = (select id from pg_temp.package('package_a'));
update public.filing_packages set status = 'ready' where id = (select id from pg_temp.package('package_a'));

select ok(
  (select bool_and(signed_files = 'p7s') from public.court_systems where court = 'TJGO' and system = 'projudi')
  and not exists (select 1 from public.court_systems where system <> 'projudi' and signed_files is not null),
  'the Projudi of TJGO takes its files already signed, as a .p7s, and no other system here does'
);
select ok(
  exists (select 1 from public.autonomy_decisions where key = 'sign_package' and default_mode = 'auto'
          and modes = array['auto', 'approval'])
  and public.firm_autonomy_mode('b8200000-0000-4000-8000-00000000000a', 'sign_package') = 'auto',
  'ONE signs a package by itself unless the firm keeps it to a person'
);

-- ---------- No authorization in force: the package waits ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_1', jsonb_build_object('claim', pg_temp.claim((select id from pg_temp.package('package_a')))));
insert into res values ('to_sign_1', public.package_signature_to_sign((select id from pg_temp.package('package_a')),
  pg_temp.got('claim_1', 'claim')::integer));
reset role;
select ok(
  pg_temp.got('to_sign_1', 'code') = 'waiting'
  and (select signature_status = 'waiting' and signature_error = 'no_signature' and signature_claimed_at is null
       from pg_temp.package('package_a')),
  'a package whose lawyers have no authorization in force waits for one, and hands out nothing'
);

-- Lucas declares his CPF and authorizes ONE at SerproID.
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000002');
set local role authenticated;
select public.declare_lawyer_cpf('529.982.247-25');
insert into res values ('lucas', public.begin_lawyer_signature('b8200000-0000-4000-8000-00000000000a', 'serproid'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.vault_store_secret('b8200000-0000-4000-8000-00000000000a', pg_temp.got('lucas', 'connection_id')::uuid, 1,
  'AAAAAAAAAAAAAAAA', 'c2Vzc2Fv', 'AAAAAAAAAAAAAAAAAAAAAA==', now() + interval '2 days',
  '{"holder_cpf_middle": "982247", "serial": "0a0b0c"}'::jsonb);
insert into res values ('claim_2', jsonb_build_object('claim', pg_temp.claim((select id from pg_temp.package('package_a')))));
insert into res values ('to_sign_2', public.package_signature_to_sign((select id from pg_temp.package('package_a')),
  pg_temp.got('claim_2', 'claim')::integer));
reset role;

select ok(
  pg_temp.got('to_sign_2', 'code') = 'sign'
  and pg_temp.got('to_sign_2', 'signer') = 'a8200000-0000-4000-8000-000000000002'
  and (select array_agg(item ->> 'sha256' order by (item ->> 'position')::integer)
       from jsonb_array_elements((select payload -> 'items' from res where name = 'to_sign_2')) item)
      = array[repeat('a', 64), repeat('b', 64)],
  'once a lawyer of the lawsuit authorized ONE, the package owes its signature again: its files in order, and who signs'
);

-- ---------- What is recorded as signed ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('wrong_claim', public.record_package_signature((select id from pg_temp.package('package_a')),
  pg_temp.got('claim_2', 'claim')::integer + 7, 'retry', null, null, '[]'::jsonb, 'psc_unavailable'));
select throws_ok(
  format($$select public.lawyer_signature_open(%L, %L, 'filing.package', %L, null, array[repeat('a', 64), repeat('b', 64)])$$,
    'b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000002', (select id from pg_temp.package('package_a'))),
  '22023', 'invalid_use',
  'a use of a package''s files names the claim it signs under'
);
insert into res values ('open_other_claim', public.lawyer_signature_open('b8200000-0000-4000-8000-00000000000a',
  'a8200000-0000-4000-8000-000000000002', 'filing.package', (select id from pg_temp.package('package_a')), null,
  array[repeat('a', 64), repeat('b', 64)], target_claim => pg_temp.got('claim_2', 'claim')::integer + 5));
insert into res values ('open_not_signer', public.lawyer_signature_open('b8200000-0000-4000-8000-00000000000a',
  'a8200000-0000-4000-8000-000000000001', 'filing.package', (select id from pg_temp.package('package_a')), null,
  array[repeat('a', 64), repeat('b', 64)], target_claim => pg_temp.got('claim_2', 'claim')::integer));
insert into res values ('use', public.lawyer_signature_open('b8200000-0000-4000-8000-00000000000a',
  'a8200000-0000-4000-8000-000000000002', 'filing.package', (select id from pg_temp.package('package_a')), null,
  array[repeat('a', 64), repeat('b', 64)], target_claim => pg_temp.got('claim_2', 'claim')::integer));
select public.lawyer_signature_finish('b8200000-0000-4000-8000-00000000000a', pg_temp.got('use', 'use_id')::uuid, true);
reset role;
-- A use of an earlier claim, signed over the very same files.
with made as (
  insert into public.lawyer_signature_uses (org_id, person_id, connection_id, psc, purpose, subject_id, case_id, seal_id,
                                              claim, document_hashes, status, signed_count, finished_at)
    values ('b8200000-0000-4000-8000-00000000000a', 'a8200000-0000-4000-8000-000000000002', pg_temp.got('lucas', 'connection_id')::uuid, 'serproid',
            'filing.package', (select id from pg_temp.package('package_a')), pg_temp.got('package_a', 'case_id')::uuid, gen_random_uuid(),
            pg_temp.got('claim_2', 'claim')::integer - 1, array[repeat('a', 64), repeat('b', 64)], 'signed', 2, now())
    returning id
)
insert into res select 'old_use', jsonb_build_object('use_id', id) from made;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('p7s', jsonb_build_object(
  'one', pg_temp.stored('b8200000-0000-4000-8000-00000000000a', 'filing', '01-arquivo.pdf.p7s', 'application/pkcs7-mime', '1'),
  'two', pg_temp.stored('b8200000-0000-4000-8000-00000000000a', 'filing', '02-arquivo.pdf.p7s', 'application/pkcs7-mime', '2'),
  'pdf', pg_temp.stored('b8200000-0000-4000-8000-00000000000a', 'filing', 'parte.pdf', 'application/pdf', '3')
));
insert into res values ('items', (
  select jsonb_agg(jsonb_build_object('item_id', i.id, 'position', i.position) order by i.position)
  from public.filing_package_items i where i.package_id = (select id from pg_temp.package('package_a'))
));
insert into res values ('bad_use', public.record_package_signature((select id from pg_temp.package('package_a')),
  pg_temp.got('claim_2', 'claim')::integer, 'signed', pg_temp.got('use', 'use_id')::uuid,
  'a8200000-0000-4000-8000-000000000001',
  jsonb_build_array(
    jsonb_build_object('item_id', (select payload -> 0 ->> 'item_id' from res where name = 'items'), 'file_id', pg_temp.got('p7s', 'one')),
    jsonb_build_object('item_id', (select payload -> 1 ->> 'item_id' from res where name = 'items'), 'file_id', pg_temp.got('p7s', 'two'))
  )));
reset role;
insert into res values ('after_bad_use', (
  select jsonb_build_object('claimed', signature_claimed_at is not null, 'retry', signature_retry_after > now(),
                            'status', signature_status, 'error', signature_error)
  from pg_temp.package('package_a')
));
update public.filing_packages set signature_claimed_at = now(), signature_retry_after = null where id = (select id from pg_temp.package('package_a'));
select pg_temp.as_backend();
set local role service_role;
insert into res values ('same_file', public.record_package_signature((select id from pg_temp.package('package_a')),
  pg_temp.got('claim_2', 'claim')::integer, 'signed', pg_temp.got('use', 'use_id')::uuid,
  'a8200000-0000-4000-8000-000000000002',
  jsonb_build_array(
    jsonb_build_object('item_id', (select payload -> 0 ->> 'item_id' from res where name = 'items'), 'file_id', pg_temp.got('p7s', 'one')),
    jsonb_build_object('item_id', (select payload -> 1 ->> 'item_id' from res where name = 'items'), 'file_id', pg_temp.got('p7s', 'one'))
  )));
reset role;
update public.filing_packages set signature_claimed_at = now(), signature_retry_after = null where id = (select id from pg_temp.package('package_a'));
select pg_temp.as_backend();
set local role service_role;
insert into res values ('a_pdf', public.record_package_signature((select id from pg_temp.package('package_a')),
  pg_temp.got('claim_2', 'claim')::integer, 'signed', pg_temp.got('use', 'use_id')::uuid,
  'a8200000-0000-4000-8000-000000000002',
  jsonb_build_array(
    jsonb_build_object('item_id', (select payload -> 0 ->> 'item_id' from res where name = 'items'), 'file_id', pg_temp.got('p7s', 'one')),
    jsonb_build_object('item_id', (select payload -> 1 ->> 'item_id' from res where name = 'items'), 'file_id', pg_temp.got('p7s', 'pdf'))
  )));
reset role;
update public.filing_packages set signature_claimed_at = now(), signature_retry_after = null where id = (select id from pg_temp.package('package_a'));
select pg_temp.as_backend();
set local role service_role;
insert into res values ('other_claim_use', public.record_package_signature((select id from pg_temp.package('package_a')),
  pg_temp.got('claim_2', 'claim')::integer, 'signed', pg_temp.got('old_use', 'use_id')::uuid,
  'a8200000-0000-4000-8000-000000000002',
  jsonb_build_array(
    jsonb_build_object('item_id', (select payload -> 0 ->> 'item_id' from res where name = 'items'), 'file_id', pg_temp.got('p7s', 'one')),
    jsonb_build_object('item_id', (select payload -> 1 ->> 'item_id' from res where name = 'items'), 'file_id', pg_temp.got('p7s', 'two'))
  )));
reset role;
update public.filing_packages set signature_claimed_at = now(), signature_retry_after = null where id = (select id from pg_temp.package('package_a'));
select pg_temp.as_backend();
set local role service_role;
insert into res values ('signed', public.record_package_signature((select id from pg_temp.package('package_a')),
  pg_temp.got('claim_2', 'claim')::integer, 'signed', pg_temp.got('use', 'use_id')::uuid,
  'a8200000-0000-4000-8000-000000000002',
  jsonb_build_array(
    jsonb_build_object('item_id', (select payload -> 0 ->> 'item_id' from res where name = 'items'), 'file_id', pg_temp.got('p7s', 'one')),
    jsonb_build_object('item_id', (select payload -> 1 ->> 'item_id' from res where name = 'items'), 'file_id', pg_temp.got('p7s', 'two'))
  )));
reset role;

select is(pg_temp.got('wrong_claim', 'code'), 'not_held', 'what a worker no longer holds is not recorded');
select is(
  array[pg_temp.got('open_other_claim', 'code'), pg_temp.got('open_not_signer', 'code')],
  array['not_claimed', 'not_a_signer'],
  'a use of a package''s files opens only under the claim the backend holds, for a lawyer of its lawsuit'
);
select ok(
  pg_temp.got('after_bad_use', 'claimed') = 'false' and pg_temp.got('after_bad_use', 'retry') = 'true'
  and pg_temp.got('after_bad_use', 'status') = 'due' and pg_temp.got('after_bad_use', 'error') = 'invalid_signature',
  'a record refused keeps nothing and gives the claim back, tried again after a wait'
);
select is(
  array[pg_temp.got('bad_use', 'code'), pg_temp.got('same_file', 'code'), pg_temp.got('a_pdf', 'code'),
        pg_temp.got('other_claim_use', 'code')],
  array['invalid_signature', 'invalid_signature', 'invalid_signature', 'invalid_signature'],
  'a signature is recorded only of the signer''s own use under this very claim, one .p7s per file, each a signed copy'
);
select ok(
  pg_temp.got('signed', 'code') = 'signed'
  and (select signature_status = 'signed' and signed_by = 'a8200000-0000-4000-8000-000000000002' and signed_at is not null
          and signature_use = pg_temp.got('use', 'use_id')::uuid and signature_claimed_at is null
       from pg_temp.package('package_a'))
  and (select array_agg(signed_file_id order by position) from public.filing_package_items
       where package_id = (select id from pg_temp.package('package_a')))
      = array[pg_temp.got('p7s', 'one')::uuid, pg_temp.got('p7s', 'two')::uuid],
  'the files of the package are signed: each one with its .p7s, by whom and under which use'
);
select ok(
  exists (select 1 from public.case_events where case_id = pg_temp.got('package_a', 'case_id')::uuid
          and kind = 'filing_package_signed' and actor_type = 'system'),
  'told in the case''s timeline as ONE''s'
);

-- A worker that lost the answer takes back what it stored: the database keeps a .p7s a package names.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('discard_p7s', public.discard_file(pg_temp.got('p7s', 'one')::uuid));
reset role;
select ok(
  pg_temp.got('discard_p7s', 'code') = 'in_use'
  and exists (select 1 from public.files where id = pg_temp.got('p7s', 'one')::uuid),
  'a .p7s the package names is never forgotten, whatever the worker that asks believes'
);

-- ---------- Who reads it ----------

select pg_temp.sign_in('a8200000-0000-4000-8000-000000000003');
set local role authenticated;
select ok(
  (select signature_status = 'signed' from public.filing_packages where id = (select id from pg_temp.package('package_a')))
  and (select count(*) = 2 from public.filing_package_items
       where package_id = (select id from pg_temp.package('package_a')) and signed_file_id is not null),
  'anybody of the firm reads that the package is signed, and its .p7s'
);
reset role;
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000004');
set local role authenticated;
select is(
  (select count(*)::integer from public.filing_packages where id = (select id from pg_temp.package('package_a'))),
  0,
  'another firm reads nothing of it'
);
reset role;

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a8200000-0000-4000-8000-000000000009', 'a8200000-0000-4000-8000-000000000002', 'b8200000-0000-4000-8000-00000000000a',
        'Conferindo a assinatura', 'f8200000-0000-4000-8000-000000000002', now() + interval '30 minutes');
create function pg_temp.open_signed(who uuid, label text, session text default null) returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(who, 'aal2', session);
  set local role authenticated;
  insert into res values (label, public.filing_signed_file((select payload -> 0 ->> 'item_id' from res where name = 'items')::uuid));
  reset role;
end;
$$;
select pg_temp.open_signed('a8200000-0000-4000-8000-000000000002', 'take_lucas');
select pg_temp.open_signed('a8200000-0000-4000-8000-000000000002', 'take_visit', 'f8200000-0000-4000-8000-000000000002');
select pg_temp.open_signed('a8200000-0000-4000-8000-000000000001', 'take_partner');
select pg_temp.open_signed('a8200000-0000-4000-8000-000000000003', 'take_attendance');
select pg_temp.open_signed('a8200000-0000-4000-8000-000000000004', 'take_other_firm');
select ok(
  pg_temp.got('take_lucas', 'file_id') = pg_temp.got('p7s', 'one') and pg_temp.got('take_lucas', 'name') = '01-arquivo.pdf'
  and array[pg_temp.got('take_visit', 'code'), pg_temp.got('take_partner', 'code'), pg_temp.got('take_attendance', 'code'),
            pg_temp.got('take_other_firm', 'code')]
      = array['not_allowed_in_support_session', 'not_the_signer', 'not_the_signer', 'not_found'],
  'the .p7s go only to the lawyer whose certificate signed them: never a partner, the attendance, a support visit or another firm'
);

-- Paula signs the lawsuit too, and files it herself: she authorizes ONE, for less time than Lucas did.
insert into public.proceeding_lawyers (proceeding_id, user_id, org_id)
values ((select proceeding_id from pg_temp.package('package_a')), 'a8200000-0000-4000-8000-000000000001', 'b8200000-0000-4000-8000-00000000000a');
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000001');
set local role authenticated;
select public.declare_lawyer_cpf('111.444.777-35');
insert into res values ('paula', public.begin_lawyer_signature('b8200000-0000-4000-8000-00000000000a', 'birdid'));
insert into res values ('paula_early', public.request_package_signature((select id from pg_temp.package('package_a'))));
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.vault_store_secret('b8200000-0000-4000-8000-00000000000a', pg_temp.got('paula', 'connection_id')::uuid, 1,
  'AAAAAAAAAAAAAAAA', 'c2Vzc2Fv', 'AAAAAAAAAAAAAAAAAAAAAA==', now() + interval '1 day',
  '{"holder_cpf_middle": "444777", "serial": "0d0e0f"}'::jsonb);
reset role;
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('paula_again', public.request_package_signature((select id from pg_temp.package('package_a'))));
reset role;
select ok(
  pg_temp.got('paula_early', 'code') = 'no_signature' and pg_temp.got('paula_again', 'code') = 'requested'
  and (select signature_status = 'due' and signer_requested = 'a8200000-0000-4000-8000-000000000001'
              and signed_by is null and signed_at is null and signature_use is null
       from pg_temp.package('package_a'))
  and not exists (select 1 from public.filing_package_items
                  where package_id = (select id from pg_temp.package('package_a')) and signed_file_id is not null)
  and not exists (select 1 from public.files where id in (pg_temp.got('p7s', 'one')::uuid, pg_temp.got('p7s', 'two')::uuid))
  and exists (select 1 from public.audit_events where action = 'filing.signature_requested'
              and actor_id = 'a8200000-0000-4000-8000-000000000001' and (metadata ->> 'again')::boolean),
  'a lawyer of the lawsuit asks only with an authorization of their own, and asking over a colleague''s signature takes the colleague''s files away'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_p', jsonb_build_object('claim', pg_temp.claim((select id from pg_temp.package('package_a')))));
insert into res values ('to_sign_p', public.package_signature_to_sign((select id from pg_temp.package('package_a')), pg_temp.got('claim_p', 'claim')::integer));
insert into res values ('open_lucas_p', public.lawyer_signature_open('b8200000-0000-4000-8000-00000000000a',
  'a8200000-0000-4000-8000-000000000002', 'filing.package', (select id from pg_temp.package('package_a')), null,
  array[repeat('a', 64), repeat('b', 64)], target_claim => pg_temp.got('claim_p', 'claim')::integer));
insert into res values ('retry_p', public.record_package_signature((select id from pg_temp.package('package_a')),
  pg_temp.got('claim_p', 'claim')::integer, 'retry', null, null, '[]'::jsonb, 'psc_unavailable'));
reset role;
select ok(
  pg_temp.got('to_sign_p', 'signer') = 'a8200000-0000-4000-8000-000000000001'
  and pg_temp.got('open_lucas_p', 'code') = 'not_the_signer',
  'who asked signs with their own authorization, though a colleague''s lasts longer, and nobody else''s opens for it'
);

-- Paula no longer signs the lawsuit: what she asked stands no more.
delete from public.proceeding_lawyers
where proceeding_id = (select proceeding_id from pg_temp.package('package_a')) and user_id = 'a8200000-0000-4000-8000-000000000001';
select pg_temp.as_backend();
set local role service_role;
select public.claim_package_signatures(5, (select id from pg_temp.package('package_a')));
reset role;
select ok(
  (select signer_requested is null and signature_status = 'due' from pg_temp.package('package_a')),
  'a lawyer who asked and no longer signs the lawsuit asked for nothing: where the firm lets ONE sign, a lawyer of the lawsuit signs'
);

-- Lucas's authorization signs it again.
update public.filing_packages set signature_retry_after = null where id = (select id from pg_temp.package('package_a'));
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_l', jsonb_build_object('claim', pg_temp.claim((select id from pg_temp.package('package_a')))));
insert into res values ('use_l', public.lawyer_signature_open('b8200000-0000-4000-8000-00000000000a',
  'a8200000-0000-4000-8000-000000000002', 'filing.package', (select id from pg_temp.package('package_a')), null,
  array[repeat('a', 64), repeat('b', 64)], target_claim => pg_temp.got('claim_l', 'claim')::integer));
select public.lawyer_signature_finish('b8200000-0000-4000-8000-00000000000a', pg_temp.got('use_l', 'use_id')::uuid, true);
insert into res values ('p7s_l', jsonb_build_object(
  'one', pg_temp.stored('b8200000-0000-4000-8000-00000000000a', 'filing', '01-arquivo.pdf.p7s', 'application/pkcs7-mime', '4'),
  'two', pg_temp.stored('b8200000-0000-4000-8000-00000000000a', 'filing', '02-arquivo.pdf.p7s', 'application/pkcs7-mime', '5')
));
insert into res values ('signed_l', public.record_package_signature((select id from pg_temp.package('package_a')),
  pg_temp.got('claim_l', 'claim')::integer, 'signed', pg_temp.got('use_l', 'use_id')::uuid,
  'a8200000-0000-4000-8000-000000000002',
  jsonb_build_array(
    jsonb_build_object('item_id', (select payload -> 0 ->> 'item_id' from res where name = 'items'), 'file_id', pg_temp.got('p7s_l', 'one')),
    jsonb_build_object('item_id', (select payload -> 1 ->> 'item_id' from res where name = 'items'), 'file_id', pg_temp.got('p7s_l', 'two'))
  )));
reset role;

-- ---------- A firm that keeps the signature to a person ----------

insert into public.firm_autonomy (org_id, decision, mode)
values ('b8200000-0000-4000-8000-00000000000b', 'sign_package', 'approval');
select pg_temp.as_backend();
set local role service_role;
select public.claim_package_signatures(5, (select id from pg_temp.package('package_b')));
reset role;
select ok(
  (select signature_status is null and signature_claimed_at is null from pg_temp.package('package_b')),
  'where the firm keeps it to a person, ONE signs nothing by itself'
);

select pg_temp.sign_in('a8200000-0000-4000-8000-000000000004', 'aal1');
set local role authenticated;
select throws_ok(
  format($$select public.request_package_signature(%L)$$, (select id from pg_temp.package('package_b'))),
  '42501', 'second_factor_required',
  'a lawyer of the lawsuit asks for it with the second factor'
);
reset role;
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a8200000-0000-4000-8000-000000000009', 'a8200000-0000-4000-8000-000000000004', 'b8200000-0000-4000-8000-00000000000b',
        'Conferindo o pacote', 'f8200000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000004', 'aal2', 'f8200000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format($$select public.request_package_signature(%L)$$, (select id from pg_temp.package('package_b'))),
  '42501', 'not_allowed_in_support_session',
  'never from a support visit'
);
reset role;
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('request_not_signer', public.request_package_signature((select id from pg_temp.package('package_a'))));
insert into res values ('request_other_firm', public.request_package_signature((select id from pg_temp.package('package_b'))));
reset role;
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('request_unauthorized', public.request_package_signature((select id from pg_temp.package('package_b'))));
select public.declare_lawyer_cpf('123.456.789-09');
insert into res values ('marcos', public.begin_lawyer_signature('b8200000-0000-4000-8000-00000000000b', 'serproid'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.vault_store_secret('b8200000-0000-4000-8000-00000000000b', pg_temp.got('marcos', 'connection_id')::uuid, 1,
  'AAAAAAAAAAAAAAAA', 'c2Vzc2Fv', 'AAAAAAAAAAAAAAAAAAAAAA==', now() + interval '3 days',
  '{"holder_cpf_middle": "456789", "serial": "0a0b0d"}'::jsonb);
reset role;
select is(
  array[pg_temp.got('request_not_signer', 'code'), pg_temp.got('request_other_firm', 'code'),
        pg_temp.got('request_unauthorized', 'code')],
  array['not_a_signer', 'not_found', 'no_signature'],
  'only a lawyer named to sign the lawsuit asks for it, in their firm, with an authorization of their own in force'
);
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('request_b', public.request_package_signature((select id from pg_temp.package('package_b'))));
reset role;
select ok(
  pg_temp.got('request_b', 'code') = 'requested'
  and (select signature_status = 'due' and signer_requested = 'a8200000-0000-4000-8000-000000000004'
       from pg_temp.package('package_b'))
  and exists (select 1 from public.audit_events where action = 'filing.signature_requested'
              and actor_id = 'a8200000-0000-4000-8000-000000000004'),
  'and the package owes the signature of the lawyer who asked, on the record'
);

-- ---------- Tried again, then a person's ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('b_claim_1', jsonb_build_object('claim', pg_temp.claim((select id from pg_temp.package('package_b')))));
insert into res values ('b_retry', public.record_package_signature((select id from pg_temp.package('package_b')),
  pg_temp.got('b_claim_1', 'claim')::integer, 'retry', null, null, '[]'::jsonb, 'psc_unavailable'));
reset role;
select ok(
  pg_temp.got('b_retry', 'code') = 'retry'
  and (select signature_status = 'due' and signature_retry_after > now() and signature_error = 'psc_unavailable'
       from pg_temp.package('package_b')),
  'a passing failure is tried again after a wait'
);
update public.filing_packages set signature_retry_after = null, signature_attempts = 3
where id = (select id from pg_temp.package('package_b'));
select pg_temp.as_backend();
set local role service_role;
insert into res values ('b_claim_2', jsonb_build_object('claim', pg_temp.claim((select id from pg_temp.package('package_b')))));
insert into res values ('b_failed', public.record_package_signature((select id from pg_temp.package('package_b')),
  pg_temp.got('b_claim_2', 'claim')::integer, 'retry', null, null, '[]'::jsonb, 'psc_unavailable'));
reset role;
select ok(
  pg_temp.got('b_failed', 'code') = 'failed'
  and (select signature_status = 'failed' from pg_temp.package('package_b'))
  and exists (select 1 from public.case_events where case_id = pg_temp.got('package_b', 'case_id')::uuid
              and kind = 'filing_package_signature_failed'),
  'after its tries the package waits for a person, and the case says so'
);
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('request_again', public.request_package_signature((select id from pg_temp.package('package_b'))));
reset role;
select ok(
  pg_temp.got('request_again', 'code') = 'requested'
  and (select signature_status = 'due' and signature_attempts = 0 from pg_temp.package('package_b')),
  'and a lawyer of the lawsuit asks for it again'
);

-- A claim that never came back, held past the setting's minutes, at its last try.
update public.filing_packages set signature_attempts = 3, signature_claimed_at = now() - interval '20 minutes'
where id = (select id from pg_temp.package('package_b'));
select pg_temp.as_backend();
set local role service_role;
select public.claim_package_signatures(5, (select id from pg_temp.package('package_b')));
reset role;
select ok(
  (select signature_status = 'failed' and signature_error = 'abandoned' and signature_claimed_at is null
   from pg_temp.package('package_b'))
  and exists (select 1 from public.case_events where case_id = pg_temp.got('package_b', 'case_id')::uuid
              and kind = 'filing_package_signature_failed' and data ->> 'code' = 'abandoned'),
  'a claim that never came back spends its try, and after the tries the package waits for a person'
);
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000004');
set local role authenticated;
select public.request_package_signature((select id from pg_temp.package('package_b')));
reset role;

-- A package that no longer says what its lawsuit is (its system changed since it was built): nobody signs it. (Since
-- 0066 a planned lawsuit's system is its court's row, and a change of the row gives up the package; the system is
-- moved here by hand, with those triggers off, to try the signature's own check.)
alter table public.proceedings disable trigger proceedings_court_system;
alter table public.proceedings disable trigger proceedings_system_changed;
update public.proceedings set system = 'eproc' where id = (select proceeding_id from pg_temp.package('package_b'));
select pg_temp.as_backend();
set local role service_role;
insert into res values ('b_outdated_claim', jsonb_build_object('claim', pg_temp.claim((select id from pg_temp.package('package_b')))));
reset role;
select pg_temp.sign_in('a8200000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b_outdated_request', public.request_package_signature((select id from pg_temp.package('package_b'))));
reset role;
update public.proceedings set system = 'projudi' where id = (select proceeding_id from pg_temp.package('package_b'));
alter table public.proceedings enable trigger proceedings_court_system;
alter table public.proceedings enable trigger proceedings_system_changed;
select ok(
  pg_temp.got('b_outdated_claim', 'claim') is null
  and pg_temp.got('b_outdated_request', 'code') = 'package_outdated'
  and (select signature_status = 'due' and signature_claimed_at is null from pg_temp.package('package_b')),
  'a package that no longer says what its lawsuit is is signed by nobody, nor asked for'
);

-- ---------- What a package owes no longer ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('b_claim_3', jsonb_build_object('claim', pg_temp.claim((select id from pg_temp.package('package_b')))));
reset role;
update public.filing_packages set status = 'cancelled' where id = (select id from pg_temp.package('package_b'));
select pg_temp.as_backend();
set local role service_role;
insert into res values ('b_late', public.record_package_signature((select id from pg_temp.package('package_b')),
  pg_temp.got('b_claim_3', 'claim')::integer, 'retry', null, null, '[]'::jsonb, 'psc_unavailable'));
reset role;
select is(pg_temp.got('b_late', 'code'), 'not_working', 'a package no longer built takes nothing a worker brings late');

-- A claim of a package given up meanwhile goes stale at its last try: nothing fails, nothing is told.
update public.filing_packages set signature_claimed_at = now() - interval '20 minutes', signature_attempts = 3
where id = (select id from pg_temp.package('package_b'));
insert into res values ('b_failed_before', jsonb_build_object('n', (
  select count(*) from public.case_events where case_id = pg_temp.got('package_b', 'case_id')::uuid
    and kind = 'filing_package_signature_failed')));
select pg_temp.as_backend();
set local role service_role;
select public.claim_package_signatures(5, (select id from pg_temp.package('package_b')));
reset role;
select ok(
  (select signature_status = 'due' and signature_claimed_at is null from pg_temp.package('package_b'))
  and (select count(*) from public.case_events where case_id = pg_temp.got('package_b', 'case_id')::uuid
         and kind = 'filing_package_signature_failed') = pg_temp.got('b_failed_before', 'n')::integer,
  'a claim that goes stale over a package given up meanwhile fails nothing and tells nothing'
);

select ok(
  pg_temp.got('signed_l', 'code') = 'signed'
  and exists (select 1 from public.files where id = pg_temp.got('p7s_l', 'one')::uuid),
  'signed again by Lucas, the package has its .p7s'
);
select public.drop_filing_package_files((select id from pg_temp.package('package_a')));
select ok(
  not exists (select 1 from public.files where id in (pg_temp.got('p7s_l', 'one')::uuid, pg_temp.got('p7s_l', 'two')::uuid))
  and not exists (select 1 from public.filing_package_items where package_id = (select id from pg_temp.package('package_a'))),
  'a package given up forgets its .p7s with its parts, never the documents'
);
select ok(
  exists (select 1 from public.files where id = pg_temp.got('p7s', 'pdf')::uuid),
  'and a file of the purpose no package named stays for the sweep of parts'
);

-- ---------- Nobody but the backend ----------

select pg_temp.sign_in('a8200000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select * from public.claim_package_signatures(5, null)$$, '42501', null, 'a person claims nothing');
select throws_ok(
  format($$select public.record_package_signature(%L, 1, 'failed')$$, (select id from pg_temp.package('package_a'))),
  '42501', null,
  'nor records a signature'
);
select throws_ok(
  $$update public.filing_packages set signature_status = 'signed', signed_at = now() where true$$,
  '42501', null,
  'nor writes the package'
);
reset role;

select * from finish();
rollback;
