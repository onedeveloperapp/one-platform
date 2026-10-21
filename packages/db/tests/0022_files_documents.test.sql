begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- ============================================================
-- The firm's files and the documents ONE issues (0018).
--
-- A person of the firm reserves an upload; the backend measures what arrived
-- and keeps it or rejects it, by the type its bytes say and the size the
-- setting allows. A document is issued as a version with a public code, once
-- per request, by one renderer at a time; anyone holding it can check the
-- code without seeing its content; it is revoked, never deleted. Two firms:
-- neither reaches a file or a document of the other.
--
-- Every person, firm and document here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a8000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a8000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bruno@souza.invalid', '', now(), '{}', '{"display_name":"Bruno Lima"}', now(), now()),
  ('a8000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'carla@souza.invalid', '', now(), '{}', '{"display_name":"Carla Dias"}', now(), now()),
  ('a8000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('a8000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a8000000-0000-4000-8000-000000000009';

-- Firm A: Ana (owner, sócia), Bruno (atendimento), Carla (advogada). Firm B: Davi (owner, advogado).
insert into public.organizations (id, name, slug, created_by) values
  ('b8000000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'a8000000-0000-4000-8000-000000000001'),
  ('b8000000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'a8000000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b8000000-0000-4000-8000-00000000000a', 'a8000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b8000000-0000-4000-8000-00000000000a', 'a8000000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b8000000-0000-4000-8000-00000000000a', 'a8000000-0000-4000-8000-000000000003', 'member', 'advogado'),
  ('b8000000-0000-4000-8000-00000000000b', 'a8000000-0000-4000-8000-000000000004', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

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

create function pg_temp.id_of(name text, field text default 'file_id') returns uuid language sql as
$$ select (payload ->> id_of.field)::uuid from res where res.name = id_of.name; $$;

-- ---------- Reserving an upload ----------

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('upload', public.reserve_file_upload('b8000000-0000-4000-8000-00000000000a', 'upload', 'RG da cliente.pdf', 'application/pdf', 1048576));
select is(
  array[
    public.reserve_file_upload('b8000000-0000-4000-8000-00000000000a', 'upload', 'pagina.html', 'text/html', 100) ->> 'code',
    public.reserve_file_upload('b8000000-0000-4000-8000-00000000000a', 'upload', 'grande.pdf', 'application/pdf', 41943040) ->> 'code',
    public.reserve_file_upload('b8000000-0000-4000-8000-00000000000a', 'upload', '   ', 'application/pdf', 100) ->> 'code',
    public.reserve_file_upload('b8000000-0000-4000-8000-00000000000a', 'upload', 'vazio.pdf', 'application/pdf', 0) ->> 'code',
    public.reserve_file_upload('b8000000-0000-4000-8000-00000000000a', 'outra-coisa', 'x.pdf', 'application/pdf', 100) ->> 'code',
    public.reserve_file_upload('b8000000-0000-4000-8000-00000000000a', 'issued', 'x.pdf', 'application/pdf', 100) ->> 'code'
  ],
  array['type_not_allowed', 'too_large', 'invalid_name', 'invalid_size', 'unknown_purpose', 'purpose_not_allowed'],
  'what may be uploaded, how large, and for what is the setting''s, and a person never uploads what ONE issues'
);
reset role;

select ok(
  (select payload ->> 'code' = 'reserved'
          and payload ->> 'storage_path' = 'org/b8000000-0000-4000-8000-00000000000a/upload/' || (payload ->> 'file_id')
          and (payload ->> 'expires_at')::timestamptz > now()
   from res where name = 'upload')
  and (select status = 'reserved' and uploaded_by = 'a8000000-0000-4000-8000-000000000002' and name = 'RG da cliente.pdf'
       from public.files where id = pg_temp.id_of('upload')),
  'a person of the firm reserves an upload under the firm''s folder, for a limited time'
);
select ok(
  exists (select 1 from public.audit_events where action = 'file.reserved' and actor_type = 'person'
          and entity_id = pg_temp.id_of('upload')::text),
  'the reservation is audited'
);

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.reserve_file_upload('b8000000-0000-4000-8000-00000000000a', 'upload', 'x.pdf', 'application/pdf', 100)$$,
  '42501', 'not_authorized',
  'nobody uploads into another firm'
);
insert into res values ('upload_b', public.reserve_file_upload('b8000000-0000-4000-8000-00000000000b', 'upload', 'Contrato.pdf', 'application/pdf', 2048));
reset role;

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a8000000-0000-4000-8000-000000000009', 'a8000000-0000-4000-8000-000000000002', 'b8000000-0000-4000-8000-00000000000a',
        'Conferindo os arquivos', 'f8000000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a8000000-0000-4000-8000-000000000002', 'aal2', 'f8000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.reserve_file_upload('b8000000-0000-4000-8000-00000000000a', 'upload', 'x.pdf', 'application/pdf', 100)$$,
  '42501', 'not_allowed_in_support_session',
  'nor from a support visit'
);
reset role;

-- ---------- Confirming what arrived ----------

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  format($$select public.confirm_file(%L, %L, 100, 'application/pdf')$$, pg_temp.id_of('upload'), repeat('a', 64)),
  '42501', null,
  'a person does not confirm a file: the backend measures it'
);
select throws_ok(
  $$update public.files set status = 'stored' where true$$,
  '42501', null,
  'nor writes the record of a file'
);
reset role;

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('fake_type', public.reserve_file_upload('b8000000-0000-4000-8000-00000000000a', 'upload', 'foto.jpg', 'image/jpeg', 5000));
insert into res values ('big', public.reserve_file_upload('b8000000-0000-4000-8000-00000000000a', 'upload', 'scan.pdf', 'application/pdf', 5000));
reset role;

select pg_temp.as_backend();
set local role service_role;
select throws_ok(
  format($$select public.confirm_file(%L, 'nao-e-hash', 100, 'application/pdf')$$, pg_temp.id_of('upload')),
  '22023', 'invalid_measure',
  'a measure is a SHA-256 and a size'
);
insert into res values ('confirmed', public.confirm_file(pg_temp.id_of('upload'), repeat('a', 64), 1048000, 'application/pdf', 3));
insert into res values ('confirmed_again', public.confirm_file(pg_temp.id_of('upload'), repeat('a', 64), 1048000, 'application/pdf', 3));
insert into res values ('confirmed_other', public.confirm_file(pg_temp.id_of('upload'), repeat('b', 64), 1048000, 'application/pdf', 3));
insert into res values ('rejected_type', public.confirm_file(pg_temp.id_of('fake_type'), repeat('c', 64), 5000, 'text/html'));
insert into res values ('rejected_size', public.confirm_file(pg_temp.id_of('big'), repeat('d', 64), 41943040, 'application/pdf'));
reset role;

select ok(
  (select payload ->> 'code' = 'stored' from res where name = 'confirmed')
  and (select status = 'stored' and sha256 = repeat('a', 64) and bytes = 1048000 and detected_mime = 'application/pdf'
              and pages = 3 and confirmed_at is not null
       from public.files where id = pg_temp.id_of('upload')),
  'the backend keeps what arrived with its hash, size, type and pages'
);
select ok(
  (select (payload ->> 'ok')::boolean and payload ->> 'code' = 'stored' from res where name = 'confirmed_again')
  and (select not (payload ->> 'ok')::boolean and payload ->> 'code' = 'already_stored' from res where name = 'confirmed_other'),
  'a file is confirmed once: the same measure again is an answer, another one is refused'
);
select ok(
  (select payload ->> 'code' = 'rejected' and payload ->> 'reason' = 'type_not_allowed' from res where name = 'rejected_type')
  and (select payload ->> 'reason' = 'too_large' from res where name = 'rejected_size')
  and (select status = 'rejected' and sha256 is null and rejected_reason = 'type_not_allowed'
       from public.files where id = pg_temp.id_of('fake_type')),
  'a file whose bytes are of another type than declared, or larger than allowed, is rejected'
);
select ok(
  exists (select 1 from public.audit_events where action = 'file.stored' and entity_id = pg_temp.id_of('upload')::text)
  and exists (select 1 from public.audit_events where action = 'file.rejected' and entity_id = pg_temp.id_of('fake_type')::text
              and metadata ->> 'reason' = 'type_not_allowed'),
  'both outcomes are audited'
);

-- ---------- Who sees the files ----------

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000003');
set local role authenticated;
select is((select count(*)::int from public.files), 3, 'the people of the firm see its files');
reset role;

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000004');
set local role authenticated;
select is(
  (select array_agg(name) from public.files), array['Contrato.pdf'],
  'the owner of the other firm sees only their own'
);
reset role;

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000009');
set local role authenticated;
select is((select count(*)::int from public.files), 0, 'the platform operator reads no firm''s files');
reset role;

-- ---------- The backend's own files ----------

select pg_temp.as_backend();
set local role service_role;
select is(
  public.reserve_file('b8000000-0000-4000-8000-00000000000a', 'issued', 'procuracao.pdf', 'application/pdf', 4096,
                      'a8000000-0000-4000-8000-000000000004') ->> 'code',
  'requester_not_in_firm',
  'the backend reserves for a person of the firm, never of another'
);
insert into res values ('issued_file', public.reserve_file('b8000000-0000-4000-8000-00000000000a', 'issued', 'procuracao.pdf', 'application/pdf', 4096, 'a8000000-0000-4000-8000-000000000003'));
insert into res values ('issued_file_confirmed', public.confirm_file(pg_temp.id_of('issued_file'), repeat('e', 64), 4096, 'application/pdf', 1));
insert into res values ('issued_file_2', public.reserve_file('b8000000-0000-4000-8000-00000000000a', 'issued', 'procuracao-v2.pdf', 'application/pdf', 4096));
select public.confirm_file(pg_temp.id_of('issued_file_2'), repeat('f', 64), 4096, 'application/pdf', 1);
insert into res values ('issued_file_b', public.reserve_file('b8000000-0000-4000-8000-00000000000b', 'issued', 'contrato.pdf', 'application/pdf', 4096));
select public.confirm_file(pg_temp.id_of('issued_file_b'), repeat('9', 64), 4096, 'application/pdf', 1);
reset role;

select ok(
  (select payload ->> 'code' = 'stored' from res where name = 'issued_file_confirmed')
  and (select purpose = 'issued' and status = 'stored' and storage_path like 'org/b8000000-0000-4000-8000-00000000000a/issued/%'
       from public.files where id = pg_temp.id_of('issued_file')),
  'what ONE issues is kept the same way, under its own purpose'
);

-- ---------- The upkeep of the bucket ----------

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('abandoned', public.reserve_file_upload('b8000000-0000-4000-8000-00000000000a', 'upload', 'nunca.pdf', 'application/pdf', 100));
reset role;
update public.files set expires_at = now() - interval '1 minute' where id = pg_temp.id_of('abandoned');

insert into storage.objects (bucket_id, name, created_at) values
  ('firm-files', (select storage_path from public.files where id = pg_temp.id_of('upload')), now() - interval '2 hours'),
  ('firm-files', (select storage_path from public.files where id = pg_temp.id_of('fake_type')), now() - interval '2 hours'),
  ('firm-files', 'org/b8000000-0000-4000-8000-00000000000a/upload/sem-registro', now() - interval '2 hours'),
  ('firm-files', 'org/b8000000-0000-4000-8000-00000000000a/upload/acabou-de-chegar', now()),
  ('firm-files', (select storage_path from public.files where id = pg_temp.id_of('upload_b')), now() - interval '2 hours');

select pg_temp.as_backend();
set local role service_role;
insert into res values ('expired', to_jsonb(public.expire_file_reservations()));
insert into res values ('expired_again', to_jsonb(public.expire_file_reservations()));
insert into res values ('orphans', to_jsonb(public.orphaned_firm_files(100)));
reset role;

select ok(
  (select payload = '1'::jsonb from res where name = 'expired')
  and (select payload = '0'::jsonb from res where name = 'expired_again')
  and not exists (select 1 from public.files where id = pg_temp.id_of('abandoned'))
  and exists (select 1 from public.audit_events where action = 'file.expired' and entity_id = pg_temp.id_of('abandoned')::text),
  'a reservation whose time ended without an upload is removed, once'
);
select is(
  (select array_agg(item order by item) from res, jsonb_array_elements_text(payload) as item where name = 'orphans'),
  (select array_agg(path order by path) from unnest(array[
    'org/b8000000-0000-4000-8000-00000000000a/upload/sem-registro',
    (select storage_path from public.files where id = pg_temp.id_of('fake_type'))
  ]) as path),
  'the objects nothing keeps (no record, or a rejected one) are handed over for removal; a fresh upload is left alone'
);

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.orphaned_firm_files(10)$$, '42501', null, 'only the backend sweeps the bucket');
reset role;

select is(
  (select array_agg(path order by path) from public.account_deletion_storage(array['b8000000-0000-4000-8000-00000000000b'::uuid], null)),
  array[(select storage_path from public.files where id = pg_temp.id_of('upload_b'))]::text[],
  'deleting a firm lists its files for removal, and only its files'
);

-- ---------- Issuing a document ----------

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.reserve_document('b8000000-0000-4000-8000-00000000000a', 'procuracao', 'Procuração', 'chave-0001', 'ABCDEFGHJKMN')$$,
  '42501', null,
  'a person does not issue directly: the backend does, for the firm'
);
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('doc', public.reserve_document(
  'b8000000-0000-4000-8000-00000000000a', 'procuracao', 'Procuração de Maria Teste', 'chave-0001', 'ABCDEFGHJKMN',
  null, 'a8000000-0000-4000-8000-000000000003'));
