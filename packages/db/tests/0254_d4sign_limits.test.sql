begin;
create extension if not exists pgtap;
select plan(12);

-- ============================================================
-- What D4Sign asks of ONE (0254). Firm A's account is D4Sign: a paper ONE issues to a client with no e-mail on record
-- goes by gov.br and says why, one to a client with an e-mail goes by D4Sign; a person sending by D4Sign to people
-- with no e-mail of their own is told so. An envelope D4Sign would not open for its limit of calls an hour waits and
-- is claimed again when its time comes, and fails once tried too often. A D4Sign envelope is polled once a day, a
-- ZapSign one (firm B) as before. Nothing here is a member's to call.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2540000-0000-4000-8000-000000000001', 'ana@souza-limites.invalid', 'Ana Souza'),
  ('a2540000-0000-4000-8000-000000000002', 'caio@rocha-limites.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2540000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-limites', 'a2540000-0000-4000-8000-000000000001'),
  ('b2540000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-limites', 'a2540000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2540000-0000-4000-8000-00000000000a', 'a2540000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2540000-0000-4000-8000-00000000000b', 'a2540000-0000-4000-8000-000000000002', 'owner', 'socio');

-- Firm A's account is D4Sign, firm B's is ZapSign (their keys live in the vault; not here).
insert into public.connections (id, org_id, provider, label, status, connected_at, metadata) values
  ('c2540000-0000-4000-8000-00000000000a', 'b2540000-0000-4000-8000-00000000000a', 'd4sign', 'D4Sign (sandbox)',
   'connected', now(), jsonb_build_object('environment', 'sandbox', 'webhook_secret_sha256', repeat('8', 64))),
  ('c2540000-0000-4000-8000-00000000000b', 'b2540000-0000-4000-8000-00000000000b', 'zapsign', 'ZapSign',
   'connected', now(), jsonb_build_object('environment', 'sandbox', 'webhook_secret_sha256', repeat('9', 64)));

-- Rui gave no e-mail; Lia did.
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2540000-0000-4000-8000-000000000001', 'b2540000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'drafting');
insert into public.people (id, org_id, full_name, cpf, birth_date, nationality, marital_status, profession, email,
                           street, address_number, district, city, uf, postal_code) values
  ('d2540000-0000-4000-8000-000000000001', 'b2540000-0000-4000-8000-00000000000a', 'Rui Teste', '52998224725',
   '1980-01-01', 'brasileira', 'casado', 'Professor', null, 'Rua das Flores', '10', 'Centro', 'Goiânia', 'GO', '74000000'),
  ('d2540000-0000-4000-8000-000000000002', 'b2540000-0000-4000-8000-00000000000a', 'Lia Teste', '11144477735',
   '1982-02-02', 'brasileira', 'casado', 'Engenheira', 'lia@teste.invalid', 'Rua das Flores', '10', 'Centro',
   'Goiânia', 'GO', '74000000');
insert into public.case_parties (id, org_id, case_id, person_id, role, guardian_id) values
  ('e2540000-0000-4000-8000-000000000001', 'b2540000-0000-4000-8000-00000000000a', 'c2540000-0000-4000-8000-000000000001',
   'd2540000-0000-4000-8000-000000000001', 'claimant', null),
  ('e2540000-0000-4000-8000-000000000002', 'b2540000-0000-4000-8000-00000000000a', 'c2540000-0000-4000-8000-000000000001',
   'd2540000-0000-4000-8000-000000000002', 'claimant', null);

-- Both finished their links: their papers are due (0181).
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at, finished_at) values
  ('a7254000-0000-4000-8000-000000000001', 'b2540000-0000-4000-8000-00000000000a', 'c2540000-0000-4000-8000-000000000001',
   'd2540000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-do-rui-limites', 'UTF8')), 'hex'),
   now() + interval '30 days', now()),
  ('a7254000-0000-4000-8000-000000000002', 'b2540000-0000-4000-8000-00000000000a', 'c2540000-0000-4000-8000-000000000001',
   'd2540000-0000-4000-8000-000000000002', encode(sha256(convert_to('token-da-lia-limites', 'UTF8')), 'hex'),
   now() + interval '30 days', now());

