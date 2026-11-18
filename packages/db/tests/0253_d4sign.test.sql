begin;
create extension if not exists pgtap;
select plan(10);

-- ============================================================
-- The firm's signature account may be D4Sign (0253). Firm A connected
-- D4Sign: ONE issues Rui's power of attorney and the envelope is D4Sign's,
-- reserved for the backend, opened, followed, cancelled at D4Sign and never
-- confirmed by hand. Firm B connected ZapSign: a paper sent by D4Sign has no
-- account there, and one sent by ZapSign goes as before. Nothing of one firm
-- reaches the other.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2530000-0000-4000-8000-000000000001', 'ana@souza-d4sign.invalid', 'Ana Souza'),
  ('a2530000-0000-4000-8000-000000000002', 'caio@rocha-d4sign.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2530000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-d4sign', 'a2530000-0000-4000-8000-000000000001'),
  ('b2530000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-d4sign', 'a2530000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2530000-0000-4000-8000-00000000000a', 'a2530000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2530000-0000-4000-8000-00000000000b', 'a2530000-0000-4000-8000-000000000002', 'owner', 'socio');

-- Firm A's account is D4Sign, firm B's is ZapSign (their keys live in the vault; not here).
insert into public.connections (id, org_id, provider, label, status, connected_at, metadata) values
  ('c2530000-0000-4000-8000-00000000000a', 'b2530000-0000-4000-8000-00000000000a', 'd4sign', 'D4Sign (sandbox)',
   'connected', now(), jsonb_build_object('environment', 'sandbox', 'webhook_secret_sha256', repeat('8', 64))),
  ('c2530000-0000-4000-8000-00000000000b', 'b2530000-0000-4000-8000-00000000000b', 'zapsign', 'ZapSign',
   'connected', now(), jsonb_build_object('environment', 'sandbox', 'webhook_secret_sha256', repeat('9', 64)));

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2530000-0000-4000-8000-000000000001', 'b2530000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'drafting');
-- Rui gave his e-mail, which D4Sign names him by (0254 sends a paper to somebody with none by gov.br).
insert into public.people (id, org_id, full_name, cpf, birth_date, nationality, marital_status, profession, email,
                           street, address_number, district, city, uf, postal_code) values
  ('d2530000-0000-4000-8000-000000000001', 'b2530000-0000-4000-8000-00000000000a', 'Rui Teste', '52998224725',
   '1980-01-01', 'brasileira', 'casado', 'Professor', 'rui@teste.invalid', 'Rua das Flores', '10', 'Centro',
   'Goiânia', 'GO', '74000000');
insert into public.case_parties (id, org_id, case_id, person_id, role, guardian_id) values
  ('e2530000-0000-4000-8000-000000000001', 'b2530000-0000-4000-8000-00000000000a', 'c2530000-0000-4000-8000-000000000001',
   'd2530000-0000-4000-8000-000000000001', 'claimant', null);

-- Rui finished his link: his papers are due (0181).
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at, finished_at) values
  ('a7253000-0000-4000-8000-000000000001', 'b2530000-0000-4000-8000-00000000000a', 'c2530000-0000-4000-8000-000000000001',
   'd2530000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-do-rui-d4sign', 'UTF8')), 'hex'),
   now() + interval '30 days', now());

create temporary table res (key text primary key, value jsonb);
grant all on res to authenticated, service_role, anon;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(key text, field text) returns text language sql as
$$ select value ->> got.field from res where res.key = got.key; $$;

-- ---------- Which account each firm has ----------

select pg_temp.sign_in('a2530000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a_sees', jsonb_build_object(
  'account', public.firm_signature_account('b2530000-0000-4000-8000-00000000000a') ->> 'provider',
  'environment', public.firm_signature_account('b2530000-0000-4000-8000-00000000000a') ->> 'environment',
  'has', public.firm_has_signature_account('b2530000-0000-4000-8000-00000000000a'),
  'other', public.firm_signature_account('b2530000-0000-4000-8000-00000000000b') ->> 'provider'));
reset role;
select pg_temp.sign_in('a2530000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('b_sees', jsonb_build_object(
  'account', public.firm_signature_account('b2530000-0000-4000-8000-00000000000b') ->> 'provider',
  'other', public.firm_signature_account('b2530000-0000-4000-8000-00000000000a') ->> 'provider'));
reset role;

select ok(
  pg_temp.got('a_sees', 'account') = 'd4sign' and pg_temp.got('a_sees', 'environment') = 'sandbox'
    and pg_temp.got('a_sees', 'has') = 'true'
    and pg_temp.got('b_sees', 'account') = 'zapsign',
  'each firm learns its own account: D4Sign in its sandbox for firm A, ZapSign for firm B'
);
select ok(
  pg_temp.got('a_sees', 'other') is null and pg_temp.got('b_sees', 'other') is null,
  'nobody of one firm learns the account of the other'
);

-- ---------- ONE issues Rui's power of attorney through firm A's D4Sign ----------

update public.case_advances set claimed_at = now(), claims = claims + 1
where case_id = 'c2530000-0000-4000-8000-000000000001';
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, expires_at)
values ('a8253000-0000-4000-8000-0000000000aa', 'b2530000-0000-4000-8000-00000000000a', 'paper', 'org/x/procuracao-d4sign',
        'procuracao.pdf', 'application/pdf', 100, 'reserved', now() + interval '1 hour');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('issued', public.advance_record_paper('c2530000-0000-4000-8000-000000000001',
  (select claims from public.case_advances where case_id = 'c2530000-0000-4000-8000-000000000001'),
  'd2530000-0000-4000-8000-000000000001', 'procuracao',
  public.paper_template_for('b2530000-0000-4000-8000-00000000000a', 'procuracao'),
  jsonb_build_object('file_id', 'a8253000-0000-4000-8000-0000000000aa', 'sha256', repeat('f', 64), 'bytes', '100', 'pages', '1')));
