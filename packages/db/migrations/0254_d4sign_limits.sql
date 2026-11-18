-- 0254_d4sign_limits
--
-- What D4Sign asks of ONE, read in its reference and checked by an independent review of 0253 (2026-11-17), before the
-- pilot's sandbox:
--
-- * D4Sign takes 10 calls an hour per account by default ("Você terá um limite de 10 requisições por hora", raised by
--   its sales), and opening a document takes four and one per signer. An envelope the backend could not open for that
--   limit is no longer failed: it is given back to wait (`record_signature_retry`, `signature_envelopes.retry_after`)
--   and claimed again when its time comes (`claim_signature_envelopes`), until it has been tried as many times as the
--   setting `signatures.retry_attempts` says (24 by default), when it fails with its code. A D4Sign envelope is polled
--   once a day at most (`signature_envelopes_to_poll`): its webhook tells what happens.
-- * D4Sign names every signer by an e-mail and sends the code of the signature there, which cannot be turned off.
--   `signature_emails_problem` says whether a set of people can sign by D4Sign: each with an e-mail of their own on
--   record ('signer_email_missing' when one has none, 'signer_email_shared' when two share one). `request_signature`
--   refuses a paper sent by D4Sign to people who cannot; `advance_record_paper` and `record_appeal_paper`, where ONE
--   issues the paper itself, send it by gov.br on the link instead, the envelope saying why
--   (`last_error` 'd4sign_email_missing').
-- * Redefined from the bodies 0253 left, word for word but for the lines that say 0254.

-- ---------- An envelope that waits ----------

alter table public.signature_envelopes add column retry_after timestamptz;
comment on column public.signature_envelopes.retry_after is
  'When an envelope the backend gave back (the provider''s limit of calls an hour) may be claimed again (0254).';

/**
 * Gives an envelope the backend claimed back to the queue, to wait `target_minutes` (1 to 1440): the provider took no
 * more calls (D4Sign's limit an hour), or what the opening needed could not be read. Nothing was opened at the
 * provider. Once tried as many times as `signatures.retry_attempts` says (24 by default), it fails with its code.
 */
