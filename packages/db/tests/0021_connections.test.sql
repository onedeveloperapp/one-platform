begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

-- ============================================================
-- The firm's accounts at its vendors and the vault of their tokens (0017).
--
-- Who manages a firm connects and disconnects its accounts, with the second
-- factor, never from a support visit. Only the backend seals a token, and
-- the sealed token is reachable through the vault functions alone: no API
-- role reads the table, not even the service role, and every read is
-- audited with its purpose. A token whose validity ended is discarded.
-- Names that would hold a lawyer's own credential are refused. Two firms:
-- neither reaches an account of the other.
--
-- Every person, firm and token here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a7000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a7000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bruno@souza.invalid', '', now(), '{}', '{"display_name":"Bruno Lima"}', now(), now()),
  ('a7000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('a7000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a7000000-0000-4000-8000-000000000009';

-- Firm A: Ana (owner) and Bruno (a plain member, advogado). Firm B: Davi (owner).
insert into public.organizations (id, name, slug, created_by) values
  ('b7000000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'a7000000-0000-4000-8000-000000000001'),
  ('b7000000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'a7000000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b7000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b7000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b7000000-0000-4000-8000-00000000000b', 'a7000000-0000-4000-8000-000000000004', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated, service_role;

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

create function pg_temp.conn(name text) returns uuid language sql as
$$ select (payload ->> 'connection_id')::uuid from res where res.name = conn.name; $$;

create function pg_temp.org(name text) returns uuid language sql as
$$ select (payload ->> 'org_id')::uuid from res where res.name = org.name; $$;

-- ---------- Names that would hold a lawyer's own credential ----------

select is(
  (select array_agg(name order by name) from unnest(array[
     'pin', 'pinCode', 'PIN', 'senhaTribunal', 'password', 'privateKey', 'chave_privada', 'cert', 'certificado_a1',
     'seedPhrase', 'mfa_secret', '2fa', 'totp_uri', 'otp', 'pfx', 'passphrase'
   ]) as name where public.is_credential_name(name)),
  (select array_agg(name order by name) from unnest(array[
     'pin', 'pinCode', 'PIN', 'senhaTribunal', 'password', 'privateKey', 'chave_privada', 'cert', 'certificado_a1',
     'seedPhrase', 'mfa_secret', '2fa', 'totp_uri', 'otp', 'pfx', 'passphrase'
   ]) as name),
  'a password, a PIN, a code or its seed, a certificate or a private key is named as such'
);
select is(
  (select coalesce(array_agg(name order by name), '{}') from unnest(array[
     'access_token', 'app_secret', 'api_key', 'phone_number_id', 'shipping', 'spinner', 'certidao', 'pinned_at', 'waba_id'
   ]) as name where public.is_credential_name(name)),
  '{}'::text[],
  'and a vendor token, an id or a word that merely contains one of those is not'
);
select ok(
  public.jsonb_has_credential_key('{"conta": {"lista": [{"senhaTribunal": "x"}]}}')
  and not public.jsonb_has_credential_key('{"conta": {"lista": [{"numero": "x"}]}, "access_token": "y"}'),
  'a credential name is found at any depth of the details, and only there'
);

-- ---------- Starting a connection ----------

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.begin_connection('b7000000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-1', 'WhatsApp do escritório')$$,
  '42501', 'not_authorized',
  'a plain member does not connect an account of the firm'
);
reset role;

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
select throws_ok(
  $$select public.begin_connection('b7000000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-1', 'WhatsApp do escritório')$$,
  '42501', 'second_factor_required',
  'connecting asks for the second factor'
);
reset role;

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a7000000-0000-4000-8000-000000000009', 'a7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-00000000000a',
        'Conferindo as conexões', 'f7000000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001', 'aal2', 'f7000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.begin_connection('b7000000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-1', 'WhatsApp do escritório')$$,
  '42501', 'not_allowed_in_support_session',
  'nor from a support visit'
);
reset role;

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.begin_connection('b7000000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-1', 'Conta de outro')$$,
  '42501', 'not_authorized',
  'nor by the owner of another firm'
);
insert into res values ('b', public.begin_connection('b7000000-0000-4000-8000-00000000000b', 'whatsapp', 'waba-9', 'WhatsApp da Rocha'));
reset role;

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a', public.begin_connection('b7000000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-1', 'WhatsApp do escritório'));
insert into res values ('a_again', public.begin_connection('b7000000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-1', 'WhatsApp principal'));
insert into res values ('a_sign', public.begin_connection('b7000000-0000-4000-8000-00000000000a', 'zapsign', null, 'Assinaturas'));
insert into res values ('a_bad', public.begin_connection('b7000000-0000-4000-8000-00000000000a', 'WhatsApp Business', null, null));
reset role;