create temporary table res (key text primary key, value jsonb);
grant all on res to authenticated, service_role, anon;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(key text, field text) returns text language sql as
$$ select value ->> got.field from res where res.key = got.key; $$;
create function pg_temp.envelope(key text) returns public.signature_envelopes language sql as
$$ select e from public.signature_envelopes e where e.id = pg_temp.got(key, 'envelope_id')::uuid; $$;

-- ---------- ONE issues each client's power of attorney ----------

update public.case_advances set claimed_at = now(), claims = claims + 1
where case_id = 'c2540000-0000-4000-8000-000000000001';
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, expires_at) values
  ('a8254000-0000-4000-8000-0000000000a1', 'b2540000-0000-4000-8000-00000000000a', 'paper', 'org/x/procuracao-rui',
   'procuracao.pdf', 'application/pdf', 100, 'reserved', now() + interval '1 hour'),
  ('a8254000-0000-4000-8000-0000000000a2', 'b2540000-0000-4000-8000-00000000000a', 'paper', 'org/x/procuracao-lia',
   'procuracao.pdf', 'application/pdf', 100, 'reserved', now() + interval '1 hour');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('rui_paper', public.advance_record_paper('c2540000-0000-4000-8000-000000000001',
  (select claims from public.case_advances where case_id = 'c2540000-0000-4000-8000-000000000001'),
  'd2540000-0000-4000-8000-000000000001', 'procuracao',
  public.paper_template_for('b2540000-0000-4000-8000-00000000000a', 'procuracao'),
  jsonb_build_object('file_id', 'a8254000-0000-4000-8000-0000000000a1', 'sha256', repeat('e', 64), 'bytes', '100', 'pages', '1')));
insert into res values ('lia_paper', public.advance_record_paper('c2540000-0000-4000-8000-000000000001',
  (select claims from public.case_advances where case_id = 'c2540000-0000-4000-8000-000000000001'),
  'd2540000-0000-4000-8000-000000000002', 'procuracao',
  public.paper_template_for('b2540000-0000-4000-8000-00000000000a', 'procuracao'),
  jsonb_build_object('file_id', 'a8254000-0000-4000-8000-0000000000a2', 'sha256', repeat('d', 64), 'bytes', '100', 'pages', '1')));
reset role;

select ok(
  (pg_temp.envelope('rui_paper')).method = 'govbr' and (pg_temp.envelope('rui_paper')).status = 'pending'
    and (pg_temp.envelope('rui_paper')).connection_id is null
    and (pg_temp.envelope('rui_paper')).last_error = 'd4sign_email_missing',
  'a client with no e-mail on record gets the paper by gov.br, and the envelope says why'
);
select ok(
  (pg_temp.envelope('lia_paper')).method = 'd4sign' and (pg_temp.envelope('lia_paper')).status = 'reserved'
    and (pg_temp.envelope('lia_paper')).connection_id = 'c2540000-0000-4000-8000-00000000000a'
    and (pg_temp.envelope('lia_paper')).last_error is null,
  'a client with an e-mail gets it by the firm''s D4Sign'
);

-- ---------- A person sends a document by D4Sign ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('doc_file', public.reserve_file('b2540000-0000-4000-8000-00000000000a', 'upload',
  'contrato.pdf', 'application/pdf', 4000, 'a2540000-0000-4000-8000-000000000001'));
select public.confirm_file(pg_temp.got('doc_file', 'file_id')::uuid, repeat('a', 64), 4000, 'application/pdf', 1);
reset role;
select pg_temp.sign_in('a2540000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('doc', public.attach_case_document('c2540000-0000-4000-8000-000000000001',
  pg_temp.got('doc_file', 'file_id')::uuid, 'contract'));
