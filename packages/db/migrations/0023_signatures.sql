-- ============================================================
-- 0023_signatures: what the client signs, and what the client accepts.
--
--   signature_envelopes  a document of the case the firm sends a client to
--                        sign, by one of three ways:
--                          zapsign     the firm's ZapSign account (its token
--                                      sealed in the vault, 0017): ONE opens
--                                      the envelope, ZapSign tells when it was
--                                      signed, ONE keeps the signed PDF;
--                          govbr       the client downloads the PDF from their
--                                      link, signs it at gov.br and sends it
--                                      back; a person of the firm confirms it;
--                          enotariado  the act is made at a notary through
--                                      e-Notariado: the firm gives the client
--                                      its link and confirms the signed file;
--   client_consents      what a client accepted on their link, per purpose,
--                        with the text in force frozen (`consent_terms`, 0001;
--                        the texts for clients are the slugs `cliente-*`) and
--                        how it was accepted. A client has no account, so this
--                        is not `consent_acceptances`.
--
-- The envelope is reserved before anything leaves ONE (claim, then send): a
-- job that runs twice never opens two envelopes for one request. One that was
-- claimed and never answered is `uncertain`, never opened again by itself.
-- ============================================================

insert into public.platform_settings (key, value, is_public) values
  ('signatures', jsonb_build_object(
    -- An envelope claimed and not answered for this long is uncertain.
    'opening_minutes', 15,
    -- How long a ZapSign envelope waits before the sweep asks for it again (the webhook is what tells first).
    'poll_hours', 6,
    -- How many people sign one document at most.
    'max_signers', 10
  ), false)
on conflict (key) do nothing;

-- A file a signature produced is a document of the case too.
alter table public.case_documents drop constraint case_documents_source_check;
alter table public.case_documents add constraint case_documents_source_check
  check (source in ('client', 'firm', 'whatsapp', 'signature'));

-- ---------- Envelopes ----------

create table public.signature_envelopes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  -- What is signed: a document of the case, a PDF the firm added.
  document_id uuid not null,
  method text not null,
  -- reserved   made by a person of the firm; the backend has not opened it yet (zapsign);
  -- opening    claimed by the backend, being opened at the provider;
  -- pending    waiting for the signatures;
  -- received   the client sent a signed file back (govbr), waiting for the firm;
  -- signed     done: the signed file is a document of the case;
  -- refused    a signer refused;
  -- expired    the deadline passed with a signature missing;
  -- cancelled  the firm ended it;
  -- failed     the provider would not open it (`last_error` says how);
  -- uncertain  claimed and never answered: nobody can tell whether it was opened.
  status text not null,
  -- The people who sign, in order: [{position, person_id, name, sign_url, signed_at}]. Never their contacts.
  signers jsonb not null,
  -- The firm's account at the provider, for zapsign.
  connection_id uuid,
  -- The provider's id of the envelope (ZapSign's document token).
  provider_id text,
  -- For enotariado: the link of the act the client opens.
  enotariado_url text,
  -- The signed document, once there is one.
  signed_document_id uuid,
  signed_sha256 text,
  -- What the provider says of each signature: [{signer, signed_at}]. Never a document number or a picture.
  evidence jsonb not null default '[]'::jsonb,
  last_error text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  ended_reason text,
  -- Cancelled in ONE while pending at ZapSign: the cancel at ZapSign is still
  -- owed (its signing addresses keep working until it is sent).
  provider_cancel_pending boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  unique (provider_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (document_id, org_id) references public.case_documents (id, org_id) on delete cascade,
  foreign key (connection_id, org_id) references public.connections (id, org_id) on delete set null (connection_id),
  foreign key (signed_document_id, org_id) references public.case_documents (id, org_id) on delete set null (signed_document_id),
  constraint signature_envelopes_method_check check (method in ('zapsign', 'govbr', 'enotariado')),
  constraint signature_envelopes_status_check check (status in (
    'reserved', 'opening', 'pending', 'received', 'signed', 'refused', 'expired', 'cancelled', 'failed', 'uncertain'
  )),
  constraint signature_envelopes_signers_check check (jsonb_typeof(signers) = 'array' and jsonb_array_length(signers) between 1 and 20),
  constraint signature_envelopes_url_check check (
    enotariado_url is null or (enotariado_url ~ '^https://[^[:space:]]{8,}$' and char_length(enotariado_url) <= 500)
  ),
  constraint signature_envelopes_sha_check check (signed_sha256 is null or signed_sha256 ~ '^[0-9a-f]{64}$'),
  constraint signature_envelopes_signed_check check (status <> 'signed' or signed_document_id is not null),
  constraint signature_envelopes_text_check check (
    coalesce(char_length(last_error), 0) <= 60 and coalesce(char_length(ended_reason), 0) <= 500
  )
);

