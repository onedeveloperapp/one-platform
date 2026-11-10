begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- Os documentos do cliente que volta (0157). Maria had a case at Lima, with
-- her identity and a proof of address accepted 10 days ago; João had one
-- with a proof of address accepted 200 days ago. Each comes back with a new
-- case being gathered: Maria's identity and proof are owed in hers (her
-- second new case already has an identity of its own, so only the proof);
-- João's identity only. A test case's documents never reach a real case.
-- The copy is recorded once, at the path the database files it; a case that
-- no longer owes it says so. Rocha's case is Rocha's alone.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1550000-0000-4000-8000-000000000001', 'ana@lima-volta.invalid', 'Ana Lima'),
  ('a1550000-0000-4000-8000-000000000009', 'edu@rocha-volta.invalid', 'Edu Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b1550000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-volta', 'a1550000-0000-4000-8000-000000000001'),
  ('b1550000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-volta', 'a1550000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1550000-0000-4000-8000-00000000000a', 'a1550000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1550000-0000-4000-8000-00000000000b', 'a1550000-0000-4000-8000-000000000009', 'owner', 'socio');

insert into public.people (id, org_id, full_name, cpf) values
  ('d1550000-0000-4000-8000-000000000001', 'b1550000-0000-4000-8000-00000000000a', 'Maria Teste', '52998224725'),
  ('d1550000-0000-4000-8000-000000000002', 'b1550000-0000-4000-8000-00000000000a', 'João Teste', '11144477735'),
  ('d1550000-0000-4000-8000-000000000009', 'b1550000-0000-4000-8000-00000000000b', 'Maria Teste', '52998224725');
