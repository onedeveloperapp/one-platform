-- ============================================================
-- 0133 · As pessoas do escritório: a busca, a página da pessoa e os dados de cada uma
--
-- Phase 9 of the plan of the controladoria, the outcome of the cases and the
-- firm's finance, its first part. When a client calls, anybody of the firm
-- finds them in seconds by a name, a CPF, a telephone, or a case's or a
-- lawsuit's number (`firm_people_search`, beside the cases the top already
-- searched), and opens a page with everything of them (`firm_person`): the
-- cases and their lawsuits, the data, the documents, the conversations and
-- the notices.
--
-- "Não quero receber marketing" is a person's word, kept with how and when
-- (`people.marketing_off_at`, `marketing_off_how`): on their own link or
-- recorded by anybody of the firm. It takes the person out of every segment
-- (0134) and never stops the notices of their lawsuit.
--
-- The data of a person: who decides for the firm exports everything the firm
-- keeps of them and answers a request to erase it, with the second factor
-- (`person_data_requests`). An erasure is refused, with its reason, while the
-- person has a lawsuit open (LGPD, art. 7º, VI); otherwise it takes out the
-- telephone, the e-mail, the address and the rest of their data, and what the
-- AI read of their documents and accounts (the runs keep their cost), and
-- keeps the name and the CPF the fiscal and court records still need (art.
-- 16, I). Each phase of the finance adds its own tables to it.
-- ============================================================

alter table public.people add column marketing_off_at timestamptz;
alter table public.people add column marketing_off_how text;
alter table public.people add constraint people_marketing_off_check check (
  (marketing_off_at is null) = (marketing_off_how is null)
  and (marketing_off_how is null
       or marketing_off_how in ('link', 'telefone', 'whatsapp', 'email', 'pessoalmente', 'outro'))
);
-- The person's data were erased at their request: only the name and the CPF are kept.
alter table public.people add column erased_at timestamptz;

-- ---------- What is active, and who is a minor ----------
/** Whether a person of a firm has a case still going (internal). */
create or replace function public.person_active(target_person uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.case_parties cp join public.cases c on c.id = cp.case_id
    where cp.person_id = target_person and c.status not in ('closed', 'declined')
  );
$$;

revoke all on function public.person_active(uuid) from public, anon, authenticated;

/** Whether a person is known to be a minor (internal): by their birth date, or a claimant a guardian answers for. */
create or replace function public.person_minor(target_person uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.birth_date > ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date
                   from public.people p where p.id = target_person), false)
    or exists (select 1 from public.case_parties cp where cp.person_id = target_person and cp.role = 'claimant'
               and cp.guardian_id is not null);
$$;

revoke all on function public.person_minor(uuid) from public, anon, authenticated;

-- ---------- The search at the top ----------
/**
 * The people and the conversations of a firm that what was typed names (anybody of the firm): a name by its words in
 * any order and without accents, a CPF, a telephone by its last eight digits (with or without the ninth), the number
 * of a WhatsApp conversation or its name. A few of each, who has a case going first. The cases are searched apart, as
 * the list of cases searches them.
 */
create or replace function public.firm_people_search(target_org uuid, target_text text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  typed text := left(btrim(coalesce(target_text, '')), 120);
  digits text := regexp_replace(typed, '\D', '', 'g');
  name_words text[] := case when typed ~ '[[:alpha:]]' then
    array(select w from regexp_split_to_table(public.slugify(typed), '-') as w where w <> '') end;
  cpf_wanted text := case when name_words is null and char_length(digits) = 11 then digits end;
  phone_end text := case when name_words is null and char_length(digits) between 8 and 13 then right(digits, 8) end;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if char_length(typed) < 2 or (name_words is null and char_length(digits) < 8) then
    return jsonb_build_object('people', '[]'::jsonb, 'conversations', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(row_data order by (row_data ->> 'active')::boolean desc, row_data ->> 'name')
      from (
        select jsonb_build_object(
          'id', p.id, 'name', p.full_name, 'cpf', p.cpf, 'city', p.city, 'uf', p.uf, 'phone', p.phone,
          'cases', (select count(distinct cp.case_id) from public.case_parties cp where cp.person_id = p.id),
          'active', public.person_active(p.id)
        ) as row_data
        from public.people p
        where p.org_id = target_org
          and ((name_words is not null and not exists (
                  select 1 from unnest(name_words) as word where position(word in public.slugify(p.full_name)) = 0))
               or (cpf_wanted is not null and p.cpf = cpf_wanted)
               or (phone_end is not null and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), 8) = phone_end))
        order by public.person_active(p.id) desc, p.full_name
        limit 8
      ) found
    ), '[]'::jsonb),
    'conversations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'name', w.contact_name, 'number', w.contact_wa_id, 'last_message_at', w.last_message_at
      ) order by w.last_message_at desc nulls last)
      from (
        select w.* from public.wa_conversations w
        where w.org_id = target_org
          and ((name_words is not null and w.contact_name is not null and not exists (
                  select 1 from unnest(name_words) as word where position(word in public.slugify(w.contact_name)) = 0))
               or (phone_end is not null and right(regexp_replace(w.contact_wa_id, '\D', '', 'g'), 8) = phone_end))
        order by w.last_message_at desc nulls last
        limit 5
      ) w
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.firm_people_search(uuid, text) from public, anon;
grant execute on function public.firm_people_search(uuid, text) to authenticated;