create index signature_envelopes_case_idx on public.signature_envelopes (case_id, created_at desc);
create index signature_envelopes_work_idx on public.signature_envelopes (status, created_at) where status in ('reserved', 'opening', 'pending');

alter table public.signature_envelopes enable row level security;
create policy "signature_envelopes_select_member" on public.signature_envelopes
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.signature_envelopes to authenticated;
create trigger signature_envelopes_updated_at before update on public.signature_envelopes
  for each row execute function public.set_updated_at();
create trigger guard_impersonation_signature_envelopes after insert or update or delete on public.signature_envelopes
  for each statement execute function public.guard_impersonation_readonly();

-- The file a client sends back for an envelope (govbr) knows its envelope.
alter table public.case_documents add column envelope_id uuid;
alter table public.case_documents add constraint case_documents_envelope_fkey
  foreign key (envelope_id, org_id) references public.signature_envelopes (id, org_id) on delete set null (envelope_id);

-- ---------- What the client accepted ----------

create table public.client_consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  person_id uuid not null,
  link_id uuid,
  -- The text in force when it was accepted: never edited, so this is what was read.
  term_id uuid not null references public.consent_terms (id),
  -- Its slug, version and title, kept with the acceptance: a newer version stops the old one being read.
  term_slug text not null,
  term_version integer not null,
  term_title text not null,
  -- How it was accepted: the channel, and what the server saw of the browser.
  evidence jsonb not null default '{}'::jsonb,
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (person_id, org_id) references public.people (id, org_id) on delete cascade,
  foreign key (link_id, org_id) references public.client_links (id, org_id) on delete set null (link_id),
  constraint client_consents_evidence_check check (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 2000)
);

create unique index client_consents_current_idx on public.client_consents (case_id, person_id, term_id) where revoked_at is null;

alter table public.client_consents enable row level security;
create policy "client_consents_select_member" on public.client_consents
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.client_consents to authenticated;
create trigger guard_impersonation_client_consents after insert or update or delete on public.client_consents
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- Helpers ----------

create or replace function public.signatures_setting(setting text)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select value -> setting from public.platform_settings where key = 'signatures';
$$;

revoke all on function public.signatures_setting(text) from public, anon, authenticated;

-- ---------- What a person of the firm does ----------

/**
 * Sends a document of the case to be signed by people of the case, adults
 * only (a minor's guardian signs for them). A document has one open envelope
 * at a time. By ZapSign the firm needs its account connected.
 */
