-- ============================================================
-- 0224 · O adolescente de 16 ou 17 anos assina junto com quem o assiste.
--
-- From the review of 2026-11-11 against the CPC. A minor of 16 or 17 is
-- relatively incapable: they act assisted, beside who answers for them, not
-- represented by them (Código Civil, art. 4º, I; CPC, art. 71). ONE's papers
-- already said so ("assistindo", `[[REPRESENTADOS]]`, 0093), but only the
-- adult signed: a power of attorney of an assisted minor went without the
-- minor's own signature.
--
-- The user chose on 2026-11-12, from the recommendation: the same paper takes
-- both signatures, on the link of who answers for the minor. Each paper ONE
-- issues to a person (`advance_record_paper`, redefined from 0125) has, after
-- the person, each minor of 16 or 17 they assist in the case as a signer of
-- its own (`paper_cosigners`): the power of attorney, and the declaration of
-- hardship when that minor asks free justice. A minor under 16 is represented
-- and signs nothing, as before. By ZapSign each signer has their own address,
-- and the envelope is signed once both signed; by gov.br the adult signs the
-- file, the minor signs the same file with their own gov.br account, and the
-- adult sends it back, for the firm to confirm with both names in front of it.
-- The filing already waits for every power of attorney of the lawsuit signed
-- (`filing_blocker`, 0054), so it waits for the minor's too. The link of who
-- answers for the minor shows the minor's part (`client_link_signatures`,
-- redefined from 0023: `assisted`).
-- ============================================================

/**
 * Who signs a paper beside the person it is issued to (0224): each minor of 16 or 17 the person assists in the case,
 * a claimant; of a declaration of hardship, only one who asks free justice. A minor under 16 is represented and signs
 * nothing. Internal.
 */
create or replace function public.paper_cosigners(target_case uuid, target_person uuid, target_kind text)
returns table (person_id uuid, full_name text, seq integer)
language sql
stable
security definer
set search_path = public
as $$
  select pe.id, pe.full_name, (row_number() over (order by pe.full_name, pe.id))::integer
  from public.case_parties g
  join public.case_parties cp on cp.guardian_id = g.id and cp.case_id = g.case_id and cp.role = 'claimant'
  join public.people pe on pe.id = cp.person_id
  where g.case_id = target_case and g.person_id = target_person
    and target_kind in ('procuracao', 'declaracao_hipossuficiencia')
    and pe.birth_date is not null
    and pe.birth_date <= (now() at time zone 'America/Sao_Paulo')::date - interval '16 years'
    and pe.birth_date > (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
    and (target_kind <> 'declaracao_hipossuficiencia' or exists (
      select 1 from public.free_justice_needs(target_case) n where n.party_id = cp.id and n.asks
    ));
$$;

revoke all on function public.paper_cosigners(uuid, uuid, text) from public, anon, authenticated;

-- ---------- ONE issues the paper with both signers ----------

/**
 * ONE issues a paper (0123, 0125, redefined): a declaration of hardship is a document of its own kind, and the minors
 * of 16 or 17 the person assists sign the same paper after them (0224).
 */
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

  -- How it is signed: by the firm's own ZapSign account where it connected one, else by gov.br on the link.
  select c.id into account from public.connections c
  where c.org_id = current_case.org_id and c.provider = 'zapsign' and c.status = 'connected'
  order by c.connected_at desc nulls last
  limit 1;
  method := case when account is null then 'govbr' else 'zapsign' end;
  insert into public.signature_envelopes (org_id, case_id, document_id, method, status, signers, connection_id)
  values (current_case.org_id, current_case.id, document, method,
    case when method = 'zapsign' then 'reserved' else 'pending' end,
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

revoke all on function public.advance_record_paper(uuid, integer, uuid, text, uuid, jsonb) from public, anon, authenticated;

-- ---------- The link of who assists shows the minor's part ----------

/**
 * The documents a person signs on their link (0023, redefined): with the part of each minor of 16 or 17 they assist
 * who signs the same document (0224).
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
    'enotariado_url', e.enotariado_url, 'created_at', e.created_at,
    -- Who signs beside this person, each a minor of 16 or 17 they assist in the case (0224): their name, their own
    -- address at ZapSign and whether they signed.
    'assisted', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', s.value ->> 'name', 'sign_url', s.value ->> 'sign_url', 'signed_at', s.value ->> 'signed_at')
        order by (s.value ->> 'position')::integer)
      from jsonb_array_elements(e.signers) s
      join public.case_parties cp on cp.case_id = e.case_id and cp.person_id::text = s.value ->> 'person_id'
      join public.case_parties g on g.id = cp.guardian_id and g.person_id = link.person_id
    ), '[]'::jsonb)
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
