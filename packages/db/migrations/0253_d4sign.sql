-- 0253_d4sign
--
-- The firm's signature account may be D4Sign as well as ZapSign (the owner, 2026-11-17: "vamos usar esse sistema
-- para assinatura", D4Sign's sandbox first, for the pilot's phase). An envelope signed through the firm's own account
-- has the method of its provider, 'zapsign' or 'd4sign'; everything 0023 does for one it now does for both: reserved
-- by a person or by ONE, claimed and opened by the backend, polled, cancelled at the provider, its signing address
-- told in the chat (0231), never confirmed by hand. A firm keeps one signature account connected at a time (the app
-- refuses a second); where two are connected, the most recently connected signs.
--
-- * `signature_envelopes.method` takes 'd4sign'.
-- * `firm_signature_account`: which provider the firm's connected account is, and in which environment, for anybody
--   of the firm (the case screen offers that one), beside `firm_has_signature_account`, which now answers for either.
-- * Redefined from their latest bodies, word for word but for the method: `request_signature` (0023; the account
--   must be of the provider asked), `advance_record_paper` (0224) and `record_appeal_paper` (0218), which take the
--   provider of the account they find, `cancel_signature` (0023), `end_free_justice_paper` (0125) and
--   `end_residence_declaration` (0124), which owe the provider a cancel for either, `confirm_signature`,
--   `claim_signature_envelopes`, `signature_envelopes_to_poll` and `firm_has_signature_account` (0023), and
--   `signature_links_owed` (0231).
-- * The token and the key of a D4Sign account live in the vault (0017) as ZapSign's token does: never here. Beside
--   the connection, as for ZapSign, only the hash of the secret that authenticates a webhook delivery.

-- ---------- The method ----------

alter table public.signature_envelopes drop constraint signature_envelopes_method_check;
alter table public.signature_envelopes add constraint signature_envelopes_method_check
  check (method in ('zapsign', 'd4sign', 'govbr', 'enotariado'));

-- ---------- Which account the firm has ----------

/**
 * The firm's connected signature account, `{provider, environment}` ('zapsign' or 'd4sign'; 'production' or
 * 'sandbox'), or null: anybody of the firm may know which (the case screen offers it and opens its panel), though
 * only who manages it sees the account. Where two are connected, the most recently connected.
 */
create or replace function public.firm_signature_account(target_org uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object('provider', c.provider,
    'environment', case when c.metadata ->> 'environment' = 'sandbox' then 'sandbox' else 'production' end)
  from public.connections c
  where public.is_org_member(target_org) and c.org_id = target_org and c.provider in ('zapsign', 'd4sign')
    and c.status = 'connected'
  order by c.connected_at desc nulls last
  limit 1;
$$;

revoke all on function public.firm_signature_account(uuid) from public, anon;
grant execute on function public.firm_signature_account(uuid) to authenticated;

-- ---------- What 0023 and its followers did for ZapSign, for either provider ----------

-- From 0023_signatures.sql.
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

-- From 0224_assisted_signs.sql.
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
  insert into public.signature_envelopes (org_id, case_id, document_id, method, status, signers, connection_id)
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
    account)
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

-- From 0218_appeal_free_justice.sql.
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
  insert into public.signature_envelopes (org_id, case_id, document_id, method, status, signers, connection_id)
  values (current_case.org_id, current_case.id, document, method,
    case when method in ('zapsign', 'd4sign') then 'reserved' else 'pending' end,
    jsonb_build_array(jsonb_build_object(
      'position', 1, 'person_id', person.id, 'name', person.full_name, 'sign_url', null, 'signed_at', null)),
    account)
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

-- From 0023_signatures.sql.
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
      provider_cancel_pending = (envelope.method in ('zapsign', 'd4sign') and envelope.status = 'pending' and envelope.provider_id is not null)
  where id = envelope.id and status = envelope.status;
  perform public.record_case_event(current_case.org_id, current_case.id, 'signature_cancelled', 'person',
    jsonb_build_object('envelope', envelope.id));
  return jsonb_build_object('ok', true, 'code', 'cancelled');
end;
$$;