reset role;

select ok(
  (select e.method = 'd4sign' and e.status = 'reserved' and e.connection_id = 'c2530000-0000-4000-8000-00000000000a'
   from public.signature_envelopes e where e.id = pg_temp.got('issued', 'envelope_id')::uuid),
  'the power of attorney goes by D4Sign, reserved for the backend on firm A''s account'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claimed', (
  select coalesce(jsonb_agg(jsonb_build_object('envelope', c.envelope_id, 'connection', c.connection_id)), '[]'::jsonb)
  from public.claim_signature_envelopes(10, pg_temp.got('issued', 'envelope_id')::uuid) c));
insert into res values ('opened', public.record_signature_opened(pg_temp.got('issued', 'envelope_id')::uuid,
  '8f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5',
  array['https://sandbox.d4sign.com.br/embed/viewblob/8f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5?key_signer=abc123']));
reset role;

select ok(
  (select value -> 0 ->> 'connection' = 'c2530000-0000-4000-8000-00000000000a' from res where key = 'claimed')
    and pg_temp.got('opened', 'ok') = 'true'
    and (select e.status = 'pending' and e.provider_id = '8f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5'
         from public.signature_envelopes e where e.id = pg_temp.got('issued', 'envelope_id')::uuid),
  'the backend claims the D4Sign envelope with firm A''s account and records it opened, its signing address kept'
);

-- Nobody heard of it for a day (D4Sign is asked once a day since 0254): the sweep asks D4Sign again.
-- The trigger that stamps an update is held, as 0026 does, so the envelope looks as old as it is meant to.
set local session_replication_role = replica;
update public.signature_envelopes set updated_at = now() - interval '25 hours'
where id = pg_temp.got('issued', 'envelope_id')::uuid;
set local session_replication_role = origin;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('polled', (
  select coalesce(jsonb_agg(p.envelope_id), '[]'::jsonb) from public.signature_envelopes_to_poll(200) p));
reset role;
select ok(
  (select value ? pg_temp.got('issued', 'envelope_id') from res where key = 'polled'),
  'a D4Sign envelope nobody heard of for a while is asked for again by the sweep'
);

select pg_temp.sign_in('a2530000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('confirm', public.confirm_signature(pg_temp.got('issued', 'envelope_id')::uuid,
  pg_temp.got('issued', 'document_id')::uuid));
insert into res values ('cancel', public.cancel_signature(pg_temp.got('issued', 'envelope_id')::uuid, 'Documento errado'));
reset role;

select is(pg_temp.got('confirm', 'code'), 'signed_by_provider',
  'a D4Sign envelope is never confirmed by hand: D4Sign says when it is signed');
select ok(
  pg_temp.got('cancel', 'ok') = 'true'
    and (select e.provider_cancel_pending from public.signature_envelopes e
         where e.id = pg_temp.got('issued', 'envelope_id')::uuid),
  'a D4Sign envelope cancelled in ONE owes D4Sign its cancel'
);

-- ---------- Firm B, whose account is ZapSign ----------

select pg_temp.sign_in('a2530000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('case_b', public.create_case('b2530000-0000-4000-8000-00000000000b', 'cancellation', 'G3',
  date '2026-09-20', '{"full_name": "Bia Teste", "cpf": "12345678909", "birth_date": "1985-03-03"}'::jsonb));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('poa_b_file', public.reserve_file('b2530000-0000-4000-8000-00000000000b', 'upload',
  'procuracao.pdf', 'application/pdf', 4000, 'a2530000-0000-4000-8000-000000000002'));
select public.confirm_file(pg_temp.got('poa_b_file', 'file_id')::uuid, repeat('a', 64), 4000, 'application/pdf', 1);
reset role;
select pg_temp.sign_in('a2530000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('poa_b', public.attach_case_document(pg_temp.got('case_b', 'case_id')::uuid,
  pg_temp.got('poa_b_file', 'file_id')::uuid, 'power_of_attorney'));
insert into res values ('by_d4sign', public.request_signature(pg_temp.got('case_b', 'case_id')::uuid,
  pg_temp.got('poa_b', 'document_id')::uuid, 'd4sign', array[pg_temp.got('case_b', 'person_id')::uuid]));
insert into res values ('by_zapsign', public.request_signature(pg_temp.got('case_b', 'case_id')::uuid,
  pg_temp.got('poa_b', 'document_id')::uuid, 'zapsign', array[pg_temp.got('case_b', 'person_id')::uuid]));
reset role;

select is(pg_temp.got('by_d4sign', 'code'), 'no_signature_account',
  'a paper sent by D4Sign in a firm whose account is ZapSign has no account to go by');
select ok(
  pg_temp.got('by_zapsign', 'ok') = 'true'
    and (select e.method = 'zapsign' and e.status = 'reserved' and e.connection_id = 'c2530000-0000-4000-8000-00000000000b'
         from public.signature_envelopes e where e.id = pg_temp.got('by_zapsign', 'envelope_id')::uuid),
  'a paper sent by ZapSign in firm B goes as before, on its own account'
);

-- A firm with no account sends nothing by either provider.
select pg_temp.sign_in('a2530000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(
  public.firm_signature_account('b2530000-0000-4000-8000-00000000000b') is null
    and not public.firm_has_signature_account('b2530000-0000-4000-8000-00000000000b'),
  'firm A asking about firm B learns nothing, not even that it has an account'
);
reset role;

select * from finish();
rollback;