-- ---------- The page of a person ----------
/**
 * Everything of a person of the firm, for its page (anybody of the firm): the data, the cases and their lawsuits, the
 * documents, the conversations at their telephone, the latest notices, the word on marketing, the requests about
 * their data, and what the person reading may do.
 */
create or replace function public.firm_person(target_org uuid, target_person uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  person public.people%rowtype;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into person from public.people where id = target_person and org_id = target_org;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'person', to_jsonb(person) - 'cpf_registry_result' - 'updated_via' - 'created_by',
    'minor', public.person_minor(person.id),
    'active', public.person_active(person.id),
    'cases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'seq', c.seq, 'status', c.status, 'incident', c.incident, 'module', c.module, 'origin', c.origin,
        'airline', c.airline_iata, 'created_at', c.created_at, 'is_test', c.is_test, 'roles', roles.list
      ) order by c.created_at desc)
      from public.cases c
      join lateral (select array_agg(distinct cp.role) as list from public.case_parties cp
                    where cp.case_id = c.id and cp.person_id = person.id) roles on roles.list is not null
      where c.org_id = target_org
    ), '[]'::jsonb),
    'lawsuits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id, 'case_id', pr.case_id, 'case_seq', c.seq, 'cnj', pr.cnj, 'court', pr.court, 'kind', pr.kind,
        'status', pr.status, 'filed_at', pr.filed_at
      ) order by c.seq, pr.created_at)
      from public.proceedings pr
      join public.cases c on c.id = pr.case_id
      where pr.org_id = target_org and exists (
        select 1 from public.case_parties cp where cp.case_id = pr.case_id and cp.person_id = person.id)
    ), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'case_id', d.case_id, 'case_seq', c.seq, 'kind', d.kind, 'status', d.status, 'source', d.source,
        'created_at', d.created_at
      ) order by d.created_at desc)
      from public.case_documents d join public.cases c on c.id = d.case_id
      where d.org_id = target_org and d.party_id in (select cp.id from public.case_parties cp where cp.person_id = person.id) and d.status <> 'uploading'
    ), '[]'::jsonb),
    'conversations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'name', w.contact_name, 'number', w.contact_wa_id, 'last_message_at', w.last_message_at,
        'preview', w.last_message_preview
      ) order by w.last_message_at desc nulls last)
      from public.wa_conversations w
      where w.org_id = target_org and person.phone is not null
        and w.contact_wa_id = any (public.wa_phone_variants(person.phone))
    ), '[]'::jsonb),
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object('kind', n.kind, 'case_id', n.case_id, 'at', n.reserved_at) order by n.reserved_at desc)
      from (select * from public.client_notices n where n.org_id = target_org and n.person_id = person.id
            order by n.reserved_at desc limit 10) n
    ), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'how', r.how, 'status', r.status, 'refusal', r.refusal, 'requested_at', r.requested_at,
        'decided_at', r.decided_at
      ) order by r.requested_at desc)
      from public.person_data_requests r where r.person_id = person.id and public.decides_for_firm(target_org)
    ), '[]'::jsonb),
    'may', jsonb_build_object(
      'data', public.decides_for_firm(target_org) and not public.is_impersonated(),
      'marketing', not public.is_impersonated()
    )
  );
end;
$$;

-- ---------- The requests about a person's data ----------
create table public.person_data_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  person_id uuid not null,
  -- export  everything the firm keeps of the person, handed to them;
  -- erase   their data taken out, but what the law keeps.
  kind text not null,
  -- How the person asked.
  how text not null,
  -- done, or refused with why (an erasure while a lawsuit of theirs is open).
  status text not null,
  refusal text,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  foreign key (person_id, org_id) references public.people (id, org_id) on delete cascade,
  constraint person_data_requests_kind_check check (kind in ('export', 'erase')),
  constraint person_data_requests_how_check check (how in ('link', 'telefone', 'whatsapp', 'email', 'pessoalmente', 'outro')),
  constraint person_data_requests_status_check check (status in ('done', 'refused')),
  constraint person_data_requests_refusal_check check ((status = 'refused') = (refusal is not null))
);

