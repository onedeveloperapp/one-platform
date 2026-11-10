-- ============================================================
-- 0125 · A justiça gratuita da família na vara cível
--
-- Phase 3 of the plan of the controladoria, the outcome of the cases and the
-- firm's finance, its second part. In the civil court there are costs at the
-- start of a lawsuit (in the small-claims court there are none in the first
-- instance, Lei 9.099/1995, art. 54, so nothing is asked there): each
-- claimant of a lawsuit planned in the civil court says whether they ask for
-- free justice (`free_justice_answers`), through who gives their word today
-- (the claimant, or who answers for a minor: `civil_court_answerer`), on
-- their link or through the firm, saying how. Who asks signs a declaration
-- of economic hardship (CPC, arts. 98 and 99, § 3º; Lei 7.115/1983): ONE
-- issues one per signer, for themselves and the minors they answer for who
-- ask (`declaracao_hipossuficiencia`, a paper of the queue of 0123, from the
-- firm's model of it, else the platform's), and sends it to sign as the
-- other papers go; a change of an answer ends the paper it changes, and a
-- new one is issued. An optional proof of income (`income_proof`) goes to
-- the court with it.
--
-- The piece writes the request where the model puts the marks
-- `[[GRATUIDADE]]` and `[[PEDIDO_GRATUIDADE]]` (the platform's civil model
-- has them now, in place of its `[COMPLETAR]`), naming who asks. A piece of
-- the civil court is not approved while a claimant has not answered
-- (`free_justice_unanswered`), and ONE's own approval waits for the answers
-- instead of giving up; a piece without the mark, while somebody asks, waits
-- for a lawyer to put it (`free_justice_mark_missing`). The filing waits for
-- every answer and for the declarations of who asks, signed
-- (`filing_blocker`). The case screen follows the declarations of residence
-- and the answers by itself (`case_pulse`).
-- ============================================================

-- ---------- What the declaration and the proof of income are ----------

alter table public.case_documents drop constraint case_documents_kind_check;
alter table public.case_documents add constraint case_documents_kind_check check (kind in (
  'identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'power_of_attorney',
  'residence_declaration', 'free_justice_declaration', 'income_proof', 'contract', 'petition', 'other'
));
alter table public.case_papers drop constraint case_papers_kind_check;
alter table public.case_papers add constraint case_papers_kind_check
  check (kind in ('procuracao', 'contrato', 'declaracao_residencia', 'declaracao_hipossuficiencia'));
alter table public.draft_templates drop constraint draft_templates_document_kind_check;
alter table public.draft_templates add constraint draft_templates_document_kind_check
  check (document_kind in ('piece', 'procuracao', 'contrato', 'declaracao_residencia', 'declaracao_hipossuficiencia'));

