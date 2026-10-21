begin;
create extension if not exists pgtap;
select plan(20);

-- ============================================================
-- What the client signs, and what the client accepts (0023).
--
-- An envelope is a firm's: requested by its people for adults of its case,
-- reserved before anything leaves ONE, opened and closed by the backend only.
-- The client reaches it through their link, and accepts the texts for
-- clients in force, by their own link. Two firms: nothing of one reaches the
-- other.
--
-- Every person, firm and CPF here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ac100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('ac100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('ac100000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());

update public.profiles set is_superadmin = true where id = 'ac100000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('bc100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'ac100000-0000-4000-8000-000000000001'),
  ('bc100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'ac100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bc100000-0000-4000-8000-00000000000a', 'ac100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('bc100000-0000-4000-8000-00000000000b', 'ac100000-0000-4000-8000-000000000004', 'owner', 'advogado');

-- Firm A has its ZapSign account connected (the token itself lives in the vault; not here).
insert into public.connections (id, org_id, provider, label, status, connected_at, metadata)
values ('cc100000-0000-4000-8000-00000000000a', 'bc100000-0000-4000-8000-00000000000a', 'zapsign', 'ZapSign', 'connected', now(),
        jsonb_build_object('environment', 'sandbox', 'webhook_secret_sha256', repeat('9', 64)));

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_client() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.hash(token text) returns text language sql as
$$ select encode(sha256(convert_to(token, 'UTF8')), 'hex'); $$;

-- A case of firm A: Maria, an adult, and her son, a minor. A case of firm B.
select pg_temp.sign_in('ac100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('bc100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02", "phone": "62999990001"}'::jsonb));
insert into res values ('guardian', public.save_case_person(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, '{}'::jsonb, 'guardian'));
insert into res values ('minor', public.save_case_person(pg_temp.got('case', 'case_id')::uuid, null,
  '{"full_name": "Joao Teste", "birth_date": "2015-03-10"}'::jsonb, 'claimant', pg_temp.got('guardian', 'party_id')::uuid));
insert into res values ('link', public.create_client_link(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, pg_temp.hash('token-de-assinatura-1234567890')));
reset role;
select pg_temp.sign_in('ac100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('bc100000-0000-4000-8000-00000000000b', 'cancellation', null, null,
  '{"full_name": "Paulo Teste"}'::jsonb));
reset role;

-- The firm's papers: a power of attorney and a contract as PDFs, a photo that is not one.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('poa_file', public.reserve_file('bc100000-0000-4000-8000-00000000000a', 'upload', 'procuracao.pdf',
  'application/pdf', 4000, 'ac100000-0000-4000-8000-000000000001'));
select public.confirm_file(pg_temp.got('poa_file', 'file_id')::uuid, repeat('a', 64), 4000, 'application/pdf', 1);
insert into res values ('contract_file', public.reserve_file('bc100000-0000-4000-8000-00000000000a', 'upload', 'contrato.pdf',
  'application/pdf', 5000, 'ac100000-0000-4000-8000-000000000001'));
select public.confirm_file(pg_temp.got('contract_file', 'file_id')::uuid, repeat('b', 64), 5000, 'application/pdf', 2);
insert into res values ('photo_file', public.reserve_file('bc100000-0000-4000-8000-00000000000a', 'upload', 'foto.jpg',
  'image/jpeg', 3000, 'ac100000-0000-4000-8000-000000000001'));
select public.confirm_file(pg_temp.got('photo_file', 'file_id')::uuid, repeat('c', 64), 3000, 'image/jpeg', null);
insert into res values ('decl_file', public.reserve_file('bc100000-0000-4000-8000-00000000000a', 'upload', 'declaracao.pdf',
  'application/pdf', 2000, 'ac100000-0000-4000-8000-000000000001'));
select public.confirm_file(pg_temp.got('decl_file', 'file_id')::uuid, repeat('d', 64), 2000, 'application/pdf', 1);
reset role;

select pg_temp.sign_in('ac100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('poa', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('poa_file', 'file_id')::uuid, 'power_of_attorney'));
insert into res values ('contract', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('contract_file', 'file_id')::uuid, 'contract'));
insert into res values ('photo', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('photo_file', 'file_id')::uuid, 'other'));
insert into res values ('decl', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('decl_file', 'file_id')::uuid, 'other'));

-- ---------- The firm sends a document to be signed ----------

