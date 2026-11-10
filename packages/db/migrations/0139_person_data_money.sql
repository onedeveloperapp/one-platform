-- ============================================================
-- 0139 · Os dados de uma pessoa chegam ao dinheiro do cliente
--
-- The plan's phase 9 asks each phase of the finance to add its tables to a
-- person's export and erasure, and phase 10 (0135) did not. A person's
-- export now carries their parts of a release, the account they receive in,
-- their declarations of residence and their answers on free justice. An
-- erasure takes the account they receive in and what the server saw of
-- their requests on the link; and it is refused, on the record, while a part of theirs still
-- waits to be passed on, held or ordered by the judge, since the firm owes
-- it to them. The values of each part stay: they are the firm's records.
-- ============================================================

create or replace function public.person_data_export(target_org uuid, target_person uuid, target_how text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  person public.people%rowtype;
  refusal text;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  refusal := public.person_data_refusal(target_org);
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if coalesce(target_how, '') not in ('link', 'telefone', 'whatsapp', 'email', 'pessoalmente', 'outro') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  select * into person from public.people where id = target_person and org_id = target_org;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  insert into public.person_data_requests (org_id, person_id, kind, how, status, requested_by, decided_at)
  values (target_org, person.id, 'export', target_how, 'done', auth.uid(), now());
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'person.data_exported', 'person', person.id::text, jsonb_build_object('how', target_how));
  return jsonb_build_object(
    'ok', true,
    'person', to_jsonb(person) - 'read_fields' - 'created_by',
    'cases', coalesce((
      select jsonb_agg(jsonb_build_object('seq', c.seq, 'status', c.status, 'incident', c.incident, 'airline', c.airline_iata,
        'flight_date', c.flight_date, 'origin', c.origin, 'created_at', c.created_at, 'role', cp.role) order by c.seq)
      from public.case_parties cp join public.cases c on c.id = cp.case_id where cp.person_id = person.id
    ), '[]'::jsonb),
    'lawsuits', coalesce((
      select jsonb_agg(jsonb_build_object('cnj', pr.cnj, 'court', pr.court, 'kind', pr.kind, 'status', pr.status,
        'filed_at', pr.filed_at) order by pr.created_at)
      from public.proceedings pr
      where exists (select 1 from public.case_parties cp where cp.case_id = pr.case_id and cp.person_id = person.id)
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('kind', d.kind, 'status', d.status, 'source', d.source, 'created_at', d.created_at,
        'rejected_reason', d.rejected_reason) order by d.created_at)
      from public.case_documents d where d.party_id in (select cp.id from public.case_parties cp where cp.person_id = person.id) and d.status <> 'uploading'
    ), '[]'::jsonb),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object('created_at', s.created_at, 'source', s.source, 'transcript', s.transcript)
        order by s.created_at)
      from public.case_statements s join public.case_parties cp on cp.id = s.party_id where cp.person_id = person.id
    ), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object('accepted_at', cc.accepted_at, 'term', cc.term_title, 'version', cc.term_version,
        'revoked_at', cc.revoked_at) order by cc.accepted_at)
      from public.client_consents cc where cc.person_id = person.id
    ), '[]'::jsonb),
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object('kind', n.kind, 'at', n.reserved_at) order by n.reserved_at)
      from public.client_notices n where n.person_id = person.id
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('at', m.created_at, 'direction', m.direction, 'text', m.body) order by m.created_at)
      from (
        select m.* from public.wa_messages m join public.wa_conversations w on w.id = m.conversation_id
        where w.org_id = target_org and person.phone is not null and w.contact_wa_id = any (public.wa_phone_variants(person.phone))
        order by m.created_at desc limit 2000
      ) m
    ), '[]'::jsonb),
    -- 0139: what the finance keeps of them.
    'money', coalesce((
      select jsonb_agg(jsonb_build_object('case', c.seq, 'gross_cents', s.gross_cents, 'fees_cents', s.fees_cents,
        'costs_cents', s.costs_cents, 'held_cents', s.held_cents, 'payable_cents', s.payable_cents, 'status', s.status,
        'due_on', s.due_on, 'paid_on', s.paid_on, 'confirmed_at', s.client_confirmed_at) order by c.seq, s.due_on)
      from public.money_shares s join public.cases c on c.id = s.case_id
      where s.org_id = target_org and s.person_id = person.id
    ), '[]'::jsonb),
    'payment_account', (
      select jsonb_build_object('kind', a.kind, 'pix_key', a.pix_key, 'bank', a.bank, 'agency', a.agency,
        'account', a.account, 'given_at', a.given_at)
      from public.client_payment_accounts a where a.person_id = person.id and a.org_id = target_org
    ),
    'residence_declarations', coalesce((
      select jsonb_agg(jsonb_build_object('case', c.seq, 'holder', d.holder_name, 'relation', d.relation,
        'relation_note', d.relation_note, 'status', d.status, 'answered_at', d.answered_at, 'created_at', d.created_at)
        order by d.created_at)
      from public.residence_declarations d join public.cases c on c.id = d.case_id
      where d.org_id = target_org and d.person_id = person.id
    ), '[]'::jsonb),
    'free_justice', coalesce((
      select jsonb_agg(jsonb_build_object('case', c.seq, 'asks', f.asks, 'source', f.source, 'recorded_at', f.recorded_at,
        'replaced_at', f.replaced_at) order by f.recorded_at)
      from public.free_justice_answers f join public.cases c on c.id = f.case_id
      where f.org_id = target_org and f.person_id = person.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.person_data_export(uuid, uuid, text) from public, anon;
grant execute on function public.person_data_export(uuid, uuid, text) to authenticated;

create or replace function public.erase_person(target_org uuid, target_person uuid, target_how text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  person public.people%rowtype;
  refusal text;
  why text;
  subjects text[];
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  refusal := public.person_data_refusal(target_org);
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if coalesce(target_how, '') not in ('link', 'telefone', 'whatsapp', 'email', 'pessoalmente', 'outro') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  select * into person from public.people where id = target_person and org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  why := case
    when public.person_active(person.id) or exists (
      select 1 from public.proceedings pr
      where pr.status <> 'closed'
        and exists (select 1 from public.case_parties cp where cp.case_id = pr.case_id and cp.person_id = person.id)
    ) then 'open_lawsuit'
    -- 0139: a part the firm still owes them (to pass on, held, or waiting for the judge) needs the account and the name.
    when exists (
      select 1 from public.money_shares s
      where s.org_id = target_org and s.person_id = person.id and s.status in ('owed', 'held', 'minor')
    ) then 'money_owed'
  end;
  if why is not null then
    insert into public.person_data_requests (org_id, person_id, kind, how, status, refusal, requested_by, decided_at)
    values (target_org, person.id, 'erase', target_how, 'refused', why, auth.uid(), now());
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, auth.uid(), 'person.erase_refused', 'person', person.id::text, jsonb_build_object('reason', why));
    return jsonb_build_object('ok', false, 'code', why);
  end if;

  select coalesce(array_agg(x), '{}') into subjects from (
    select d.id::text as x from public.case_documents d where d.party_id in (select cp.id from public.case_parties cp where cp.person_id = person.id)
    union all
    select s.id::text from public.case_statements s join public.case_parties cp on cp.id = s.party_id
    where cp.person_id = person.id
  ) ids;
  -- What the AI read of their documents and accounts: the runs keep their cost, never what they read.
  update public.ai_runs r set output = null
  where r.org_id = target_org and r.output is not null
    and (r.subject_id = any (subjects)
         or r.id in (select d.check_run_id from public.case_documents d where d.party_id in (select cp.id from public.case_parties cp where cp.person_id = person.id) and d.check_run_id is not null));
  update public.case_statements s set transcript = null
  from public.case_parties cp where cp.id = s.party_id and cp.person_id = person.id and s.transcript is not null;

  -- 0139: the account they receive in goes, and what the server saw of their requests on the link (where they were,
  -- their browser); the parts of a release and the declarations, with what each says, stay as the firm's records.
  delete from public.client_payment_accounts where person_id = person.id and org_id = target_org;
  update public.residence_declarations set answer_evidence = null
  where org_id = target_org and person_id = person.id and answer_evidence is not null;
  update public.free_justice_answers set evidence = null
  where org_id = target_org and person_id = person.id and evidence is not null;

  update public.people set
    phone = null, email = null, birth_date = null, nationality = null, marital_status = null, profession = null,
    postal_code = null, street = null, address_number = null, complement = null, district = null, city = null, uf = null,
    cpf_registry_result = null, cpf_checked_at = null, cpf_registry_name = null, cpf_registry_birth_date = null,
    cpf_registry_situation = null, cpf_registry_regular = null, cpf_name_matches = null,
    read_fields = '{}'::jsonb, erased_at = now()
  where id = person.id;
  insert into public.person_data_requests (org_id, person_id, kind, how, status, requested_by, decided_at)
  values (target_org, person.id, 'erase', target_how, 'done', auth.uid(), now());
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'person.erased', 'person', person.id::text, jsonb_build_object('how', target_how));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.erase_person(uuid, uuid, text) from public, anon;
grant execute on function public.erase_person(uuid, uuid, text) to authenticated;