-- The declaration signed and the proof of income go to the court with their signer's other papers.
update public.platform_settings
set value = jsonb_set(value, '{package_kinds,person}',
  (value #> '{package_kinds,person}') || '["free_justice_declaration", "income_proof"]'::jsonb)
where key = 'case_advance' and not (value #> '{package_kinds,person}') ? 'free_justice_declaration';

-- ONE checks a proof of income as it checks the other papers a client sends: of the kind said, legible, whose.
update public.platform_settings
set value = jsonb_set(value, '{check_kinds}', (value -> 'check_kinds') || '["income_proof"]'::jsonb)
where key = 'document_checks' and jsonb_typeof(value -> 'check_kinds') = 'array'
  and not (value -> 'check_kinds') ? 'income_proof';

insert into public.platform_settings (key, value, is_public) values
  ('free_justice', jsonb_build_object(
    -- How many times a link may change a claimant's answer in a day.
    'answers_per_day', 10
  ), false)
on conflict (key) do nothing;

/** The kinds a court's system names a type for (0123, redefined): with the declaration of hardship and the proof of income. */
create or replace function public.filing_types_ok(types jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(types) = 'object'
    and coalesce((
      select bool_and(
        key in ('petition', 'power_of_attorney', 'identity', 'address_proof', 'residence_declaration',
                'free_justice_declaration', 'income_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence',
                'contract', 'other')
        and jsonb_typeof(value) = 'string'
        and char_length(value #>> '{}') between 2 and 80
        and value #>> '{}' = btrim(value #>> '{}')
      )
      from jsonb_each(types)
    ), true);
$$;

revoke all on function public.filing_types_ok(jsonb) from public, anon, authenticated;

-- ---------- Each claimant's answer ----------

/**
 * Each answer a claimant of a lawsuit planned in the civil court gave on free justice (or who answers for a minor),
 * kept as it was given and never rewritten: the one in force per claimant has no `replaced_at`. An answer counts only
 * while who gave it is who gives the claimant's word today (`civil_court_answerer`).
 */
create table public.free_justice_answers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  party_id uuid not null,
  -- Who answered: the claimant, or who answers for a minor.
  person_id uuid not null,
  asks boolean not null,
  -- client: on their own link; firm: a person of the firm recorded it, saying how.
  source text not null,
  note text,
  link_id uuid references public.client_links (id) on delete set null,
  -- What the server saw of the client's request: never the caller's to write.
  evidence jsonb,
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  replaced_at timestamptz,
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (party_id, org_id) references public.case_parties (id, org_id) on delete cascade,
  foreign key (person_id, org_id) references public.people (id, org_id) on delete cascade,
  constraint free_justice_answers_source_check check (source in ('client', 'firm')),
  constraint free_justice_answers_note_check check (
    (source = 'firm') = (note is not null) and (note is null or char_length(note) between 8 and 500)
  ),
  constraint free_justice_answers_evidence_check check (
    evidence is null or (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 1000)
  )
);

create unique index free_justice_answers_current_idx on public.free_justice_answers (party_id) where replaced_at is null;
create index free_justice_answers_case_idx on public.free_justice_answers (case_id, recorded_at desc);

alter table public.free_justice_answers enable row level security;
create policy "free_justice_answers_select_member" on public.free_justice_answers
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.free_justice_answers to authenticated;
create trigger guard_impersonation_free_justice_answers after insert or update or delete on public.free_justice_answers
  for each statement execute function public.guard_impersonation_readonly();

/** The answer in force of a claimant, when it was given by who gives their word today. Internal. */
create or replace function public.free_justice_answer_in_force(target_party uuid)
returns public.free_justice_answers
language sql
stable
security definer
set search_path = public
as $$
  select a.* from public.free_justice_answers a
  where a.party_id = target_party and a.replaced_at is null
    and a.person_id is not distinct from public.civil_court_answerer(target_party);
$$;

revoke all on function public.free_justice_answer_in_force(uuid) from public, anon, authenticated;

/**
 * Whose word on free justice a case needs: each claimant of a lawsuit planned in the civil court, with who gives it
 * today and the answer in force of that person, if any. What the screens, the link, the papers and the gates read.
 * Internal.
 */
create or replace function public.free_justice_needs(target_case uuid)
returns table (
  party_id uuid,
  proceeding_id uuid,
  minor boolean,
  answerer_id uuid,
  answer_id uuid,
  asks boolean,
  source text,
  recorded_at timestamptz,
  note text
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (cp.id)
    cp.id, p.id, public.case_party_is_minor(cp.id), public.civil_court_answerer(cp.id),
    a.id, a.asks, a.source, a.recorded_at, a.note
  from public.proceedings p
  join public.proceeding_parties pp on pp.proceeding_id = p.id
  join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
  left join lateral (select * from public.free_justice_answer_in_force(cp.id)) a on a.id is not null
  where p.case_id = target_case and p.kind = 'comum' and p.status = 'planned'
  order by cp.id, p.created_at, p.id;
$$;

revoke all on function public.free_justice_needs(uuid) from public, anon, authenticated;

/**
 * What keeps a lawsuit of the civil court from going on for free justice, or null: a claimant who has not answered
 * (`free_justice_unanswered`), then one who asks whose declaration, by who answers for them, is not signed yet
 * (`free_justice_unsigned`). Nothing for a lawsuit of the small-claims court, which has no costs at the start.
 * Internal.
 */
create or replace function public.free_justice_blocker(target_proceeding uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.kind <> 'comum' or p.status <> 'planned' then null
    when exists (
      select 1 from public.proceeding_parties pp
      join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
      where pp.proceeding_id = p.id and (public.free_justice_answer_in_force(cp.id)).id is null
    ) then 'free_justice_unanswered'
    when exists (
      select 1 from public.proceeding_parties pp
      join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
      where pp.proceeding_id = p.id and (public.free_justice_answer_in_force(cp.id)).asks
        and not exists (
          select 1 from public.case_papers paper
          join public.signature_envelopes e on e.id = paper.envelope_id
          where paper.case_id = p.case_id and paper.person_id = public.civil_court_answerer(cp.id)
            and paper.kind = 'declaracao_hipossuficiencia' and e.status = 'signed'
        )
    ) then 'free_justice_unsigned'
  end
  from public.proceedings p
  where p.id = target_proceeding;
$$;

revoke all on function public.free_justice_blocker(uuid) from public, anon, authenticated;

/**
 * An answer changed: the declaration its answerer had (issued for who asked then) is no longer the one to sign. Its
 * open envelope is cancelled, its PDFs (issued and signed) are refused so no filing takes them, and the paper's row
 * goes, so the declaration is issued again for who asks now. Internal.
 */
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
        provider_cancel_pending = (envelope.method = 'zapsign' and envelope.status = 'pending' and envelope.provider_id is not null)
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

revoke all on function public.end_free_justice_paper(uuid, uuid, text) from public, anon, authenticated;

/** What a case needs and had of its claimants' word on free justice, for the firm's screen. */
create or replace function public.case_free_justice(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
begin
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    return jsonb_build_object('ok', false, 'code', 'case_not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'needs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'party_id', n.party_id, 'proceeding_id', n.proceeding_id, 'minor', n.minor, 'name', pe.full_name,
        'answerer_id', n.answerer_id, 'answerer_name', ans.full_name, 'answer_id', n.answer_id, 'asks', n.asks,
        'source', n.source, 'recorded_at', n.recorded_at, 'note', n.note,
        'paper', (
          select e.status from public.case_papers paper
          join public.signature_envelopes e on e.id = paper.envelope_id
          where paper.case_id = current_case.id and paper.person_id = n.answerer_id
            and paper.kind = 'declaracao_hipossuficiencia'
        ),
        'income', exists (
          select 1 from public.case_documents d
          join public.case_parties dp on dp.id = d.party_id
          where d.case_id = current_case.id and d.kind = 'income_proof' and dp.person_id = n.answerer_id
            and d.status in ('received', 'accepted')
        )
      ) order by n.minor, pe.full_name, n.party_id)
      from public.free_justice_needs(current_case.id) n
      join public.case_parties cp on cp.id = n.party_id
      join public.people pe on pe.id = cp.person_id
      left join public.people ans on ans.id = n.answerer_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.case_free_justice(uuid) from public, anon;
grant execute on function public.case_free_justice(uuid) to authenticated;

/**
 * A person of the firm records a claimant's answer on free justice, given some other way than the link, saying how,
 * about the answer the person read (`target_seen`: another answer given since is not overwritten unseen). Never from
 * a support visit (`case_for_writer`). A changed answer ends the declaration its answerer had, for a new one.
 */
create or replace function public.record_free_justice_answer(
  target_case uuid,
  target_party uuid,
  target_asks boolean,
  target_note text,
  target_seen uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  need record;
  note_value text := nullif(btrim(coalesce(target_note, '')), '');
begin
  if target_asks is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'asks');
  end if;
  if note_value is null or char_length(note_value) not between 8 and 500 then
    return jsonb_build_object('ok', false, 'code', 'how_required', 'field', 'note');
  end if;
  select * into need from public.free_justice_needs(current_case.id) n where n.party_id = target_party;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'party_not_found');
  end if;
  if need.answerer_id is null then
    return jsonb_build_object('ok', false, 'code', 'no_guardian');
  end if;
  if need.answer_id is distinct from target_seen then
    return jsonb_build_object('ok', false, 'code', 'answer_changed');
  end if;
  update public.free_justice_answers set replaced_at = now() where party_id = target_party and replaced_at is null;
  insert into public.free_justice_answers (org_id, case_id, party_id, person_id, asks, source, note, recorded_by)
  values (current_case.org_id, current_case.id, target_party, need.answerer_id, target_asks, 'firm', note_value, auth.uid());
  if need.asks is distinct from target_asks then
    perform public.end_free_justice_paper(current_case.id, need.answerer_id, 'person');
  end if;
  perform public.record_case_event(current_case.org_id, current_case.id, 'free_justice_recorded', 'person',
    jsonb_build_object('party', target_party, 'asks', target_asks));
  perform public.wake_case_advance(current_case.id);
  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.record_free_justice_answer(uuid, uuid, boolean, text, uuid) from public, anon;
grant execute on function public.record_free_justice_answer(uuid, uuid, boolean, text, uuid) to authenticated;

/**
 * What a link asks its person about free justice: their own claim when it is planned in the civil court, and the
 * claims of the minors they answer for, each with the answer given so far, whether the declaration was issued, and
 * whether a proof of income of theirs arrived.
 */
create or replace function public.client_link_free_justice(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now()
     or not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id) then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'party_id', n.party_id, 'name', pe.full_name, 'minor', n.minor, 'asks', n.asks, 'recorded_at', n.recorded_at,
        'source', n.source
      ) order by n.minor, pe.full_name, n.party_id)
      from public.free_justice_needs(link.case_id) n
      join public.case_parties cp on cp.id = n.party_id
      join public.people pe on pe.id = cp.person_id
      where n.answerer_id = link.person_id
    ), '[]'::jsonb),
    'issued', exists (
      select 1 from public.case_papers paper
      where paper.case_id = link.case_id and paper.person_id = link.person_id
        and paper.kind = 'declaracao_hipossuficiencia'
    ),
    'income', exists (
      select 1 from public.case_documents d
      join public.case_parties dp on dp.id = d.party_id
      where d.case_id = link.case_id and d.kind = 'income_proof' and dp.person_id = link.person_id
        and d.status in ('uploading', 'received', 'accepted')
    ),
    -- The party a proof of income of this person is sent as.
    'own_party', (
      select cp.id from public.case_parties cp
      where cp.case_id = link.case_id and cp.person_id = link.person_id
      order by (cp.role = 'claimant') desc, cp.created_at
      limit 1
    )
  );
end;
$$;

revoke all on function public.client_link_free_justice(text) from public;
grant execute on function public.client_link_free_justice(text) to anon, authenticated;

/**
 * The client answers on their link, for their own claim or a minor's they answer for. Nothing is rewritten: each
 * answer stays on record with what the server saw of the request. A link changes a claimant's answer a few times a
 * day. Called by the backend only: the evidence is never the caller's to write. A changed answer ends the
 * declaration issued before it, for a new one.
 */
