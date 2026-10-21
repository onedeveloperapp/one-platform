-- ============================================================
-- 0018_files_documents: the firm's files, and the documents ONE issues.
--
-- Files. Every file of a firm lives in the private bucket `firm-files`, under
-- `org/<org_id>/<purpose>/<file id>`. Nobody reads or writes the bucket with
-- a session: an upload goes straight from the browser to storage through a
-- signed upload URL the backend mints after `reserve_file_upload` (so it never
-- passes through the 4.5 MB limit of a serverless request), and a download is
-- a short-lived signed URL the backend mints after the person's session reads
-- the row (row-level security is what proves they belong to the firm). The
-- backend then confirms the upload: it downloads the object, measures it
-- (SHA-256, size, the type its bytes say it is, the pages of a PDF) and keeps
-- it or rejects it. What may be uploaded, and how large, is a setting
-- (`platform_settings` key `files`).
--
-- Issued documents. A document ONE issues (a power of attorney, a contract, a
-- filing package) is a version with a public code: whoever holds the paper
-- or the PDF can check at /verificar/<code> that the firm issued it, which
-- version it is and whether it was revoked, without seeing anything of its
-- content. Issuing is idempotent (the same request is one version) and fenced
-- (one renderer at a time); a document is revoked, never deleted.
-- ============================================================

-- ---------- Files ----------

insert into storage.buckets (id, name, public, file_size_limit)
values ('firm-files', 'firm-files', false, 52428800)
on conflict (id) do nothing;

create table public.files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- What the file is for: `upload` (sent by a person of the firm), `issued`
  -- (a document ONE issued). The setting says who may reserve each one.
  purpose text not null,
  storage_path text not null unique,
  -- The name a person gave it, shown on screen; never part of the path.
  name text not null,
  declared_mime text not null,
  declared_bytes bigint not null,
  -- reserved  the upload may happen until `expires_at`;
  -- stored    the backend measured it and kept it;
  -- rejected  the backend measured it and discarded it (`rejected_reason`).
  status text not null default 'reserved',
  sha256 text,
  bytes bigint,
  detected_mime text,
  pages integer,
  rejected_reason text,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  unique (id, org_id),
  constraint files_purpose_check check (purpose ~ '^[a-z][a-z0-9_.-]{1,39}$'),
  constraint files_name_check check (char_length(btrim(name)) between 1 and 200 and name !~ '[[:cntrl:]]'),
  constraint files_declared_check check (declared_bytes > 0 and declared_mime ~ '^[a-z]+/[a-z0-9.+-]+$'),
  constraint files_status_check check (status in ('reserved', 'stored', 'rejected')),
  constraint files_sha_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint files_measured_check check ((status = 'reserved') = (confirmed_at is null)),
  constraint files_stored_check check (status <> 'stored' or (sha256 is not null and bytes is not null and detected_mime is not null)),
  constraint files_rejected_check check ((status = 'rejected') = (rejected_reason is not null))
);

create index files_org_idx on public.files (org_id, created_at desc);
create index files_reserved_idx on public.files (expires_at) where status = 'reserved';

alter table public.files enable row level security;

-- The people of the firm see its files. The bytes still need a signed URL.
create policy "files_select_member" on public.files
  for select to authenticated
  using (public.is_org_member(org_id));

grant select on table public.files to authenticated;

create trigger guard_impersonation_files
  after insert or update or delete on public.files
  for each statement execute function public.guard_impersonation_readonly();