select ok(
  (select payload ->> 'code' = 'started' and payload ->> 'org_id' = 'b7000000-0000-4000-8000-00000000000a' from res where name = 'a')
  and (select status = 'pending' and connected_by = 'a7000000-0000-4000-8000-000000000001'
       from public.connections where id = pg_temp.conn('a')),
  'who manages the firm starts a connection, which waits for its token'
);
select ok(
  (select payload ->> 'code' = 'existing' from res where name = 'a_again')
  and pg_temp.conn('a_again') = pg_temp.conn('a')
  and (select label from public.connections where id = pg_temp.conn('a')) = 'WhatsApp principal',
  'starting again for the same account reuses it'
);
select is((select payload ->> 'code' from res where name = 'a_bad'), 'invalid_provider', 'a vendor is a slug');
select ok(
  exists (select 1 from public.audit_events where action = 'connection.started' and actor_type = 'person'
          and entity_id = pg_temp.conn('a')::text),
  'starting is audited as done by the person'
);

select throws_ok(
  format($$insert into public.connection_secrets (connection_id, org_id, key_version, iv, ciphertext, auth_tag)
           values (%L, 'b7000000-0000-4000-8000-00000000000b', 1, 'AAAAAAAAAAAAAAAA', 'eA==', 'AAAAAAAAAAAAAAAAAAAAAA==')$$,
         pg_temp.conn('a_sign')),
  '23503', null,
  'a token can never sit under an account of another firm'
);

-- ---------- Sealing a token ----------

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format($$select public.vault_store_secret(%L, %L, 1, 'AAAAAAAAAAAAAAAA', 'c2VncmVkbw==', 'AAAAAAAAAAAAAAAAAAAAAA==')$$, pg_temp.org('a'), pg_temp.conn('a')),
  '42501', null,
  'a person does not seal a token: the backend does'
);
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('stored', public.vault_store_secret(pg_temp.org('a'), pg_temp.conn('a'), 1, 'AAAAAAAAAAAAAAAA', 'c2VncmVkbw==', 'AAAAAAAAAAAAAAAAAAAAAA==', null, '{"numero": "+55 62 0000-0000"}'));
insert into res values ('replaced', public.vault_store_secret(pg_temp.org('a'), pg_temp.conn('a'), 1, 'BBBBBBBBBBBBBBBB', 'b3V0cm8gc2VncmVkbw==', 'BBBBBBBBBBBBBBBBBBBBBA=='));
insert into res values ('stored_sign', public.vault_store_secret(pg_temp.org('a_sign'), pg_temp.conn('a_sign'), 1, 'CCCCCCCCCCCCCCCC', 'YXNzaW5hdHVyYXM=', 'CCCCCCCCCCCCCCCCCCCCCA==', now() + interval '30 days'));
insert into res values ('stored_b', public.vault_store_secret(pg_temp.org('b'), pg_temp.conn('b'), 1, 'DDDDDDDDDDDDDDDD', 'cm9jaGE=', 'DDDDDDDDDDDDDDDDDDDDDA=='));
insert into res values ('bad_meta', public.vault_store_secret(pg_temp.org('a'), pg_temp.conn('a'), 1, 'AAAAAAAAAAAAAAAA', 'c2VncmVkbw==', 'AAAAAAAAAAAAAAAAAAAAAA==', null, '{"senha_do_tribunal": "x"}'));
reset role;

select ok(
  (select payload ->> 'code' = 'stored' from res where name = 'stored')
  and (select payload ->> 'code' = 'replaced' from res where name = 'replaced')
  and (select status = 'connected' and connected_at is not null and metadata = '{"numero": "+55 62 0000-0000"}'::jsonb
       from public.connections where id = pg_temp.conn('a')),
  'the backend seals the token, and a second seal replaces it'
);
select is(
  (select row(key_version, iv, ciphertext, org_id)::text from public.connection_secrets where connection_id = pg_temp.conn('a')),
  row(1, 'BBBBBBBBBBBBBBBB', 'b3V0cm8gc2VncmVkbw==', 'b7000000-0000-4000-8000-00000000000a'::uuid)::text,
  'one sealed token per account, under its firm'
);
select is((select payload ->> 'code' from res where name = 'bad_meta'), 'invalid_metadata', 'details that name a credential are refused');
select throws_ok(
  $$insert into public.connections (org_id, provider, label, metadata) values ('b7000000-0000-4000-8000-00000000000a', 'outro', 'Outro', '{"pin": "1234"}')$$,
  '23514', null,
  'and the table itself refuses them, whoever writes'
);
select ok(
  exists (select 1 from public.audit_events where action = 'vault.secret.stored' and actor_type = 'system'
          and entity_id = pg_temp.conn('a')::text and (metadata ->> 'replaced')::boolean),
  'sealing is audited, without the token'
);