create or replace function public.client_link_answer_free_justice(
  target_token text,
  target_party uuid,
  target_asks boolean,
  target_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  need record;
  evidence jsonb := coalesce(target_evidence, '{}'::jsonb);
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now()
     or not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id) then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_asks is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_value');
  end if;
  -- The case's row is held: two answers given at once take turns, and the second finds the first.
  perform 1 from public.cases c where c.id = link.case_id for no key update;
  select * into need from public.free_justice_needs(link.case_id) n
  where n.party_id = target_party and n.answerer_id = link.person_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_asked');
  end if;
  if need.asks is not distinct from target_asks then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  if (
    select count(*) from public.free_justice_answers a
    where a.party_id = target_party and a.source = 'client' and a.recorded_at > now() - interval '24 hours'
  ) >= greatest(coalesce((
    select case when s.value ->> 'answers_per_day' ~ '^[0-9]{1,4}$' then (s.value ->> 'answers_per_day')::integer end
    from public.platform_settings s where s.key = 'free_justice'), 10), 1) then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;

  update public.free_justice_answers set replaced_at = now() where party_id = target_party and replaced_at is null;
  evidence := jsonb_strip_nulls(jsonb_build_object(
    'user_agent', left(case when jsonb_typeof(evidence) = 'object' then evidence ->> 'user_agent' end, 300),
    'ip', left(case when jsonb_typeof(evidence) = 'object' then evidence ->> 'ip' end, 64),
    'channel', 'link'
  ));
  insert into public.free_justice_answers (org_id, case_id, party_id, person_id, asks, source, link_id, evidence)
  values (link.org_id, link.case_id, target_party, link.person_id, target_asks, 'client', link.id, evidence);
  if need.answer_id is not null then
    perform public.end_free_justice_paper(link.case_id, link.person_id, 'client');
  end if;
  perform public.record_case_event(link.org_id, link.case_id, 'free_justice_answered', 'client',
    jsonb_build_object('party', target_party, 'asks', target_asks));
  perform public.wake_case_advance(link.case_id);
  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.client_link_answer_free_justice(text, uuid, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.client_link_answer_free_justice(text, uuid, boolean, jsonb) to service_role;

/** A client sends a file on their link (0022, redefined): a proof of income too, for free justice (0125). */
create or replace function public.client_link_reserve_upload(
  target_token text,
  target_kind text,
  target_party uuid,
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
  rule jsonb := public.file_purpose_rule('client');
  problem text;
  reserved jsonb;
  document uuid;
  ceiling integer := coalesce((public.cases_setting('client_link_uploads') #>> '{}')::integer, 60);
begin
  begin
    link := public.client_link_for_writer(target_token);
  exception when sqlstate 'P0002' then
    return jsonb_build_object('ok', false, 'code', sqlerrm);
  end;
  if target_kind is null or target_kind not in ('identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt', 'evidence', 'income_proof', 'other') then
    return jsonb_build_object('ok', false, 'code', 'invalid_kind');
  end if;
  if target_party is not null and not exists (
    select 1 from public.client_link_people(link) lp where lp.party_id = target_party
  ) then
    return jsonb_build_object('ok', false, 'code', 'party_not_found');
  end if;
  if link.upload_count >= ceiling then
    return jsonb_build_object('ok', false, 'code', 'upload_limit');
  end if;
  problem := public.file_reservation_problem(rule, target_name, target_mime, target_bytes);
  if problem is not null then
    return jsonb_build_object('ok', false, 'code', problem);
  end if;

  reserved := public.insert_file_reservation(link.org_id, 'client', target_name, target_mime, target_bytes, null);
  if not coalesce((reserved ->> 'ok')::boolean, false) then
    return reserved;
  end if;

  insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, link_id, status)
  values (link.org_id, link.case_id, target_party, (reserved ->> 'file_id')::uuid, target_kind, 'client', link.id, 'uploading')
  returning id into document;

  update public.client_links set upload_count = upload_count + 1 where id = link.id;

  return jsonb_build_object(
    'ok', true, 'code', 'reserved', 'document_id', document,
    'file_id', reserved ->> 'file_id', 'storage_path', reserved ->> 'storage_path', 'org_id', link.org_id
  );
end;
$$;

revoke all on function public.client_link_reserve_upload(text, text, uuid, text, text, bigint) from public;
grant execute on function public.client_link_reserve_upload(text, text, uuid, text, text, bigint) to anon, authenticated;

-- ---------- The declaration, a paper of the queue ----------

/** Who asks for free justice in a signer's declaration: themselves, and each minor they answer for. Internal. */
create or replace function public.free_justice_marks_filled(target_case uuid, target_person uuid, target_body text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select replace(coalesce(target_body, ''), '[[GRATUIDADE_PARA]]', coalesce(
    string_agg(
      pe.full_name || case when n.minor then ', menor de idade, por quem respondo' else ', em nome próprio' end,
      '; ' order by n.minor, pe.full_name, n.party_id),
    '[COMPLETAR: quem pede a gratuidade da justiça]'))
  from public.free_justice_needs(target_case) n
  join public.case_parties cp on cp.id = n.party_id
  join public.people pe on pe.id = cp.person_id
  where n.answerer_id = target_person and n.asks;
$$;

revoke all on function public.free_justice_marks_filled(uuid, uuid, text) from public, anon, authenticated;

-- The platform's declaration of economic hardship, provisional until the curator reviews it.
insert into public.draft_templates (org_id, name, proceeding_kind, document_kind, body, is_default, provisional)
values (null, 'Declaração de hipossuficiência econômica', null, 'declaracao_hipossuficiencia', $body$DECLARAÇÃO DE HIPOSSUFICIÊNCIA ECONÔMICA

Eu, [[NOME]], com CPF nº [[CPF]], residente no endereço [[ENDERECO]], CEP [[CEP]], declaro, para os fins dos arts. 98 e 99 da Lei nº 13.105, de 16 de março de 2015 (Código de Processo Civil), que não tenho condições de pagar as custas e as despesas do processo nem os honorários de advogado sem prejuízo do meu sustento e do sustento da minha família.

Por isso, peço a gratuidade da justiça para: [[GRATUIDADE_PARA]].

Faço esta declaração sob as penas da lei, nos termos da Lei nº 7.115, de 29 de agosto de 1983, ciente de que a declaração comprovadamente falsa me sujeita às sanções civis, administrativas e criminais previstas na legislação aplicável (art. 3º), e de que quem pede a gratuidade de má-fé pode ter de pagar, como multa, até dez vezes o valor das despesas processuais (art. 100, parágrafo único, da Lei nº 13.105).

[[LOCAL_DATA]]

[[NOME]]$body$, true, true);

/** The model ONE writes a paper from (0123, redefined): the platform's declaration of hardship too. */
create or replace function public.paper_template_for(target_org uuid, target_kind text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.draft_templates t where t.org_id = target_org and t.document_kind = target_kind
    ) then coalesce(
      (select t.id from public.draft_templates t
       where t.org_id = target_org and t.document_kind = target_kind and t.is_default),
      (select (array_agg(t.id))[1] from public.draft_templates t
       where t.org_id = target_org and t.document_kind = target_kind
       having count(*) = 1)
    )
    when target_kind in ('procuracao', 'declaracao_residencia', 'declaracao_hipossuficiencia') then
      (select t.id from public.draft_templates t
       where t.org_id is null and t.document_kind = target_kind and t.is_default)
  end;
$$;

revoke all on function public.paper_template_for(uuid, text) from public, anon, authenticated;

/** The papers a case owes now (0123, redefined): the declaration of hardship third, before the contract. */
create or replace function public.case_papers_due(target_case uuid)
returns table (person_id uuid, kind text, template_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select l.person_id, k.kind, public.paper_template_for(c.org_id, k.kind)
  from public.cases c
  join public.client_links l on l.case_id = c.id
  cross join (values ('procuracao', 1), ('declaracao_residencia', 2), ('declaracao_hipossuficiencia', 3), ('contrato', 4))
    as k (kind, position)
  where c.id = target_case
    and c.status in ('intake', 'documents', 'signature', 'drafting', 'ready')
    and (l.finished_at is not null or c.status in ('drafting', 'ready'))
    and l.revoked_at is null and l.expires_at > now()
    and public.firm_autonomy_mode(c.org_id, 'send_signature_papers') = 'auto'
    and public.paper_template_for(c.org_id, k.kind) is not null
    -- Somebody of the case, and an adult: who answers for a minor signs for them.
    and exists (select 1 from public.case_parties cp where cp.case_id = c.id and cp.person_id = l.person_id)
    and not exists (
      select 1 from public.people p
      where p.id = l.person_id and p.birth_date is not null
        and p.birth_date > (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
    )
    and not exists (
      select 1 from public.case_papers paper
      where paper.case_id = c.id and paper.person_id = l.person_id and paper.kind = k.kind
    )
    -- A declaration only of a bill in somebody else's name the firm accepted, once the person said who the holder
    -- is and nothing about the address waits for a person.
    and (k.kind <> 'declaracao_residencia' or exists (
      select 1 from public.residence_declarations d
      where d.case_id = c.id and d.person_id = l.person_id and d.status = 'open'
        and public.residence_declaration_blocker(c.id, l.person_id) = 'residence_declaration_unsigned'
    ))
    -- A declaration of hardship once everybody this person answers for in the civil court answered, and somebody
    -- of them asks (0125).
    and (k.kind <> 'declaracao_hipossuficiencia' or (
      exists (select 1 from public.free_justice_needs(c.id) n where n.answerer_id = l.person_id and n.asks)
      and not exists (select 1 from public.free_justice_needs(c.id) n where n.answerer_id = l.person_id and n.answer_id is null)
    ))
  group by l.person_id, k.kind, k.position, c.org_id
  order by l.person_id, k.position;
$$;

revoke all on function public.case_papers_due(uuid) from public, anon, authenticated;

/** The next paper a case owes (0123, redefined): the declaration of hardship filled with who asks. */
create or replace function public.advance_paper_to_issue(target_case uuid, target_claim integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  due record;
  template public.draft_templates%rowtype;
  person public.people%rowtype;
  filled text;
  missing text[];
  unwritable text[];
  held jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.case_advance_held(target_case, target_claim) then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into current_case from public.cases where id = target_case;
  for due in select * from public.case_papers_due(target_case) loop
    select * into template from public.draft_templates where id = due.template_id;
    select * into person from public.people where id = due.person_id;
    filled := template.body;
    if due.kind = 'declaracao_residencia' then
      filled := public.residence_marks_filled(target_case, due.person_id, filled);
    end if;
    if due.kind = 'declaracao_hipossuficiencia' then
      filled := public.free_justice_marks_filled(target_case, due.person_id, filled);
    end if;
    filled := public.case_paper_filled(target_case, due.person_id, filled);
    select coalesce(array_agg(distinct m[1]), '{}') into missing
    from regexp_matches(filled, '\[COMPLETAR:\s*([^\]]+)\]', 'g') as m;
    if cardinality(missing) > 0 or filled ~ '\[\[[A-Z_]+\]\]' then
      held := coalesce(held, jsonb_build_object('ok', true, 'code', 'incomplete', 'person_id', due.person_id,
        'kind', due.kind, 'missing', to_jsonb(missing), 'unknown_mark', filled ~ '\[\[[A-Z_]+\]\]'));
      continue;
    end if;
    unwritable := public.unwritable_characters(filled);
    if cardinality(unwritable) > 0 then
      held := coalesce(held, jsonb_build_object('ok', true, 'code', 'unwritable', 'person_id', due.person_id,
        'kind', due.kind, 'characters', to_jsonb(unwritable)));
      continue;
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', 'due',
      'org_id', current_case.org_id,
      'person_id', due.person_id,
      'kind', due.kind,
      'template_id', due.template_id,
      'title', case due.kind
        when 'procuracao' then 'Procuração'
        when 'declaracao_residencia' then 'Declaração de residência'
        when 'declaracao_hipossuficiencia' then 'Declaração de hipossuficiência econômica'
        else 'Contrato de prestação de serviços advocatícios' end,
      'person', person.full_name,
      'firm', (select o.name from public.organizations o where o.id = current_case.org_id),
      'body', filled
    );
  end loop;
  return coalesce(held, jsonb_build_object('ok', true, 'code', 'none'));
end;
$$;

revoke all on function public.advance_paper_to_issue(uuid, integer) from public, anon, authenticated;

/** ONE issues a paper (0123, redefined): a declaration of hardship is a document of its own kind. */
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
    jsonb_build_array(jsonb_build_object(
      'position', 1, 'person_id', person.id, 'name', person.full_name, 'sign_url', null, 'signed_at', null)),
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

-- ---------- The filing waits for it ----------

/** What keeps a lawsuit from being filed (0124, redefined): the free justice of the civil court last. */
create or replace function public.filing_blocker(target_proceeding uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.status = 'planned' and p.system is not null and p.system_refused_at is not null then 'system_refused'
    when p.status = 'planned' and p.system is not null and p.system_approved_at is null then 'system_unapproved'
    when p.kind = 'juizado' and c.family_choice = 'together' and public.case_has_minor_claimant(c.id)
      then 'family_split_unchosen'
    when p.kind = 'comum' and exists (
      select 1 from public.proceeding_parties pp
      where pp.proceeding_id = p.id
        and coalesce((public.civil_court_answer_in_force(pp.party_id)).accepted, false) is not true
    ) then 'civil_court_unanswered'
    -- A power of attorney ONE sent a person of the lawsuit to sign, and nobody of the firm has confirmed signed yet:
    -- a filing without it would go without the mandate (0054).
    when exists (
      select 1 from public.case_papers paper
      join public.signature_envelopes e on e.id = paper.envelope_id
      where paper.case_id = c.id and paper.kind = 'procuracao'
        and e.status in ('reserved', 'opening', 'pending', 'received', 'uncertain')
        and paper.person_id in (
          select cp.person_id from public.proceeding_parties pp
          join public.case_parties cp on cp.id = pp.party_id
          where pp.proceeding_id = p.id
          union
          select g.person_id from public.proceeding_parties pp
          join public.case_parties cp on cp.id = pp.party_id
          join public.case_parties g on g.id = cp.guardian_id
          where pp.proceeding_id = p.id
        )
    ) then 'power_of_attorney_unsigned'
    -- A bill in somebody else's name the firm accepted goes to the court with the client's declaration (0123), and
    -- a lawsuit of the civil court with every claimant's word on free justice and the declarations of who asks (0125).
    else coalesce((
      select b.code from (
        select public.residence_declaration_blocker(c.id, people.person_id) as code
        from (
          select cp.person_id from public.proceeding_parties pp
          join public.case_parties cp on cp.id = pp.party_id
          where pp.proceeding_id = p.id
          union
          select g.person_id from public.proceeding_parties pp
          join public.case_parties cp on cp.id = pp.party_id
          join public.case_parties g on g.id = cp.guardian_id
          where pp.proceeding_id = p.id
        ) as people
      ) as b
      where b.code is not null
      order by case b.code when 'residence_relation_missing' then 1 when 'residence_address_conflict' then 2 else 3 end
      limit 1
    ), public.free_justice_blocker(p.id))
  end
  from public.proceedings p
  join public.cases c on c.id = p.case_id
  where p.id = target_proceeding;
$$;

revoke all on function public.filing_blocker(uuid) from public, anon, authenticated;

/** Whose turn a wait is (0123, redefined): the client's word on free justice and its signature are the client's. */
create or replace function public.wait_owner(target_code text)
returns text
language sql
immutable
as $$
  select case
    when target_code in (
      'case_incomplete', 'civil_court_unanswered', 'power_of_attorney_unsigned', 'client_confirmation',
      'account_missing', 'account_incomplete', 'residence_relation_missing', 'residence_declaration_unsigned',
      'free_justice_unanswered', 'free_justice_unsigned'
    ) then 'client'
    when target_code in ('account_preparing', 'account_contested', 'unavailable', 'step_failed') then 'one'
    when target_code in ('ceiling_unknown', 'system_unknown', 'system_refused') then 'platform'
    else 'firm'
  end;
$$;

revoke all on function public.wait_owner(text) from public, anon, authenticated;

-- ---------- The piece asks for it ----------

/**
 * Why a piece of the civil court may not be approved for free justice, or null: a claimant of its lawsuit who has
 * not answered (`free_justice_unanswered`: the request the piece writes depends on the answers), or somebody who asks
 * while the latest version has no `[[GRATUIDADE]]` for the request to be written in (`free_justice_mark_missing`: a
 * lawyer puts it). Internal.
 */
create or replace function public.free_justice_piece_blocker(target_draft uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.kind <> 'comum' or p.status <> 'planned' then null
    when exists (
      select 1 from public.proceeding_parties pp
      join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
      where pp.proceeding_id = p.id and (public.free_justice_answer_in_force(cp.id)).id is null
    ) then 'free_justice_unanswered'
    when exists (
      select 1 from public.proceeding_parties pp
      join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
      where pp.proceeding_id = p.id and (public.free_justice_answer_in_force(cp.id)).asks
    ) and strpos(coalesce(v.body, ''), '[[GRATUIDADE]]') = 0 then 'free_justice_mark_missing'
  end
  from public.case_drafts d
  join public.proceedings p on p.id = d.proceeding_id
  left join public.case_draft_versions v on v.draft_id = d.id and v.version = d.version
  where d.id = target_draft;
$$;

revoke all on function public.free_justice_piece_blocker(uuid) from public, anon, authenticated;

/** The facts of a lawsuit written into a piece (0064, redefined): the request for free justice too. */
create or replace function public.case_draft_filled(target_draft uuid, target_body text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  airline public.airlines%rowtype;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  court_uf text;
  parties text;
  names text;
  per_party text;
  total bigint;
  claimants integer;
  lawyers text;
  addressed text;
  defendant text;
  filled text := coalesce(target_body, '');
  asking text;
  asked integer;
  unanswered integer;
begin
  select * into draft from public.case_drafts where id = target_draft;
  if not found then
    return filled;
  end if;
  select * into lawsuit from public.proceedings where id = draft.proceeding_id;
  select * into current_case from public.cases where id = draft.case_id;
  select * into airline from public.airlines a where a.iata = current_case.airline_iata;
  select c.uf into court_uf from public.courts c where c.acronym = lawsuit.court;

  select
    string_agg(
      public.person_qualification(cp.person_id, own.minor)
        || case when own.minor then
             -- Under sixteen somebody stands in for the person; from sixteen on, beside them.
             case when pe.birth_date is not null and pe.birth_date <= today - interval '16 years'
               then ', neste ato com a assistência de ' else ', neste ato com a representação de ' end
             || case when g.person_id is null then '[COMPLETAR: quem responde por ' || pe.full_name || ']'
                  else public.person_qualification(g.person_id, false) end
           else '' end,
      E';\n' order by cp.created_at, cp.id),
    string_agg(upper(pe.full_name), ', ' order by cp.created_at, cp.id),
    -- A claimant with no Valor da Causa Pedido asks what the court arbitrates.
    string_agg(pe.full_name || ': ' || coalesce(public.brl_from_cents(cp.claim_cents), 'o valor que este Juízo arbitrar'),
      '; ' order by cp.created_at, cp.id),
    sum(cp.claim_cents),
    count(*)
  into parties, names, per_party, total, claimants
  from public.proceeding_parties pp
  join public.case_parties cp on cp.id = pp.party_id
  join public.people pe on pe.id = cp.person_id
  left join public.case_parties g on g.id = cp.guardian_id
  cross join lateral (
    -- A minor: not eighteen yet on this day; with no day of birth on record, one somebody answers for.
    select case when pe.birth_date is null then cp.guardian_id is not null
                else pe.birth_date > today - interval '18 years' end as minor
  ) own
  where pp.proceeding_id = lawsuit.id;

  select string_agg(
    coalesce(nullif(btrim(pr.display_name), ''), '[COMPLETAR: nome de quem assina]')
      || coalesce(', OAB/' || r.uf || ' ' || r.number, ', [COMPLETAR: inscrição na OAB]'),
    E'\n' order by pr.display_name, pr.id)
  into lawyers
  from public.proceeding_lawyers pl
  join public.profiles pr on pr.id = pl.user_id
  -- Who is on record in the lawsuit and still of the firm: nobody who left signs a new piece.
  join public.memberships mb on mb.user_id = pl.user_id and mb.org_id = draft.org_id
  left join lateral (
    -- The registration in the state of the court when there is one, else the main one.
    select o.uf, o.number from public.oab_registrations o
    where o.user_id = pl.user_id
    order by (o.uf = court_uf) desc, (o.kind = 'principal') desc, o.uf
    limit 1
  ) r on true
  where pl.proceeding_id = lawsuit.id;

  addressed := case
    when nullif(btrim(lawsuit.unit), '') is null then
      case lawsuit.kind when 'juizado' then 'Juizado Especial Cível' else 'Vara Cível' end
        || ' da Comarca de ' || coalesce(nullif(btrim(lawsuit.comarca), ''), '[COMPLETAR: comarca]')
    -- The unit as the firm wrote it, with its comarca when the unit does not name it already.
    when nullif(btrim(lawsuit.comarca), '') is null
      or position(lower(btrim(lawsuit.comarca)) in lower(lawsuit.unit)) > 0 then btrim(lawsuit.unit)
    else btrim(lawsuit.unit) || ' da Comarca de ' || btrim(lawsuit.comarca)
  end;

  -- The company that answers in court is what the operator recorded of the airline: never guessed.
  defendant := coalesce(nullif(btrim(airline.legal_name), ''), '[COMPLETAR: razão social da companhia]')
    || ', CNPJ nº ' || coalesce(
      regexp_replace(airline.cnpj, '^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$', '\1.\2.\3/\4-\5'),
      '[COMPLETAR: CNPJ da companhia]');

  filled := replace(filled, '[[PARTES]]', coalesce(parties, '[COMPLETAR: quem pede neste processo]'));
  filled := replace(filled, '[[NOMES_DAS_PARTES]]', coalesce(names, '[COMPLETAR: quem pede neste processo]'));
  filled := replace(filled, '[[RE]]', defendant);
  filled := replace(filled, '[[JUIZO]]', addressed);
  if claimants = 0 then
    filled := replace(filled, '[[VALOR_DA_CAUSA]]', '[COMPLETAR: valor da causa]');
  elsif total is null then
    -- Nobody of the lawsuit asks a value: the cause has the value the court arbitrates (CPC, art. 292, § 3º),
    -- said so where the text gives the cause "o valor de" it, and as what the court arbitrates elsewhere.
    filled := regexp_replace(filled, '(valor)\s+de\s+\[\[VALOR_DA_CAUSA\]\]', '\1 que este Juízo arbitrar', 'gi');
    filled := replace(filled, '[[VALOR_DA_CAUSA]]', 'a ser arbitrado por este Juízo');
  else
    -- The values the claimants ask; one with none asks what the court arbitrates, said beside their name.
    filled := replace(filled, '[[VALOR_DA_CAUSA]]', public.brl_from_cents(total));
  end if;
  filled := replace(filled, '[[PEDIDO_POR_PARTE]]', coalesce(per_party, '[COMPLETAR: pedido de cada parte]'));
  filled := replace(filled, '[[ADVOGADOS]]', coalesce(lawyers, '[COMPLETAR: quem assina]'));

  -- Free justice, as each claimant of a lawsuit of the civil court answered it (0125): who asks, by name. A lawsuit of
  -- the small-claims court asks nothing, and a request nobody makes leaves its place empty.
  if strpos(filled, '[[GRATUIDADE]]') > 0 or strpos(filled, '[[PEDIDO_GRATUIDADE]]') > 0 then
    select
      regexp_replace(string_agg(pe.full_name, ', ' order by cp.created_at, cp.id) filter (where a.asks),
        ', ([^,]*)$', ' e \1'),
      count(*) filter (where a.asks),
      count(*) filter (where a.id is null)
    into asking, asked, unanswered
    from public.proceeding_parties pp
    join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
    join public.people pe on pe.id = cp.person_id
    left join lateral (select * from public.free_justice_answer_in_force(cp.id)) a on a.id is not null
    where pp.proceeding_id = lawsuit.id;
    if lawsuit.kind <> 'comum' then
      filled := replace(replace(filled, '[[GRATUIDADE]]', ''), '[[PEDIDO_GRATUIDADE]]', '');
    elsif coalesce(unanswered, 0) > 0 then
      filled := replace(filled, '[[GRATUIDADE]]',
        '[COMPLETAR: a resposta de cada parte autora sobre a gratuidade da justiça]');
      filled := replace(filled, '[[PEDIDO_GRATUIDADE]]', '');
    elsif coalesce(asked, 0) = 0 then
      filled := replace(filled, '[[GRATUIDADE]]', 'Nenhuma parte autora pede a gratuidade da justiça.');
      filled := replace(filled, '[[PEDIDO_GRATUIDADE]]', '');
    elsif asked = 1 then
      filled := replace(filled, '[[GRATUIDADE]]', 'A parte autora ' || asking
        || ' não tem condições de arcar com as custas e as despesas do processo sem prejuízo do próprio sustento e do'
        || ' sustento da família, e pede a gratuidade da justiça, nos termos do art. 98 da Lei nº 13.105, conforme'
        || ' a declaração que acompanha esta inicial.');
      filled := replace(filled, '[[PEDIDO_GRATUIDADE]]', 'Requer, por fim, a concessão da gratuidade da justiça a '
        || asking || ', nos termos do art. 98 da Lei nº 13.105.');
    else
      filled := replace(filled, '[[GRATUIDADE]]', 'As partes autoras ' || asking
        || ' não têm condições de arcar com as custas e as despesas do processo sem prejuízo do próprio sustento e do'
        || ' sustento da família, e pedem a gratuidade da justiça, nos termos do art. 98 da Lei nº 13.105, conforme'
        || ' as declarações que acompanham esta inicial.');
      filled := replace(filled, '[[PEDIDO_GRATUIDADE]]', 'Requer, por fim, a concessão da gratuidade da justiça a '
        || asking || ', nos termos do art. 98 da Lei nº 13.105.');
    end if;
    -- A place left empty takes no blank lines with it.
    filled := regexp_replace(filled, E'(\r?\n)(\r?\n)(\r?\n)+', E'\\1\\2', 'g');
  end if;
  return filled;
end;
$$;

revoke all on function public.case_draft_filled(uuid, text) from public, anon, authenticated;

/** Why a draft cannot be approved by its state (0029, redefined): and the free justice of the civil court. */
create or replace function public.case_draft_state_blocker(target_draft uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  justice text;
begin
  select * into draft from public.case_drafts where id = target_draft;
  if not found or draft.status <> 'proposed' or draft.version < 1 then
    return 'not_proposed';
  end if;
  if draft.work is not distinct from 'revise' then
    return 'revision_in_course';
  end if;
  if draft.checked_version is distinct from draft.version then
    return 'citations_not_checked';
  end if;
  if exists (
    select 1 from public.case_draft_citations c
    where c.draft_id = draft.id and c.version = draft.version
      and not public.legal_source_covers(draft.org_id, c.kind, c.issuer, c.number, c.article)
  ) then
    return 'citations_not_verified';
  end if;
  justice := public.free_justice_piece_blocker(draft.id);
  if justice is not null then
    return justice;
  end if;
  return null;
end;
$$;

revoke all on function public.case_draft_state_blocker(uuid) from public, anon, authenticated;

/** ONE approves the first text the AI wrote (0029, redefined): a piece waiting for answers on free justice waits. */
create or replace function public.approve_case_draft_unattended(target_draft uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  waiting public.approvals%rowtype;
  queued boolean := false;
  body_text text;
  filled text;
  blocker text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into draft from public.case_drafts where id = target_draft;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'draft_not_found');
  end if;
  -- The answer that waits first, then the draft: the order the queue and a lawyer's approval take them.
  if draft.run_id is not null then
    select * into waiting from public.approvals a where a.run_id = draft.run_id and a.status = 'pending' for update;
    queued := found;
  end if;
  select * into draft from public.case_drafts where id = target_draft for update;
  if not draft.auto_approval_owed then
    return jsonb_build_object('ok', false, 'code', 'not_eligible');
  end if;
  -- A piece of the civil court waits for every claimant's word on free justice before ONE approves it (0125): the
  -- try is kept for when the answers come.
  if public.free_justice_piece_blocker(draft.id) = 'free_justice_unanswered' then
    return jsonb_build_object('ok', false, 'code', 'free_justice_unanswered');
  end if;
  -- Tried once: approved now, or left to a lawyer for good (also when the firm, or the operator, took the piece
  -- off ONE's hands meanwhile: going back to ONE later approves nothing read before).
  update public.case_drafts set auto_approval_owed = false where id = draft.id;
  if public.firm_autonomy_mode(draft.org_id, 'piece_text') is distinct from 'auto' then
    return jsonb_build_object('ok', false, 'code', 'not_auto');
  end if;
  if draft.status <> 'proposed' or draft.version <> 1 or draft.work is not null or draft.revision_note is not null
     or draft.revisions <> 0 or draft.checked_version is distinct from draft.version
     or not exists (
       select 1 from public.case_draft_versions v where v.draft_id = draft.id and v.version = 1 and v.author = 'ai'
     ) then
    return jsonb_build_object('ok', false, 'code', 'not_eligible');
  end if;
  blocker := public.case_draft_state_blocker(draft.id);
  if blocker is not null then
    return jsonb_build_object('ok', false, 'code', blocker);
  end if;
  select v.body into body_text from public.case_draft_versions v where v.draft_id = draft.id and v.version = draft.version;
  filled := public.case_draft_filled(draft.id, body_text);
  blocker := public.case_draft_text_blocker(filled);
  if blocker is not null then
    return jsonb_build_object('ok', false, 'code', blocker);
  end if;

  perform public.mark_case_draft_approved(draft.id, null, filled, 'system');
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (draft.org_id, null, 'draft.approved', 'case_draft', draft.id::text,
    jsonb_build_object('version', draft.version, 'hash', md5(filled), 'auto', true));
  if queued then
    -- Decided as the AI wrote it, through the queue's own gate (`approvals_guard_draft` reads this setting).
    perform set_config('one.draft_approval', draft.id::text, true);
    update public.approvals set
      status = 'approved',
      final_output = (select r.output from public.ai_runs r where r.id = waiting.run_id),
      edited = false,
      decided_auto = true,
      decided_by = null,
      decided_at = now()
    where id = waiting.id;
    perform set_config('one.draft_approval', '', true);
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (waiting.org_id, null, 'ai.approval.approved', 'approval', waiting.id::text,
      jsonb_build_object('task', waiting.task, 'run_id', waiting.run_id, 'edited', false, 'auto', true));
  end if;
  return jsonb_build_object('ok', true, 'code', 'approved');
end;
$$;

revoke all on function public.approve_case_draft_unattended(uuid) from public, anon, authenticated;

/** The sweep of ONE's approvals (0029, redefined): a piece that waits for answers takes no turn. */
create or replace function public.approve_case_drafts_unattended(target_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate uuid;
  approved integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  for candidate in
    select d.id from public.case_drafts d
    where d.auto_approval_owed
      and public.free_justice_piece_blocker(d.id) is distinct from 'free_justice_unanswered'
    order by d.updated_at, d.id
    limit least(greatest(coalesce(target_limit, 20), 1), 100)
  loop
    begin
      if coalesce((public.approve_case_draft_unattended(candidate) ->> 'ok')::boolean, false) then
        approved := approved + 1;
      end if;
    exception when others then
      -- A try that failed is spent like any other (the draft waits for a lawyer), and the others go on; one
      -- whose flag could not even be cleared now is tried at the next sweep.
      begin
        update public.case_drafts set auto_approval_owed = false where id = candidate;
      exception when others then
        null;
      end;
    end;
  end loop;
  return approved;
end;
$$;

revoke all on function public.approve_case_drafts_unattended(integer) from public, anon, authenticated;

-- The platform's model of the civil court writes the request where the answers say (it left a [COMPLETAR]).
-- Its text is as the migration's file was read when applied: with CRLF where a checkout on Windows applied it, so
-- the requests are replaced in either form.
update public.draft_templates
set body = replace(replace(replace(body,
  'A parte autora não tem condições de arcar com as custas e as despesas do processo sem prejuízo do próprio sustento e requer a gratuidade da justiça, nos termos do art. 98 da Lei nº 13.105. [COMPLETAR: confirmar quais partes autoras pedem a gratuidade e juntar a declaração de cada uma.]',
  '[[GRATUIDADE]]'),
  E'a) a concessão da gratuidade da justiça a cada parte autora que a pediu, nos termos do art. 98 da Lei nº 13.105;\n\nb) a citação da ré para comparecer à audiência de conciliação ou de mediação e, querendo, apresentar contestação;\n\nc) a intimação do Ministério Público, havendo parte autora menor de idade;\n\nd) a inversão do ônus da prova, nos termos do art. 6º, VIII, da Lei nº 8.078;\n\ne) a condenação da ré ao pagamento, a cada parte autora, das indenizações por danos materiais e morais conforme o pedido de cada uma: [[PEDIDO_POR_PARTE]];\n\nf) a produção de todas as provas admitidas em direito, em especial a documental que acompanha esta inicial.\n\n',
  E'a) a citação da ré para comparecer à audiência de conciliação ou de mediação e, querendo, apresentar contestação;\n\nb) a intimação do Ministério Público, havendo parte autora menor de idade;\n\nc) a inversão do ônus da prova, nos termos do art. 6º, VIII, da Lei nº 8.078;\n\nd) a condenação da ré ao pagamento, a cada parte autora, das indenizações por danos materiais e morais conforme o pedido de cada uma: [[PEDIDO_POR_PARTE]];\n\ne) a produção de todas as provas admitidas em direito, em especial a documental que acompanha esta inicial.\n\n[[PEDIDO_GRATUIDADE]]\n\n'),
  E'a) a concessão da gratuidade da justiça a cada parte autora que a pediu, nos termos do art. 98 da Lei nº 13.105;\r\n\r\nb) a citação da ré para comparecer à audiência de conciliação ou de mediação e, querendo, apresentar contestação;\r\n\r\nc) a intimação do Ministério Público, havendo parte autora menor de idade;\r\n\r\nd) a inversão do ônus da prova, nos termos do art. 6º, VIII, da Lei nº 8.078;\r\n\r\ne) a condenação da ré ao pagamento, a cada parte autora, das indenizações por danos materiais e morais conforme o pedido de cada uma: [[PEDIDO_POR_PARTE]];\r\n\r\nf) a produção de todas as provas admitidas em direito, em especial a documental que acompanha esta inicial.\r\n\r\n',
  E'a) a citação da ré para comparecer à audiência de conciliação ou de mediação e, querendo, apresentar contestação;\r\n\r\nb) a intimação do Ministério Público, havendo parte autora menor de idade;\r\n\r\nc) a inversão do ônus da prova, nos termos do art. 6º, VIII, da Lei nº 8.078;\r\n\r\nd) a condenação da ré ao pagamento, a cada parte autora, das indenizações por danos materiais e morais conforme o pedido de cada uma: [[PEDIDO_POR_PARTE]];\r\n\r\ne) a produção de todas as provas admitidas em direito, em especial a documental que acompanha esta inicial.\r\n\r\n[[PEDIDO_GRATUIDADE]]\r\n\r\n')
where org_id is null and document_kind = 'piece' and proceeding_kind = 'comum'
  and strpos(body, '[COMPLETAR: confirmar quais partes autoras pedem a gratuidade') > 0;

-- ---------- The models a firm writes ----------

/** Writes a model of the firm's (0123, redefined): a declaration of hardship too. */
create or replace function public.draft_template_write(
  target_org uuid,
  target_actor uuid,
  target_template uuid,
  fields jsonb,
  target_by_one boolean default false,
  target_creator uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  longest integer := least(greatest(public.drafts_setting('max_body_chars', 150000), 1000), 200000);
  most integer := greatest(public.drafts_setting('max_templates', 40), 1);
  name_value text := btrim(regexp_replace(coalesce(fields ->> 'name', ''), '[[:cntrl:]]', ' ', 'g'));
  kind_value text := nullif(btrim(coalesce(fields ->> 'proceeding_kind', '')), '');
  document_value text := coalesce(nullif(btrim(coalesce(fields ->> 'document_kind', '')), ''), 'piece');
  body_value text := coalesce(fields ->> 'body', '');
  default_value boolean := coalesce(fields -> 'is_default' = 'true'::jsonb, false);
  by_one boolean := coalesce(target_by_one, false);
  saved uuid;
begin
  if char_length(name_value) < 2 or char_length(name_value) > 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'name');
  end if;
  if kind_value is not null and kind_value not in ('juizado', 'comum') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'proceeding_kind');
  end if;
  if document_value not in ('piece', 'procuracao', 'contrato', 'declaracao_residencia', 'declaracao_hipossuficiencia') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'document_kind');
  end if;
  -- A power of attorney, a contract or a declaration serves every lawsuit: it names no kind of lawsuit.
  if document_value <> 'piece' then
    kind_value := null;
  end if;
  if char_length(btrim(body_value)) < 20 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'body');
  end if;
  if char_length(body_value) > longest then
    return jsonb_build_object('ok', false, 'code', 'too_long', 'field', 'body');
  end if;
  if exists (
    select 1 from public.draft_templates t
    where t.org_id = target_org and lower(btrim(t.name)) = lower(name_value) and t.id is distinct from target_template
  ) then
    return jsonb_build_object('ok', false, 'code', 'name_in_use', 'field', 'name');
  end if;

  -- One default per kind: two saving defaults at once wait for each other (before either holds a model), and the
  -- second wins.
  if default_value then
    perform pg_advisory_xact_lock(hashtextextended('draft_template_default:' || target_org::text, 0));
  end if;
  -- The model itself is held then: one removed meanwhile is answered as gone before anything is written.
  if target_template is not null then
    -- `no key update`: a piece being asked from this model at the same moment (its key share) is not waited for.
    perform 1 from public.draft_templates t where t.id = target_template and t.org_id = target_org for no key update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
  end if;
  if target_template is null
     and (select count(*) from public.draft_templates t where t.org_id = target_org) >= most then
    return jsonb_build_object('ok', false, 'code', 'too_many_templates');
  end if;
  if default_value then
    -- The model that was the default of the kind stops being it, on the record.
    with cleared as (
      update public.draft_templates set is_default = false, updated_by = target_actor
      where org_id = target_org and is_default and document_kind = document_value
        and coalesce(proceeding_kind, '') = coalesce(kind_value, '')
        and id is distinct from target_template
      returning id, name
    )
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    select target_org, target_actor, 'drafts.template_default_moved', 'draft_template', cleared.id::text,
      jsonb_build_object('name', cleared.name)
    from cleared;
  end if;

  if target_template is null then
    insert into public.draft_templates (org_id, name, proceeding_kind, document_kind, body, is_default, created_by,
                                        updated_by, prepared_by_one)
    values (target_org, name_value, kind_value, document_value, body_value, default_value,
            coalesce(target_creator, target_actor), target_actor, by_one)
    returning id into saved;
  else
    update public.draft_templates
    set name = name_value, proceeding_kind = kind_value, document_kind = document_value, body = body_value,
        is_default = default_value, updated_by = target_actor, prepared_by_one = by_one
    where id = target_template and org_id = target_org
    returning id into saved;
    if saved is null then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, target_actor, 'drafts.template_saved', 'draft_template', saved::text,
    jsonb_strip_nulls(jsonb_build_object('name', name_value, 'default', case when default_value then true end,
      'by_one', case when by_one then true end)));
  return jsonb_build_object('ok', true, 'code', 'saved', 'template_id', saved);
end;
$$;

revoke all on function public.draft_template_write(uuid, uuid, uuid, jsonb, boolean, uuid) from public, anon, authenticated;

/** The operator saves a model of the platform (0123, redefined): a declaration of hardship too. */
create or replace function public.admin_save_platform_template(target_template uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  name_value text := btrim(coalesce(fields ->> 'name', ''));
  kind_value text := nullif(btrim(coalesce(fields ->> 'proceeding_kind', '')), '');
  document_value text := coalesce(nullif(btrim(coalesce(fields ->> 'document_kind', '')), ''), 'piece');
  body_value text := coalesce(fields ->> 'body', '');
  default_value boolean := coalesce(fields -> 'is_default' = 'true'::jsonb, false);
  provisional_value boolean := coalesce(fields -> 'provisional' = 'true'::jsonb, false);
  saved uuid;
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if kind_value is not null and kind_value not in ('juizado', 'comum') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'proceeding_kind');
  end if;
  -- The platform proposes pieces, a power of attorney and a declaration of residence; a fee contract is only ever
  -- a firm's own.
  if document_value not in ('piece', 'procuracao', 'declaracao_residencia', 'declaracao_hipossuficiencia') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'document_kind');
  end if;
  if document_value <> 'piece' then
    kind_value := null;
  end if;
  -- Two operators never make two defaults of a kind at once.
  perform pg_advisory_xact_lock(hashtextextended('draft_template_default:platform', 0));
  -- A model that is not the platform's changes nothing, the default of its kind included.
  if target_template is not null
     and not exists (select 1 from public.draft_templates t where t.id = target_template and t.org_id is null) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  begin
    if default_value then
      update public.draft_templates t set is_default = false, updated_by = caller
      where t.org_id is null and t.is_default and t.document_kind = document_value
        and coalesce(t.proceeding_kind, '') = coalesce(kind_value, '')
        and t.id is distinct from target_template;
    end if;
    if target_template is not null then
      update public.draft_templates t
      set name = name_value, proceeding_kind = kind_value, document_kind = document_value, body = body_value,
          is_default = default_value, provisional = provisional_value, updated_by = caller
      where t.id = target_template and t.org_id is null
      returning t.id into saved;
      if saved is null then
        return jsonb_build_object('ok', false, 'code', 'not_found');
      end if;
    else
      insert into public.draft_templates (org_id, name, proceeding_kind, document_kind, body, is_default, provisional,
        created_by, updated_by)
      values (null, name_value, kind_value, document_value, body_value, default_value, provisional_value, caller, caller)
      returning id into saved;
    end if;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'name_in_use');
    when check_violation or not_null_violation then
      return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'platform.template_saved', 'draft_template', saved::text,
    jsonb_build_object('kind', kind_value, 'document_kind', document_value, 'is_default', default_value,
      'provisional', provisional_value));
  return jsonb_build_object('ok', true, 'code', 'saved', 'template_id', saved);
end;
$$;

revoke all on function public.admin_save_platform_template(uuid, jsonb) from public, anon;
grant execute on function public.admin_save_platform_template(uuid, jsonb) to authenticated;

-- ---------- The case screen follows them by itself ----------

/** The mark of what the case screen reads (0104, redefined): the declarations of residence and the free justice too. */
create or replace function public.case_pulse(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  advance public.case_advances%rowtype;
  stale integer := greatest(public.case_advance_setting('stale_minutes', 15), 1);
  stamp text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  select * into advance from public.case_advances where case_id = target_case;

  select md5(concat_ws('|',
    current_case::text,
    (select concat(count(*), '/', max(e.at)) from public.case_events e where e.case_id = target_case),
    (select concat(a.waiting, '/', a.checked_at, '/', a.waiting_since, '/', a.claimed_at, '/', a.woken_at, '/', a.after)
       from public.case_advances a where a.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_parties t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.people t
       where t.id in (select cp.person_id from public.case_parties cp where cp.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.flight_segments t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.flight_checks t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_documents t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_statements t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_interviews t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_interview_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_links t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_consents t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.signature_envelopes t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_papers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.civil_court_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.residence_declarations t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.free_justice_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.proceedings t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.proceeding_parties t
       where t.proceeding_id in (select p.id from public.proceedings p where p.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.proceeding_lawyers t
       where t.proceeding_id in (select p.id from public.proceedings p where p.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.proceeding_tracking t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_drafts t where t.case_id = target_case),
    (select concat(count(*), '/', max(v.created_at)) from public.case_draft_versions v
       where v.draft_id in (select d.id from public.case_drafts d where d.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.filing_packages t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.dossiers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.deadlines t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.hearings t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_notices t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.admin_complaints t where t.case_id = target_case),
    -- Of a publication, only what a member reads of it: never the AI's word in the shadow.
    (select md5(coalesce(string_agg(concat_ws(',', t.id, t.category, t.triaged_at, t.active, t.cancel_seen_at,
        t.review_due, t.judgment, t.judgment_source, t.ack_owed, t.acked_at), ';' order by t.id), ''))
       from public.publications t where t.case_id = target_case),
    (select md5(coalesce(string_agg(concat_ws(',', r.publication_id, r.kind, r.status, r.reason, r.updated_at), ';'
        order by r.publication_id, r.kind), ''))
       from public.publication_readings r
       where r.publication_id in (select p.id from public.publications p where p.case_id = target_case))
  )) into stamp;

  return jsonb_build_object(
    'stamp', stamp,
    'advance', jsonb_build_object(
      'running', coalesce(advance.claimed_at is not null and advance.claimed_at > now() - make_interval(mins => stale), false),
      'due', coalesce(advance.woken_at is not null
        and (advance.checked_at is null or advance.woken_at > advance.checked_at)
        and (advance.after is null or advance.after <= now()), false),
      'waiting_since', advance.waiting_since,
      'checked_at', advance.checked_at
    )
  );
end;
$$;

revoke all on function public.case_pulse(uuid) from public, anon;
grant execute on function public.case_pulse(uuid) to authenticated;

-- ---------- The piece's instructions name the request's marks ----------

-- A fifth version of `caso.peca.minuta`: the marks of the request for free justice are the database's, written as each
-- claimant answered, and the AI keeps them where the model puts them and never writes the request in its own words.
insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'caso.peca.minuta',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'caso.peca.minuta'),
  v.provider, v.model, v.effort,
  replace(v.system_prompt,
    '[[PEDIDO_POR_PARTE]] e [[ADVOGADOS]], são preenchidas pelo sistema com os dados do caso.',
    '[[PEDIDO_POR_PARTE]], [[ADVOGADOS]], [[GRATUIDADE]] e [[PEDIDO_GRATUIDADE]], são preenchidas pelo sistema com os dados do caso. [[GRATUIDADE]] e [[PEDIDO_GRATUIDADE]] escrevem o pedido de gratuidade da justiça como cada parte autora respondeu: não escreva esse pedido com as suas palavras nem diga quem o pede.'),
  v.output_schema, v.max_tokens, false,
  'As marcas do pedido de gratuidade da justiça são do sistema, escritas como cada parte autora respondeu.'
from public.prompt_versions v
where v.task = 'caso.peca.minuta' and v.is_active
  and strpos(v.system_prompt, '[[GRATUIDADE]]') = 0
  and strpos(v.system_prompt, '[[PEDIDO_POR_PARTE]] e [[ADVOGADOS]], são preenchidas pelo sistema com os dados do caso.') > 0;

-- In force: one version per task, so the one in force leaves before the new one comes in.
update public.prompt_versions as v set is_active = false
where v.task = 'caso.peca.minuta' and v.is_active
  and strpos(v.system_prompt, '[[GRATUIDADE]]') = 0
  and exists (
    select 1 from public.prompt_versions w
    where w.task = v.task and w.version > v.version and strpos(w.system_prompt, '[[GRATUIDADE]]') > 0
  );
update public.prompt_versions set is_active = true
where task = 'caso.peca.minuta'
  and version = (select max(w.version) from public.prompt_versions w where w.task = 'caso.peca.minuta')
  and strpos(system_prompt, '[[GRATUIDADE]]') > 0;