/** What may be uploaded for a purpose, from the setting; NULL when the purpose does not exist. */
create or replace function public.file_purpose_rule(target_purpose text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select s.value -> 'purposes' -> target_purpose
  from public.platform_settings s
  where s.key = 'files';
$$;

revoke all on function public.file_purpose_rule(text) from public, anon, authenticated;

/** The checks a reservation passes, the same for a person and the backend. NULL when it may proceed. */
create or replace function public.file_reservation_problem(
  rule jsonb,
  target_name text,
  target_mime text,
  target_bytes bigint
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when rule is null then 'unknown_purpose'
    when target_name is null or char_length(btrim(target_name)) not between 1 and 200 or target_name ~ '[[:cntrl:]]' then 'invalid_name'
    when target_mime is null or not (rule -> 'mimes') ? lower(btrim(target_mime)) then 'type_not_allowed'
    when target_bytes is null or target_bytes <= 0 then 'invalid_size'
    when target_bytes > coalesce((rule ->> 'max_bytes')::bigint, 0) then 'too_large'
  end;
$$;

revoke all on function public.file_reservation_problem(jsonb, text, text, bigint) from public, anon, authenticated;

create or replace function public.insert_file_reservation(
  target_org uuid,
  target_purpose text,
  target_name text,
  target_mime text,
  target_bytes bigint,
  target_uploaded_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid := gen_random_uuid();
  path text := 'org/' || target_org::text || '/' || target_purpose || '/' || new_id::text;
  minutes integer;
  until timestamptz;
begin
  select least(greatest(coalesce((s.value ->> 'reservation_minutes')::integer, 60), 5), 1440) into minutes
  from public.platform_settings s where s.key = 'files';
  until := now() + make_interval(mins => coalesce(minutes, 60));

  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, uploaded_by, expires_at)
  values (new_id, target_org, target_purpose, path, btrim(target_name), lower(btrim(target_mime)), target_bytes,
          target_uploaded_by, until);

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, target_uploaded_by, 'file.reserved', 'file', new_id::text,
          jsonb_build_object('purpose', target_purpose, 'mime', lower(btrim(target_mime)), 'bytes', target_bytes));

  return jsonb_build_object('ok', true, 'code', 'reserved', 'file_id', new_id, 'storage_path', path, 'expires_at', until);
end;
$$;

revoke all on function public.insert_file_reservation(uuid, text, text, text, bigint, uuid) from public, anon, authenticated;

/**
 * A person of the firm reserves an upload. The backend then mints the signed
 * upload URL for the returned path. Only the purposes the setting opens to
 * people (`people: true`); never from a support visit.
 */
create or replace function public.reserve_file_upload(
  target_org uuid,
  target_purpose text,
  target_name text,
  target_mime text,
  target_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  rule jsonb := public.file_purpose_rule(target_purpose);
  problem text;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if rule is not null and not coalesce((rule ->> 'people')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', 'purpose_not_allowed');
  end if;
  problem := public.file_reservation_problem(rule, target_name, target_mime, target_bytes);
  if problem is not null then
    return jsonb_build_object('ok', false, 'code', problem);
  end if;
  return public.insert_file_reservation(target_org, target_purpose, target_name, target_mime, target_bytes, caller);
end;
$$;

revoke all on function public.reserve_file_upload(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.reserve_file_upload(uuid, text, text, text, bigint) to authenticated;

/** The backend reserves a file of its own making (an issued document), for a firm and, when a person asked, for them. */
create or replace function public.reserve_file(
  target_org uuid,
  target_purpose text,
  target_name text,
  target_mime text,
  target_bytes bigint,
  target_requested_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  problem text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations o where o.id = target_org) then
    return jsonb_build_object('ok', false, 'code', 'firm_not_found');
  end if;
  if target_requested_by is not null and not exists (
    select 1 from public.memberships m where m.org_id = target_org and m.user_id = target_requested_by
  ) then
    return jsonb_build_object('ok', false, 'code', 'requester_not_in_firm');
  end if;
  problem := public.file_reservation_problem(public.file_purpose_rule(target_purpose), target_name, target_mime, target_bytes);
  if problem is not null then
    return jsonb_build_object('ok', false, 'code', problem);
  end if;
  return public.insert_file_reservation(target_org, target_purpose, target_name, target_mime, target_bytes, target_requested_by);
end;
$$;

revoke all on function public.reserve_file(uuid, text, text, text, bigint, uuid) from public, anon, authenticated;

/**
 * The backend measured the object it found at the reserved path: it is kept
 * when its bytes are of a type the purpose allows and within the size, and
 * rejected otherwise (the backend then removes the object). A file is
 * confirmed once; the same measure again is an answer, not a change.
 */
create or replace function public.confirm_file(
  target_file uuid,
  target_sha256 text,
  target_bytes bigint,
  target_detected_mime text,
  target_pages integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  file public.files%rowtype;
  rule jsonb;
  detected text := lower(nullif(btrim(target_detected_mime), ''));
  reason text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_sha256 is null or target_sha256 !~ '^[0-9a-f]{64}$' or target_bytes is null or target_bytes < 0 then
    raise exception 'invalid_measure' using errcode = '22023';
  end if;

  select * into file from public.files where id = target_file for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if file.status <> 'reserved' then
    return jsonb_build_object(
      'ok', file.status = 'stored' and file.sha256 = target_sha256,
      'code', case when file.status = 'stored' and file.sha256 = target_sha256 then 'stored' else 'already_' || file.status end,
      'reason', file.rejected_reason
    );
  end if;

  rule := public.file_purpose_rule(file.purpose);
  reason := case
    when target_bytes = 0 then 'empty'
    when detected is null or rule is null or not (rule -> 'mimes') ? detected then 'type_not_allowed'
    when target_bytes > coalesce((rule ->> 'max_bytes')::bigint, 0) then 'too_large'
  end;

  update public.files set
    status = case when reason is null then 'stored' else 'rejected' end,
    sha256 = case when reason is null then target_sha256 end,
    bytes = target_bytes,
    detected_mime = detected,
    pages = case when target_pages is not null and target_pages > 0 then target_pages end,
    rejected_reason = reason,
    confirmed_at = now()
  where id = file.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (file.org_id, null, case when reason is null then 'file.stored' else 'file.rejected' end, 'file', file.id::text,
          jsonb_strip_nulls(jsonb_build_object('purpose', file.purpose, 'mime', detected, 'bytes', target_bytes, 'reason', reason)));

  return jsonb_build_object(
    'ok', reason is null,
    'code', case when reason is null then 'stored' else 'rejected' end,
    'reason', reason
  );
end;
$$;

revoke all on function public.confirm_file(uuid, text, bigint, text, integer) from public, anon, authenticated;

/**
 * Forgets a file nothing refers to: the PDF of a render that did not get
 * published. Its object then has no record, and the upkeep removes it. A
 * file an issued document names is never forgotten.
 */
create or replace function public.discard_file(target_file uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  file public.files%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into file from public.files where id = target_file for update;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'not_found');
  end if;
  if exists (select 1 from public.issued_documents d where d.file_id = file.id) then
    return jsonb_build_object('ok', false, 'code', 'in_use');
  end if;

  delete from public.files where id = file.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (file.org_id, null, 'file.discarded', 'file', file.id::text,
          jsonb_build_object('purpose', file.purpose, 'status', file.status));
  return jsonb_build_object('ok', true, 'code', 'discarded');
end;
$$;

revoke all on function public.discard_file(uuid) from public, anon, authenticated;

/**
 * The upkeep of the bucket, recomputed from the data on every pass: a
 * reservation whose time ended without an upload is removed, and the paths
 * of objects nothing keeps (no row, or a rejected one) are handed to the
 * backend, which removes them through the Storage API.
 */
create or replace function public.expire_file_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  with stale as (
    select f.id from public.files f
    where f.status = 'reserved' and f.expires_at < now()
    order by f.expires_at
    limit 1000
    for update skip locked
  ),
  gone as (
    delete from public.files f using stale where f.id = stale.id
    returning f.id, f.org_id, f.purpose
  ),
  audited as (
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    select gone.org_id, null, 'file.expired', 'file', gone.id::text, jsonb_build_object('purpose', gone.purpose)
    from gone
    returning 1
  )
  select count(*)::integer into removed from audited;
  return removed;
end;
$$;

revoke all on function public.expire_file_reservations() from public, anon, authenticated;

create or replace function public.orphaned_firm_files(target_limit integer default 500)
returns text[]
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(array_agg(name), '{}')
  from (
    select o.name
    from storage.objects o
    where o.bucket_id = 'firm-files'
      and o.created_at < now() - interval '1 hour'
      and not exists (
        select 1 from public.files f where f.storage_path = o.name and f.status <> 'rejected'
      )
    order by o.created_at
    limit least(greatest(coalesce(target_limit, 500), 1), 1000)
  ) orphans
  where auth.role() = 'service_role';
$$;

revoke all on function public.orphaned_firm_files(integer) from public, anon, authenticated;

insert into public.platform_settings (key, value, is_public) values
  ('files', jsonb_build_object(
    'reservation_minutes', 60,
    'purposes', jsonb_build_object(
      'upload', jsonb_build_object(
        'people', true,
        'max_bytes', 31457280,
        'mimes', jsonb_build_array('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')
      ),
      'issued', jsonb_build_object(
        'people', false,
        'max_bytes', 31457280,
        'mimes', jsonb_build_array('application/pdf')
      )
    )
  ), false)
on conflict (key) do nothing;

-- ---------- Issued documents ----------

create table public.issued_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- What it is, as a slug the screens have words for: `procuracao`, `contrato`.
  kind text not null,
  -- For the firm's own lists. Never shown by the public verification.
  title text not null,
  version integer not null default 1,
  previous_id uuid,
  -- draft    reserved, being rendered;
  -- issued   published, with its file and the hash of its bytes;
  -- revoked  withdrawn by the firm: the verification says so.
  status text not null default 'draft',
  -- What is printed on the document and typed at /verificar.
  verify_code text not null unique,
  file_id uuid,
  content_hash text,
  -- The same request made twice is one version.
  idempotency_key text not null,
  requested_by uuid references public.profiles (id) on delete set null,
  -- One renderer at a time: a claim with a short lease.
  claim_token uuid,
  claim_expires_at timestamptz,
  issued_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id) on delete set null,
  revoke_reason text,
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key),
  unique (id, org_id),
  -- A version follows a version of the same firm, and a file of the same firm.
  foreign key (previous_id, org_id) references public.issued_documents (id, org_id) on delete set null (previous_id),
  foreign key (file_id, org_id) references public.files (id, org_id),
  constraint issued_documents_kind_check check (kind ~ '^[a-z][a-z0-9_.-]{1,39}$'),
  constraint issued_documents_title_check check (char_length(btrim(title)) between 1 and 200),
  constraint issued_documents_version_check check (version > 0),
  constraint issued_documents_status_check check (status in ('draft', 'issued', 'revoked')),
  constraint issued_documents_code_check check (verify_code ~ '^[A-HJ-KMNP-Z2-9]{12}$'),
  constraint issued_documents_key_check check (char_length(idempotency_key) between 8 and 120),
  constraint issued_documents_hash_check check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  constraint issued_documents_issued_check check (
    (status = 'draft') = (issued_at is null)
    and (status = 'draft' or (file_id is not null and content_hash is not null))
  ),
  constraint issued_documents_revoked_check check ((status = 'revoked') = (revoked_at is not null and revoke_reason is not null))
);

create index issued_documents_org_idx on public.issued_documents (org_id, created_at desc);
create unique index issued_documents_one_version_idx on public.issued_documents (previous_id) where previous_id is not null;

alter table public.issued_documents enable row level security;

create policy "issued_documents_select_member" on public.issued_documents
  for select to authenticated
  using (public.is_org_member(org_id));

grant select on table public.issued_documents to authenticated;

select public.enable_row_versioning('public.issued_documents');

create trigger guard_impersonation_issued_documents
  after insert or update or delete on public.issued_documents
  for each statement execute function public.guard_impersonation_readonly();

/**
 * Reserves the next version of a document for a firm: the first one, or the
 * one after `target_previous` (an issued version of the same firm and kind).
 * The same idempotency key returns the version it already reserved. Backend
 * only; the person who asked, when a person did, must be of the firm.
 */
create or replace function public.reserve_document(
  target_org uuid,
  target_kind text,
  target_title text,
  target_idempotency_key text,
  target_verify_code text,
  target_previous uuid default null,
  target_requested_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.issued_documents%rowtype;
  previous public.issued_documents%rowtype;
  new_id uuid;
  next_version integer := 1;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations o where o.id = target_org) then
    return jsonb_build_object('ok', false, 'code', 'firm_not_found');
  end if;
  if target_requested_by is not null and not exists (
    select 1 from public.memberships m where m.org_id = target_org and m.user_id = target_requested_by
  ) then
    return jsonb_build_object('ok', false, 'code', 'requester_not_in_firm');
  end if;

  select * into existing from public.issued_documents
  where org_id = target_org and idempotency_key = target_idempotency_key;
  if found then
    return jsonb_build_object(
      'ok', true, 'code', 'existing', 'document_id', existing.id, 'version', existing.version,
      'verify_code', existing.verify_code, 'status', existing.status
    );
  end if;

  if target_previous is not null then
    select * into previous from public.issued_documents where id = target_previous for update;
    if not found or previous.org_id <> target_org or previous.kind <> target_kind then
      return jsonb_build_object('ok', false, 'code', 'previous_not_found');
    end if;
    if previous.status = 'draft' then
      return jsonb_build_object('ok', false, 'code', 'previous_not_issued');
    end if;
    if exists (select 1 from public.issued_documents d where d.previous_id = previous.id) then
      return jsonb_build_object('ok', false, 'code', 'previous_already_followed');
    end if;
    next_version := previous.version + 1;
  end if;

  insert into public.issued_documents (
    org_id, kind, title, version, previous_id, verify_code, idempotency_key, requested_by
  ) values (
    target_org, target_kind, btrim(target_title), next_version, target_previous, target_verify_code,
    target_idempotency_key, target_requested_by
  )
  returning id into new_id;

  return jsonb_build_object(
    'ok', true, 'code', 'reserved', 'document_id', new_id, 'version', next_version,
    'verify_code', target_verify_code, 'status', 'draft'
  );
end;
$$;

revoke all on function public.reserve_document(uuid, text, text, text, text, uuid, uuid) from public, anon, authenticated;

/** Takes the draft for rendering, for two minutes. A draft held by a live claim is `busy`; an issued one answers `issued`. */
create or replace function public.claim_document(target_document uuid, target_claim_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  doc public.issued_documents%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into doc from public.issued_documents where id = target_document for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if doc.status <> 'draft' then
    return jsonb_build_object('ok', true, 'code', doc.status);
  end if;
  if doc.claim_token is not null and doc.claim_token <> target_claim_token and doc.claim_expires_at > now() then
    return jsonb_build_object('ok', false, 'code', 'busy');
  end if;
  update public.issued_documents
  set claim_token = target_claim_token, claim_expires_at = now() + interval '2 minutes'
  where id = doc.id;
  return jsonb_build_object('ok', true, 'code', 'claimed');
end;
$$;

revoke all on function public.claim_document(uuid, uuid) from public, anon, authenticated;

/**
 * Publishes the rendered version: the claim must still be the caller's, and
 * the file a stored PDF of the same firm, issued by ONE. The hash of the
 * version is the hash of that file's bytes.
 */
create or replace function public.publish_document(target_document uuid, target_claim_token uuid, target_file uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  doc public.issued_documents%rowtype;
  file public.files%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into doc from public.issued_documents where id = target_document for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if doc.status <> 'draft' then
    return jsonb_build_object('ok', doc.file_id = target_file, 'code', 'already_' || doc.status);
  end if;
  if doc.claim_token is distinct from target_claim_token or doc.claim_expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'claim_lost');
  end if;

  select * into file from public.files where id = target_file;
  if not found or file.org_id <> doc.org_id or file.purpose <> 'issued' or file.status <> 'stored'
     or file.detected_mime <> 'application/pdf' then
    return jsonb_build_object('ok', false, 'code', 'invalid_file');
  end if;

  update public.issued_documents set
    status = 'issued',
    file_id = file.id,
    content_hash = file.sha256,
    issued_at = now(),
    claim_token = null,
    claim_expires_at = null
  where id = doc.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (doc.org_id, doc.requested_by, 'document.issued', 'issued_document', doc.id::text,
          jsonb_build_object('kind', doc.kind, 'version', doc.version, 'hash', file.sha256));

  return jsonb_build_object('ok', true, 'code', 'issued');
end;
$$;

revoke all on function public.publish_document(uuid, uuid, uuid) from public, anon, authenticated;

/** Lets go of a claim that failed, so a retry with the same key resumes the same version. */
create or replace function public.release_document(target_document uuid, target_claim_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  doc public.issued_documents%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into doc from public.issued_documents where id = target_document for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if doc.status <> 'draft' then
    return jsonb_build_object('ok', true, 'code', doc.status);
  end if;
  if doc.claim_token = target_claim_token then
    update public.issued_documents set claim_token = null, claim_expires_at = null where id = doc.id;
  end if;
  return jsonb_build_object('ok', true, 'code', 'released');
end;
$$;

revoke all on function public.release_document(uuid, uuid) from public, anon, authenticated;

/**
 * Withdraws an issued document: the public verification says it was revoked,
 * and when. Who manages the firm or who works its cases (sócio, advogado),
 * with the second factor and a reason, never from a support visit.
 */
create or replace function public.revoke_document(target_document uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  doc public.issued_documents%rowtype;
  reason text := nullif(btrim(target_reason), '');
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;

  select * into doc from public.issued_documents where id = target_document for update;
  if not found or not public.is_org_member(doc.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not (
    public.has_org_role(doc.org_id, array['owner', 'admin']::public.org_role[])
    or public.has_firm_function(doc.org_id, array['socio', 'advogado']::public.firm_function[])
  ) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform public.require_aal2();

  if reason is null or char_length(reason) < 8 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if doc.status = 'revoked' then
    return jsonb_build_object('ok', true, 'code', 'already_revoked');
  end if;
  if doc.status <> 'issued' then
    return jsonb_build_object('ok', false, 'code', 'not_issued');
  end if;

  update public.issued_documents set
    status = 'revoked',
    revoked_at = now(),
    revoked_by = caller,
    revoke_reason = left(reason, 500)
  where id = doc.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (doc.org_id, caller, 'document.revoked', 'issued_document', doc.id::text,
          jsonb_build_object('kind', doc.kind, 'version', doc.version, 'reason', left(reason, 500)));

  return jsonb_build_object('ok', true, 'code', 'revoked');
end;
$$;

revoke all on function public.revoke_document(uuid, text) from public, anon;
grant execute on function public.revoke_document(uuid, text) to authenticated;

/**
 * What anyone holding a document may learn from its code: which firm issued
 * it, what kind of document it is, which version, when, whether it was
 * revoked or replaced by a newer version, and the hash of its bytes. Never
 * its title or content, and never a draft.
 */
create or replace function public.verify_document(target_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  doc public.issued_documents%rowtype;
  firm_name text;
  newer record;
  code text := upper(regexp_replace(coalesce(target_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if code !~ '^[A-HJ-KMNP-Z2-9]{12}$' then
    return jsonb_build_object('found', false);
  end if;
  select * into doc from public.issued_documents where verify_code = code and status <> 'draft';
  if not found then
    return jsonb_build_object('found', false);
  end if;
  select o.name into firm_name from public.organizations o where o.id = doc.org_id;
  select d.version, d.issued_at into newer
  from public.issued_documents d
  where d.previous_id = doc.id and d.status = 'issued';

  return jsonb_build_object(
    'found', true,
    'status', doc.status,
    'kind', doc.kind,
    'version', doc.version,
    'issuedAt', doc.issued_at,
    'revokedAt', doc.revoked_at,
    'contentHash', doc.content_hash,
    'firm', firm_name,
    'replacedByVersion', newer.version
  );
end;
$$;

revoke all on function public.verify_document(text) from public, anon;
grant execute on function public.verify_document(text) to anon, authenticated;