insert into res values ('doc_again', public.reserve_document(
  'b8000000-0000-4000-8000-00000000000a', 'procuracao', 'Outro título', 'chave-0001', 'PQRSTUVWXYZ2'));
insert into res values ('claim_1', public.claim_document(pg_temp.id_of('doc', 'document_id'), 'c8000000-0000-4000-8000-000000000001'));
insert into res values ('claim_2', public.claim_document(pg_temp.id_of('doc', 'document_id'), 'c8000000-0000-4000-8000-000000000002'));
insert into res values ('publish_lost', public.publish_document(
  pg_temp.id_of('doc', 'document_id'), 'c8000000-0000-4000-8000-000000000002', pg_temp.id_of('issued_file')));
insert into res values ('publish_upload', public.publish_document(
  pg_temp.id_of('doc', 'document_id'), 'c8000000-0000-4000-8000-000000000001', pg_temp.id_of('upload')));
insert into res values ('publish_other_firm', public.publish_document(
  pg_temp.id_of('doc', 'document_id'), 'c8000000-0000-4000-8000-000000000001', pg_temp.id_of('issued_file_b')));
insert into res values ('published', public.publish_document(
  pg_temp.id_of('doc', 'document_id'), 'c8000000-0000-4000-8000-000000000001', pg_temp.id_of('issued_file')));