insert into public.cases (id, org_id, seq, module, incident, status, is_test) values
  ('c1550000-0000-4000-8000-000000000001', 'b1550000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed', false),
  ('c1550000-0000-4000-8000-000000000002', 'b1550000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'intake', false),
  ('c1550000-0000-4000-8000-000000000003', 'b1550000-0000-4000-8000-00000000000a', 3, 'direito-do-passageiro', 'delay', 'documents', false),
  ('c1550000-0000-4000-8000-000000000004', 'b1550000-0000-4000-8000-00000000000a', 4, 'direito-do-passageiro', 'delay', 'filed', false),
  ('c1550000-0000-4000-8000-000000000005', 'b1550000-0000-4000-8000-00000000000a', 5, 'direito-do-passageiro', 'delay', 'intake', false),
  ('c1550000-0000-4000-8000-000000000006', 'b1550000-0000-4000-8000-00000000000a', 6, 'direito-do-passageiro', 'delay', 'filed', true),
  ('c1550000-0000-4000-8000-000000000009', 'b1550000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'intake', false);
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1550000-0000-4000-8000-000000000001', 'b1550000-0000-4000-8000-00000000000a', 'c1550000-0000-4000-8000-000000000001', 'd1550000-0000-4000-8000-000000000001', 'claimant'),
  ('e1550000-0000-4000-8000-000000000002', 'b1550000-0000-4000-8000-00000000000a', 'c1550000-0000-4000-8000-000000000002', 'd1550000-0000-4000-8000-000000000001', 'claimant'),
  ('e1550000-0000-4000-8000-000000000003', 'b1550000-0000-4000-8000-00000000000a', 'c1550000-0000-4000-8000-000000000003', 'd1550000-0000-4000-8000-000000000001', 'claimant'),
  ('e1550000-0000-4000-8000-000000000004', 'b1550000-0000-4000-8000-00000000000a', 'c1550000-0000-4000-8000-000000000004', 'd1550000-0000-4000-8000-000000000002', 'claimant'),
  ('e1550000-0000-4000-8000-000000000005', 'b1550000-0000-4000-8000-00000000000a', 'c1550000-0000-4000-8000-000000000005', 'd1550000-0000-4000-8000-000000000002', 'claimant'),
  ('e1550000-0000-4000-8000-000000000006', 'b1550000-0000-4000-8000-00000000000a', 'c1550000-0000-4000-8000-000000000006', 'd1550000-0000-4000-8000-000000000002', 'claimant'),
  ('e1550000-0000-4000-8000-000000000009', 'b1550000-0000-4000-8000-00000000000b', 'c1550000-0000-4000-8000-000000000009', 'd1550000-0000-4000-8000-000000000009', 'claimant');

-- The files and documents of the earlier cases.
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at)
select id::uuid, 'b1550000-0000-4000-8000-00000000000a', 'upload', 'org/b1550000-0000-4000-8000-00000000000a/upload/' || id,
  name, 'application/pdf', 100, 'stored', repeat(hash, 64), 100, 'application/pdf', now(), now()
from (values
  ('f1550000-0000-4000-8000-000000000001', 'identidade-maria.pdf', 'a'),
  ('f1550000-0000-4000-8000-000000000002', 'conta-maria.pdf', 'b'),
  ('f1550000-0000-4000-8000-000000000003', 'conta-joao.pdf', 'c'),
  ('f1550000-0000-4000-8000-000000000004', 'identidade-joao.pdf', 'd'),
  ('f1550000-0000-4000-8000-000000000005', 'identidade-maria-nova.pdf', 'e'),
  ('f1550000-0000-4000-8000-000000000006', 'identidade-teste.pdf', 'f')
) as v (id, name, hash);
insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status, decided_at) values
  ('a7550000-0000-4000-8000-000000000001', 'b1550000-0000-4000-8000-00000000000a', 'c1550000-0000-4000-8000-000000000001',
   'e1550000-0000-4000-8000-000000000001', 'f1550000-0000-4000-8000-000000000001', 'identity', 'client', 'accepted', now() - interval '300 days'),
  ('a7550000-0000-4000-8000-000000000002', 'b1550000-0000-4000-8000-00000000000a', 'c1550000-0000-4000-8000-000000000001',
   'e1550000-0000-4000-8000-000000000001', 'f1550000-0000-4000-8000-000000000002', 'address_proof', 'client', 'accepted', now() - interval '10 days'),
  ('a7550000-0000-4000-8000-000000000003', 'b1550000-0000-4000-8000-00000000000a', 'c1550000-0000-4000-8000-000000000004',
   'e1550000-0000-4000-8000-000000000004', 'f1550000-0000-4000-8000-000000000003', 'address_proof', 'client', 'accepted', now() - interval '200 days'),
  ('a7550000-0000-4000-8000-000000000004', 'b1550000-0000-4000-8000-00000000000a', 'c1550000-0000-4000-8000-000000000004',
   'e1550000-0000-4000-8000-000000000004', 'f1550000-0000-4000-8000-000000000004', 'identity', 'client', 'accepted', now() - interval '200 days'),
  -- Maria's second new case has an identity of its own, waiting for the firm.
  ('a7550000-0000-4000-8000-000000000005', 'b1550000-0000-4000-8000-00000000000a', 'c1550000-0000-4000-8000-000000000003',
   'e1550000-0000-4000-8000-000000000003', 'f1550000-0000-4000-8000-000000000005', 'identity', 'client', 'received', null),
  -- João's test case: a test document never reaches a real case.
  ('a7550000-0000-4000-8000-000000000006', 'b1550000-0000-4000-8000-00000000000a', 'c1550000-0000-4000-8000-000000000006',
   'e1550000-0000-4000-8000-000000000006', 'f1550000-0000-4000-8000-000000000006', 'identity', 'client', 'accepted', now());