insert into res values ('bad_method', public.request_signature(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('poa', 'document_id')::uuid, 'fax', array[pg_temp.got('case', 'person_id')::uuid]));
insert into res values ('not_pdf', public.request_signature(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('photo', 'document_id')::uuid, 'govbr', array[pg_temp.got('case', 'person_id')::uuid]));
insert into res values ('minor_signs', public.request_signature(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('poa', 'document_id')::uuid, 'zapsign', array[pg_temp.got('minor', 'person_id')::uuid]));
insert into res values ('stranger_signs', public.request_signature(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('poa', 'document_id')::uuid, 'zapsign', array[pg_temp.got('case_b', 'person_id')::uuid]));
insert into res values ('bad_url', public.request_signature(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('decl', 'document_id')::uuid, 'enotariado', array[pg_temp.got('case', 'person_id')::uuid], 'http://cartorio'));
insert into res values ('zapsign', public.request_signature(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('poa', 'document_id')::uuid, 'zapsign', array[pg_temp.got('case', 'person_id')::uuid]));
insert into res values ('govbr_two', public.request_signature(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('decl', 'document_id')::uuid, 'govbr',
  array[pg_temp.got('case', 'person_id')::uuid, pg_temp.got('case', 'person_id')::uuid]));
insert into res values ('twice', public.request_signature(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('poa', 'document_id')::uuid, 'govbr', array[pg_temp.got('case', 'person_id')::uuid]));
reset role;