insert into res values ('published_again', public.publish_document(
  pg_temp.id_of('doc', 'document_id'), 'c8000000-0000-4000-8000-000000000001', pg_temp.id_of('issued_file')));
reset role;

select ok(
  (select payload ->> 'code' = 'reserved' and (payload ->> 'version')::int = 1 and payload ->> 'status' = 'draft' from res where name = 'doc')
  and (select payload ->> 'code' = 'existing' and payload ->> 'verify_code' = 'ABCDEFGHJKMN'
              and pg_temp.id_of('doc_again', 'document_id') = pg_temp.id_of('doc', 'document_id')
       from res where name = 'doc_again'),
  'the same request is one version, with the code it was given first'
);
select is(
  array[
    (select payload ->> 'code' from res where name = 'claim_1'),
    (select payload ->> 'code' from res where name = 'claim_2'),
    (select payload ->> 'code' from res where name = 'publish_lost')
  ],
  array['claimed', 'busy', 'claim_lost'],
  'one renderer at a time: a second one is told the draft is busy, and cannot publish'
);
select is(
  array[
    (select payload ->> 'code' from res where name = 'publish_upload'),
    (select payload ->> 'code' from res where name = 'publish_other_firm')
  ],
  array['invalid_file', 'invalid_file'],
  'what is published is a PDF ONE stored for this firm, never an upload or a file of another firm'
);
select ok(
  (select payload ->> 'code' = 'issued' from res where name = 'published')
  and (select (payload ->> 'ok')::boolean and payload ->> 'code' = 'already_issued' from res where name = 'published_again')
  and (select status = 'issued' and content_hash = repeat('e', 64) and file_id = pg_temp.id_of('issued_file')
              and issued_at is not null and claim_token is null
       from public.issued_documents where id = pg_temp.id_of('doc', 'document_id')),
  'the version is issued with its file and the hash of its bytes, once'
);
select ok(
  exists (select 1 from public.audit_events where action = 'document.issued'
          and entity_id = pg_temp.id_of('doc', 'document_id')::text and metadata ->> 'hash' = repeat('e', 64)),
  'issuing is audited'
);