insert into res values ('no_email', public.request_signature('c2540000-0000-4000-8000-000000000001',
  pg_temp.got('doc', 'document_id')::uuid, 'd4sign', array['d2540000-0000-4000-8000-000000000001'::uuid]));
reset role;
update public.people set email = 'LIA@Teste.invalid' where id = 'd2540000-0000-4000-8000-000000000001';
select pg_temp.sign_in('a2540000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('shared', public.request_signature('c2540000-0000-4000-8000-000000000001',
  pg_temp.got('doc', 'document_id')::uuid, 'd4sign',
  array['d2540000-0000-4000-8000-000000000001'::uuid, 'd2540000-0000-4000-8000-000000000002'::uuid]));
insert into res values ('lia_alone', public.request_signature('c2540000-0000-4000-8000-000000000001',
  pg_temp.got('doc', 'document_id')::uuid, 'd4sign', array['d2540000-0000-4000-8000-000000000002'::uuid]));
reset role;

select is(pg_temp.got('no_email', 'code'), 'signer_email_missing',
  'a document sent by D4Sign to somebody with no e-mail on record is refused, and says why');
select is(pg_temp.got('shared', 'code'), 'signer_email_shared',
  'two signers on one e-mail are refused: D4Sign would give them one code');
select ok(
  pg_temp.got('lia_alone', 'ok') = 'true' and (pg_temp.envelope('lia_alone')).method = 'd4sign'
    and (pg_temp.envelope('lia_alone')).status = 'reserved',
  'a signer with an e-mail of her own goes by D4Sign'
);

-- ---------- D4Sign's limit of calls an hour ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claimed', (select jsonb_agg(c.envelope_id)
  from public.claim_signature_envelopes(10, pg_temp.got('lia_paper', 'envelope_id')::uuid) c));
insert into res values ('retry', public.record_signature_retry(pg_temp.got('lia_paper', 'envelope_id')::uuid,
  'provider_rate_limited', 60));
insert into res values ('claimed_early', (select coalesce(jsonb_agg(c.envelope_id), '[]'::jsonb)
  from public.claim_signature_envelopes(10, pg_temp.got('lia_paper', 'envelope_id')::uuid) c));
reset role;

select ok(
  pg_temp.got('retry', 'code') = 'waiting'
    and (pg_temp.envelope('lia_paper')).status = 'reserved'
    and (pg_temp.envelope('lia_paper')).last_error = 'provider_rate_limited'
    and (pg_temp.envelope('lia_paper')).retry_after > now() + interval '59 minutes',
  'an envelope D4Sign would not open for its limit waits an hour in the queue, never failed'
);
select is((select value from res where key = 'claimed_early'), '[]'::jsonb,
  'while it waits, nobody claims it');

update public.signature_envelopes set retry_after = now() - interval '1 minute'
where id = pg_temp.got('lia_paper', 'envelope_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claimed_late', (select coalesce(jsonb_agg(c.envelope_id), '[]'::jsonb)
  from public.claim_signature_envelopes(10, pg_temp.got('lia_paper', 'envelope_id')::uuid) c));
reset role;
select ok(
  (select value ? pg_temp.got('lia_paper', 'envelope_id') from res where key = 'claimed_late')
    and (pg_temp.envelope('lia_paper')).status = 'opening'
    and (pg_temp.envelope('lia_paper')).retry_after is null,
  'once its time came, the backend claims it again'
);

update public.signature_envelopes set attempts = 24 where id = pg_temp.got('lia_paper', 'envelope_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('retry_last', public.record_signature_retry(pg_temp.got('lia_paper', 'envelope_id')::uuid,
  'provider_rate_limited', 60));
reset role;
select ok(
  (pg_temp.envelope('lia_paper')).status = 'failed'
    and (pg_temp.envelope('lia_paper')).last_error = 'provider_rate_limited',
  'tried as many times as the setting says, it fails with its reason'
);