-- From 0125_free_justice.sql.
create or replace function public.end_free_justice_paper(target_case uuid, target_person uuid, target_actor_type text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  paper public.case_papers%rowtype;
  envelope public.signature_envelopes%rowtype;
begin
  select * into paper from public.case_papers p
  where p.case_id = target_case and p.person_id = target_person and p.kind = 'declaracao_hipossuficiencia'
  for update;
  if paper.id is null then
    return;
  end if;
  select e.* into envelope from public.signature_envelopes e where e.id = paper.envelope_id for update;
  if envelope.id is not null and envelope.status in ('reserved', 'pending', 'received', 'uncertain') then
    update public.signature_envelopes
    set status = 'cancelled', ended_reason = 'A resposta sobre a justiça gratuita mudou.', decided_by = auth.uid(),
        provider_cancel_pending = (envelope.method in ('zapsign', 'd4sign') and envelope.status = 'pending' and envelope.provider_id is not null)
    where id = envelope.id;
    perform public.record_case_event(paper.org_id, paper.case_id, 'signature_cancelled', target_actor_type,
      jsonb_build_object('envelope', envelope.id));
  end if;
  update public.case_documents d
  set status = 'rejected', decided_at = now(), decided_by = auth.uid(),
      rejected_reason = 'A declaração de hipossuficiência foi refeita depois que uma resposta mudou.'
  where d.case_id = paper.case_id and d.status in ('received', 'accepted')
    and d.id in (paper.document_id, envelope.signed_document_id);
  delete from public.case_papers where id = paper.id;
  perform public.record_case_event(paper.org_id, paper.case_id, 'free_justice_paper_ended', target_actor_type,
    jsonb_build_object('person', target_person));
end;
$$;

-- From 0124_residence_paper_again.sql.
create or replace function public.end_residence_declaration(
  target_declaration uuid,
  target_status text,
  target_reason text,
  target_actor_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  declaration public.residence_declarations%rowtype;
  paper public.case_papers%rowtype;
  envelope public.signature_envelopes%rowtype;
begin
  update public.residence_declarations
  set status = target_status, ended_reason = left(target_reason, 500), ended_by = auth.uid(), ended_at = now()
  where id = target_declaration and status = 'open'
  returning * into declaration;
  if declaration.id is null then
    return;
  end if;
  select * into paper from public.case_papers p
  where p.case_id = declaration.case_id and p.person_id = declaration.person_id and p.kind = 'declaracao_residencia'
  for update;
  if paper.id is not null then
    select e.* into envelope from public.signature_envelopes e where e.id = paper.envelope_id for update;
    if envelope.id is not null and envelope.status in ('reserved', 'pending', 'received', 'uncertain') then
      update public.signature_envelopes
      set status = 'cancelled', ended_reason = left(target_reason, 500), decided_by = auth.uid(),
          provider_cancel_pending = (envelope.method in ('zapsign', 'd4sign') and envelope.status = 'pending' and envelope.provider_id is not null)
      where id = envelope.id;
      perform public.record_case_event(declaration.org_id, declaration.case_id, 'signature_cancelled', target_actor_type,
        jsonb_build_object('envelope', envelope.id));
    end if;
    -- The PDF issued and the copy signed (gov.br sends back a document of its own) go to no court.
    update public.case_documents d
    set status = 'rejected', decided_at = now(), decided_by = auth.uid(),
        rejected_reason = 'A declaração de residência deixou de ser necessária.'
    where d.case_id = declaration.case_id and d.status in ('received', 'accepted')
      and d.id in (paper.document_id, envelope.signed_document_id);
    delete from public.case_papers where id = paper.id;
  end if;
  perform public.record_case_event(declaration.org_id, declaration.case_id,
    case target_status when 'waived' then 'residence_declaration_waived' else 'residence_declaration_ended' end,
    target_actor_type, jsonb_build_object('person', declaration.person_id, 'declaration', declaration.id));
end;
$$;

-- From 0023_signatures.sql.
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
  if envelope.method in ('zapsign', 'd4sign') then
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

-- From 0023_signatures.sql.
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

-- From 0023_signatures.sql.
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
    and e.updated_at < now() - make_interval(hours => hours)
  order by e.updated_at
  limit greatest(least(coalesce(target_limit, 50), 200), 1);
end;
$$;

-- From 0023_signatures.sql.
create or replace function public.firm_has_signature_account(target_org uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_org_member(target_org) and exists (
    select 1 from public.connections c where c.org_id = target_org and c.provider in ('zapsign', 'd4sign') and c.status = 'connected'
  );
$$;

-- From 0231_chat_signature.sql.
create or replace function public.signature_links_owed(target_limit integer default 20)
returns table (org_id uuid, conversation_id uuid, case_id uuid, person_id uuid, full_name text, papers jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  with owed as (
    select cp.org_id, cp.case_id, cp.person_id, cp.id as paper_id, cp.kind, e.method,
           (select s ->> 'sign_url' from jsonb_array_elements(e.signers) s
            where (s ->> 'person_id')::uuid = cp.person_id limit 1) as sign_url,
           cp.created_at
    from public.case_papers cp
    join public.signature_envelopes e on e.id = cp.envelope_id and e.status = 'pending'
    join public.cases c on c.id = cp.case_id and c.status in ('intake', 'documents', 'signature')
    where cp.told_in_chat_at is null and cp.created_at > now() - interval '7 days'
  ), ready as (
    select o.* from owed o where o.method = 'govbr' or (o.method in ('zapsign', 'd4sign') and o.sign_url is not null)
  ), talk as (
    select distinct on (r.org_id, r.case_id, r.person_id)
           r.org_id, r.case_id, r.person_id, wc.id as conversation_id, p.full_name
    from ready r
    join public.people p on p.id = r.person_id and p.phone is not null and p.erased_at is null
    join public.wa_conversations wc on wc.org_id = r.org_id and wc.contact_wa_id = any (public.wa_phone_variants(p.phone))
    join public.wa_numbers n on n.id = wc.number_id and n.status = 'active'
    where wc.agent = 'one'
      and public.wa_window_open(wc.last_inbound_at)
      and not exists (select 1 from public.wa_optouts x where x.org_id = wc.org_id and x.contact_wa_id = wc.contact_wa_id)
    order by r.org_id, r.case_id, r.person_id, wc.last_inbound_at desc
  )
  select t.org_id, t.conversation_id, t.case_id, t.person_id, t.full_name,
         (select jsonb_agg(jsonb_build_object('paper_id', r.paper_id, 'kind', r.kind, 'method', r.method, 'sign_url', r.sign_url)
                           order by case r.kind when 'procuracao' then 0 else 1 end, r.created_at)
          from ready r where r.case_id = t.case_id and r.person_id = t.person_id)
  from talk t
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;