-- ---------- Verifying a code ----------

set local role anon;
insert into res values ('verified', public.verify_document('abcd-efgh-jkmn'));
insert into res values ('unknown', public.verify_document('ZZZZZZZZZZZZ'));
insert into res values ('garbage', public.verify_document('<script>'));
reset role;

select ok(
  (select payload ->> 'found' = 'true' and payload ->> 'status' = 'issued' and payload ->> 'kind' = 'procuracao'
          and (payload ->> 'version')::int = 1 and payload ->> 'firm' = 'Souza Advogados'
          and payload ->> 'contentHash' = repeat('e', 64)
   from res where name = 'verified'),
  'anyone holding the document checks its code, typed as it is printed, and learns who issued it and its hash'
);
select ok(
  (select not (payload ? 'title') and payload::text not like '%Maria Teste%' from res where name = 'verified'),
  'and nothing of its content'
);
select ok(
  (select payload = '{"found": false}'::jsonb from res where name = 'unknown')
  and (select payload = '{"found": false}'::jsonb from res where name = 'garbage'),
  'a code that does not exist, or is not a code, finds nothing'
);

-- ---------- A new version ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('draft_b', public.reserve_document(
  'b8000000-0000-4000-8000-00000000000b', 'procuracao', 'Procuração B', 'chave-0002', 'BCDEFGHJKMNP'));
