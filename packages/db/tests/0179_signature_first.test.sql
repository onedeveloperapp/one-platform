begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- The new order (0181): the power of attorney is due once the person's
-- identity and proof of address were accepted, before "Terminei"; what ONE
-- asks after the signature (the interview, the dispensable documents) waits
-- for it where ONE sends the papers, and a firm that keeps the papers to a
-- person asks as before. Two firms: nothing of one reaches the other.
--
-- Every person, firm and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1790000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-ordem.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1790000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-ordem.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1790000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-ordem', 'a1790000-0000-4000-8000-000000000001'),
  ('b1790000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-ordem', 'a1790000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1790000-0000-4000-8000-00000000000a', 'a1790000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1790000-0000-4000-8000-00000000000b', 'a1790000-0000-4000-8000-000000000002', 'owner', 'socio');
-- Firm B keeps the papers to a person.
insert into public.firm_autonomy (org_id, decision, mode) values
  ('b1790000-0000-4000-8000-00000000000b', 'send_signature_papers', 'approval');

insert into public.people (id, org_id, full_name, birth_date) values
  ('d1790000-0000-4000-8000-000000000001', 'b1790000-0000-4000-8000-00000000000a', 'Maria Teste', date '1990-04-02'),
  ('d1790000-0000-4000-8000-000000000002', 'b1790000-0000-4000-8000-00000000000b', 'Joana Teste', date '1988-01-15');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1790000-0000-4000-8000-000000000001', 'b1790000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'documents'),
  ('c1790000-0000-4000-8000-000000000002', 'b1790000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'documents');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1790000-0000-4000-8000-000000000001', 'b1790000-0000-4000-8000-00000000000a', 'c1790000-0000-4000-8000-000000000001', 'd1790000-0000-4000-8000-000000000001', 'claimant'),
  ('e1790000-0000-4000-8000-000000000002', 'b1790000-0000-4000-8000-00000000000b', 'c1790000-0000-4000-8000-000000000002', 'd1790000-0000-4000-8000-000000000002', 'claimant');
insert into public.client_links (org_id, case_id, person_id, token_hash, expires_at) values
  ('b1790000-0000-4000-8000-00000000000a', 'c1790000-0000-4000-8000-000000000001', 'd1790000-0000-4000-8000-000000000001',
   encode(sha256(convert_to('token-da-ordem-a', 'UTF8')), 'hex'), now() + interval '30 days'),
  ('b1790000-0000-4000-8000-00000000000b', 'c1790000-0000-4000-8000-000000000002', 'd1790000-0000-4000-8000-000000000002',
   encode(sha256(convert_to('token-da-ordem-b', 'UTF8')), 'hex'), now() + interval '30 days');

create function pg_temp.doc(target_org uuid, target_case uuid, target_party uuid, target_kind text, target_status text)
returns uuid language plpgsql as $$
declare
  file uuid := gen_random_uuid();
  made uuid := gen_random_uuid();
begin
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
    detected_mime, expires_at, confirmed_at)
  values (file, target_org, 'upload', 'org/' || target_org || '/upload/' || file, target_kind || '.pdf', 'application/pdf', 100,
    'stored', repeat('e', 64), 100, 'application/pdf', now() + interval '1 hour', now());
  insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status, party_id)
  values (made, target_org, target_case, file, target_kind, 'firm', target_status, target_party);
  return made;
end;
$$;

select ok(
  not exists (select 1 from public.case_papers_due('c1790000-0000-4000-8000-000000000001') d where d.kind = 'procuracao')
  and public.case_waits_signature('c1790000-0000-4000-8000-000000000001')
  and not public.interview_owed('c1790000-0000-4000-8000-000000000001')
  and (select bool_and(d ->> 'state' = 'later') from jsonb_array_elements(public.case_dispensables('c1790000-0000-4000-8000-000000000001')) d),
  'before the documents, no paper is due, and the interview and the dispensables wait for the signature'
);

select pg_temp.doc('b1790000-0000-4000-8000-00000000000a', 'c1790000-0000-4000-8000-000000000001',
  'e1790000-0000-4000-8000-000000000001', 'identity', 'accepted');
select pg_temp.doc('b1790000-0000-4000-8000-00000000000a', 'c1790000-0000-4000-8000-000000000001',
  'e1790000-0000-4000-8000-000000000001', 'address_proof', 'accepted');

select ok(
  exists (select 1 from public.case_papers_due('c1790000-0000-4000-8000-000000000001') d
          where d.kind = 'procuracao' and d.person_id = 'd1790000-0000-4000-8000-000000000001')
  and public.case_waits_signature('c1790000-0000-4000-8000-000000000001'),
  'once the identity and the proof of address are accepted, the power of attorney is due, before the client finished'
);

-- The power of attorney comes back signed.
do $$
declare
  issued uuid := pg_temp.doc('b1790000-0000-4000-8000-00000000000a', 'c1790000-0000-4000-8000-000000000001',
    'e1790000-0000-4000-8000-000000000001', 'power_of_attorney', 'accepted');
  signed uuid := pg_temp.doc('b1790000-0000-4000-8000-00000000000a', 'c1790000-0000-4000-8000-000000000001',
    'e1790000-0000-4000-8000-000000000001', 'power_of_attorney', 'accepted');
  envelope uuid := gen_random_uuid();
begin
  insert into public.signature_envelopes (id, org_id, case_id, document_id, method, status, signers, signed_document_id)
  values (envelope, 'b1790000-0000-4000-8000-00000000000a', 'c1790000-0000-4000-8000-000000000001', issued, 'govbr', 'signed',
    jsonb_build_array(jsonb_build_object('position', 1, 'person_id', 'd1790000-0000-4000-8000-000000000001', 'name', 'Maria Teste')),
    signed);
  insert into public.case_papers (org_id, case_id, person_id, kind, document_id, envelope_id)
  values ('b1790000-0000-4000-8000-00000000000a', 'c1790000-0000-4000-8000-000000000001',
    'd1790000-0000-4000-8000-000000000001', 'procuracao', issued, envelope);
end;
$$;

select ok(
  not public.case_waits_signature('c1790000-0000-4000-8000-000000000001')
  and public.case_signed_at('c1790000-0000-4000-8000-000000000001') is not null
  and (select bool_and(d ->> 'state' = 'asked') from jsonb_array_elements(public.case_dispensables('c1790000-0000-4000-8000-000000000001')) d),
  'once signed, ONE asks the rest: the dispensables are asked, counted from the signature'
);

select ok(
  not public.case_waits_signature('c1790000-0000-4000-8000-000000000002')
  and (select bool_and(d ->> 'state' = 'asked') from jsonb_array_elements(public.case_dispensables('c1790000-0000-4000-8000-000000000002')) d)
  and (public.firm_signs_first('b1790000-0000-4000-8000-00000000000a') ->> 'signs_first')::boolean
  and not (public.firm_signs_first('b1790000-0000-4000-8000-00000000000b') ->> 'signs_first')::boolean,
  'a firm that keeps the papers to a person asks as before, and the passenger is told the order of each firm'
);

select ok(
  not has_function_privilege('authenticated', 'public.firm_signs_first(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.case_waits_signature(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.case_papers_due(uuid)', 'EXECUTE'),
  'the order is read by the database and the backend alone'
);

select * from finish();
rollback;