create index person_data_requests_person_idx on public.person_data_requests (person_id, requested_at);

alter table public.person_data_requests enable row level security;
create policy "person_data_requests_select_decider" on public.person_data_requests
  for select to authenticated using (public.decides_for_firm(org_id));
grant select on table public.person_data_requests to authenticated;
create trigger guard_impersonation_person_data_requests after insert or update or delete on public.person_data_requests
  for each statement execute function public.guard_impersonation_readonly();

revoke all on function public.firm_person(uuid, uuid) from public, anon;
grant execute on function public.firm_person(uuid, uuid) to authenticated;

/** Who decides for the firm, with the second factor and never in a support visit (internal): the gate of a person's data. */
create or replace function public.person_data_refusal(target_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_impersonated() then 'support_visit'
    when not public.decides_for_firm(target_org) then 'not_allowed'
    when not public.is_aal2() then 'second_factor'
  end;
$$;

revoke all on function public.person_data_refusal(uuid) from public, anon, authenticated;

/**
 * Everything the firm keeps of a person, handed to who decides for it with the second factor, on the record (the
 * request kept as done): the data, the cases they are of, the lawsuits, the documents (their index, never the files),
 * the accounts they gave, the words they agreed to, the requests to stop, the notices, and the messages of the
 * conversations at their telephone (the latest 2,000).
 */
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
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.person_data_export(uuid, uuid, text) from public, anon;
grant execute on function public.person_data_export(uuid, uuid, text) to authenticated;

/**
 * A person's request to erase their data, answered by who decides for the firm with the second factor: refused, with
 * its reason and on the record, while a case of theirs is going or a lawsuit of theirs is not closed; else their
 * telephone, e-mail, address and the rest of their data go, and what the AI read of their documents and accounts (the
 * runs keep their cost), and the name and the CPF stay, for the records the law keeps.
 */
create or replace function public.erase_person(target_org uuid, target_person uuid, target_how text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  person public.people%rowtype;
  refusal text;
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
  if public.person_active(person.id) or exists (
    select 1 from public.proceedings pr
    where pr.status <> 'closed'
      and exists (select 1 from public.case_parties cp where cp.case_id = pr.case_id and cp.person_id = person.id)
  ) then
    insert into public.person_data_requests (org_id, person_id, kind, how, status, refusal, requested_by, decided_at)
    values (target_org, person.id, 'erase', target_how, 'refused', 'open_lawsuit', auth.uid(), now());
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, auth.uid(), 'person.erase_refused', 'person', person.id::text, jsonb_build_object('reason', 'open_lawsuit'));
    return jsonb_build_object('ok', false, 'code', 'open_lawsuit');
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

-- ---------- "Não quero receber marketing" ----------
/**
 * Anybody of the firm records that a person asked not to receive marketing, or to receive it again, saying how. It
 * never stops the notices of their lawsuit. Never a support visit; on the record.
 */
create or replace function public.set_person_marketing(target_org uuid, target_person uuid, target_off boolean, target_how text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  person public.people%rowtype;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if target_off and coalesce(target_how, '') not in ('telefone', 'whatsapp', 'email', 'pessoalmente', 'outro') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  select * into person from public.people where id = target_person and org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if target_off then
    update public.people set marketing_off_at = coalesce(marketing_off_at, now()), marketing_off_how = coalesce(marketing_off_how, target_how)
    where id = person.id;
  else
    update public.people set marketing_off_at = null, marketing_off_how = null where id = person.id;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), case when target_off then 'person.marketing_off' else 'person.marketing_on' end,
    'person', person.id::text, jsonb_strip_nulls(jsonb_build_object('how', target_how)));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_person_marketing(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.set_person_marketing(uuid, uuid, boolean, text) to authenticated;

/** On their own link (the backend's, by the link's token): the person says they do not want marketing, or want it. */
create or replace function public.client_link_marketing(target_token text, target_off boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_off is null then
    return jsonb_build_object('ok', true, 'off', (select p.marketing_off_at is not null from public.people p where p.id = link.person_id));
  end if;
  if target_off then
    update public.people set marketing_off_at = coalesce(marketing_off_at, now()), marketing_off_how = coalesce(marketing_off_how, 'link')
    where id = link.person_id;
  else
    update public.people set marketing_off_at = null, marketing_off_how = null where id = link.person_id;
  end if;
  insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (link.org_id, null, 'client', case when target_off then 'person.marketing_off' else 'person.marketing_on' end,
    'person', link.person_id::text, jsonb_build_object('how', 'link'));
  return jsonb_build_object('ok', true, 'off', target_off);
end;
$$;

revoke all on function public.client_link_marketing(text, boolean) from public, anon, authenticated;
grant execute on function public.client_link_marketing(text, boolean) to service_role;