insert into res values ('v2', public.reserve_document(
  'b8000000-0000-4000-8000-00000000000a', 'procuracao', 'Procuração de Maria Teste', 'chave-0003', 'CDEFGHJKMNPQ',
  pg_temp.id_of('doc', 'document_id')));
insert into res values ('v2_twice', public.reserve_document(
  'b8000000-0000-4000-8000-00000000000a', 'procuracao', 'Outra', 'chave-0004', 'DEFGHJKMNPQR',
  pg_temp.id_of('doc', 'document_id')));
insert into res values ('v2_kind', public.reserve_document(
  'b8000000-0000-4000-8000-00000000000a', 'contrato', 'Contrato', 'chave-0005', 'EFGHJKMNPQRS',
  pg_temp.id_of('doc', 'document_id')));
insert into res values ('v2_firm', public.reserve_document(
  'b8000000-0000-4000-8000-00000000000b', 'procuracao', 'De outra firma', 'chave-0006', 'FGHJKMNPQRST',
  pg_temp.id_of('doc', 'document_id')));
insert into res values ('v2_draft', public.reserve_document(
  'b8000000-0000-4000-8000-00000000000b', 'procuracao', 'Após rascunho', 'chave-0007', 'GHJKMNPQRSTU',
  pg_temp.id_of('draft_b', 'document_id')));