create or replace function public.request_signature(
  target_case uuid,
  target_document uuid,
  target_method text,
  target_signers uuid[],
  target_enotariado_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  document public.case_documents%rowtype;
  detected text;
  account uuid;
  signer_list jsonb;
  envelope uuid;
  url text := nullif(btrim(coalesce(target_enotariado_url, '')), '');
  ceiling integer := coalesce((public.signatures_setting('max_signers') #>> '{}')::integer, 10);
begin
  if target_method is null or target_method not in ('zapsign', 'govbr', 'enotariado') then
    return jsonb_build_object('ok', false, 'code', 'invalid_method', 'field', 'method');
  end if;
  select * into document from public.case_documents where id = target_document and case_id = current_case.id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'document_not_found', 'field', 'document');
  end if;
  if document.kind not in ('power_of_attorney', 'contract', 'other') then
    return jsonb_build_object('ok', false, 'code', 'not_for_signature', 'field', 'document');
  end if;
  if document.status = 'rejected' then
    return jsonb_build_object('ok', false, 'code', 'document_rejected', 'field', 'document');
  end if;
  select f.detected_mime into detected from public.files f where f.id = document.file_id and f.status = 'stored';
  if detected is distinct from 'application/pdf' then
    return jsonb_build_object('ok', false, 'code', 'not_pdf', 'field', 'document');
  end if;
  if target_signers is null or cardinality(target_signers) = 0 then
    return jsonb_build_object('ok', false, 'code', 'signers_required', 'field', 'signers');
  end if;
  if target_method = 'govbr' and cardinality(target_signers) > 1 then
    return jsonb_build_object('ok', false, 'code', 'single_signer', 'field', 'signers');
  end if;
  if cardinality(target_signers) > ceiling or (select count(distinct s) from unnest(target_signers) s) <> cardinality(target_signers) then
    return jsonb_build_object('ok', false, 'code', 'invalid_signers', 'field', 'signers');
  end if;
  if exists (
    select 1 from unnest(target_signers) as given (person)
    where not exists (
      select 1 from public.case_parties cp where cp.case_id = current_case.id and cp.person_id = given.person
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'signer_not_found', 'field', 'signers');
  end if;
  if exists (
    select 1 from public.people p
    where p.id = any (target_signers) and p.birth_date is not null and p.birth_date > (current_date - interval '18 years')::date
  ) then
    return jsonb_build_object('ok', false, 'code', 'minor_cannot_sign', 'field', 'signers');
  end if;
  if exists (
    select 1 from public.signature_envelopes e
    where e.document_id = document.id and e.status in ('reserved', 'opening', 'pending', 'received', 'uncertain')
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_open');
  end if;
  if target_method = 'zapsign' then
    select c.id into account from public.connections c
    where c.org_id = current_case.org_id and c.provider = 'zapsign' and c.status = 'connected'
    order by c.connected_at desc nulls last
    limit 1;
    if account is null then
      return jsonb_build_object('ok', false, 'code', 'no_signature_account');
    end if;
  end if;
  if target_method = 'enotariado' and (url is null or url !~ '^https://[^[:space:]]{8,}$' or char_length(url) > 500) then
    return jsonb_build_object('ok', false, 'code', 'invalid_url', 'field', 'enotariado_url');
  end if;

  select jsonb_agg(jsonb_build_object(
    'position', given.position, 'person_id', p.id, 'name', p.full_name, 'sign_url', null, 'signed_at', null
  ) order by given.position)
  into signer_list
  from unnest(target_signers) with ordinality as given (person, position)
  join public.people p on p.id = given.person;

  insert into public.signature_envelopes (
    org_id, case_id, document_id, method, status, signers, connection_id, enotariado_url, created_by
  ) values (
    current_case.org_id, current_case.id, document.id, target_method,
    case when target_method = 'zapsign' then 'reserved' else 'pending' end,
    signer_list, account, case when target_method = 'enotariado' then url end, auth.uid()
  )
  returning id into envelope;

  perform public.record_case_event(current_case.org_id, current_case.id, 'signature_requested', 'person',
    jsonb_build_object('envelope', envelope, 'method', target_method, 'document', document.id));
  return jsonb_build_object('ok', true, 'code', 'requested', 'envelope_id', envelope);
end;
$$;

revoke all on function public.request_signature(uuid, uuid, text, uuid[], text) from public, anon;
grant execute on function public.request_signature(uuid, uuid, text, uuid[], text) to authenticated;

/**
 * Ends an envelope that is not signed, with a reason the timeline keeps. A
 * new one can then be made. Not while the backend is opening it at ZapSign
 * (`busy`: a moment later it is pending, and can be cancelled). A ZapSign
 * envelope already pending is cancelled in ONE at once and its cancel at
 * ZapSign is recorded as owed: the backend sends it (now, and on every sweep
 * until it went), so a cut account never keeps an envelope open in ONE.
 */
create or replace function public.cancel_signature(target_envelope uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  envelope public.signature_envelopes%rowtype;
  current_case public.cases%rowtype;
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
begin
  select * into envelope from public.signature_envelopes where id = target_envelope;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(envelope.case_id);
  select * into envelope from public.signature_envelopes where id = target_envelope for update;
  if envelope.status in ('signed', 'refused', 'expired', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'already_ended');
  end if;
  if envelope.status = 'opening' then
    return jsonb_build_object('ok', false, 'code', 'busy');
  end if;
  if reason is null or char_length(reason) < 4 then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'field', 'reason');
  end if;
  update public.signature_envelopes
  set status = 'cancelled', ended_reason = left(reason, 500), decided_by = auth.uid(),
      provider_cancel_pending = (envelope.method = 'zapsign' and envelope.status = 'pending' and envelope.provider_id is not null)
  where id = envelope.id and status = envelope.status;
  perform public.record_case_event(current_case.org_id, current_case.id, 'signature_cancelled', 'person',
    jsonb_build_object('envelope', envelope.id));
  return jsonb_build_object('ok', true, 'code', 'cancelled');
end;
$$;

revoke all on function public.cancel_signature(uuid, text) from public, anon;
grant execute on function public.cancel_signature(uuid, text) to authenticated;

/**
 * A person of the firm confirms the signed file of an envelope signed outside
 * ZapSign: the one the client sent back (govbr), or one the firm added after
 * the act (enotariado). The file becomes an accepted document of the case.
 */
create or replace function public.confirm_signature(target_envelope uuid, target_document uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  envelope public.signature_envelopes%rowtype;
  current_case public.cases%rowtype;
  document public.case_documents%rowtype;
begin
  select * into envelope from public.signature_envelopes where id = target_envelope;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(envelope.case_id);
  select * into envelope from public.signature_envelopes where id = target_envelope for update;
  if envelope.method = 'zapsign' then
    return jsonb_build_object('ok', false, 'code', 'signed_by_provider');
  end if;
  if envelope.status not in ('pending', 'received') then
    return jsonb_build_object('ok', false, 'code', 'not_pending');
  end if;
  -- gov.br: the file the client sent back for this envelope. e-Notariado: a file
  -- the firm added that no other envelope holds. A PDF, never the original.
  select d.* into document from public.case_documents d
  join public.files f on f.id = d.file_id and f.detected_mime = 'application/pdf'
  where d.id = target_document and d.case_id = envelope.case_id and d.status in ('received', 'accepted')
    and d.id <> envelope.document_id
    and case envelope.method
      when 'govbr' then d.envelope_id = envelope.id
      else d.source = 'firm' and (d.envelope_id is null or d.envelope_id = envelope.id)
    end
    and not exists (select 1 from public.signature_envelopes other where other.signed_document_id = d.id);
  if not found then
    return jsonb_build_object('ok', false, 'code', 'document_not_found', 'field', 'document');
  end if;

  update public.case_documents
  set status = 'accepted', decided_by = auth.uid(), decided_at = now(), envelope_id = envelope.id
  where id = document.id;
  update public.signature_envelopes
  set status = 'signed', signed_document_id = document.id, decided_by = auth.uid(),
      signed_sha256 = (select f.sha256 from public.files f where f.id = document.file_id)
  where id = envelope.id and status = envelope.status;
  perform public.record_case_event(current_case.org_id, current_case.id, 'signature_signed', 'person',
    jsonb_build_object('envelope', envelope.id, 'method', envelope.method, 'document', document.id));
  return jsonb_build_object('ok', true, 'code', 'signed');
end;
$$;

revoke all on function public.confirm_signature(uuid, uuid) from public, anon;
grant execute on function public.confirm_signature(uuid, uuid) to authenticated;

-- ---------- What the backend does ----------

/**
 * Claims the envelopes waiting to be opened at ZapSign, oldest first, and
 * first gives up on the ones claimed and never answered (uncertain: never
 * opened again by itself). Answers what the backend needs to open each one.
 */
create or replace function public.claim_signature_envelopes(target_limit integer default 10, target_envelope uuid default null)
returns table (
  envelope_id uuid,
  org_id uuid,
  connection_id uuid,
  file_id uuid,
  storage_path text,
  title text,
  signers jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  minutes integer := coalesce((public.signatures_setting('opening_minutes') #>> '{}')::integer, 15);
  stuck record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  for stuck in
    update public.signature_envelopes e set status = 'uncertain', last_error = 'no_answer'
    where e.status = 'opening' and e.claimed_at < now() - make_interval(mins => minutes)
    returning e.id, e.org_id, e.case_id
  loop
    perform public.record_case_event(stuck.org_id, stuck.case_id, 'signature_uncertain', 'system',
      jsonb_build_object('envelope', stuck.id));
  end loop;

  return query
  with picked as (
    select e.id from public.signature_envelopes e
    where e.status = 'reserved' and e.method = 'zapsign' and (target_envelope is null or e.id = target_envelope)
    order by e.created_at
    for update skip locked
    limit greatest(least(coalesce(target_limit, 10), 50), 1)
  ),
  claimed as (
    update public.signature_envelopes e
    set status = 'opening', claimed_at = now(), attempts = e.attempts + 1
    from picked where e.id = picked.id
    returning e.id, e.org_id, e.connection_id, e.document_id, e.signers
  )
  select c.id, c.org_id, c.connection_id, f.id, f.storage_path, f.name, c.signers
  from claimed c
  join public.case_documents d on d.id = c.document_id
  join public.files f on f.id = d.file_id;
end;
$$;

revoke all on function public.claim_signature_envelopes(integer, uuid) from public, anon, authenticated;

/** The provider opened the envelope: its id, and each signer's address in order. */
create or replace function public.record_signature_opened(target_envelope uuid, target_provider_id text, target_sign_urls text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  envelope public.signature_envelopes%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into envelope from public.signature_envelopes where id = target_envelope for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if envelope.status <> 'opening' then
    return jsonb_build_object('ok', false, 'code', 'not_opening');
  end if;
  if coalesce(target_provider_id, '') !~ '^[A-Za-z0-9-]{8,80}$'
     or coalesce(cardinality(target_sign_urls), 0) <> jsonb_array_length(envelope.signers)
     or exists (select 1 from unnest(target_sign_urls) u where u !~ '^https://[^[:space:]]{8,}$' or char_length(u) > 500) then
    return jsonb_build_object('ok', false, 'code', 'invalid_answer');
  end if;
  update public.signature_envelopes set
    status = 'pending',
    provider_id = target_provider_id,
    last_error = null,
    signers = (
      select jsonb_agg(s.value || jsonb_build_object('sign_url', target_sign_urls[(s.value ->> 'position')::integer])
                       order by (s.value ->> 'position')::integer)
      from jsonb_array_elements(envelope.signers) s
    )
  where id = envelope.id;
  perform public.record_case_event(envelope.org_id, envelope.case_id, 'signature_opened', 'system',
    jsonb_build_object('envelope', envelope.id));
  return jsonb_build_object('ok', true, 'code', 'opened');
end;
$$;

revoke all on function public.record_signature_opened(uuid, text, text[]) from public, anon, authenticated;

/** The provider would not open it. A short code, never the provider's message. */
create or replace function public.record_signature_failed(target_envelope uuid, target_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  envelope public.signature_envelopes%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.signature_envelopes
  set status = 'failed', last_error = left(coalesce(nullif(btrim(target_code), ''), 'failed'), 60)
  where id = target_envelope and status = 'opening'
  returning * into envelope;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_opening');
  end if;
  perform public.record_case_event(envelope.org_id, envelope.case_id, 'signature_failed', 'system',
    jsonb_build_object('envelope', envelope.id, 'code', envelope.last_error));
  return jsonb_build_object('ok', true, 'code', 'failed');
end;
$$;

revoke all on function public.record_signature_failed(uuid, text) from public, anon, authenticated;

/** What the backend needs to act on a delivery or a sweep about an envelope. */
create or replace function public.signature_envelope_for_backend(target_envelope uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  envelope public.signature_envelopes%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into envelope from public.signature_envelopes where id = target_envelope;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true, 'org_id', envelope.org_id, 'case_id', envelope.case_id, 'method', envelope.method,
    'status', envelope.status, 'connection_id', envelope.connection_id, 'provider_id', envelope.provider_id,
    'document_id', envelope.document_id,
    'webhook_secret_sha256', (
      select c.metadata ->> 'webhook_secret_sha256' from public.connections c
      where c.id = envelope.connection_id and c.status in ('connected', 'error')
    )
  );
end;
$$;

revoke all on function public.signature_envelope_for_backend(uuid) from public, anon, authenticated;

/** The ZapSign envelopes still pending that nobody heard about for a while: the sweep asks for them again. */
create or replace function public.signature_envelopes_to_poll(target_limit integer default 50)
returns table (envelope_id uuid, org_id uuid, connection_id uuid, provider_id text)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  hours integer := coalesce((public.signatures_setting('poll_hours') #>> '{}')::integer, 6);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  select e.id, e.org_id, e.connection_id, e.provider_id
  from public.signature_envelopes e
  join public.connections c on c.id = e.connection_id and c.status = 'connected'
  where e.status = 'pending' and e.method = 'zapsign' and e.provider_id is not null
    and e.updated_at < now() - make_interval(hours => hours)
  order by e.updated_at
  limit greatest(least(coalesce(target_limit, 50), 200), 1);
end;
$$;

revoke all on function public.signature_envelopes_to_poll(integer) from public, anon, authenticated;

/**
 * An envelope the backend asked about and could not settle (the account cut,
 * ZapSign did not know it, ZapSign did not answer): when, and why, so the
 * sweep asks the others first and the screen can say it.
 */
create or replace function public.record_signature_checked(target_envelope uuid, target_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.signature_envelopes
  set last_error = left(nullif(btrim(coalesce(target_code, '')), ''), 60), updated_at = now()
  where id = target_envelope and status = 'pending';
  return jsonb_build_object('ok', found, 'code', case when found then 'recorded' else 'not_pending' end);
end;
$$;

revoke all on function public.record_signature_checked(uuid, text) from public, anon, authenticated;

/** The cancels owed to ZapSign, on accounts still connected: the backend sends them. */
create or replace function public.signature_cancels_to_send(target_limit integer default 20, target_envelope uuid default null)
returns table (envelope_id uuid, org_id uuid, connection_id uuid, provider_id text, reason text)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  select e.id, e.org_id, e.connection_id, e.provider_id, e.ended_reason
  from public.signature_envelopes e
  join public.connections c on c.id = e.connection_id and c.status in ('connected', 'error')
  where e.provider_cancel_pending and (target_envelope is null or e.id = target_envelope)
  order by e.updated_at
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;

revoke all on function public.signature_cancels_to_send(integer, uuid) from public, anon, authenticated;

/**
 * What ZapSign answered to the cancel: it went (or the document was already
 * gone), or the client had signed it first, which the timeline says so the
 * firm knows a signed copy exists at ZapSign.
 */
create or replace function public.record_signature_cancel_sent(target_envelope uuid, target_answer text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  envelope public.signature_envelopes%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_answer not in ('cancelled', 'already_ended', 'not_found', 'already_signed') then
    return jsonb_build_object('ok', false, 'code', 'invalid_answer');
  end if;
  update public.signature_envelopes set provider_cancel_pending = false
  where id = target_envelope and provider_cancel_pending
  returning * into envelope;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  if target_answer = 'already_signed' then
    perform public.record_case_event(envelope.org_id, envelope.case_id, 'signature_signed_after_cancel', 'system',
      jsonb_build_object('envelope', envelope.id));
  end if;
  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.record_signature_cancel_sent(uuid, text) from public, anon, authenticated;

/** An owed cancel that could not go (the account refused, ZapSign did not answer): still owed, asked again after the others. */
create or replace function public.record_signature_cancel_failed(target_envelope uuid, target_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.signature_envelopes
  set last_error = left(coalesce(nullif(btrim(target_code), ''), 'failed'), 60), updated_at = now()
  where id = target_envelope and provider_cancel_pending;
  return jsonb_build_object('ok', found, 'code', case when found then 'recorded' else 'not_owed' end);
end;
$$;

revoke all on function public.record_signature_cancel_failed(uuid, text) from public, anon, authenticated;

/** Whether the firm has a ZapSign account connected: anybody of the firm may know, though only who manages it sees the account. */
create or replace function public.firm_has_signature_account(target_org uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_org_member(target_org) and exists (
    select 1 from public.connections c where c.org_id = target_org and c.provider = 'zapsign' and c.status = 'connected'
  );
$$;

revoke all on function public.firm_has_signature_account(uuid) from public, anon;
grant execute on function public.firm_has_signature_account(uuid) to authenticated;

/**
 * What the provider says of a pending envelope: when each signer signed (in
 * order; null for who has not), and whether it ended refused or expired. A
 * signed envelope is recorded with its file (`record_signature_signed`).
 */
create or replace function public.record_signature_status(target_envelope uuid, target_status text, target_signed_at text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  envelope public.signature_envelopes%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_status not in ('pending', 'refused', 'expired') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status');
  end if;
  select * into envelope from public.signature_envelopes where id = target_envelope for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if envelope.status <> 'pending' then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  update public.signature_envelopes set
    status = target_status,
    last_error = null,
    signers = (
      select jsonb_agg(s.value || jsonb_build_object('signed_at',
               nullif(target_signed_at[(s.value ->> 'position')::integer], ''))
             order by (s.value ->> 'position')::integer)
      from jsonb_array_elements(envelope.signers) s
    )
  where id = envelope.id;
  if target_status <> 'pending' then
    perform public.record_case_event(envelope.org_id, envelope.case_id, 'signature_' || target_status, 'system',
      jsonb_build_object('envelope', envelope.id));
  end if;
  return jsonb_build_object('ok', true, 'code', target_status);
end;
$$;

revoke all on function public.record_signature_status(uuid, text, text[]) from public, anon, authenticated;

/**
 * The provider's signed PDF, kept by the backend in the firm's files
 * (`reserve_file` + `confirm_file`, purpose `signed`), becomes an accepted
 * document of the case, of the kind the original was.
 */
create or replace function public.record_signature_signed(
  target_envelope uuid,
  target_file uuid,
  target_sha256 text,
  target_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  envelope public.signature_envelopes%rowtype;
  original public.case_documents%rowtype;
  file public.files%rowtype;
  signed uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into envelope from public.signature_envelopes where id = target_envelope for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if envelope.status = 'signed' then
    return jsonb_build_object('ok', true, 'code', 'already_signed', 'document_id', envelope.signed_document_id);
  end if;
  if envelope.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'not_pending');
  end if;
  select * into file from public.files where id = target_file and org_id = envelope.org_id and status = 'stored';
  if not found or file.sha256 is distinct from target_sha256 then
    return jsonb_build_object('ok', false, 'code', 'file_not_found');
  end if;
  if jsonb_typeof(coalesce(target_evidence, '[]'::jsonb)) <> 'array' or octet_length(coalesce(target_evidence, '[]'::jsonb)::text) > 4000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_evidence');
  end if;
  select * into original from public.case_documents where id = envelope.document_id;

  insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, status, envelope_id)
  values (envelope.org_id, envelope.case_id, null, file.id, original.kind, 'signature', 'accepted', envelope.id)
  returning id into signed;

  update public.signature_envelopes set
    status = 'signed', signed_document_id = signed, signed_sha256 = target_sha256,
    evidence = coalesce(target_evidence, '[]'::jsonb), last_error = null
  where id = envelope.id;
  perform public.record_case_event(envelope.org_id, envelope.case_id, 'signature_signed', 'system',
    jsonb_build_object('envelope', envelope.id, 'method', envelope.method, 'document', signed));
  return jsonb_build_object('ok', true, 'code', 'signed', 'document_id', signed);
end;
$$;

revoke all on function public.record_signature_signed(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- A signed file is kept under its own purpose, written by the backend only.
update public.platform_settings
set value = jsonb_set(value, '{purposes,signed}', jsonb_build_object(
  'people', false,
  'max_bytes', 31457280,
  'mimes', jsonb_build_array('application/pdf')
))
where key = 'files' and not (value -> 'purposes') ? 'signed';

-- A file the client sends back for an envelope moves the envelope to `received`.
create or replace function public.case_document_moves_envelope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.envelope_id is not null and new.source = 'client' and old.status = 'uploading' and new.status = 'received'
     and exists (select 1 from public.files f where f.id = new.file_id and f.detected_mime = 'application/pdf') then
    update public.signature_envelopes set status = 'received'
    where id = new.envelope_id and status = 'pending' and method = 'govbr';
    if found then
      perform public.record_case_event(new.org_id, new.case_id, 'signature_received', 'client',
        jsonb_build_object('envelope', new.envelope_id, 'document', new.id));
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.case_document_moves_envelope() from public, anon, authenticated;

create trigger case_documents_move_envelope after update of status on public.case_documents
  for each row execute function public.case_document_moves_envelope();

-- ---------- What the client does, through their link ----------

/**
 * The envelopes a client signs, on their link: what each is, how it is
 * signed, where (their own address at ZapSign, or the e-Notariado link), and
 * whether they already did. Read only: it counts no visit.
 */
create or replace function public.client_link_signatures(target_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  result jsonb;
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now()
     or not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id) then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'method', e.method, 'status', e.status, 'kind', d.kind, 'name', f.name,
    'sign_url', me.value ->> 'sign_url', 'signed_at', me.value ->> 'signed_at',
    'enotariado_url', e.enotariado_url, 'created_at', e.created_at
  ) order by e.created_at desc), '[]'::jsonb)
  into result
  from public.signature_envelopes e
  join public.case_documents d on d.id = e.document_id
  join public.files f on f.id = d.file_id
  cross join lateral (
    select s.value from jsonb_array_elements(e.signers) s where s.value ->> 'person_id' = link.person_id::text limit 1
  ) as me
  where e.case_id = link.case_id and e.status in ('pending', 'received', 'signed');
  return jsonb_build_object('ok', true, 'signatures', result);
end;
$$;

revoke all on function public.client_link_signatures(text) from public;
grant execute on function public.client_link_signatures(text) to anon, authenticated;

/** The link a client signs through: open, and its person still in the case. Signing is not tied to the stage of the case. */
create or replace function public.client_link_for_signer(target_token text)
returns public.client_links
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now()
     or not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id) then
    raise exception 'link_not_open' using errcode = 'P0002';
  end if;
  return link;
end;
$$;

revoke all on function public.client_link_for_signer(text) from public, anon, authenticated;

/** The PDF a client downloads to sign at gov.br: its path, which the backend signs for a minute. */
create or replace function public.client_link_signature_original(target_token text, target_envelope uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  link public.client_links%rowtype;
  path text;
  name text;
begin
  begin
    link := public.client_link_for_signer(target_token);
  exception when sqlstate 'P0002' then
    return jsonb_build_object('ok', false, 'code', sqlerrm);
  end;
  select f.storage_path, f.name into path, name
  from public.signature_envelopes e
  join public.case_documents d on d.id = e.document_id
  join public.files f on f.id = d.file_id and f.status = 'stored'
  where e.id = target_envelope and e.case_id = link.case_id and e.method = 'govbr' and e.status = 'pending'
    and exists (select 1 from jsonb_array_elements(e.signers) s where s.value ->> 'person_id' = link.person_id::text);
  if path is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'storage_path', path, 'name', name);
end;
$$;

revoke all on function public.client_link_signature_original(text, uuid) from public;
grant execute on function public.client_link_signature_original(text, uuid) to anon, authenticated;

/**
 * The client sends back the PDF they signed at gov.br: reserved in the firm's
 * files like any file of the link, and counted against the link's ceiling.
 */
create or replace function public.client_link_reserve_signed(
  target_token text,
  target_envelope uuid,
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
  link public.client_links%rowtype;
  envelope public.signature_envelopes%rowtype;
  original public.case_documents%rowtype;
  problem text;
  reserved jsonb;
  document uuid;
  ceiling integer := coalesce((public.cases_setting('client_link_uploads') #>> '{}')::integer, 60);
begin
  begin
    link := public.client_link_for_signer(target_token);
  exception when sqlstate 'P0002' then
    return jsonb_build_object('ok', false, 'code', sqlerrm);
  end;
  select * into envelope from public.signature_envelopes
  where id = target_envelope and case_id = link.case_id and method = 'govbr' and status in ('pending', 'received')
    and exists (select 1 from jsonb_array_elements(signers) s where s.value ->> 'person_id' = link.person_id::text);
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if lower(btrim(coalesce(target_mime, ''))) <> 'application/pdf' then
    return jsonb_build_object('ok', false, 'code', 'type_not_allowed');
  end if;
  if link.upload_count >= ceiling then
    return jsonb_build_object('ok', false, 'code', 'upload_limit');
  end if;
  problem := public.file_reservation_problem(public.file_purpose_rule('client'), target_name, target_mime, target_bytes);
  if problem is not null then
    return jsonb_build_object('ok', false, 'code', problem);
  end if;
  reserved := public.insert_file_reservation(link.org_id, 'client', target_name, target_mime, target_bytes, null);
  if not coalesce((reserved ->> 'ok')::boolean, false) then
    return reserved;
  end if;
  select * into original from public.case_documents where id = envelope.document_id;

  insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, link_id, status, envelope_id)
  values (link.org_id, link.case_id, null, (reserved ->> 'file_id')::uuid, original.kind, 'client', link.id, 'uploading', envelope.id)
  returning id into document;
  update public.client_links set upload_count = upload_count + 1 where id = link.id;

  return jsonb_build_object(
    'ok', true, 'code', 'reserved', 'document_id', document,
    'file_id', reserved ->> 'file_id', 'storage_path', reserved ->> 'storage_path', 'org_id', link.org_id
  );
end;
$$;

revoke all on function public.client_link_reserve_signed(text, uuid, text, text, bigint) from public;
grant execute on function public.client_link_reserve_signed(text, uuid, text, text, bigint) to anon, authenticated;

/** The texts a client is asked to accept on their link (the slugs `cliente-*` in force), and which they already did. */
create or replace function public.client_link_terms(target_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  result jsonb;
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now()
     or not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id) then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'slug', t.slug, 'version', t.version, 'title', t.title, 'body_md', t.body_md,
    'accepted_at', (
      select c.accepted_at from public.client_consents c
      where c.case_id = link.case_id and c.person_id = link.person_id and c.term_id = t.id and c.revoked_at is null
    )
  ) order by t.slug), '[]'::jsonb)
  into result
  from public.consent_terms t
  where t.is_active and t.locale = 'pt-BR' and t.slug like 'cliente-%';
  return jsonb_build_object('ok', true, 'terms', result);
end;
$$;

revoke all on function public.client_link_terms(text) from public;
grant execute on function public.client_link_terms(text) to anon, authenticated;

/**
 * The client accepts texts in force, by their ids (what they read). Only a
 * text for clients in force counts; accepting the same text twice records it
 * once. Called by the backend only, with what the server saw of the request
 * (its browser, its address): the evidence is never the caller's to write.
 */
create or replace function public.client_link_accept_terms(target_token text, target_terms uuid[], target_evidence jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  evidence jsonb := coalesce(target_evidence, '{}'::jsonb);
  term record;
  added integer := 0;
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now()
     or not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id) then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  if target_terms is null or cardinality(target_terms) = 0 then
    return jsonb_build_object('ok', false, 'code', 'terms_required');
  end if;
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  evidence := jsonb_strip_nulls(jsonb_build_object(
    'user_agent', left(case when jsonb_typeof(evidence) = 'object' then evidence ->> 'user_agent' end, 300),
    'ip', left(case when jsonb_typeof(evidence) = 'object' then evidence ->> 'ip' end, 64),
    'channel', 'link'
  ));
  if exists (
    select 1 from unnest(target_terms) as given (id)
    where not exists (
      select 1 from public.consent_terms t
      where t.id = given.id and t.is_active and t.locale = 'pt-BR' and t.slug like 'cliente-%'
    )
  ) then
    return jsonb_build_object('ok', false, 'code', 'term_not_in_force');
  end if;

  for term in select t.id, t.slug, t.version, t.title from public.consent_terms t where t.id = any (target_terms) loop
    insert into public.client_consents (org_id, case_id, person_id, link_id, term_id, term_slug, term_version, term_title, evidence)
    values (link.org_id, link.case_id, link.person_id, link.id, term.id, term.slug, term.version, term.title, evidence)
    on conflict (case_id, person_id, term_id) where revoked_at is null do nothing;
    if found then
      added := added + 1;
      perform public.record_case_event(link.org_id, link.case_id, 'client_term_accepted', 'client',
        jsonb_build_object('term', term.slug, 'version', term.version));
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'code', 'accepted', 'added', added);
end;
$$;

revoke all on function public.client_link_accept_terms(text, uuid[], jsonb) from public, anon, authenticated;
