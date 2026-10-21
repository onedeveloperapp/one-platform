-- ============================================================
-- 0017_connections: the firm's accounts at its vendors, and the vault that
-- keeps their API tokens.
--
-- A connection is one account of a firm at one vendor: its WhatsApp Business
-- account, its signature platform, its court-data aggregator. What the
-- platform needs to act on that account is a vendor's API token, and only
-- that: a lawyer's password, PIN, second-factor seed or digital certificate
-- is never stored here or anywhere (`is_credential_name` below refuses the
-- names, and a catalog test refuses such a column anywhere). Since 0041 the
-- vault also keeps one thing of a lawyer's: the authorization they give ONE
-- at the provider of their certificate in the cloud (a PSC), as a connection
-- of that person, under rules of its own; never the certificate, its key or
-- the factors that unlock it.
--
--   connections         the account: vendor, label, status, validity, and
--                       non-secret details. Read by who manages the firm.
--   connection_secrets  the token, ENCRYPTED. AES-256-GCM in the backend with
--                       a key that never enters the database (`VAULT_KEYS`),
--                       bound to the firm and the connection, with the key
--                       version that sealed it so the key can be rotated.
--                       No API role reads it, not even the service role: the
--                       functions below are the only door, and every read
--                       through them is audited with its purpose. It is left
--                       out of the logical backup (packages/backup).
--
-- Who connects or disconnects: who manages the firm, with the second factor,
-- never from a support visit. Sealing a token, reading it, reporting how a
-- call went and the upkeep are the backend's (the service role), and each of
-- those functions receives the firm together with the connection: work done
-- for one firm can never reach an account of another by a wrong id.
-- ============================================================

-- ---------- What may never be stored ----------

/**
 * True when a name says it holds a lawyer's own credential: a password, a
 * PIN, a one-time code or its seed, a certificate or a private key. camelCase
 * is split first, so `pinCode` reads as `pin_code`; a word that merely
 * contains one of these (`shipping`, `certidao`) is not one.
 */