select ok(
  pg_temp.got('bad_method', 'code') = 'invalid_method'
  and pg_temp.got('not_pdf', 'code') = 'not_pdf'
  and pg_temp.got('minor_signs', 'code') = 'minor_cannot_sign'
  and pg_temp.got('stranger_signs', 'code') = 'signer_not_found'
  and pg_temp.got('bad_url', 'code') = 'invalid_url'
  and pg_temp.got('twice', 'code') = 'already_open'
  and pg_temp.got('govbr_two', 'code') in ('invalid_signers', 'single_signer'),
  'a PDF of the firm is signed by adults of the case, one envelope at a time, at a notary only through a secure link'
);
select ok(
  pg_temp.got('zapsign', 'code') = 'requested'
  and (select status = 'reserved' and method = 'zapsign' and connection_id = 'cc100000-0000-4000-8000-00000000000a'
          and signers -> 0 ->> 'name' = 'Maria Teste' and signers -> 0 ->> 'sign_url' is null
       from public.signature_envelopes where id = pg_temp.got('zapsign', 'envelope_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'signature_requested'),
  'by ZapSign the envelope is only reserved, on the firm''s own connected account: nothing has left ONE yet'
);

select pg_temp.sign_in('ac100000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(
  public.firm_has_signature_account('bc100000-0000-4000-8000-00000000000a')
  and not public.firm_has_signature_account('bc100000-0000-4000-8000-00000000000b'),
  'a person of the firm knows whether its ZapSign is connected, and nothing of another firm''s'
);
reset role;

-- Firm B: no account at ZapSign, and nothing of firm A.
select pg_temp.sign_in('ac100000-0000-4000-8000-000000000004');
set local role authenticated;
select is((select count(*)::int from public.signature_envelopes), 0, 'a person of firm B reads no envelope of firm A');
select throws_ok(
  format($$select public.request_signature(%L, %L, 'govbr', array[%L]::uuid[])$$,
    pg_temp.got('case', 'case_id'), pg_temp.got('contract', 'document_id'), pg_temp.got('case', 'person_id')),
  'P0002', 'case_not_found',
  'nor sends a document of firm A to be signed'
);
reset role;

-- ---------- The backend opens it at ZapSign ----------

select pg_temp.as_backend();
set local role service_role;
create temporary table claimed as select * from public.claim_signature_envelopes(10);
reset role;
select pg_temp.sign_in('ac100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('cancel_opening', public.cancel_signature(pg_temp.got('zapsign', 'envelope_id')::uuid, 'Mudou de ideia'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claimed_again', (select jsonb_build_object('count', count(*)) from public.claim_signature_envelopes(10)));
insert into res values ('opened_wrong', public.record_signature_opened(pg_temp.got('zapsign', 'envelope_id')::uuid,
  'doc-0001-aaaa-bbbb', array['https://sandbox.app.zapsign.com.br/verificar/a', 'https://sandbox.app.zapsign.com.br/verificar/b']));
insert into res values ('opened', public.record_signature_opened(pg_temp.got('zapsign', 'envelope_id')::uuid,
  'doc-0001-aaaa-bbbb', array['https://sandbox.app.zapsign.com.br/verificar/doc-0001-s1']));
reset role;

select ok(
  (select count(*) = 1 and bool_and(storage_path like 'org/bc100000-0000-4000-8000-00000000000a/upload/%')
          and bool_and(signers -> 0 ->> 'name' = 'Maria Teste' and not (signers -> 0) ? 'phone' and not (signers -> 0) ? 'email')
   from claimed)
  and pg_temp.got('claimed_again', 'count') = '0'
  and pg_temp.got('cancel_opening', 'code') = 'busy'
  and pg_temp.got('opened_wrong', 'code') = 'invalid_answer'
  and pg_temp.got('opened', 'code') = 'opened'
  and (select status = 'pending' and provider_id = 'doc-0001-aaaa-bbbb'
          and signers -> 0 ->> 'sign_url' = 'https://sandbox.app.zapsign.com.br/verificar/doc-0001-s1'
       from public.signature_envelopes where id = pg_temp.got('zapsign', 'envelope_id')::uuid),
  'an envelope is claimed once, opened with one address per signer, and only an answer that fits is kept'
);

select pg_temp.sign_in('ac100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format($$select public.record_signature_opened(%L, 'doc-9999-aaaa-bbbb', array['https://x.invalid/a'])$$, pg_temp.got('zapsign', 'envelope_id')),
  '42501', null,
  'only the backend records what the provider answered'
);
reset role;

-- Nobody heard of it for seven hours (the trigger that stamps updated_at is set aside for this).
set local session_replication_role = replica;
update public.signature_envelopes set updated_at = now() - interval '7 hours'
where id = pg_temp.got('zapsign', 'envelope_id')::uuid;
set local session_replication_role = origin;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('poll_due', (select jsonb_build_object('count', count(*)) from public.signature_envelopes_to_poll(50)));
insert into res values ('checked', public.record_signature_checked(pg_temp.got('zapsign', 'envelope_id')::uuid, 'unknown_at_provider'));
insert into res values ('poll_after', (select jsonb_build_object('count', count(*)) from public.signature_envelopes_to_poll(50)));
insert into res values ('webhook_hash', public.signature_envelope_for_backend(pg_temp.got('zapsign', 'envelope_id')::uuid));
reset role;
select ok(
  pg_temp.got('poll_due', 'count') = '1' and pg_temp.got('checked', 'code') = 'recorded'
  and pg_temp.got('poll_after', 'count') = '0'
  and (select last_error = 'unknown_at_provider' from public.signature_envelopes where id = pg_temp.got('zapsign', 'envelope_id')::uuid)
  and pg_temp.got('webhook_hash', 'webhook_secret_sha256') = repeat('9', 64),
  'the sweep asks again for what nobody heard of, puts what it could not settle at the back, and the webhook''s secret is checked by its hash'
);

-- The client reads it on their link.
select pg_temp.as_client();
set local role anon;
insert into res values ('client_sees', public.client_link_signatures('token-de-assinatura-1234567890'));
insert into res values ('client_nothing', public.client_link_signatures('token-que-nao-existe'));
reset role;
select ok(
  (select payload -> 'signatures' -> 0 ->> 'method' = 'zapsign'
          and payload -> 'signatures' -> 0 ->> 'sign_url' = 'https://sandbox.app.zapsign.com.br/verificar/doc-0001-s1'
          and payload -> 'signatures' -> 0 ->> 'name' = 'procuracao.pdf'
   from res where name = 'client_sees')
  and pg_temp.got('client_nothing', 'code') = 'link_not_open',
  'the client finds on their link what they sign and their own address to sign it'
);

-- ZapSign says it was signed; the backend keeps the signed PDF.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('status', public.record_signature_status(pg_temp.got('zapsign', 'envelope_id')::uuid, 'pending',
  array['2026-10-09T12:00:00Z']));
insert into res values ('signed_file', public.reserve_file('bc100000-0000-4000-8000-00000000000a', 'signed', 'procuracao-assinada.pdf',
  'application/pdf', 6000, null));
select public.confirm_file(pg_temp.got('signed_file', 'file_id')::uuid, repeat('e', 64), 6000, 'application/pdf', 2);
insert into res values ('signed', public.record_signature_signed(pg_temp.got('zapsign', 'envelope_id')::uuid,
  pg_temp.got('signed_file', 'file_id')::uuid, repeat('e', 64),
  '[{"signer": "Maria Teste", "signed_at": "2026-10-09T12:00:00Z"}]'::jsonb));
insert into res values ('signed_twice', public.record_signature_signed(pg_temp.got('zapsign', 'envelope_id')::uuid,
  pg_temp.got('signed_file', 'file_id')::uuid, repeat('e', 64), '[]'::jsonb));
reset role;

select ok(
  pg_temp.got('signed', 'code') = 'signed' and pg_temp.got('signed_twice', 'code') = 'already_signed'
  and (select status = 'signed' and signed_sha256 = repeat('e', 64) and evidence -> 0 ->> 'signer' = 'Maria Teste'
          and last_error is null
          and signers -> 0 ->> 'signed_at' = '2026-10-09T12:00:00Z'
       from public.signature_envelopes where id = pg_temp.got('zapsign', 'envelope_id')::uuid)
  and (select kind = 'power_of_attorney' and source = 'signature' and status = 'accepted'
       from public.case_documents where id = pg_temp.got('signed', 'document_id')::uuid),
  'the signed PDF becomes an accepted document of the case, of the kind the original was, with its hash and the evidence'
);

-- An envelope claimed and never answered is uncertain, and never opened again by itself.
select pg_temp.sign_in('ac100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('contract_zapsign', public.request_signature(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('contract', 'document_id')::uuid, 'zapsign', array[pg_temp.got('case', 'person_id')::uuid]));
reset role;
select pg_temp.as_backend();
set local role service_role;
select count(*) from public.claim_signature_envelopes(10);
reset role;
update public.signature_envelopes set claimed_at = now() - interval '20 minutes'
where id = pg_temp.got('contract_zapsign', 'envelope_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('after_stuck', (select jsonb_build_object('count', count(*)) from public.claim_signature_envelopes(10)));
reset role;
select ok(
  pg_temp.got('after_stuck', 'count') = '0'
  and (select status = 'uncertain' and last_error = 'no_answer' and attempts = 1
       from public.signature_envelopes where id = pg_temp.got('contract_zapsign', 'envelope_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'signature_uncertain'),
  'an envelope claimed and never answered is uncertain: nobody can tell whether it was opened, so it is not opened again'
);

-- A pending ZapSign envelope is cancelled in ONE at once; its cancel at ZapSign is owed until sent.
select pg_temp.sign_in('ac100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('decl_zapsign', public.request_signature(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('decl', 'document_id')::uuid, 'zapsign', array[pg_temp.got('case', 'person_id')::uuid]));
reset role;
select pg_temp.as_backend();
set local role service_role;
select count(*) from public.claim_signature_envelopes(10, pg_temp.got('decl_zapsign', 'envelope_id')::uuid);
select public.record_signature_opened(pg_temp.got('decl_zapsign', 'envelope_id')::uuid, 'doc-0003-aaaa-bbbb',
  array['https://sandbox.app.zapsign.com.br/verificar/doc-0003-s1']);
reset role;
select pg_temp.sign_in('ac100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('decl_cancel', public.cancel_signature(pg_temp.got('decl_zapsign', 'envelope_id')::uuid, 'Documento errado'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('owed', (select jsonb_build_object('count', count(*), 'provider', min(provider_id))
                                 from public.signature_cancels_to_send(20)));
insert into res values ('cancel_failed', public.record_signature_cancel_failed(pg_temp.got('decl_zapsign', 'envelope_id')::uuid, 'provider_unavailable'));
insert into res values ('after_failed', (select to_jsonb(e) from public.signature_envelopes e where e.id = pg_temp.got('decl_zapsign', 'envelope_id')::uuid));
insert into res values ('cancel_sent', public.record_signature_cancel_sent(pg_temp.got('decl_zapsign', 'envelope_id')::uuid, 'already_signed'));
insert into res values ('owed_after', (select jsonb_build_object('count', count(*)) from public.signature_cancels_to_send(20)));
reset role;
select ok(
  pg_temp.got('decl_cancel', 'code') = 'cancelled'
  and pg_temp.got('owed', 'count') = '1' and pg_temp.got('owed', 'provider') = 'doc-0003-aaaa-bbbb'
  and pg_temp.got('cancel_failed', 'code') = 'recorded'
  and pg_temp.got('after_failed', 'provider_cancel_pending') = 'true' and pg_temp.got('after_failed', 'last_error') = 'provider_unavailable'
  and pg_temp.got('cancel_sent', 'code') = 'recorded' and pg_temp.got('owed_after', 'count') = '0'
  and (select status = 'cancelled' and not provider_cancel_pending
       from public.signature_envelopes where id = pg_temp.got('decl_zapsign', 'envelope_id')::uuid)
  and exists (select 1 from public.case_events where kind = 'signature_signed_after_cancel'),
  'a ZapSign envelope is cancelled in ONE at once, its cancel at ZapSign is owed until sent, and a signature that came first is told'
);

-- ---------- gov.br: the client signs the PDF themselves and sends it back ----------

select pg_temp.sign_in('ac100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('cancel_short', public.cancel_signature(pg_temp.got('contract_zapsign', 'envelope_id')::uuid, 'x'));
insert into res values ('cancel', public.cancel_signature(pg_temp.got('contract_zapsign', 'envelope_id')::uuid, 'Sem resposta da ZapSign'));
insert into res values ('govbr', public.request_signature(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('contract', 'document_id')::uuid, 'govbr', array[pg_temp.got('case', 'person_id')::uuid]));
reset role;

select pg_temp.as_client();
set local role anon;
insert into res values ('original', public.client_link_signature_original('token-de-assinatura-1234567890',
  pg_temp.got('govbr', 'envelope_id')::uuid));
insert into res values ('original_zapsign', public.client_link_signature_original('token-de-assinatura-1234567890',
  pg_temp.got('zapsign', 'envelope_id')::uuid));
insert into res values ('signed_image', public.client_link_reserve_signed('token-de-assinatura-1234567890',
  pg_temp.got('govbr', 'envelope_id')::uuid, 'assinado.jpg', 'image/jpeg', 2000));
insert into res values ('signed_back', public.client_link_reserve_signed('token-de-assinatura-1234567890',
  pg_temp.got('govbr', 'envelope_id')::uuid, 'contrato-assinado.pdf', 'application/pdf', 7000));
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.confirm_file(pg_temp.got('signed_back', 'file_id')::uuid, repeat('f', 64), 7000, 'application/pdf', 2);
reset role;
select pg_temp.sign_in('ac100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_case_status(pg_temp.got('case', 'case_id')::uuid, 'drafting');
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('original_drafting', public.client_link_signature_original('token-de-assinatura-1234567890',
  pg_temp.got('govbr', 'envelope_id')::uuid));
reset role;
select ok(
  pg_temp.got('original_drafting', 'storage_path') like 'org/bc100000-0000-4000-8000-00000000000a/upload/%',
  'signing is not tied to the stage of the case: an open link still downloads what it signs'
);
select pg_temp.as_backend();
set local role service_role;
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('signed_back_done', public.client_link_finish_upload('token-de-assinatura-1234567890',
  pg_temp.got('signed_back', 'document_id')::uuid));
reset role;

select ok(
  pg_temp.got('cancel_short', 'code') = 'reason_required' and pg_temp.got('cancel', 'code') = 'cancelled'
  and pg_temp.got('original', 'storage_path') like 'org/bc100000-0000-4000-8000-00000000000a/upload/%'
  and pg_temp.got('original_zapsign', 'code') = 'not_found'
  and pg_temp.got('signed_image', 'code') = 'type_not_allowed'
  and pg_temp.got('signed_back_done', 'code') = 'received'
  and (select status = 'received' from public.signature_envelopes where id = pg_temp.got('govbr', 'envelope_id')::uuid)
  and (select kind = 'contract' and envelope_id = pg_temp.got('govbr', 'envelope_id')::uuid
       from public.case_documents where id = pg_temp.got('signed_back', 'document_id')::uuid),
  'by gov.br the client downloads the PDF from their link and sends back a signed PDF, which waits for the firm'
);

select pg_temp.sign_in('ac100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('confirm_original', public.confirm_signature(pg_temp.got('govbr', 'envelope_id')::uuid,
  pg_temp.got('contract', 'document_id')::uuid));
insert into res values ('confirm_other_file', public.confirm_signature(pg_temp.got('govbr', 'envelope_id')::uuid,
  pg_temp.got('decl', 'document_id')::uuid));
insert into res values ('confirm', public.confirm_signature(pg_temp.got('govbr', 'envelope_id')::uuid,
  pg_temp.got('signed_back', 'document_id')::uuid));
insert into res values ('confirm_zapsign', public.confirm_signature(pg_temp.got('zapsign', 'envelope_id')::uuid,
  pg_temp.got('signed_back', 'document_id')::uuid));
reset role;
select ok(
  pg_temp.got('confirm_original', 'code') = 'document_not_found'
  and pg_temp.got('confirm_other_file', 'code') = 'document_not_found'
  and pg_temp.got('confirm', 'code') = 'signed'
  and pg_temp.got('confirm_zapsign', 'code') = 'signed_by_provider'
  and (select status = 'signed' and signed_document_id = pg_temp.got('signed_back', 'document_id')::uuid
          and signed_sha256 = repeat('f', 64)
       from public.signature_envelopes where id = pg_temp.got('govbr', 'envelope_id')::uuid)
  and (select status = 'accepted' from public.case_documents where id = pg_temp.got('signed_back', 'document_id')::uuid),
  'a person of the firm confirms the file the client signed elsewhere; what ZapSign signed needs nobody to confirm it'
);

-- ---------- What the client accepts ----------

select pg_temp.sign_in('ac100000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('term', jsonb_build_object('id', public.publish_consent_term('cliente-dados', 'pt-BR',
  'Uso dos seus dados no caso', 'O escritório usa os seus dados para cuidar do seu caso.')));
insert into res values ('other_term', jsonb_build_object('id', public.publish_consent_term('termos-de-uso', 'pt-BR',
  'Termos de uso', 'Texto dos termos de uso da plataforma.')));
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('terms_before', public.client_link_terms('token-de-assinatura-1234567890'));
select throws_ok(
  format($$select public.client_link_accept_terms('token-de-assinatura-1234567890', array[%L]::uuid[], '{"channel": "outro"}')$$,
    pg_temp.got('term', 'id')),
  '42501', null,
  'the client does not record an acceptance, nor its evidence, by calling the database directly'
);
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('accept', public.client_link_accept_terms('token-de-assinatura-1234567890',
  array[pg_temp.got('term', 'id')::uuid], '{"user_agent": "Navegador de teste", "channel": "outro", "extra": "x"}'::jsonb));
insert into res values ('accept_again', public.client_link_accept_terms('token-de-assinatura-1234567890',
  array[pg_temp.got('term', 'id')::uuid]));
insert into res values ('accept_other', public.client_link_accept_terms('token-de-assinatura-1234567890',
  array[pg_temp.got('other_term', 'id')::uuid]));
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('terms_after', public.client_link_terms('token-de-assinatura-1234567890'));
reset role;

select ok(
  (select jsonb_array_length(payload -> 'terms') = 1 and payload -> 'terms' -> 0 ->> 'slug' = 'cliente-dados'
          and payload -> 'terms' -> 0 ->> 'accepted_at' is null
   from res where name = 'terms_before')
  and pg_temp.got('accept', 'added') = '1' and pg_temp.got('accept_again', 'added') = '0'
  and pg_temp.got('accept_other', 'code') = 'term_not_in_force'
  and (select payload -> 'terms' -> 0 ->> 'accepted_at' is not null from res where name = 'terms_after'),
  'the client accepts the texts for clients in force, once each, and nothing else through their link'
);

select pg_temp.sign_in('ac100000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(
  (select count(*) = 1 and bool_and(evidence ->> 'channel' = 'link' and evidence ->> 'user_agent' = 'Navegador de teste'
                                     and not evidence ? 'extra'
                                     and term_slug = 'cliente-dados' and term_version = 1 and term_title = 'Uso dos seus dados no caso')
   from public.client_consents where case_id = pg_temp.got('case', 'case_id')::uuid),
  'the firm reads what its client accepted, with the text it was and how it was accepted, never what the caller added'
);
reset role;
select pg_temp.sign_in('ac100000-0000-4000-8000-000000000004');
set local role authenticated;
select is((select count(*)::int from public.client_consents), 0, 'and firm B reads none of it');
reset role;

select pg_temp.as_client();
set local role anon;
select throws_ok($$select count(*) from public.signature_envelopes$$, '42501', null,
  'the client reads no envelope directly: only what their link answers');
reset role;

select * from finish();
rollback;