select public.claim_document(pg_temp.id_of('v2', 'document_id'), 'c8000000-0000-4000-8000-000000000003');
select public.publish_document(pg_temp.id_of('v2', 'document_id'), 'c8000000-0000-4000-8000-000000000003', pg_temp.id_of('issued_file_2'));
reset role;

select is(
  array[
    (select payload ->> 'version' from res where name = 'v2'),
    (select payload ->> 'code' from res where name = 'v2_twice'),
    (select payload ->> 'code' from res where name = 'v2_kind'),
    (select payload ->> 'code' from res where name = 'v2_firm'),
    (select payload ->> 'code' from res where name = 'v2_draft')
  ],
  array['2', 'previous_already_followed', 'previous_not_found', 'previous_not_found', 'previous_not_issued'],
  'a version follows one issued version of the same firm and kind, and only one version follows it'
);

set local role anon;
insert into res values ('verified_v1', public.verify_document('ABCDEFGHJKMN'));
reset role;
select is(
  (select (payload ->> 'replacedByVersion')::int from res where name = 'verified_v1'), 2,
  'the old version says a newer one replaced it'
);

set local role anon;
select is(
  public.verify_document('BCDEFGHJKMNP'), '{"found": false}'::jsonb,
  'a draft is never found'
);
reset role;

-- ---------- Revoking ----------

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  format($$select public.revoke_document(%L, 'Emitida por engano.')$$, pg_temp.id_of('v2', 'document_id')),
  '42501', 'not_authorized',
  'atendimento does not revoke a document'
);
reset role;

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000003', 'aal1');
set local role authenticated;
select throws_ok(
  format($$select public.revoke_document(%L, 'Emitida por engano.')$$, pg_temp.id_of('v2', 'document_id')),
  '42501', 'second_factor_required',
  'revoking asks for the second factor'
);
reset role;

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000004');
set local role authenticated;
select is(
  public.revoke_document(pg_temp.id_of('v2', 'document_id'), 'Emitida por engano.') ->> 'code', 'not_found',
  'a document of another firm does not exist for its owner'
);
reset role;

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000003');
set local role authenticated;
select is(public.revoke_document(pg_temp.id_of('v2', 'document_id'), 'erro') ->> 'code', 'reason_required', 'a revocation says why');
insert into res values ('revoked', public.revoke_document(pg_temp.id_of('v2', 'document_id'), 'Emitida com o endereço errado.'));
insert into res values ('revoked_again', public.revoke_document(pg_temp.id_of('v2', 'document_id'), 'Emitida com o endereço errado.'));
select throws_ok(
  $$update public.issued_documents set status = 'issued' where true$$,
  '42501', null,
  'and nobody writes a document directly'
);
reset role;

select ok(
  (select payload ->> 'code' = 'revoked' from res where name = 'revoked')
  and (select payload ->> 'code' = 'already_revoked' from res where name = 'revoked_again')
  and (select status = 'revoked' and revoked_by = 'a8000000-0000-4000-8000-000000000003' and revoke_reason = 'Emitida com o endereço errado.'
       from public.issued_documents where id = pg_temp.id_of('v2', 'document_id')),
  'an advogada of the firm revokes it, with a reason'
);
select ok(
  exists (select 1 from public.audit_events where action = 'document.revoked' and actor_type = 'person'
          and entity_id = pg_temp.id_of('v2', 'document_id')::text),
  'revoking is audited as done by the person'
);