create or replace function public.is_credential_name(name text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(regexp_replace(coalesce(name, ''), '([a-z0-9])([A-Z])', '\1_\2', 'g'))
    ~ '(^|[^a-z0-9])(senha|password|passwd|passphrase|pin|otp|totp|mfa|2fa|seed|certificado|certificate|cert|pfx|p12|pkcs12|private_?key|chave_?privada)([^a-z0-9]|$)';
$$;

revoke all on function public.is_credential_name(text) from public, anon;
grant execute on function public.is_credential_name(text) to authenticated;

/** True when any key of the object, at any depth, is a credential name. */
create or replace function public.jsonb_has_credential_key(value jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select exists (
    select 1
    from jsonb_path_query(coalesce(value, '{}'::jsonb), 'strict $.**') as item
    cross join lateral jsonb_object_keys(case when jsonb_typeof(item) = 'object' then item else '{}'::jsonb end) as key
    where public.is_credential_name(key)
  );
$$;

revoke all on function public.jsonb_has_credential_key(jsonb) from public, anon;
grant execute on function public.jsonb_has_credential_key(jsonb) to authenticated;

-- ---------- Connections ----------

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The vendor, as a slug: `whatsapp`, `zapsign`, `google`.
  provider text not null,
  -- The account at the vendor (a WhatsApp Business account, an account id).
  -- NULL when the vendor has one account per firm.
  external_id text,
  label text not null,
  -- pending       started by a person, the token not sealed yet;
  -- connected     the token is sealed and in use;
  -- error         the last call with it failed (`last_error` says how);
  -- expired       its validity ended: the token was discarded;
  -- disconnected  somebody of the firm cut it: the token was discarded.
  status text not null default 'pending',
  -- Non-secret details of the account (a display number, a business name).
  metadata jsonb not null default '{}'::jsonb,
  -- When the token stops working, when the vendor says so. NULL: no end.
  expires_at timestamptz,
  last_used_at timestamptz,
  -- A short code, never the vendor's message.
  last_error text,
  connected_by uuid references public.profiles (id) on delete set null,
  connected_at timestamptz,
  disconnected_by uuid references public.profiles (id) on delete set null,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- What a secret refers to: the connection AND its firm, so a secret can never
  -- sit under a connection of another firm.
  unique (id, org_id),
  -- One row per account: reconnecting reuses it.
  constraint connections_account_key unique nulls not distinct (org_id, provider, external_id),
  constraint connections_provider_check check (provider ~ '^[a-z][a-z0-9_.-]{1,39}$'),
  constraint connections_external_check check (external_id is null or char_length(external_id) between 1 and 200),
  constraint connections_label_check check (char_length(btrim(label)) between 1 and 120),
  constraint connections_status_check check (status in ('pending', 'connected', 'error', 'expired', 'disconnected')),
  constraint connections_metadata_check check (
    jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 8000
    and not public.jsonb_has_credential_key(metadata)
  ),
  constraint connections_error_check check (last_error is null or last_error ~ '^[a-z][a-z0-9_]{1,63}$')
);

create index connections_org_idx on public.connections (org_id, provider);
create index connections_expiring_idx on public.connections (expires_at) where status in ('connected', 'error');

alter table public.connections enable row level security;

-- Who manages the firm reads its accounts; the platform operator too, for
-- support (never a token: those are in the other table, which nobody reads).
create policy "connections_select_manager" on public.connections
  for select to authenticated
  using (
    public.has_org_role(org_id, array['owner', 'admin']::public.org_role[])
    or public.is_superadmin()
  );

-- Read-only for the API roles: written by the functions below only.
grant select on table public.connections to authenticated;

create trigger connections_updated_at
  before update on public.connections
  for each row execute function public.set_updated_at();

create trigger guard_impersonation_connections
  after insert or update or delete on public.connections
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- The vault ----------

create table public.connection_secrets (
  connection_id uuid primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The version of the backend key that sealed it (`VAULT_KEYS`).
  key_version integer not null,
  -- AES-256-GCM: 12-byte nonce, the sealed token, 16-byte tag, base64.
  iv text not null,
  ciphertext text not null,
  auth_tag text not null,
  -- The seal itself: a new token is a new seal, and a reseal under a newer key keeps it.
  seal_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  rewrapped_at timestamptz,
  foreign key (connection_id, org_id) references public.connections (id, org_id) on delete cascade,
  constraint connection_secrets_version_check check (key_version between 1 and 9999),
  constraint connection_secrets_iv_check check (iv ~ '^[A-Za-z0-9+/]{16}$'),
  constraint connection_secrets_ciphertext_check check (ciphertext ~ '^[A-Za-z0-9+/]+={0,2}$' and char_length(ciphertext) between 4 and 24000),
  constraint connection_secrets_tag_check check (auth_tag ~ '^[A-Za-z0-9+/]{22}==$')
);

create index connection_secrets_version_idx on public.connection_secrets (key_version);

comment on table public.connection_secrets is
  'Vendor API tokens, sealed by the backend (AES-256-GCM, key outside the database). No API role reads it; the vault_* functions are the only door, every read audited. Never in the logical backup.';

alter table public.connection_secrets enable row level security;

-- Not even the service role reads or writes it directly: a read that does not
-- go through vault_read_secret would not be audited.
revoke all on table public.connection_secrets from public, anon, authenticated, service_role;

create trigger guard_impersonation_connection_secrets
  after insert or update or delete on public.connection_secrets
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- What a person of the firm does ----------

/**
 * Starts connecting an account of the firm: returns the connection the
 * backend then seals the token under. Who manages the firm, with the second
 * factor, never from a support visit. Starting again for the same account
 * reuses its row, so a reconnection replaces the token instead of adding a
 * second account.
 */
create or replace function public.begin_connection(
  target_org uuid,
  target_provider text,
  target_external_id text default null,
  target_label text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  clean_external text := nullif(btrim(target_external_id), '');
  clean_label text := left(coalesce(nullif(btrim(target_label), ''), target_provider), 120);
  existing public.connections%rowtype;
  connection uuid;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();

  -- A PSC's connection is a lawyer's own authorization, started by that lawyer alone (0041).
  if target_provider is null or target_provider !~ '^[a-z][a-z0-9_.-]{1,39}$' or target_provider ~ '^psc[.]' then
    return jsonb_build_object('ok', false, 'code', 'invalid_provider');
  end if;
  if clean_external is not null and char_length(clean_external) > 200 then
    return jsonb_build_object('ok', false, 'code', 'invalid_external_id');
  end if;

  select * into existing from public.connections
  where org_id = target_org and provider = target_provider and external_id is not distinct from clean_external
  for update;

  if found then
    connection := existing.id;
    update public.connections set
      label = clean_label,
      status = case when status in ('connected', 'error') then status else 'pending' end,
      connected_by = caller,
      disconnected_by = null,
      disconnected_at = null
    where id = existing.id;
  else
    insert into public.connections (org_id, provider, external_id, label, connected_by)
    values (target_org, target_provider, clean_external, clean_label, caller)
    returning id into connection;
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org, caller, 'connection.started', 'connection', connection::text,
    jsonb_strip_nulls(jsonb_build_object('provider', target_provider, 'external_id', clean_external, 'again', existing.id is not null))
  );

  return jsonb_build_object(
    'ok', true,
    'code', case when existing.id is null then 'started' else 'existing' end,
    'connection_id', connection,
    'org_id', target_org
  );
end;
$$;

revoke all on function public.begin_connection(uuid, text, text, text) from public, anon;
grant execute on function public.begin_connection(uuid, text, text, text) to authenticated;

/**
 * Cuts an account of the firm: the token is discarded at once (it can never be
 * read again) and the account shows as disconnected. Who manages the firm,
 * with the second factor, never from a support visit.
 */
create or replace function public.disconnect_connection(target_connection uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  conn public.connections%rowtype;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;

  select * into conn from public.connections where id = target_connection for update;
  -- The same answer for one that does not exist and one of another firm.
  if not found or not public.is_org_member(conn.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_org_role(conn.org_id, array['owner', 'admin']::public.org_role[]) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();

  if conn.status = 'disconnected' then
    return jsonb_build_object('ok', true, 'code', 'already_disconnected');
  end if;

  delete from public.connection_secrets where connection_id = conn.id;
  update public.connections set
    status = 'disconnected',
    disconnected_by = caller,
    disconnected_at = now(),
    last_error = null
  where id = conn.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (conn.org_id, caller, 'connection.disconnected', 'connection', conn.id::text,
          jsonb_build_object('provider', conn.provider));

  return jsonb_build_object('ok', true, 'code', 'disconnected');
end;
$$;

revoke all on function public.disconnect_connection(uuid) from public, anon;
grant execute on function public.disconnect_connection(uuid) to authenticated;

-- ---------- What the backend does (the service role) ----------

/**
 * Seals the token of a connection that a person started (or replaces it, on a
 * reconnection or a token refresh). The envelope arrives already encrypted:
 * the database never sees the token or the key.
 */
create or replace function public.vault_store_secret(
  target_org uuid,
  target_connection uuid,
  target_key_version integer,
  target_iv text,
  target_ciphertext text,
  target_tag text,
  target_expires_at timestamptz default null,
  target_metadata jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conn public.connections%rowtype;
  replaced boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into conn from public.connections where id = target_connection and org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  -- A cut account is started again by a person (begin_connection), never
  -- brought back by the backend on its own.
  if conn.status in ('disconnected', 'expired') then
    return jsonb_build_object('ok', false, 'code', conn.status);
  end if;
  if target_expires_at is not null and target_expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'already_expired');
  end if;
  if target_metadata is not null and (
    jsonb_typeof(target_metadata) <> 'object' or public.jsonb_has_credential_key(target_metadata)
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_metadata');
  end if;

  replaced := exists (select 1 from public.connection_secrets s where s.connection_id = conn.id);

  insert into public.connection_secrets (connection_id, org_id, key_version, iv, ciphertext, auth_tag)
  values (conn.id, conn.org_id, target_key_version, target_iv, target_ciphertext, target_tag)
  on conflict (connection_id) do update set
    key_version = excluded.key_version,
    iv = excluded.iv,
    ciphertext = excluded.ciphertext,
    auth_tag = excluded.auth_tag,
    seal_id = gen_random_uuid(),
    created_at = now(),
    rewrapped_at = null;

  update public.connections set
    status = 'connected',
    connected_at = now(),
    expires_at = target_expires_at,
    last_error = null,
    metadata = coalesce(target_metadata, metadata)
  where id = conn.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (conn.org_id, null, 'vault.secret.stored', 'connection', conn.id::text,
          jsonb_build_object('provider', conn.provider, 'key_version', target_key_version, 'replaced', replaced));

  return jsonb_build_object('ok', true, 'code', case when replaced then 'replaced' else 'stored' end);
end;
$$;

revoke all on function public.vault_store_secret(uuid, uuid, integer, text, text, text, timestamptz, jsonb) from public, anon, authenticated;

/**
 * Hands the sealed token of a connection to the backend, which opens it with
 * its key. Every read is audited with what it was for (`whatsapp.send`), so a
 * caller reads once per batch of work, never once per message. A token whose
 * validity ended is discarded here and nothing is returned.
 */
create or replace function public.vault_read_secret(target_org uuid, target_connection uuid, target_purpose text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conn public.connections%rowtype;
  sealed public.connection_secrets%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_purpose is null or target_purpose !~ '^[a-z][a-z0-9_.-]{2,63}$' then
    raise exception 'invalid_purpose' using errcode = '22023';
  end if;

  select * into conn from public.connections where id = target_connection and org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if conn.status in ('connected', 'error') and conn.expires_at is not null and conn.expires_at <= now() then
    delete from public.connection_secrets where connection_id = conn.id;
    update public.connections set status = 'expired' where id = conn.id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (conn.org_id, null, 'connection.expired', 'connection', conn.id::text,
            jsonb_build_object('provider', conn.provider));
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;
  if conn.status not in ('connected', 'error') then
    return jsonb_build_object('ok', false, 'code', conn.status);
  end if;

  select * into sealed from public.connection_secrets where connection_id = conn.id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_secret');
  end if;

  update public.connections set last_used_at = now() where id = conn.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (conn.org_id, null, 'vault.secret.read', 'connection', conn.id::text,
          jsonb_build_object('provider', conn.provider, 'purpose', target_purpose));

  return jsonb_build_object(
    'ok', true,
    'code', 'read',
    'org_id', conn.org_id,
    'provider', conn.provider,
    'external_id', conn.external_id,
    'status', conn.status,
    'expires_at', conn.expires_at,
    'envelope', jsonb_build_object(
      'key_version', sealed.key_version,
      'iv', sealed.iv,
      'ciphertext', sealed.ciphertext,
      'tag', sealed.auth_tag
    )
  );
end;
$$;

revoke all on function public.vault_read_secret(uuid, uuid, text) from public, anon, authenticated;

/**
 * How the last call with a connection went. A failure moves it to `error`
 * with a short code (the token revoked at the vendor, a permission removed);
 * a success after a failure brings it back. Audited only when the state
 * changes, so a busy account does not flood the trail.
 */
create or replace function public.vault_report_status(
  target_org uuid,
  target_connection uuid,
  target_ok boolean,
  target_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conn public.connections%rowtype;
  code text := nullif(btrim(target_error_code), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not coalesce(target_ok, false) and (code is null or code !~ '^[a-z][a-z0-9_]{1,63}$') then
    raise exception 'invalid_error_code' using errcode = '22023';
  end if;

  select * into conn from public.connections where id = target_connection and org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if conn.status not in ('connected', 'error') then
    return jsonb_build_object('ok', false, 'code', conn.status);
  end if;

  if target_ok then
    if conn.status = 'error' then
      update public.connections set status = 'connected', last_error = null where id = conn.id;
      insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
      values (conn.org_id, null, 'connection.recovered', 'connection', conn.id::text,
              jsonb_build_object('provider', conn.provider));
    end if;
    return jsonb_build_object('ok', true, 'code', 'connected');
  end if;

  if conn.status <> 'error' or conn.last_error is distinct from code then
    update public.connections set status = 'error', last_error = code where id = conn.id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (conn.org_id, null, 'connection.failed', 'connection', conn.id::text,
            jsonb_build_object('provider', conn.provider, 'error_code', code));
  end if;
  return jsonb_build_object('ok', true, 'code', 'error');
end;
$$;

revoke all on function public.vault_report_status(uuid, uuid, boolean, text) from public, anon, authenticated;

/** The connections, each with its firm, whose token was sealed by a key older than `target_key_version`: what a rotation still has to do. */
create or replace function public.vault_rewrap_pending(target_key_version integer, target_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  pending jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('org_id', batch.org_id, 'connection_id', batch.connection_id)), '[]'::jsonb)
  into pending
  from (
    select s.org_id, s.connection_id
    from public.connection_secrets s
    where s.key_version < target_key_version
    order by s.created_at
    limit least(greatest(coalesce(target_limit, 100), 1), 1000)
  ) batch;
  return pending;
end;
$$;

revoke all on function public.vault_rewrap_pending(integer, integer) from public, anon, authenticated;

/**
 * Replaces a sealed token with the same token sealed by a newer key. Only when
 * the token is still the one the backend read (`target_from_version`): a token
 * replaced meanwhile is left alone.
 */
create or replace function public.vault_rewrap_secret(
  target_org uuid,
  target_connection uuid,
  target_from_version integer,
  target_key_version integer,
  target_iv text,
  target_ciphertext text,
  target_tag text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conn_org uuid;
  conn_provider text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_key_version <= target_from_version then
    raise exception 'invalid_key_version' using errcode = '22023';
  end if;

  update public.connection_secrets set
    key_version = target_key_version,
    iv = target_iv,
    ciphertext = target_ciphertext,
    auth_tag = target_tag,
    rewrapped_at = now()
  where connection_id = target_connection and org_id = target_org and key_version = target_from_version
  returning org_id into conn_org;
  if conn_org is null then
    return jsonb_build_object('ok', false, 'code', 'changed');
  end if;

  select provider into conn_provider from public.connections where id = target_connection;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (conn_org, null, 'vault.secret.rewrapped', 'connection', target_connection::text,
          jsonb_build_object('provider', conn_provider, 'from', target_from_version, 'to', target_key_version));

  return jsonb_build_object('ok', true, 'code', 'rewrapped');
end;
$$;

revoke all on function public.vault_rewrap_secret(uuid, uuid, integer, integer, text, text, text) from public, anon, authenticated;

/**
 * The upkeep, recomputed from the data on every pass: a token whose validity
 * ended is discarded and its account shows as expired; an account started
 * and never sealed within a day is removed.
 */
create or replace function public.expire_connections()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expired integer := 0;
  abandoned integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  with ended as (
    select c.id from public.connections c
    where c.status in ('connected', 'error') and c.expires_at is not null and c.expires_at <= now()
    order by c.expires_at
    limit 500
    for update skip locked
  ),
  discarded as (
    delete from public.connection_secrets s using ended where s.connection_id = ended.id
  ),
  closed as (
    update public.connections c set status = 'expired'
    from ended where c.id = ended.id
    returning c.id, c.org_id, c.provider
  ),
  audited as (
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    select closed.org_id, null, 'connection.expired', 'connection', closed.id::text,
           jsonb_build_object('provider', closed.provider)
    from closed
    returning 1
  )
  select count(*)::integer into expired from audited;

  -- A start that was never sealed within a day is given up. An account that
  -- was never connected is removed: nothing hangs on it. One that was connected
  -- before, and that somebody began to connect again, goes back to
  -- disconnected and STAYS: what the firm did through it (the conversations of
  -- a number) refers to it, and a failed attempt to reconnect must cost nothing.
  with stale as (
    select c.id, c.connected_at is not null as was_connected from public.connections c
    where c.status = 'pending' and c.updated_at < now() - interval '1 day'
      and not exists (select 1 from public.connection_secrets s where s.connection_id = c.id)
    limit 500
    for update skip locked
  ),
  returned as (
    update public.connections c set status = 'disconnected', disconnected_at = now()
    from stale where c.id = stale.id and stale.was_connected
    returning c.id, c.org_id, c.provider
  ),
  removed as (
    delete from public.connections c using stale where c.id = stale.id and not stale.was_connected
    returning c.id, c.org_id, c.provider
  ),
  audited as (
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    select gone.org_id, null, 'connection.abandoned', 'connection', gone.id::text,
           jsonb_build_object('provider', gone.provider, 'kept', gone.kept)
    from (
      select removed.id, removed.org_id, removed.provider, false as kept from removed
      union all
      select returned.id, returned.org_id, returned.provider, true as kept from returned
    ) as gone
    returning 1
  )
  select count(*)::integer into abandoned from audited;

  return jsonb_build_object('expired', expired, 'abandoned', abandoned);
end;
$$;

revoke all on function public.expire_connections() from public, anon, authenticated;