create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.as_backend(name text, call text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  set local role service_role;
  execute format('insert into res values (%L, to_jsonb((%s)))', name, call);
  reset role;
end;
$$;
create function pg_temp.due() returns table (target_case uuid, kind text, source uuid) language sql as $$
  select (d ->> 'target_case')::uuid, d ->> 'kind', (d ->> 'source_document')::uuid
  from res, jsonb_array_elements(res.value) d where res.key = 'due';
$$;

select pg_temp.as_backend('due', $$public.document_reuses_due(50)$$);
select set_eq(
  $$ select target_case, kind, source from pg_temp.due() $$,
  $$ values
    ('c1550000-0000-4000-8000-000000000002'::uuid, 'identity', 'a7550000-0000-4000-8000-000000000001'::uuid),
    ('c1550000-0000-4000-8000-000000000002'::uuid, 'address_proof', 'a7550000-0000-4000-8000-000000000002'::uuid),
    ('c1550000-0000-4000-8000-000000000003'::uuid, 'address_proof', 'a7550000-0000-4000-8000-000000000002'::uuid),
    ('c1550000-0000-4000-8000-000000000005'::uuid, 'identity', 'a7550000-0000-4000-8000-000000000004'::uuid) $$,
  'a new case being gathered owes its people''s accepted identity and recent proof of address, nothing it has, nothing old, nothing of a test case'
);

select pg_temp.as_backend('wrong-path', $$public.record_document_reuse('a7550000-0000-4000-8000-000000000001',
  'c1550000-0000-4000-8000-000000000002', 'e1550000-0000-4000-8000-000000000002', 'f1550000-0000-4000-8000-0000000000a1',
  'org/b1550000-0000-4000-8000-00000000000b/upload/f1550000-0000-4000-8000-0000000000a1')$$);
select is(pg_temp.got('wrong-path', '{code}'), 'invalid_path', 'a copy is recorded only at the path the database files it');

select pg_temp.as_backend('reuse', $$public.record_document_reuse('a7550000-0000-4000-8000-000000000001',
  'c1550000-0000-4000-8000-000000000002', 'e1550000-0000-4000-8000-000000000002', 'f1550000-0000-4000-8000-0000000000a1',
  'org/b1550000-0000-4000-8000-00000000000a/upload/f1550000-0000-4000-8000-0000000000a1')$$);
select ok(
  pg_temp.got('reuse', '{ok}') = 'true'
    and (select status = 'accepted' and source = 'reuse' and kind = 'identity' and reused_from = 'a7550000-0000-4000-8000-000000000001'
           and party_id = 'e1550000-0000-4000-8000-000000000002'
         from public.case_documents where file_id = 'f1550000-0000-4000-8000-0000000000a1')
    and (select status = 'stored' and sha256 = repeat('a', 64) and name = 'identidade-maria.pdf'
         from public.files where id = 'f1550000-0000-4000-8000-0000000000a1'),
  'the copy is an accepted document of the new case, brought from the earlier one, its file measured as the source was'
);
select ok(
  exists (select 1 from public.case_events where case_id = 'c1550000-0000-4000-8000-000000000002' and kind = 'document_reused'
          and actor_type = 'system' and (data ->> 'from_case') = '1'),
  'the timeline says ONE brought it, from which case'
);

select pg_temp.as_backend('again', $$public.record_document_reuse('a7550000-0000-4000-8000-000000000001',
  'c1550000-0000-4000-8000-000000000002', 'e1550000-0000-4000-8000-000000000002', 'f1550000-0000-4000-8000-0000000000a2',
  'org/b1550000-0000-4000-8000-00000000000a/upload/f1550000-0000-4000-8000-0000000000a2')$$);
select is(pg_temp.got('again', '{code}'), 'not_due', 'once brought, the same document is owed no more');

select pg_temp.as_backend('due-after', $$public.document_reuses_due(50)$$);
select ok(
  not exists (select 1 from res, jsonb_array_elements(res.value) d
              where res.key = 'due-after' and d ->> 'target_case' = 'c1550000-0000-4000-8000-000000000002' and d ->> 'kind' = 'identity'),
  'and leaves what is owed'
);

-- A person who refuses the copy has the client asked for another: the same source is never brought again.
update public.case_documents set status = 'rejected', rejected_reason = 'Documento vencido.'
where file_id = 'f1550000-0000-4000-8000-0000000000a1';
select pg_temp.as_backend('due-refused', $$public.document_reuses_due(50)$$);
select ok(
  not exists (select 1 from res, jsonb_array_elements(res.value) d
              where res.key = 'due-refused' and d ->> 'target_case' = 'c1550000-0000-4000-8000-000000000002' and d ->> 'kind' = 'identity'),
  'a copy a person refused is never brought again'
);

select ok(
  not exists (select 1 from res, jsonb_array_elements(res.value) d
              where res.key = 'due' and d ->> 'org_id' = 'b1550000-0000-4000-8000-00000000000b'),
  'a person of another firm with the same CPF is another firm''s client: nothing of Lima reaches Rocha'
);

select * from finish();
rollback;
