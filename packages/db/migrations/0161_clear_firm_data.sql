-- 0161_clear_firm_data
--
-- A firm starts its tests again from nothing (the owner, 2026-11-10): one action in the firm's settings takes away
-- every case of the firm with what hangs on it, every client (`people`), every WhatsApp conversation and request to
-- stop, the trips ONE follows for the firm, the publications, deadlines and hearings, the portfolio imports, and the
-- passengers its partner agencies registered at the test chat's numbers ("(00) 98888-000N", 0047), with the children
-- they answer for, their trips and documents. What stays: the accounts and the team, the setup and every setting,
-- the library, the connections and the test chat itself, the partnerships and the agency's other passengers, the
-- firm's books (an entry or a bill of a case that goes loses its link to it), the documents ONE issued (their public
-- code still answers), the audit trail and the removals a calendar is owed (a hearing that goes still has its event
-- taken out of Google).
--
-- It deletes real data when a real firm uses it, so it is guarded as the gravest act of the firm: who decides for
-- the firm (`decides_for_firm`, 0078), with the second factor, never in a support visit, the word "apagar" typed by
-- the person and checked here too, and the firm's own row locked meanwhile (a case created at that moment waits).
-- It is on the record with how many of each went (`firm.data_cleared`), never anything of anybody.
--
-- The AI's answers about what goes leave the queue and each run keeps its cost and loses its output, as when a
-- person's data are erased (0133). The bell's lines that lead to what went are taken out. A file goes only when no
-- row that stays names it, read from every foreign key that points at `files`, so a reference added later is
-- honoured with no change here; the firm's own uploads of the books and of the library are never taken. The bytes
-- of the files that went are queued where the backend already removes bytes after their records (`pax_file_removals`,
-- 0072, drained by the passenger module's daily sweep) and the app removes them at once after the answer.

-- ---------- Who may ----------

/** Why this person may not clear the firm's data now, or null. Internal. */
create or replace function public.firm_clear_refusal(target_org uuid, need_second_factor boolean)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_impersonated() then 'support_visit'
    when not public.decides_for_firm(target_org) then 'not_allowed'
    when need_second_factor and not public.is_aal2() then 'second_factor'
  end;
$$;

revoke all on function public.firm_clear_refusal(uuid, boolean) from public, anon, authenticated;

-- ---------- The agency's test passengers ----------

/**
 * The passengers of the firm's partner agencies that a clearing takes: the adults registered at a test chat's number
 * and the children whose guardian is one of them. A passenger at any other number stays the agency's. Internal.
 */
create or replace function public.firm_clear_travelers(target_org uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with adults as (
    select t.id
    from public.pax_travelers t
    where (t.org_id = target_org
           or t.partnership_id in (select l.id from public.partner_links l where l.org_id = target_org))
      and regexp_replace(coalesce(t.phone, ''), '\D', '', 'g') ~ '^(55)?0098888000[0-9]$'
  )
  select a.id from adults a
  union
  select t.id from public.pax_travelers t where t.guardian_id in (select a.id from adults a);
$$;

revoke all on function public.firm_clear_travelers(uuid) from public, anon, authenticated;

-- ---------- What would go ----------

/**
 * What a clearing would take now, for the confirmation the person reads before typing the word: how many cases,
 * clients, conversations, publications, deadlines, hearings, portfolio imports and agency test passengers. Who may
 * clear reads it with no second factor (the dialog asks for it in place); anybody else is refused.
 */
create or replace function public.firm_clear_preview(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  refusal text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  refusal := public.firm_clear_refusal(target_org, false);
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  return jsonb_build_object(
    'ok', true,
    'second_factor', public.is_aal2(),
    'counts', jsonb_build_object(
      'cases', (select count(*) from public.cases c where c.org_id = target_org),
      'people', (select count(*) from public.people p where p.org_id = target_org),
      'conversations', (select count(*) from public.wa_conversations w where w.org_id = target_org),
      'publications', (select count(*) from public.publications p where p.org_id = target_org),
      'deadlines', (select count(*) from public.deadlines d where d.org_id = target_org),
      'hearings', (select count(*) from public.hearings h where h.org_id = target_org),
      'imports', (select count(*) from public.import_batches b where b.org_id = target_org),
      'agency_passengers', (select count(*) from public.firm_clear_travelers(target_org))));
end;
$$;

revoke all on function public.firm_clear_preview(uuid) from public, anon;
grant execute on function public.firm_clear_preview(uuid) to authenticated;

-- ---------- The clearing ----------

/**
 * Clears the firm's cases, clients and conversations (see the header). Answers how many of each went and the storage
 * paths of the files whose records went, for the app to remove their bytes; or a refusal: `support_visit`,
 * `not_allowed`, `second_factor`, `confirm_missing` (the word was not typed).
 */
create or replace function public.clear_firm_data(target_org uuid, target_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  refusal text;
  firm_subjects constant text[] := array['case_document', 'case_draft', 'case_interview', 'case_statement',
    'publication', 'wa_conversation', 'wa_message'];
  bell constant text := '^/(casos|pessoas|parceiro/passageiros|publicacoes|prazos|agenda|protocolo|aprovacoes|atendimento|financeiro/repasses)(/|\?|#|$)';
  travelers uuid[];
  trips uuid[];
  pax_docs text[];
  pax_files uuid[];
  candidates uuid[];
  gone_files uuid[];
  paths text[];
  fk record;
  n_runs integer;
  n_approvals integer;
  n_bell integer;
  n_optouts integer;
  n_conversations integer;
  n_trips integer;
  n_publications integer;
  n_deadlines integer;
  n_hearings integer;
  n_imports integer;
  n_cases integer;
  n_people integer;
  counts jsonb;
begin
  if actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  refusal := public.firm_clear_refusal(target_org, true);
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if lower(btrim(coalesce(target_confirm, ''))) <> 'apagar' then
    return jsonb_build_object('ok', false, 'code', 'confirm_missing');
  end if;

  -- One clearing at a time, and no case created while it runs (`create_case` takes this row too).
  perform 1 from public.organizations o where o.id = target_org for update;

  select coalesce(array_agg(x), '{}') into travelers from public.firm_clear_travelers(target_org) x;
  select coalesce(array_agg(p.id), '{}') into trips from public.pax_trips p where p.holder_id = any (travelers);
  select coalesce(array_agg(d.id::text), '{}'), coalesce(array_agg(d.file_id) filter (where d.file_id is not null), '{}')
    into pax_docs, pax_files
  from public.pax_documents d where d.traveler_id = any (travelers);

  -- The AI's answers about what goes leave the queue; each run keeps its cost and loses what it answered.
  delete from public.approvals a
  using public.ai_runs r
  where r.id = a.run_id
    and ((r.org_id = target_org and r.subject_type = any (firm_subjects))
         or (r.subject_type = 'pax_document' and r.subject_id = any (pax_docs)));
  get diagnostics n_approvals = row_count;
  update public.ai_runs r set output = null
  where r.output is not null
    and ((r.org_id = target_org and r.subject_type = any (firm_subjects))
         or (r.subject_type = 'pax_document' and r.subject_id = any (pax_docs)));
  get diagnostics n_runs = row_count;

  -- The bell's lines that lead to what goes: the firm's people's, and the agency's about its test passengers.
  delete from public.notifications n
  where (n.user_id in (select m.user_id from public.memberships m where m.org_id = target_org)
         and coalesce(n.href, '') ~ bell)
     or (n.user_id in (select pm.user_id from public.partner_members pm
                       join public.partner_links l on l.partner_id = pm.partner_id
                       where l.org_id = target_org)
         and exists (select 1 from unnest(travelers) t
                     where n.href like '/parceiro/passageiros/' || t::text || '%'));
  get diagnostics n_bell = row_count;

  delete from public.wa_optouts w where w.org_id = target_org;
  get diagnostics n_optouts = row_count;
  delete from public.wa_conversations w where w.org_id = target_org;
  get diagnostics n_conversations = row_count;
  -- The trips ONE follows for the firm; an agency's trip of a passenger who stays is the agency's.
  delete from public.tracked_trips t
  where t.org_id = target_org and (t.pax_trip_id is null or t.pax_trip_id = any (trips));
  get diagnostics n_trips = row_count;
  delete from public.pax_travelers t where t.id = any (travelers);
  delete from public.publications p where p.org_id = target_org;
  get diagnostics n_publications = row_count;
  delete from public.deadlines d where d.org_id = target_org;
  get diagnostics n_deadlines = row_count;
  -- A hearing that goes owes the removal of its event from the firm's calendar (`hearings_owe_removal`, 0037).
  delete from public.hearings h where h.org_id = target_org;
  get diagnostics n_hearings = row_count;
  delete from public.import_batches b where b.org_id = target_org;
  get diagnostics n_imports = row_count;
  delete from public.cases c where c.org_id = target_org;
  get diagnostics n_cases = row_count;
  delete from public.people p where p.org_id = target_org;
  get diagnostics n_people = row_count;

  -- The files no row that stays names: the firm's own (but the books' and the library's uploads) and the agency's
  -- documents of the passengers that went.
  select coalesce(array_agg(f.id), '{}') into candidates
  from public.files f
  where f.org_id = target_org
    and ((f.partner_id is null and f.purpose not in ('finance', 'model_source')) or f.id = any (pax_files));
  -- A key that also holds the firm (`(file_id, org_id)`) is read for the firm's rows alone.
  for fk in
    select c.conrelid::regclass::text as tbl, a.attname as col,
      exists (select 1 from unnest(c.conkey) ck join pg_attribute o on o.attrelid = c.conrelid and o.attnum = ck
              where o.attname = 'org_id') as by_firm
    from pg_constraint c
    cross join lateral unnest(c.conkey, c.confkey) as k (child_att, parent_att)
    join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = k.parent_att and pa.attname = 'id'
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.child_att
    where c.contype = 'f' and c.confrelid = 'public.files'::regclass
  loop
    exit when cardinality(candidates) = 0;
    execute format(
      'select coalesce(array_agg(x), ''{}'') from unnest($1) x
       where x not in (select t.%I from %s t where t.%I is not null %s)',
      fk.col, fk.tbl, fk.col, case when fk.by_firm then 'and t.org_id = $2' else '' end)
      into candidates using candidates, target_org;
  end loop;
  with gone as (
    delete from public.files f where f.id = any (candidates) returning f.id, f.storage_path
  )
  select coalesce(array_agg(g.id), '{}'), coalesce(array_agg(g.storage_path), '{}') into gone_files, paths from gone g;
  update public.ai_runs r set output = null
  where r.subject_type = 'file' and r.subject_id = any (gone_files::text[]) and r.output is not null;
  -- Records first, bytes after: what the app does not remove at once, the daily sweep does.
  insert into public.pax_file_removals (storage_path)
  select p from unnest(paths) p where p ~ '^org/[0-9a-f-]{36}/[a-z_]+/[0-9a-f-]{36}$'
  on conflict do nothing;

  counts := jsonb_build_object(
    'cases', n_cases, 'people', n_people, 'conversations', n_conversations, 'optouts', n_optouts,
    'tracked_trips', n_trips, 'publications', n_publications, 'deadlines', n_deadlines, 'hearings', n_hearings,
    'imports', n_imports, 'agency_passengers', cardinality(travelers), 'files', cardinality(gone_files),
    'ai_answers', n_runs, 'approvals', n_approvals, 'bell', n_bell);
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, actor, 'firm.data_cleared', 'firm', target_org::text, counts);
  return jsonb_build_object('ok', true, 'code', 'cleared', 'counts', counts, 'paths', to_jsonb(paths));
end;
$$;

revoke all on function public.clear_firm_data(uuid, text) from public, anon;
grant execute on function public.clear_firm_data(uuid, text) to authenticated;