create function public.record_signature_retry(target_envelope uuid, target_code text, target_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  envelope public.signature_envelopes%rowtype;
  ceiling integer := coalesce((public.signatures_setting('retry_attempts') #>> '{}')::integer, 24);
  code text := left(coalesce(nullif(btrim(coalesce(target_code, '')), ''), 'retry'), 60);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into envelope from public.signature_envelopes where id = target_envelope for update;
  if not found or envelope.status <> 'opening' then
    return jsonb_build_object('ok', false, 'code', 'not_opening');
  end if;
  if envelope.attempts >= ceiling then
    return public.record_signature_failed(target_envelope, code);
  end if;
  update public.signature_envelopes
  set status = 'reserved', claimed_at = null, last_error = code,
      retry_after = now() + make_interval(mins => greatest(least(coalesce(target_minutes, 60), 1440), 1))
  where id = target_envelope
  returning * into envelope;
  return jsonb_build_object('ok', true, 'code', 'waiting', 'retry_after', envelope.retry_after);
end;
$$;

revoke all on function public.record_signature_retry(uuid, text, integer) from public, anon, authenticated;

-- ---------- Who can sign by D4Sign ----------

/**
 * Why these people cannot sign by D4Sign, or null when they can: each needs an e-mail of their own on record
 * ('signer_email_missing' when one has none or an invalid one, 'signer_email_shared' when two share one). D4Sign
 * sends the code of the signature to that e-mail. Called by the functions that choose how a paper is signed.
 */
create function public.signature_emails_problem(target_people uuid[])
returns text
language sql
security definer
set search_path = public
stable
as $$
  select case
    when coalesce(cardinality(target_people), 0) = 0 then 'signer_email_missing'
    when exists (
      select 1 from unnest(target_people) as given (person)
      left join public.people p on p.id = given.person
      where coalesce(btrim(p.email), '') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    ) then 'signer_email_missing'
    when (select count(distinct lower(btrim(p.email))) from public.people p where p.id = any (target_people))
         < (select count(distinct given.person) from unnest(target_people) as given (person)) then 'signer_email_shared'
  end;
$$;

revoke all on function public.signature_emails_problem(uuid[]) from public, anon, authenticated;

-- ---------- What 0253 left, with 0254's lines ----------

-- From 0253_d4sign.sql.
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
  emails text;
begin
  if target_method is null or target_method not in ('zapsign', 'd4sign', 'govbr', 'enotariado') then
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
  if target_method in ('zapsign', 'd4sign') then
    select c.id into account from public.connections c
    where c.org_id = current_case.org_id and c.provider = target_method and c.status = 'connected'
    order by c.connected_at desc nulls last
    limit 1;
    if account is null then
      return jsonb_build_object('ok', false, 'code', 'no_signature_account');
    end if;
  end if;
  -- D4Sign names every signer by an e-mail and sends the code of the signature there (0254): each signer needs one of
  -- their own on record.
  if target_method = 'd4sign' then
    emails := public.signature_emails_problem(target_signers);
    if emails is not null then
      return jsonb_build_object('ok', false, 'code', emails, 'field', 'signers');
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
    case when target_method in ('zapsign', 'd4sign') then 'reserved' else 'pending' end,
    signer_list, account, case when target_method = 'enotariado' then url end, auth.uid()
  )
  returning id into envelope;

  perform public.record_case_event(current_case.org_id, current_case.id, 'signature_requested', 'person',
    jsonb_build_object('envelope', envelope, 'method', target_method, 'document', document.id));
  return jsonb_build_object('ok', true, 'code', 'requested', 'envelope_id', envelope);
end;
$$;

-- From 0253_d4sign.sql.
create or replace function public.advance_record_paper(
  target_case uuid,
  target_claim integer,
  target_person uuid,
  target_kind text,
  target_template uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  person public.people%rowtype;
  file public.files%rowtype;
  kept jsonb;
  document uuid;
  envelope uuid;
  account uuid;
  method text;
  why text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform set_config('one.system_case', target_case::text, true);
  current_case := public.case_for_writer(target_case);
  if not public.case_advance_held(target_case, target_claim) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if not exists (
    select 1 from public.case_papers_due(target_case) d
    where d.person_id = target_person and d.kind = target_kind and d.template_id is not distinct from target_template
  ) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_due');
  end if;
  if coalesce(payload ->> 'file_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(payload ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(payload ->> 'bytes', '') !~ '^[0-9]{1,12}$'
     or coalesce(payload ->> 'pages', '1') !~ '^[0-9]{1,6}$' then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  select * into file from public.files f
  where f.id = (payload ->> 'file_id')::uuid and f.org_id = current_case.org_id and f.purpose = 'paper' for update;
  if not found then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'file_not_found');
  end if;
  kept := public.confirm_file(file.id, payload ->> 'sha256', (payload ->> 'bytes')::bigint, 'application/pdf',
    coalesce((payload ->> 'pages')::integer, 1));
  if not coalesce((kept ->> 'ok')::boolean, false) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'file_refused');
  end if;
  select * into person from public.people where id = target_person;

  insert into public.case_documents (org_id, case_id, file_id, kind, source, status, decided_at)
  values (current_case.org_id, current_case.id, file.id,
    case target_kind
      when 'procuracao' then 'power_of_attorney'
      when 'declaracao_residencia' then 'residence_declaration'
      when 'declaracao_hipossuficiencia' then 'free_justice_declaration'
      else 'contract' end,
    'firm', 'accepted', now())
  returning id into document;

  -- How it is signed: by the firm's own signature account (ZapSign or D4Sign, 0253) where it connected one, else by
  -- gov.br on the link.
  select c.id, c.provider into account, method from public.connections c
  where c.org_id = current_case.org_id and c.provider in ('zapsign', 'd4sign') and c.status = 'connected'
  order by c.connected_at desc nulls last
  limit 1;
  method := case when account is null then 'govbr' else method end;
  -- D4Sign names every signer by an e-mail of their own (0254): a paper whose signers have none on record, or share
  -- one, goes by gov.br on the link, and the envelope says why.
  if method = 'd4sign' and public.signature_emails_problem(array[target_person] || coalesce((
       select array_agg(c.person_id) from public.paper_cosigners(current_case.id, target_person, target_kind) c
     ), '{}'::uuid[])) is not null then
    account := null;
    method := 'govbr';
    why := 'd4sign_email_missing';
  end if;
  insert into public.signature_envelopes (org_id, case_id, document_id, method, status, signers, connection_id,
    last_error)
  values (current_case.org_id, current_case.id, document, method,
    case when method in ('zapsign', 'd4sign') then 'reserved' else 'pending' end,
    -- The person first, then each minor of 16 or 17 they assist in the case, who signs the same paper (0224).
    jsonb_build_array(jsonb_build_object(
      'position', 1, 'person_id', person.id, 'name', person.full_name, 'sign_url', null, 'signed_at', null))
    || coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', 1 + c.seq, 'person_id', c.person_id, 'name', c.full_name, 'sign_url', null, 'signed_at', null)
        order by c.seq)
      from public.paper_cosigners(current_case.id, target_person, target_kind) c
    ), '[]'::jsonb),
    account, why)
  returning id into envelope;

  insert into public.case_papers (org_id, case_id, person_id, kind, template_id, document_id, envelope_id)
  values (current_case.org_id, current_case.id, target_person, target_kind, target_template, document, envelope);

  perform public.record_case_event(current_case.org_id, current_case.id, 'paper_issued', 'system',
    jsonb_build_object('document', document, 'kind', target_kind, 'person', target_person));
  perform public.record_case_event(current_case.org_id, current_case.id, 'signature_requested', 'system',
    jsonb_build_object('envelope', envelope, 'method', method, 'document', document));
  perform set_config('one.system_case', '', true);
  return jsonb_build_object('ok', true, 'code', 'issued', 'document_id', document, 'envelope_id', envelope,
    'method', method);