-- ---------- Nobody reads the vault but its functions ----------

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select count(*) from public.connection_secrets$$, '42501', null, 'not who manages the firm');
select throws_ok(
  format($$select public.vault_read_secret(%L, %L, 'whatsapp.send')$$, pg_temp.org('a'), pg_temp.conn('a')),
  '42501', null,
  'nor open one through the vault'
);
select throws_ok(
  $$update public.connections set status = 'connected' where true$$,
  '42501', null,
  'nor write an account directly'
);
reset role;

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000009');
set local role authenticated;
select throws_ok($$select count(*) from public.connection_secrets$$, '42501', null, 'not the platform operator');
reset role;

select pg_temp.as_backend();
set local role service_role;
select throws_ok($$select count(*) from public.connection_secrets$$, '42501', null, 'not even the service role, outside the vault functions');
select throws_ok(
  format($$select public.vault_read_secret(%L, %L, 'Ler Tudo')$$, pg_temp.org('a'), pg_temp.conn('a')),
  '22023', 'invalid_purpose',
  'a read says what it is for'
);
insert into res values ('read', public.vault_read_secret(pg_temp.org('a'), pg_temp.conn('a'), 'whatsapp.send'));
insert into res values ('read_other_firm', public.vault_read_secret(
  'b7000000-0000-4000-8000-00000000000b', pg_temp.conn('a'), 'whatsapp.send'));
insert into res values ('store_other_firm', public.vault_store_secret(
  'b7000000-0000-4000-8000-00000000000b', pg_temp.conn('a'), 1, 'AAAAAAAAAAAAAAAA', 'c2VncmVkbw==', 'AAAAAAAAAAAAAAAAAAAAAA=='));
reset role;

select is(
  array[
    (select payload ->> 'code' from res where name = 'read_other_firm'),
    (select payload ->> 'code' from res where name = 'store_other_firm')
  ],
  array['not_found', 'not_found'],
  'work done for one firm never reaches an account of another, even holding its id'
);

select ok(
  (select payload ->> 'code' = 'read' and payload ->> 'provider' = 'whatsapp' and payload ->> 'external_id' = 'waba-1'
          and payload -> 'envelope' = '{"key_version": 1, "iv": "BBBBBBBBBBBBBBBB", "ciphertext": "b3V0cm8gc2VncmVkbw==", "tag": "BBBBBBBBBBBBBBBBBBBBBA=="}'::jsonb
   from res where name = 'read'),
  'the backend receives the sealed token, still sealed'
);
select ok(
  exists (select 1 from public.audit_events where action = 'vault.secret.read' and actor_type = 'system'
          and entity_id = pg_temp.conn('a')::text and metadata ->> 'purpose' = 'whatsapp.send')
  and (select last_used_at is not null from public.connections where id = pg_temp.conn('a')),
  'every read is audited with what it was for'
);

-- ---------- Who sees the accounts ----------

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select count(*)::int from public.connections), 2, 'who manages the firm sees its accounts');
reset role;

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select count(*)::int from public.connections), 0, 'a plain member does not');
reset role;

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000004');
set local role authenticated;
select is(
  (select array_agg(label) from public.connections), array['WhatsApp da Rocha'],
  'the owner of the other firm sees only their own'
);
select is(
  public.disconnect_connection(pg_temp.conn('a')) ->> 'code', 'not_found',
  'and an account of another firm does not exist for them'
);
reset role;

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000009');
set local role authenticated;
select is((select count(*)::int from public.connections), 3, 'the platform operator sees the accounts of every firm, never a token');
reset role;

-- ---------- How the calls go ----------

select pg_temp.as_backend();
set local role service_role;
select throws_ok(
  format($$select public.vault_report_status(%L, %L, false, 'Token inválido')$$, pg_temp.org('a'), pg_temp.conn('a')),
  '22023', 'invalid_error_code',
  'a failure is reported as a code, never the vendor''s message'
);
select public.vault_report_status(pg_temp.org('a'), pg_temp.conn('a'), false, 'token_revoked');
select public.vault_report_status(pg_temp.org('a'), pg_temp.conn('a'), false, 'token_revoked');
reset role;

