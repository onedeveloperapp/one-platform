begin;
create extension if not exists pgtap;
select plan(4);

-- ============================================================
-- What the backend is handed of an upload of a client's link says the
-- envelope a paper sent back signed belongs to (0281), so the backend reads
-- whether that PDF carries a signature and refuses one with none. Any other
-- upload has none. Firm B's link never reaches firm A's upload.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2810000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@lima-retorno.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a2810000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@rocha-retorno.invalid', '', now(), '{}', '{"display_name":"Duda Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2810000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-retorno', 'a2810000-0000-4000-8000-000000000001'),
  ('b2810000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-retorno', 'a2810000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2810000-0000-4000-8000-00000000000a', 'a2810000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2810000-0000-4000-8000-00000000000b', 'a2810000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2810000-0000-4000-8000-000000000001', 'b2810000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'signature'),
  ('c2810000-0000-4000-8000-000000000002', 'b2810000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'signature');
insert into public.people (id, org_id, full_name) values
  ('d2810000-0000-4000-8000-000000000001', 'b2810000-0000-4000-8000-00000000000a', 'Maria Teste'),
  ('d2810000-0000-4000-8000-000000000002', 'b2810000-0000-4000-8000-00000000000b', 'Paulo Teste');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e2810000-0000-4000-8000-000000000001', 'b2810000-0000-4000-8000-00000000000a', 'c2810000-0000-4000-8000-000000000001',
   'd2810000-0000-4000-8000-000000000001', 'claimant'),
  ('e2810000-0000-4000-8000-000000000002', 'b2810000-0000-4000-8000-00000000000b', 'c2810000-0000-4000-8000-000000000002',
   'd2810000-0000-4000-8000-000000000002', 'claimant');
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at) values
  ('f2810000-0000-4000-8000-000000000001', 'b2810000-0000-4000-8000-00000000000a', 'c2810000-0000-4000-8000-000000000001',
   'd2810000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-0281-maria-assinatura-1234567890', 'UTF8')), 'hex'),
   now() + interval '30 days'),
  ('f2810000-0000-4000-8000-000000000002', 'b2810000-0000-4000-8000-00000000000b', 'c2810000-0000-4000-8000-000000000002',
   'd2810000-0000-4000-8000-000000000002', encode(sha256(convert_to('token-0281-paulo-assinatura-1234567890', 'UTF8')), 'hex'),
   now() + interval '30 days');

-- Firm A's power of attorney, issued and sent to be signed at gov.br; and a photo of an identity the client is sending.
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('92810000-0000-4000-8000-000000000001', 'b2810000-0000-4000-8000-00000000000a', 'upload',
   'org/b2810000-0000-4000-8000-00000000000a/upload/92810000-0000-4000-8000-000000000001', 'procuracao.pdf', 'application/pdf',
   4000, 'stored', repeat('1', 64), 4000, 'application/pdf', now() + interval '1 hour', now());
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, expires_at) values
  ('92810000-0000-4000-8000-000000000002', 'b2810000-0000-4000-8000-00000000000a', 'upload',
   'org/b2810000-0000-4000-8000-00000000000a/upload/92810000-0000-4000-8000-000000000002', 'identidade.jpg', 'image/jpeg',
   3000, 'reserved', now() + interval '1 hour');
insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status, decided_at) values
  ('72810000-0000-4000-8000-000000000001', 'b2810000-0000-4000-8000-00000000000a', 'c2810000-0000-4000-8000-000000000001',
   'e2810000-0000-4000-8000-000000000001', '92810000-0000-4000-8000-000000000001', 'power_of_attorney', 'firm', 'accepted', now());
insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, link_id, status) values
  ('72810000-0000-4000-8000-000000000002', 'b2810000-0000-4000-8000-00000000000a', 'c2810000-0000-4000-8000-000000000001',
   'e2810000-0000-4000-8000-000000000001', '92810000-0000-4000-8000-000000000002', 'identity', 'client',
   'f2810000-0000-4000-8000-000000000001', 'uploading');
insert into public.signature_envelopes (id, org_id, case_id, document_id, method, status, signers) values
  ('62810000-0000-4000-8000-000000000001', 'b2810000-0000-4000-8000-00000000000a', 'c2810000-0000-4000-8000-000000000001',
   '72810000-0000-4000-8000-000000000001', 'govbr', 'pending',
   '[{"position": 1, "person_id": "d2810000-0000-4000-8000-000000000001", "name": "Maria Teste"}]');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

-- Maria sends back, on her link, what she says is the PDF she signed.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
insert into res values ('signed_back', public.client_link_reserve_signed('token-0281-maria-assinatura-1234567890',
  '62810000-0000-4000-8000-000000000001', 'procuracao-assinada.pdf', 'application/pdf', 7000));
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('returned', public.client_link_upload_to_finish('token-0281-maria-assinatura-1234567890',
  ((select payload ->> 'document_id' from res where name = 'signed_back'))::uuid));
insert into res values ('identity', public.client_link_upload_to_finish('token-0281-maria-assinatura-1234567890',
  '72810000-0000-4000-8000-000000000002'));
insert into res values ('other_link', public.client_link_upload_to_finish('token-0281-paulo-assinatura-1234567890',
  ((select payload ->> 'document_id' from res where name = 'signed_back'))::uuid));
reset role;

select is((select payload ->> 'envelope_id' from res where name = 'returned'), '62810000-0000-4000-8000-000000000001',
  'a paper sent back for signing says its envelope, for the backend to read whether it is signed');
select ok((select payload ? 'envelope_id' and payload ->> 'envelope_id' is null and payload ->> 'kind' = 'identity'
           from res where name = 'identity'),
  'any other upload belongs to no envelope');
select is((select payload ->> 'code' from res where name = 'other_link'), 'not_found',
  'firm B''s link is never handed firm A''s upload');
select ok(
  not has_function_privilege('anon', 'public.client_link_upload_to_finish(text, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.client_link_upload_to_finish(text, uuid)', 'EXECUTE'),
  'only the backend is handed what it reads of an upload');

select * from finish();
rollback;