end;
$$;

-- From 0253_d4sign.sql.
create or replace function public.record_appeal_paper(
  target_case uuid,
  target_person uuid,
  target_template uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  person public.people%rowtype;
  file public.files%rowtype;
  kept jsonb;
  document uuid;
  envelope uuid;
  account uuid;
  method text;
  why text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform set_config('one.system_case', target_case::text, true);
  -- The case's own lock: two workers issuing at once take turns, and the second finds the paper of the first.
  current_case := public.case_for_writer(target_case);
  if not exists (
    select 1 from public.appeal_papers_due(target_case) d
    where d.person_id = target_person and d.template_id is not distinct from target_template
  ) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_due');
  end if;
  if coalesce(payload ->> 'file_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(payload ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(payload ->> 'bytes', '') !~ '^[0-9]{1,12}$'
     or coalesce(payload ->> 'pages', '1') !~ '^[0-9]{1,6}$' then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  select * into file from public.files f
  where f.id = (payload ->> 'file_id')::uuid and f.org_id = current_case.org_id and f.purpose = 'paper' for update;
  if not found then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'file_not_found');
  end if;
  kept := public.confirm_file(file.id, payload ->> 'sha256', (payload ->> 'bytes')::bigint, 'application/pdf',
    coalesce((payload ->> 'pages')::integer, 1));
  if not coalesce((kept ->> 'ok')::boolean, false) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'file_refused');
  end if;
  select * into person from public.people where id = target_person;

  insert into public.case_documents (org_id, case_id, file_id, kind, source, status, decided_at)
  values (current_case.org_id, current_case.id, file.id, 'free_justice_declaration', 'firm', 'accepted', now())
  returning id into document;

  select c.id, c.provider into account, method from public.connections c
  where c.org_id = current_case.org_id and c.provider in ('zapsign', 'd4sign') and c.status = 'connected'
  order by c.connected_at desc nulls last
  limit 1;
  method := case when account is null then 'govbr' else method end;
  -- D4Sign names every signer by an e-mail of their own (0254): a paper whose signers have none on record, or share
  -- one, goes by gov.br on the link, and the envelope says why.
  if method = 'd4sign' and public.signature_emails_problem(array[target_person]) is not null then
    account := null;
    method := 'govbr';
    why := 'd4sign_email_missing';
  end if;
  insert into public.signature_envelopes (org_id, case_id, document_id, method, status, signers, connection_id,
    last_error)
  values (current_case.org_id, current_case.id, document, method,
    case when method in ('zapsign', 'd4sign') then 'reserved' else 'pending' end,
    jsonb_build_array(jsonb_build_object(
      'position', 1, 'person_id', person.id, 'name', person.full_name, 'sign_url', null, 'signed_at', null)),
    account, why)
  returning id into envelope;

  insert into public.case_papers (org_id, case_id, person_id, kind, template_id, document_id, envelope_id)
  values (current_case.org_id, current_case.id, target_person, 'declaracao_hipossuficiencia', target_template, document,
          envelope);

  perform public.record_case_event(current_case.org_id, current_case.id, 'paper_issued', 'system',
    jsonb_build_object('document', document, 'kind', 'declaracao_hipossuficiencia', 'person', target_person));
  perform public.record_case_event(current_case.org_id, current_case.id, 'signature_requested', 'system',
    jsonb_build_object('envelope', envelope, 'method', method, 'document', document));
  perform set_config('one.system_case', '', true);
  return jsonb_build_object('ok', true, 'code', 'issued', 'document_id', document, 'envelope_id', envelope,
    'method', method);
end;
$$;

-- From 0253_d4sign.sql.
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
    where e.status = 'reserved' and e.method in ('zapsign', 'd4sign') and (target_envelope is null or e.id = target_envelope)
      -- One given back for the provider's limit of calls waits its time (0254).
      and (e.retry_after is null or e.retry_after <= now())
    order by e.created_at
    for update skip locked
    limit greatest(least(coalesce(target_limit, 10), 50), 1)
  ),
  claimed as (
    update public.signature_envelopes e
    set status = 'opening', claimed_at = now(), attempts = e.attempts + 1, retry_after = null
    from picked where e.id = picked.id
    returning e.id, e.org_id, e.connection_id, e.document_id, e.signers
  )
  select c.id, c.org_id, c.connection_id, f.id, f.storage_path, f.name, c.signers
  from claimed c
  join public.case_documents d on d.id = c.document_id
  join public.files f on f.id = d.file_id;
end;
$$;

-- From 0253_d4sign.sql.
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
  where e.status = 'pending' and e.method in ('zapsign', 'd4sign') and e.provider_id is not null
    -- D4Sign tells each document's events by its webhook and takes few calls an hour (0254): asked once a day.
    and e.updated_at < now() - make_interval(hours => case when e.method = 'd4sign' then greatest(hours, 24) else hours end)
  order by e.updated_at
  limit greatest(least(coalesce(target_limit, 50), 200), 1);
end;
$$;