select ok(
  (select status = 'error' and last_error = 'token_revoked' from public.connections where id = pg_temp.conn('a'))
  and (select count(*) = 1 from public.audit_events where action = 'connection.failed' and entity_id = pg_temp.conn('a')::text),
  'a failure moves the account to error, audited once however many calls fail'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_error', public.vault_read_secret(pg_temp.org('a'), pg_temp.conn('a'), 'whatsapp.send'));
select public.vault_report_status(pg_temp.org('a'), pg_temp.conn('a'), true);
reset role;

select ok(
  (select payload ->> 'code' = 'read' from res where name = 'read_error')
  and (select status = 'connected' and last_error is null from public.connections where id = pg_temp.conn('a'))
  and exists (select 1 from public.audit_events where action = 'connection.recovered' and entity_id = pg_temp.conn('a')::text),
  'an account in error can still be tried, and a success brings it back'
);

-- ---------- Rotating the key ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('pending', to_jsonb(public.vault_rewrap_pending(2, 100)));
insert into res values ('rewrap_stale', public.vault_rewrap_secret(pg_temp.org('a'), pg_temp.conn('a'), 7, 8, 'EEEEEEEEEEEEEEEE', 'bm92byBzZWxv', 'EEEEEEEEEEEEEEEEEEEEEA=='));
insert into res values ('rewrapped', public.vault_rewrap_secret(pg_temp.org('a'), pg_temp.conn('a'), 1, 2, 'EEEEEEEEEEEEEEEE', 'bm92byBzZWxv', 'EEEEEEEEEEEEEEEEEEEEEA=='));
insert into res values ('pending_after', to_jsonb(public.vault_rewrap_pending(2, 100)));
select throws_ok(
  format($$select public.vault_rewrap_secret(%L, %L, 2, 2, 'EEEEEEEEEEEEEEEE', 'bm92byBzZWxv', 'EEEEEEEEEEEEEEEEEEEEEA==')$$, pg_temp.org('a'), pg_temp.conn('a')),
  '22023', 'invalid_key_version',
  'a rotation only moves to a newer key'
);
reset role;

select is(
  (select jsonb_array_length(payload) from res where name = 'pending'), 3,
  'the rotation finds every token sealed by an older key'
);
select ok(
  (select payload ->> 'code' = 'changed' from res where name = 'rewrap_stale')
  and (select payload ->> 'code' = 'rewrapped' from res where name = 'rewrapped')
  and (select key_version = 2 and rewrapped_at is not null from public.connection_secrets where connection_id = pg_temp.conn('a'))
  and (select jsonb_array_length(payload) = 2 from res where name = 'pending_after'),
  'and reseals one only if it is still the token it read'
);
select ok(
  exists (select 1 from public.audit_events where action = 'vault.secret.rewrapped'
          and entity_id = pg_temp.conn('a')::text and metadata ->> 'from' = '1' and metadata ->> 'to' = '2'),
  'a reseal is audited'
);

-- ---------- Validity ----------

-- The signature account's token stopped working yesterday.
update public.connections set expires_at = now() - interval '1 day' where id = pg_temp.conn('a_sign');

select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_expired', public.vault_read_secret(pg_temp.org('a_sign'), pg_temp.conn('a_sign'), 'assinaturas.enviar'));
insert into res values ('store_expired', public.vault_store_secret(pg_temp.org('a_sign'), pg_temp.conn('a_sign'), 2, 'CCCCCCCCCCCCCCCC', 'YXNzaW5hdHVyYXM=', 'CCCCCCCCCCCCCCCCCCCCCA=='));
reset role;

select ok(
  (select payload ->> 'code' = 'expired' from res where name = 'read_expired')
  and (select status = 'expired' from public.connections where id = pg_temp.conn('a_sign'))
  and not exists (select 1 from public.connection_secrets where connection_id = pg_temp.conn('a_sign'))
  and exists (select 1 from public.audit_events where action = 'connection.expired' and entity_id = pg_temp.conn('a_sign')::text),
  'a token past its validity is discarded when it is asked for, and the account shows as expired'
);
select is(
  (select payload ->> 'code' from res where name = 'store_expired'), 'expired',
  'an expired account is not brought back by the backend on its own'
);

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a_sign_again', public.begin_connection('b7000000-0000-4000-8000-00000000000a', 'zapsign', null, 'Assinaturas'));
reset role;

select ok(
  pg_temp.conn('a_sign_again') = pg_temp.conn('a_sign')
  and (select status = 'pending' from public.connections where id = pg_temp.conn('a_sign')),
  'a person starts it again, on the same account'
);

-- The sweep: firm B's token ends now, and an account started two days ago was never sealed.
update public.connections set expires_at = now() - interval '1 minute' where id = pg_temp.conn('b');
insert into public.connections (org_id, provider, external_id, label, connected_by, updated_at)
values ('b7000000-0000-4000-8000-00000000000b', 'google', 'agenda', 'Agenda', 'a7000000-0000-4000-8000-000000000004', now() - interval '2 days');

select pg_temp.as_backend();
set local role service_role;
insert into res values ('sweep', public.expire_connections());
insert into res values ('sweep_again', public.expire_connections());
reset role;

select is(
  array[(select payload from res where name = 'sweep'), (select payload from res where name = 'sweep_again')],
  array['{"expired": 1, "abandoned": 1}'::jsonb, '{"expired": 0, "abandoned": 0}'::jsonb],
  'the sweep discards the tokens that ended and the starts never sealed, once'
);
select ok(
  (select status = 'expired' from public.connections where id = pg_temp.conn('b'))
  and not exists (select 1 from public.connection_secrets where connection_id = pg_temp.conn('b'))
  and not exists (select 1 from public.connections where provider = 'google'),
  'leaving no token behind'
);

-- ---------- Disconnecting ----------

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  format($$select public.disconnect_connection(%L)$$, pg_temp.conn('a')),
  '42501', 'not_authorized',
  'a plain member does not disconnect an account'
);
reset role;

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
select throws_ok(
  format($$select public.disconnect_connection(%L)$$, pg_temp.conn('a')),
  '42501', 'second_factor_required',
  'disconnecting asks for the second factor'
);
reset role;

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001', 'aal2', 'f7000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format($$select public.disconnect_connection(%L)$$, pg_temp.conn('a')),
  '42501', 'not_allowed_in_support_session',
  'and is never done from a support visit'
);
reset role;

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('cut', public.disconnect_connection(pg_temp.conn('a')));
insert into res values ('cut_again', public.disconnect_connection(pg_temp.conn('a')));
reset role;

