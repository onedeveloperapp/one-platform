-- ============================================================
-- Essential and dispensable documents (0177), item 3.1 of the case journey
-- plan: every document a case asked held it the same. Now, per kind of
-- problem, as configuration (`cases.documents_by_problem`): the essential
-- ones hold the lawsuits (each claimant's identity, the proof of address of
-- who answers for the case, the ticket or the boarding pass; and, for a
-- bag, the airline's report of the irregularity, the RIB, a kind of its own:
-- `baggage_report`); the dispensable ones (the receipts of what was spent,
-- the prints of the airline's messages or photos) are asked once and the
-- case goes on with the client's "não tenho" or after the setting's days
-- (`cases.dispensable_days`). `case_required_documents` is the one reading
-- of what a case's essentials are; `case_dispensables` says where each
-- dispensable stands (sent, not had, past its days, asked), and the client
-- answers on their link (`client_link_not_have`), or a person of the firm
-- for them (`record_document_not_have`).
-- ============================================================

alter table public.case_documents drop constraint case_documents_kind_check;
alter table public.case_documents add constraint case_documents_kind_check check (kind in (
  'identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'power_of_attorney',
  'residence_declaration', 'free_justice_declaration', 'income_proof', 'contract', 'petition', 'baggage_report',
  'other'
));

create or replace function public.filing_types_ok(types jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(types) = 'object'
    and coalesce((
      select bool_and(
        key in ('petition', 'power_of_attorney', 'identity', 'address_proof', 'residence_declaration',
                'free_justice_declaration', 'income_proof', 'ticket', 'boarding_pass', 'baggage_report', 'receipt',
                'evidence', 'contract', 'other')
        and jsonb_typeof(value) = 'string'
        and char_length(value #>> '{}') between 2 and 80
        and value #>> '{}' = btrim(value #>> '{}')
      )
      from jsonb_each(types)
    ), true);
$$;

revoke all on function public.filing_types_ok(jsonb) from public, anon, authenticated;

-- The RIB goes to court with the papers of the trip.
update public.platform_settings
set value = jsonb_set(value, '{package_kinds,case}', (value #> '{package_kinds,case}') || '["baggage_report"]'::jsonb)
where key = 'case_advance' and not (value #> '{package_kinds,case}') ? 'baggage_report';

-- What each kind of problem needs: the essentials hold the lawsuits, the dispensables are asked once.
update public.platform_settings
set value = value
  || jsonb_build_object('dispensable_days', 7)
  || jsonb_build_object('documents_by_problem', jsonb_build_object(
    'default', jsonb_build_object(
      'essential', coalesce(value -> 'required_documents', '[]'::jsonb),
      'dispensable', jsonb_build_array(
        jsonb_build_object('kind', 'receipt', 'label', 'comprovantes do que você gastou por causa do problema'),
        jsonb_build_object('kind', 'evidence', 'label', 'prints das mensagens da companhia ou fotos do painel do aeroporto')
      )
    ),
    'baggage', jsonb_build_object(
      'essential', coalesce(value -> 'required_documents', '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('kind', 'baggage_report', 'per', 'case')),
      'dispensable', jsonb_build_array(
        jsonb_build_object('kind', 'receipt', 'label', 'comprovantes do que você gastou e do que havia na bagagem'),
        jsonb_build_object('kind', 'evidence', 'label', 'fotos da bagagem ou prints das mensagens da companhia')
      )
    )
  ))
where key = 'cases' and not value ? 'documents_by_problem';

/** The documents a kind of problem asks: its own entry (a bag's), else the default. Internal. */
create or replace function public.problem_documents(target_incident text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.value -> 'documents_by_problem' -> case when target_incident like 'baggage%' then 'baggage' else 'default' end
     from public.platform_settings s where s.key = 'cases'),
    jsonb_build_object('essential', coalesce(public.cases_setting('required_documents'), '[]'::jsonb), 'dispensable', '[]'::jsonb)
  );
$$;

revoke all on function public.problem_documents(text) from public, anon, authenticated;

/** The essentials of a case, by its kind of problem: what holds its lawsuits. Internal. */
create or replace function public.case_required_documents(target_case uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.problem_documents((select c.incident from public.cases c where c.id = target_case)) -> 'essential',
    '[]'::jsonb
  );
$$;

revoke all on function public.case_required_documents(uuid) from public, anon, authenticated;

create table public.case_document_answers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  kind text not null,
  answer text not null default 'not_have',
  -- Who said it: the client on their link, or a person of the firm for them.
  said_by text not null,
  said_by_user uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (case_id, kind),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  constraint case_document_answers_kind_check check (kind in ('receipt', 'evidence')),
  constraint case_document_answers_answer_check check (answer in ('not_have')),
  constraint case_document_answers_said_check check (said_by in ('client', 'firm'))
);

alter table public.case_document_answers enable row level security;
create policy "case_document_answers_select_member" on public.case_document_answers
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.case_document_answers to authenticated;
create trigger guard_impersonation_case_document_answers after insert or update or delete on public.case_document_answers
  for each statement execute function public.guard_impersonation_readonly();

/**
 * Where each dispensable document of a case stands (0177): sent (a document of its kind the firm did not refuse),
 * not had (the client said so, or a person of the firm for them), past the setting's days from when the case
 * asked it, or asked. Each with the words it is asked in. Internal.
 */
create or replace function public.case_dispensables(target_case uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', d.value ->> 'kind',
    'label', d.value ->> 'label',
    'state', case
      when exists (select 1 from public.case_documents x
                   where x.case_id = c.id and x.kind = d.value ->> 'kind' and x.status <> 'rejected') then 'sent'
      when exists (select 1 from public.case_document_answers a where a.case_id = c.id and a.kind = d.value ->> 'kind')
        then 'not_have'
      when c.created_at < now() - make_interval(days => greatest(coalesce(
             (public.cases_setting('dispensable_days') #>> '{}')::integer, 7), 1)) then 'expired'
      else 'asked'
    end
  ) order by d.ordinality), '[]'::jsonb)
  from public.cases c
  cross join lateral jsonb_array_elements(coalesce(public.problem_documents(c.incident) -> 'dispensable', '[]'::jsonb))
    with ordinality as d (value, ordinality)
  where c.id = target_case;
$$;

revoke all on function public.case_dispensables(uuid) from public, anon, authenticated;

/** What the case screen reads of a case's documents: its essentials and where each dispensable stands. Member. */
create or replace function public.case_document_needs(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid := (select c.org_id from public.cases c where c.id = target_case);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if org is null or not public.is_org_member(org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'essential', public.case_required_documents(target_case),
                            'dispensable', public.case_dispensables(target_case));
end;
$$;

revoke all on function public.case_document_needs(uuid) from public, anon;
grant execute on function public.case_document_needs(uuid) to authenticated;

/** A dispensable the client does not have, said for them by a person of the firm (0177). Never a support visit. */
create or replace function public.record_document_not_have(target_case uuid, target_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into current_case from public.cases c where c.id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not exists (select 1 from jsonb_array_elements(public.case_dispensables(current_case.id)) d where d ->> 'kind' = target_kind) then
    return jsonb_build_object('ok', false, 'code', 'not_dispensable');
  end if;
  insert into public.case_document_answers (org_id, case_id, kind, said_by, said_by_user)
  values (current_case.org_id, current_case.id, target_kind, 'firm', auth.uid())
  on conflict (case_id, kind) do nothing;
  perform public.record_case_event(current_case.org_id, current_case.id, 'document_not_had', 'person',
    jsonb_build_object('kind', target_kind));
  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.record_document_not_have(uuid, text) from public, anon;
grant execute on function public.record_document_not_have(uuid, text) to authenticated;

/** The client says on their link they do not have a dispensable document (0177). The backend's, by the link. */
create or replace function public.client_link_not_have(target_token text, target_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_found');
  end if;
  if not exists (select 1 from jsonb_array_elements(public.case_dispensables(link.case_id)) d where d ->> 'kind' = target_kind) then
    return jsonb_build_object('ok', false, 'code', 'not_dispensable');
  end if;
  insert into public.case_document_answers (org_id, case_id, kind, said_by)
  values (link.org_id, link.case_id, target_kind, 'client')
  on conflict (case_id, kind) do nothing;
  perform public.record_case_event(link.org_id, link.case_id, 'document_not_had', 'client',
    jsonb_build_object('kind', target_kind));
  return jsonb_build_object('ok', true, 'code', 'recorded', 'dispensables', public.case_dispensables(link.case_id));
end;
$$;

revoke all on function public.client_link_not_have(text, text) from public, anon, authenticated;
grant execute on function public.client_link_not_have(text, text) to service_role;

-- ---------- The client's link reads them ----------

create or replace function public.client_link_open(target_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  current_case public.cases%rowtype;
  firm text;
  segments jsonb;
  documents jsonb;
  parties jsonb;
  state text;
begin
  if link.id is null then
    return jsonb_build_object('found', false);
  end if;
  select o.name into firm from public.organizations o where o.id = link.org_id;
  state := case
    when link.revoked_at is not null then 'revoked'
    when link.expires_at <= now() then 'expired'
    when not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id)
      then 'revoked'
    else 'open'
  end;
  if state <> 'open' then
    return jsonb_build_object('found', true, 'status', state, 'firm', firm);
  end if;

  select * into current_case from public.cases where id = link.case_id;
  -- A visit: the page reads the link again after each thing the client saves,
  -- so openings within half an hour of the last are the same visit.
  update public.client_links
  set opened_count = opened_count + case
        when last_opened_at is null or last_opened_at < now() - interval '30 minutes' then 1 else 0 end,
      last_opened_at = now()
  where id = link.id;

  -- One entry per person. A person who is both a claimant and a guardian (a
  -- parent who flew with a child) is named by the claimant party: their own
  -- documents are theirs as a claimant.
  select jsonb_agg(jsonb_build_object(
    'person_id', p.id, 'party_id', roles.party_id, 'party_ids', roles.party_ids, 'roles', roles.names,
    'is_holder', p.id = link.person_id,
    'full_name', p.full_name, 'cpf', p.cpf, 'birth_date', p.birth_date, 'nationality', p.nationality,
    'marital_status', p.marital_status, 'profession', p.profession, 'email', p.email, 'phone', p.phone,
    'postal_code', p.postal_code, 'street', p.street, 'address_number', p.address_number,
    'complement', p.complement, 'district', p.district, 'city', p.city, 'uf', p.uf,
    'read_fields', p.read_fields
  ) order by (p.id = link.person_id) desc, p.full_name)
  into parties
  from (
    select lp.person_id,
           (array_agg(lp.party_id order by (lp.role = 'claimant') desc))[1] as party_id,
           to_jsonb(array_agg(lp.party_id order by (lp.role = 'claimant') desc, lp.party_id)) as party_ids,
           to_jsonb(array_agg(lp.role order by lp.role)) as names
    from public.client_link_people(link) lp
    group by lp.person_id
  ) as roles
  join public.people p on p.id = roles.person_id;

  select jsonb_agg(jsonb_build_object(
    'id', s.id, 'position', s.position, 'flight_number', s.flight_number,
    'origin_iata', s.origin_iata, 'destination_iata', s.destination_iata,
    'scheduled_departure_local', s.scheduled_departure_local, 'scheduled_arrival_local', s.scheduled_arrival_local,
    'actual_departure_local', s.actual_departure_local, 'actual_arrival_local', s.actual_arrival_local,
    'booking_reference', s.booking_reference, 'affected', s.affected, 'source', s.source
  ) order by s.position)
  into segments
  from public.flight_segments s where s.case_id = link.case_id;

  select jsonb_agg(jsonb_build_object(
    'id', d.id, 'kind', d.kind, 'party_id', d.party_id, 'status', d.status,
    'rejected_reason', d.rejected_reason, 'name', f.name, 'created_at', d.created_at,
    'processing', d.processing
  ) order by d.created_at)
  into documents
  from public.case_documents d
  join public.files f on f.id = d.file_id
  where d.case_id = link.case_id and d.status <> 'uploading'
    -- What a client sends, never the firm's own papers.
    and d.kind in ('identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'other')
    -- Of the people this link answers for; of the whole case, the trip's papers
    -- (the same trip for everybody in it) and what this link itself sent.
    and (
      d.party_id in (select lp.party_id from public.client_link_people(link) lp)
      or (d.party_id is null and (d.kind in ('ticket', 'boarding_pass') or d.link_id = link.id))
    );

  return jsonb_build_object(
    'found', true,
    'status', 'open',
    'firm', firm,
    'link', jsonb_build_object('person_id', link.person_id, 'expires_at', link.expires_at, 'finished_at', link.finished_at,
      'uploads_left', greatest(coalesce((public.cases_setting('client_link_uploads') #>> '{}')::integer, 60) - link.upload_count, 0)),
    'case', jsonb_build_object(
      'seq', current_case.seq, 'incident', current_case.incident, 'flight_date', current_case.flight_date,
      'airline', (select jsonb_build_object('iata', a.iata, 'name', a.name) from public.airlines a where a.iata = current_case.airline_iata),
      'editable', current_case.status in ('intake', 'documents', 'signature')
    ),
    'people', coalesce(parties, '[]'::jsonb),
    'segments', coalesce(segments, '[]'::jsonb),
    'documents', coalesce(documents, '[]'::jsonb),
    -- 0177: the essentials of this case's kind of problem, and where each dispensable stands.
    'required_documents', public.case_required_documents(current_case.id),
    'dispensables', public.case_dispensables(current_case.id)
  );
end;
$$;

revoke all on function public.client_link_open(text) from public;
grant execute on function public.client_link_open(text) to anon, authenticated;