-- ---------- How often each provider is asked ----------

select pg_temp.sign_in('a2540000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('case_b', public.create_case('b2540000-0000-4000-8000-00000000000b', 'cancellation', 'G3',
  date '2026-09-20', '{"full_name": "Bia Teste", "cpf": "12345678909", "birth_date": "1985-03-03"}'::jsonb));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('poa_b_file', public.reserve_file('b2540000-0000-4000-8000-00000000000b', 'upload',
  'procuracao.pdf', 'application/pdf', 4000, 'a2540000-0000-4000-8000-000000000002'));
select public.confirm_file(pg_temp.got('poa_b_file', 'file_id')::uuid, repeat('b', 64), 4000, 'application/pdf', 1);
reset role;
select pg_temp.sign_in('a2540000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('poa_b', public.attach_case_document(pg_temp.got('case_b', 'case_id')::uuid,
  pg_temp.got('poa_b_file', 'file_id')::uuid, 'power_of_attorney'));
insert into res values ('zap', public.request_signature(pg_temp.got('case_b', 'case_id')::uuid,
  pg_temp.got('poa_b', 'document_id')::uuid, 'zapsign', array[pg_temp.got('case_b', 'person_id')::uuid]));
reset role;

select pg_temp.as_backend();
set local role service_role;
select public.claim_signature_envelopes(1, pg_temp.got('lia_alone', 'envelope_id')::uuid);
select public.record_signature_opened(pg_temp.got('lia_alone', 'envelope_id')::uuid,
  '9b1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e6', array['https://sandbox.d4sign.com.br/w/i/lia']);
select public.claim_signature_envelopes(1, pg_temp.got('zap', 'envelope_id')::uuid);
select public.record_signature_opened(pg_temp.got('zap', 'envelope_id')::uuid,
  'zap-0254-limites-doc', array['https://sandbox.app.zapsign.com.br/verificar/bia']);
reset role;

-- Both quiet for seven hours: only ZapSign's is asked. The trigger that stamps an update is held, as 0026 does.
set local session_replication_role = replica;
update public.signature_envelopes set updated_at = now() - interval '7 hours'
where id in (pg_temp.got('lia_alone', 'envelope_id')::uuid, pg_temp.got('zap', 'envelope_id')::uuid);
set local session_replication_role = origin;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('poll_7h', (select coalesce(jsonb_agg(p.envelope_id), '[]'::jsonb)
  from public.signature_envelopes_to_poll(200) p));
reset role;
set local session_replication_role = replica;
update public.signature_envelopes set updated_at = now() - interval '25 hours'
where id = pg_temp.got('lia_alone', 'envelope_id')::uuid;
set local session_replication_role = origin;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('poll_25h', (select coalesce(jsonb_agg(p.envelope_id), '[]'::jsonb)
  from public.signature_envelopes_to_poll(200) p));
reset role;

select ok(
  (select value ? pg_temp.got('zap', 'envelope_id') and not value ? pg_temp.got('lia_alone', 'envelope_id')
   from res where key = 'poll_7h')
    and (select value ? pg_temp.got('lia_alone', 'envelope_id') from res where key = 'poll_25h'),
  'a ZapSign envelope is asked after six quiet hours, a D4Sign one after a day: its webhook tells the rest'
);

-- ---------- Nothing here is a member's ----------

select pg_temp.sign_in('a2540000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.record_signature_retry(%L::uuid, %L, 1)', pg_temp.got('lia_alone', 'envelope_id'), 'x'),
  '42501', null, 'a member cannot give an envelope back to the queue'
);
select throws_ok(
  'select public.signature_emails_problem(array[''d2540000-0000-4000-8000-000000000002''::uuid])',
  '42501', null, 'a member cannot ask about the e-mails of the people'
);
reset role;

select * from finish();
rollback;