set local role anon;
insert into res values ('verified_revoked', public.verify_document('CDEFGHJKMNPQ'));
insert into res values ('verified_v1_after', public.verify_document('ABCDEFGHJKMN'));
reset role;

select ok(
  (select payload ->> 'status' = 'revoked' and payload ->> 'revokedAt' is not null from res where name = 'verified_revoked')
  and (select payload ->> 'replacedByVersion' is null from res where name = 'verified_v1_after'),
  'the verification says it was revoked, and a revoked version replaces nothing'
);

-- ---------- Releasing a claim ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('d3', public.reserve_document(
  'b8000000-0000-4000-8000-00000000000a', 'contrato', 'Contrato de teste', 'chave-0008', 'HJKMNPQRSTUV'));
select public.claim_document(pg_temp.id_of('d3', 'document_id'), 'c8000000-0000-4000-8000-000000000004');
select public.release_document(pg_temp.id_of('d3', 'document_id'), 'c8000000-0000-4000-8000-000000000005');
insert into res values ('d3_busy', public.claim_document(pg_temp.id_of('d3', 'document_id'), 'c8000000-0000-4000-8000-000000000006'));
select public.release_document(pg_temp.id_of('d3', 'document_id'), 'c8000000-0000-4000-8000-000000000004');
insert into res values ('d3_free', public.claim_document(pg_temp.id_of('d3', 'document_id'), 'c8000000-0000-4000-8000-000000000006'));
reset role;

select is(
  array[(select payload ->> 'code' from res where name = 'd3_busy'), (select payload ->> 'code' from res where name = 'd3_free')],
  array['busy', 'claimed'],
  'only the renderer that holds a claim releases it, and then a retry takes it'
);

-- ---------- A file nothing refers to ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('spare', public.reserve_file('b8000000-0000-4000-8000-00000000000a', 'issued', 'sobra.pdf', 'application/pdf', 4096));
select public.confirm_file(pg_temp.id_of('spare'), repeat('7', 64), 4096, 'application/pdf', 1);
insert into res values ('discard_used', public.discard_file(pg_temp.id_of('issued_file')));
insert into res values ('discard_spare', public.discard_file(pg_temp.id_of('spare')));
reset role;

select ok(
  (select payload ->> 'code' = 'in_use' from res where name = 'discard_used')
  and exists (select 1 from public.files where id = pg_temp.id_of('issued_file'))
  and (select payload ->> 'code' = 'discarded' from res where name = 'discard_spare')
  and not exists (select 1 from public.files where id = pg_temp.id_of('spare'))
  and exists (select 1 from public.audit_events where action = 'file.discarded' and entity_id = pg_temp.id_of('spare')::text),
  'the file of a render that was not published is forgotten; one a document names never is'
);

-- ---------- Who sees the documents ----------

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select count(*)::int from public.issued_documents), 3, 'the people of the firm see its documents');
reset role;

select pg_temp.sign_in('a8000000-0000-4000-8000-000000000004');
set local role authenticated;
select is(
  (select array_agg(title) from public.issued_documents), array['Procuração B'],
  'the other firm sees only its own'
);
reset role;

-- ---------- The firm goes ----------

-- The deletion of a firm is the platform's (0013): no session here.
select set_config('request.jwt.claims', '', true);
delete from public.organizations where id = 'b8000000-0000-4000-8000-00000000000a';
select ok(
  not exists (select 1 from public.files where org_id = 'b8000000-0000-4000-8000-00000000000a')
  and not exists (select 1 from public.issued_documents where org_id = 'b8000000-0000-4000-8000-00000000000a')
  and exists (select 1 from public.files where org_id = 'b8000000-0000-4000-8000-00000000000b'),
  'deleting a firm removes its files and documents, and nothing of the other firm'
);

select * from finish();
rollback;