select ok(
  (select payload ->> 'code' = 'disconnected' from res where name = 'cut')
  and (select payload ->> 'code' = 'already_disconnected' from res where name = 'cut_again')
  and (select status = 'disconnected' and disconnected_by = 'a7000000-0000-4000-8000-000000000001' and disconnected_at is not null
       from public.connections where id = pg_temp.conn('a'))
  and not exists (select 1 from public.connection_secrets where connection_id = pg_temp.conn('a')),
  'who manages the firm cuts an account, and its token is discarded at once'
);
select ok(
  exists (select 1 from public.audit_events where action = 'connection.disconnected' and actor_type = 'person'
          and actor_id = 'a7000000-0000-4000-8000-000000000001' and entity_id = pg_temp.conn('a')::text),
  'cutting is audited as done by the person'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('read_cut', public.vault_read_secret(pg_temp.org('a'), pg_temp.conn('a'), 'whatsapp.send'));
insert into res values ('store_cut', public.vault_store_secret(pg_temp.org('a'), pg_temp.conn('a'), 2, 'AAAAAAAAAAAAAAAA', 'c2VncmVkbw==', 'AAAAAAAAAAAAAAAAAAAAAA=='));
reset role;

select is(
  array[(select payload ->> 'code' from res where name = 'read_cut'), (select payload ->> 'code' from res where name = 'store_cut')],
  array['disconnected', 'disconnected'],
  'a cut account gives nothing to read, and the backend does not seal it again on its own'
);

-- ---------- The firm goes, its accounts and tokens with it ----------

select pg_temp.sign_in('a7000000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b_new', public.begin_connection('b7000000-0000-4000-8000-00000000000b', 'whatsapp', 'waba-10', 'Outro número'));
reset role;

select pg_temp.as_backend();
set local role service_role;
select public.vault_store_secret(pg_temp.org('b_new'), pg_temp.conn('b_new'), 1, 'DDDDDDDDDDDDDDDD', 'cm9jaGE=', 'DDDDDDDDDDDDDDDDDDDDDA==');
reset role;

delete from public.organizations where id = 'b7000000-0000-4000-8000-00000000000b';
select ok(
  not exists (select 1 from public.connections where org_id = 'b7000000-0000-4000-8000-00000000000b')
  and not exists (select 1 from public.connection_secrets where org_id = 'b7000000-0000-4000-8000-00000000000b')
  and exists (select 1 from public.connections where org_id = 'b7000000-0000-4000-8000-00000000000a'),
  'deleting a firm removes its accounts and their tokens, and nothing of the other firm'
);

select * from finish();
rollback;
