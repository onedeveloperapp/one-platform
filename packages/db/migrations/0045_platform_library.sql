-- ============================================================
-- 0045_platform_library: the models and sources ONE gives every firm.
--
-- A firm's library and its models of pieces were the firm's alone (0029), so
-- a firm just founded had nothing to write a piece from: ONE waited on every
-- case for "a default model" (0039) and every citation of a first text was a
-- source to register by hand. The platform now keeps its own, read by every
-- firm and written by the operator only:
--
-- - Sources (`legal_sources` with no firm): each checked by ONE where it was
--   published, with the address and the day, and answering the gate of a
--   piece of any firm as the firm's own sources do (`legal_source_covers`).
--   A firm still registers its own; where both have a key, what the AI is
--   handed is the firm's (`case_draft_to_work`).
-- - Models (`draft_templates` with no firm): a default per kind of lawsuit,
--   marked provisional (`provisional`) while the curator has not reviewed it.
--   ONE writes from the platform's model only for a firm that has no model of
--   that kind; a firm with its own models keeps its rule (its default, or its
--   only model), so a firm with two models and no default still waits for a
--   person to choose (`draft_template_for`). A piece may be asked from a model
--   of the platform (`request_case_draft`), and a draft keeps the model's
--   name and text as it was asked.
--
-- Seeded with 22 sources (the consumer code, the Civil Code, the Constitution,
-- the small-claims law, the CPC, the Montreal Convention, ANAC's Resolution
-- 400 and two themes of the STF), each quoted as its official page writes it
-- (Planalto, ANAC, STF; read on 2026-10-22), and with two models, the
-- initial of the small-claims court and the one of the civil court, which
-- cite only these. The operator keeps them (`admin_save_platform_source`,
-- `admin_retire_platform_source`, `admin_save_platform_template`,
-- `admin_remove_platform_template`, each on the record).
-- ============================================================

-- ---------- Sources ----------

alter table public.legal_sources alter column org_id drop not null;

-- The platform keeps one entry per key, as each firm does (`unique (org_id, key)` counts no null twice).
create unique index legal_sources_platform_key_idx on public.legal_sources (key) where org_id is null;
create index legal_sources_platform_norm_idx on public.legal_sources (kind, issuer, number)
  where org_id is null and status = 'verified';

-- What the platform checked is anybody's to read: the text of a law, as its official page writes it.
create policy "legal_sources_select_platform" on public.legal_sources
  for select to authenticated using (org_id is null);

/**
 * True when the library of the firm, or the platform's, answers for a
 * citation (0029): an article needs an entry of that very article; a citation
 * of a norm with no article is answered by an entry of the norm or of any
 * article of it; a decision, a súmula or a theme by its own entry. An article
 * with no norm beside it (`artigo`) and what was read into no source
 * (`ilegivel`) are never answered. The same rule as `isCovered` in
 * `@flyee/knowledge/citations`.
 */
create or replace function public.legal_source_covers(target_org uuid, kind text, issuer text, number text, article text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select kind not in ('artigo', 'ilegivel') and exists (
    select 1 from public.legal_sources s
    where (s.org_id = target_org or s.org_id is null) and s.status = 'verified'
      and s.kind = legal_source_covers.kind and s.issuer = upper(coalesce(legal_source_covers.issuer, ''))
      and s.number = legal_source_covers.number
      and (legal_source_covers.article is null or s.article = legal_source_covers.article)
  );
$$;

revoke all on function public.legal_source_covers(uuid, text, text, text, text) from public, anon, authenticated;

-- ---------- Models ----------

alter table public.draft_templates alter column org_id drop not null;
alter table public.draft_templates add column provisional boolean not null default false;
-- Provisional is said of a model of the platform: a firm's model is the firm's word.
alter table public.draft_templates add constraint draft_templates_provisional_check
  check (not provisional or org_id is null);

comment on column public.draft_templates.provisional is
  'A model of the platform the curator has not reviewed yet; shown as such to the firms.';

create unique index draft_templates_platform_name_idx on public.draft_templates (lower(btrim(name)))
  where org_id is null;
create unique index draft_templates_platform_default_idx on public.draft_templates (coalesce(proceeding_kind, ''))
  where org_id is null and is_default;

create policy "draft_templates_select_platform" on public.draft_templates
  for select to authenticated using (org_id is null);

-- A draft may come from a model of the platform: the model is named by its id alone, and who may use it is
-- `request_case_draft`'s to say (a model of the case's firm, or of the platform).
alter table public.case_drafts drop constraint case_drafts_template_id_org_id_fkey;
alter table public.case_drafts add constraint case_drafts_template_id_fkey
  foreign key (template_id) references public.draft_templates (id) on delete set null;

/**
 * The model ONE writes the piece of a lawsuit of a kind from (0039): for a
 * firm with models of that kind, its default of the kind, else its default of
 * both kinds, else its only model that serves the kind (and nothing when it
 * has more than one and no default: a person chooses); for a firm with none,
 * the platform's default of the kind, else the platform's of both kinds.
 */
create or replace function public.draft_template_for(target_org uuid, target_kind text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.draft_templates t
      where t.org_id = target_org and (t.proceeding_kind = target_kind or t.proceeding_kind is null)
    ) then coalesce(
      (select t.id from public.draft_templates t
       where t.org_id = target_org and t.is_default and t.proceeding_kind = target_kind),
      (select t.id from public.draft_templates t
       where t.org_id = target_org and t.is_default and t.proceeding_kind is null),
      (select (array_agg(t.id))[1] from public.draft_templates t
       where t.org_id = target_org and (t.proceeding_kind = target_kind or t.proceeding_kind is null)
       having count(*) = 1)
    )
    else coalesce(
      (select t.id from public.draft_templates t
       where t.org_id is null and t.is_default and t.proceeding_kind = target_kind),
      (select t.id from public.draft_templates t
       where t.org_id is null and t.is_default and t.proceeding_kind is null)
    )
  end;
$$;

revoke all on function public.draft_template_for(uuid, text) from public, anon, authenticated;

/**
 * A model added, changed or removed may now be, or no longer be, the one ONE
 * writes from (0039). A model of the platform may be every firm's: each firm
 * with a case that waits for a model is looked at again.
 */
create or replace function public.draft_templates_wake_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.org_id, old.org_id);
  firm uuid;
begin
  if target is not null then
    perform public.wake_firm_advance(target, 'piece');
  else
    for firm in
      select distinct a.org_id from public.case_advances a where a.waiting = 'no_model' order by a.org_id
    loop
      perform public.wake_firm_advance(firm, 'piece');
    end loop;
  end if;
  return null;
end;
$$;

revoke all on function public.draft_templates_wake_advance() from public, anon, authenticated;

/**
 * Anybody who works on a case asks for the draft of the piece of a lawsuit
 * not filed yet, from a model of the firm or of the platform (0029, 0045).
 */
create or replace function public.request_case_draft(target_proceeding uuid, target_template uuid, target_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  template public.draft_templates%rowtype;
  replaced uuid;
  draft uuid;
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'proceeding_not_found');
  end if;
  current_case := public.case_for_writer(lawsuit.case_id);
  -- Read again under the lock of its case: a receipt may have just filed it.
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'proceeding_not_found');
  end if;
  if lawsuit.status <> 'planned' then
    return jsonb_build_object('ok', false, 'code', 'already_filed');
  end if;
  if current_case.status in ('closed', 'declined') then
    return jsonb_build_object('ok', false, 'code', 'case_closed');
  end if;
  if target_mode is null or target_mode not in ('ai', 'blank') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'mode');
  end if;
  -- A model of the case's firm, or of the platform (0045).
  select * into template from public.draft_templates
  where id = target_template and (org_id = current_case.org_id or org_id is null);
  if not found then
    return jsonb_build_object('ok', false, 'code', 'template_not_found', 'field', 'template');
  end if;
  if exists (select 1 from public.case_drafts d where d.proceeding_id = lawsuit.id and d.status = 'approved') then
    return jsonb_build_object('ok', false, 'code', 'draft_being_issued');
  end if;
  if exists (select 1 from public.case_drafts d where d.proceeding_id = lawsuit.id and d.status = 'proposed') then
    return jsonb_build_object('ok', false, 'code', 'draft_in_course');
  end if;

  for replaced in
    select d.id from public.case_drafts d
    where d.proceeding_id = lawsuit.id and d.status in ('generating', 'failed')
    order by d.requested_at, d.id
  loop
    perform public.withdraw_draft_approvals(replaced, 'A peça foi substituída por outra.');
    update public.case_drafts
    set status = 'cancelled', work = null, work_claimed_at = null
    where id = replaced and status in ('generating', 'failed');
    if not found then
      -- Its first text arrived while this request waited for its answer in the queue: it waits for a lawyer
      -- now. Raised, never answered: the answer this request just withdrew goes back to waiting with it.
      raise exception 'draft_in_course' using errcode = 'P0001';
    end if;
  end loop;

  insert into public.case_drafts (
    org_id, case_id, proceeding_id, template_id, template_name, template_body, mode, status, work, version, requested_by,
    requested_auto
  ) values (
    current_case.org_id, current_case.id, lawsuit.id, template.id, template.name, template.body, target_mode,
    case target_mode when 'ai' then 'generating' else 'proposed' end,
    case target_mode when 'ai' then 'generate' else 'check' end,
    case target_mode when 'ai' then 0 else 1 end,
    auth.uid(),
    public.case_system_writer(current_case.id)
  )
  returning id into draft;
  if target_mode = 'blank' then
    insert into public.case_draft_versions (org_id, draft_id, version, author, author_id, body)
    values (current_case.org_id, draft, 1, 'template', auth.uid(), template.body);
  end if;
  perform public.record_case_event(current_case.org_id, current_case.id, 'draft_requested',
    public.case_actor(current_case.id),
    jsonb_build_object('draft', draft, 'proceeding', lawsuit.id, 'mode', target_mode));
  return jsonb_build_object('ok', true, 'code', 'requested', 'draft_id', draft);
end;
$$;

revoke all on function public.request_case_draft(uuid, uuid, text) from public, anon;
grant execute on function public.request_case_draft(uuid, uuid, text) to authenticated;

/**
 * What a worker is handed of a draft it holds the claim of (0029), the
 * library being the firm's and the platform's (0045).
 */
create or replace function public.case_draft_to_work(target_draft uuid, target_claim integer)
returns table (
  draft_id uuid, org_id uuid, case_id uuid, claim integer, work text, version integer, body text,
  template text, facts jsonb, library jsonb, run_key text, firm text, title text, requested_by uuid, note text,
  same jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  keyed jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into draft from public.case_drafts d
  where d.id = target_draft and d.work is not null and d.work_claimed_at is not null and d.work_claims = target_claim;
  if not found then
    return;
  end if;
  select * into lawsuit from public.proceedings where id = draft.proceeding_id;
  select * into current_case from public.cases where id = draft.case_id;

  draft_id := draft.id;
  org_id := draft.org_id;
  case_id := draft.case_id;
  claim := draft.work_claims;
  work := draft.work;
  version := draft.version;
  -- Who asked (the piece, or its rewriting), while they are still of the firm: a run is asked by a person
  -- of the firm or by nobody.
  requested_by := (
    select m.user_id from public.memberships m
    where m.org_id = draft.org_id
      and m.user_id = case when draft.work = 'revise' then draft.revision_by else draft.requested_by end
  );
  firm := (select o.name from public.organizations o where o.id = draft.org_id);
  title := draft.template_name || ', caso ' || current_case.seq
    || case lawsuit.kind when 'juizado' then ', juizado especial' else ', vara cível' end;
  body := case draft.work
    when 'issue' then draft.approved_body
    when 'check' then (select v.body from public.case_draft_versions v where v.draft_id = draft.id and v.version = draft.version)
  end;
  if draft.work = 'revise' then
    -- The list of the marks is written under the claim, with the draft held: a request given up and asked
    -- again meanwhile is another claim, and never reads under this one's list.
    select * into draft from public.case_drafts d
    where d.id = target_draft and d.work = 'revise' and d.work_claimed_at is not null and d.work_claims = target_claim
    for update;
    if not found then
      return;
    end if;
    -- A second look at the same work (its worker was cut) reads under the marks of the first.
    keyed := public.case_text_keyed(current_case.id,
      (select v.body from public.case_draft_versions v where v.draft_id = draft.id and v.version = draft.version),
      coalesce(draft.revision_keys, '{}'::jsonb));
    body := keyed ->> 'text';
    keyed := public.case_text_keyed(current_case.id, draft.revision_note, keyed -> 'keys');
    note := keyed ->> 'text';
    same := public.case_marks_same_name(current_case.id, keyed -> 'keys');
    update public.case_drafts d set revision_keys = keyed -> 'keys' where d.id = draft.id;
  end if;
  if draft.work in ('generate', 'revise') then
    if draft.work = 'generate' then
      -- The model of the firm goes as an account does: with what identifies a person taken out of it.
      template := public.case_text_for_ai(current_case.id, draft.template_body);
    end if;
    -- The runs that will never be this draft's text: the ones that failed, and the ones whose answer was no
    -- piece. Each rewriting asked for is a work of its own, with runs of its own.
    run_key := 'draft:' || draft.id::text
      || case when draft.work = 'revise' then ':r' || draft.revisions::text else '' end
      || ':' || (draft.unusable_runs + (
      select count(*) from public.ai_runs r
      where r.org_id = draft.org_id and r.task = 'caso.peca.minuta'
        and r.subject_type = 'case_draft' and r.subject_id = draft.id::text and r.status in ('failed', 'blocked')
    ))::text;
    facts := jsonb_build_object(
      'tipo_de_processo', case lawsuit.kind when 'juizado' then 'juizado especial cível' else 'vara cível, procedimento comum' end,
      'ocorrencia', current_case.incident,
      'companhia', (select a.name from public.airlines a where a.iata = current_case.airline_iata),
      'data_do_voo', current_case.flight_date,
      'causa_informada_pela_companhia', current_case.airline_stated_cause,
      'quantas_partes', (select count(*) from public.proceeding_parties pp where pp.proceeding_id = lawsuit.id),
      -- A minor as the piece itself tells one: not eighteen yet today; with no day of birth on record, one
      -- somebody answers for (`case_draft_filled`).
      'ha_menor_entre_as_partes', exists (
        select 1 from public.proceeding_parties pp
        join public.case_parties cp on cp.id = pp.party_id
        join public.people pe on pe.id = cp.person_id
        where pp.proceeding_id = lawsuit.id
          and case when pe.birth_date is null then cp.guardian_id is not null
                   else pe.birth_date > (now() at time zone 'America/Sao_Paulo')::date - interval '18 years' end
      ),
      'foro', jsonb_build_object('comarca', lawsuit.comarca, 'base', lawsuit.forum_basis,
        'motivo', public.case_text_for_ai(current_case.id, lawsuit.forum_reason)),
      'trechos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'voo', s.flight_number, 'origem', s.origin_iata, 'destino', s.destination_iata,
          'partida_prevista', s.scheduled_departure_local, 'chegada_prevista', s.scheduled_arrival_local,
          'partida_real', s.actual_departure_local, 'chegada_real', s.actual_arrival_local,
          'trecho_afetado', s.affected
        ) order by s.position)
        from public.flight_segments s where s.case_id = current_case.id
      ), '[]'::jsonb),
      -- What the client told, in the order of the facts the firm approved, and whether the client confirmed it.
      'relatos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'confirmado_pelo_cliente', st.chronology_status = 'confirmed',
          'cronologia', public.case_text_for_ai(current_case.id, st.chronology)
        ) order by st.created_at)
        from public.case_statements st
        where st.case_id = current_case.id and st.chronology is not null and st.chronology_status in ('approved', 'confirmed')
      ), '[]'::jsonb),
      'reclamacoes_antes_da_acao', coalesce((
        select jsonb_agg(jsonb_build_object(
          'canal', ac.channel, 'protocolo', ac.protocol, 'feita_em', ac.filed_on, 'respondida_em', ac.answered_on,
          'resultado', ac.outcome
        ) order by ac.created_at)
        from public.admin_complaints ac where ac.case_id = current_case.id
      ), '[]'::jsonb)
    );
    -- Every source with its key: the worker puts the ones the model itself cites first and fits the rest
    -- to what one request carries (`draftLibrary`). Only the start of what may be transcribed goes.
    library := coalesce((
      select jsonb_agg(jsonb_build_object(
        'chave', s.key, 'como_citar', s.citation, 'titulo', s.title, 'trecho', left(s.quote, 1200)
      ) order by s.verified_at desc, s.id)
      from (
        -- The firm's sources and the platform's (0045); where both have a key, the firm's.
        select * from (
          select distinct on (ls.key) ls.* from public.legal_sources ls
          where (ls.org_id = draft.org_id or ls.org_id is null) and ls.status = 'verified'
          order by ls.key, (ls.org_id is null), ls.verified_at desc
        ) both_libraries
        order by both_libraries.verified_at desc, both_libraries.id limit 1000
      ) s
    ), '[]'::jsonb);
  end if;
  return next;
end;
$$;

revoke all on function public.case_draft_to_work(uuid, integer) from public, anon, authenticated;

-- ---------- What the operator keeps ----------

/**
 * The operator registers a source of the platform, or corrects what it says
 * of one (its title, its quote, its address, a note): checked where it was
 * published, said once per key. A source retired comes back verified when it
 * is registered again. Never in a support visit; on the record, with no firm.
 */
create or replace function public.admin_save_platform_source(target_source uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  kind_value text := btrim(coalesce(fields ->> 'kind', ''));
  issuer_value text := upper(btrim(coalesce(fields ->> 'issuer', '')));
  number_value text := btrim(coalesce(fields ->> 'number', ''));
  article_value text := nullif(upper(btrim(coalesce(fields ->> 'article', ''))), '');
  title_value text := btrim(coalesce(fields ->> 'title', ''));
  quote_value text := nullif(btrim(coalesce(fields ->> 'quote', '')), '');
  url_value text := btrim(coalesce(fields ->> 'source_url', ''));
  note_value text := nullif(btrim(coalesce(fields ->> 'note', '')), '');
  existing public.legal_sources%rowtype;
  saved uuid;
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  begin
    if target_source is not null then
      update public.legal_sources s
      set title = title_value, quote = quote_value, source_url = url_value, note = note_value,
          verified_by = caller, verified_at = now()
      where s.id = target_source and s.org_id is null
      returning s.id into saved;
      if saved is null then
        return jsonb_build_object('ok', false, 'code', 'not_found');
      end if;
    else
      select * into existing from public.legal_sources s
      where s.org_id is null and s.key = public.legal_source_key(kind_value, issuer_value, number_value, article_value)
      for update;
      if found and existing.status = 'verified' then
        return jsonb_build_object('ok', false, 'code', 'already_in_library', 'source_id', existing.id);
      elsif found then
        update public.legal_sources s
        set status = 'verified', retired_by = null, retired_at = null, retired_reason = null,
            title = title_value, quote = quote_value, source_url = url_value, note = note_value,
            verified_by = caller, verified_at = now()
        where s.id = existing.id
        returning s.id into saved;
      else
        insert into public.legal_sources (org_id, kind, issuer, number, article, title, quote, source_url, note, verified_by)
        values (null, kind_value, issuer_value, number_value, article_value, title_value, quote_value, url_value, note_value, caller)
        returning id into saved;
      end if;
    end if;
  exception when check_violation or not_null_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_source');
  end;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'platform.source_saved', 'legal_source', saved::text,
    jsonb_build_object('key', (select s.key from public.legal_sources s where s.id = saved)));
  return jsonb_build_object('ok', true, 'code', 'saved', 'source_id', saved);
end;
$$;

revoke all on function public.admin_save_platform_source(uuid, jsonb) from public, anon;
grant execute on function public.admin_save_platform_source(uuid, jsonb) to authenticated;

/** The operator retires a source of the platform, with the reason; it stays on record. */
create or replace function public.admin_retire_platform_source(target_source uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  reason text := btrim(coalesce(target_reason, ''));
  source public.legal_sources%rowtype;
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if char_length(reason) < 4 or char_length(reason) > 500 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  select * into source from public.legal_sources s where s.id = target_source and s.org_id is null for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if source.status = 'retired' then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  update public.legal_sources s
  set status = 'retired', retired_by = caller, retired_at = now(), retired_reason = reason
  where s.id = source.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'platform.source_retired', 'legal_source', source.id::text,
    jsonb_build_object('key', source.key, 'reason', reason));
  return jsonb_build_object('ok', true, 'code', 'retired');
end;
$$;

revoke all on function public.admin_retire_platform_source(uuid, text) from public, anon;
grant execute on function public.admin_retire_platform_source(uuid, text) to authenticated;

/**
 * The operator saves a model of the platform: its name, the kind of lawsuit
 * it serves (or both), its text, whether it is the platform's default of its
 * kind (one per kind: another default of the kind stops being one) and
 * whether it is still provisional. On the record, with no firm.
 */
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
      where t.org_id is null and t.is_default and coalesce(t.proceeding_kind, '') = coalesce(kind_value, '')
        and t.id is distinct from target_template;
    end if;
    if target_template is not null then
      update public.draft_templates t
      set name = name_value, proceeding_kind = kind_value, body = body_value, is_default = default_value,
          provisional = provisional_value, updated_by = caller
      where t.id = target_template and t.org_id is null
      returning t.id into saved;
      if saved is null then
        return jsonb_build_object('ok', false, 'code', 'not_found');
      end if;
    else
      insert into public.draft_templates (org_id, name, proceeding_kind, body, is_default, provisional, created_by, updated_by)
      values (null, name_value, kind_value, body_value, default_value, provisional_value, caller, caller)
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
    jsonb_build_object('kind', kind_value, 'is_default', default_value, 'provisional', provisional_value));
  return jsonb_build_object('ok', true, 'code', 'saved', 'template_id', saved);
end;
$$;

revoke all on function public.admin_save_platform_template(uuid, jsonb) from public, anon;
grant execute on function public.admin_save_platform_template(uuid, jsonb) to authenticated;

/** The operator removes a model of the platform; the drafts asked from it keep its name and text. */
create or replace function public.admin_remove_platform_template(target_template uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  removed public.draft_templates%rowtype;
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.draft_templates t where t.id = target_template and t.org_id is null returning * into removed;
  if removed.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'platform.template_removed', 'draft_template', removed.id::text,
    jsonb_build_object('name', removed.name, 'kind', removed.proceeding_kind));
  return jsonb_build_object('ok', true, 'code', 'removed');
end;
$$;

revoke all on function public.admin_remove_platform_template(uuid) from public, anon;
grant execute on function public.admin_remove_platform_template(uuid) to authenticated;

-- ---------- What the platform gives every firm ----------

-- Each source quoted as its official page writes it, read on 2026-10-22 (what a page struck out is left out;
-- "(...)" marks what of an article is not quoted).
insert into public.legal_sources (org_id, kind, issuer, number, article, title, quote, source_url, note, status, verified_at)
select null, s.kind, s.issuer, s.number, s.article, s.title, s.quote, s.url, s.note, 'verified',
  timestamptz '2026-10-22 12:00:00-03'
from (values
  ($q$lei$q$, $q$$q$, $q$8078$q$, $q$2$q$,
   $q$Código de Defesa do Consumidor, art. 2º: quem é consumidor$q$,
   $q$Art. 2° Consumidor é toda pessoa física ou jurídica que adquire ou utiliza produto ou serviço como destinatário final.
Parágrafo único. Equipara-se a consumidor a coletividade de pessoas, ainda que indetermináveis, que haja intervindo nas relações de consumo.$q$,
   $q$https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm$q$, null),
  ($q$lei$q$, $q$$q$, $q$8078$q$, $q$3$q$,
   $q$Código de Defesa do Consumidor, art. 3º: quem é fornecedor e o que é serviço$q$,
   $q$Art. 3° Fornecedor é toda pessoa física ou jurídica, pública ou privada, nacional ou estrangeira, bem como os entes despersonalizados, que desenvolvem atividade de produção, montagem, criação, construção, transformação, importação, exportação, distribuição ou comercialização de produtos ou prestação de serviços.
(...)
§ 2° Serviço é qualquer atividade fornecida no mercado de consumo, mediante remuneração, inclusive as de natureza bancária, financeira, de crédito e securitária, salvo as decorrentes das relações de caráter trabalhista.$q$,
   $q$https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm$q$, null),
  ($q$lei$q$, $q$$q$, $q$8078$q$, $q$6$q$,
   $q$Código de Defesa do Consumidor, art. 6º: reparação dos danos e inversão do ônus da prova$q$,
   $q$Art. 6º São direitos básicos do consumidor:
(...)
VI - a efetiva prevenção e reparação de danos patrimoniais e morais, individuais, coletivos e difusos;
(...)
VIII - a facilitação da defesa de seus direitos, inclusive com a inversão do ônus da prova, a seu favor, no processo civil, quando, a critério do juiz, for verossímil a alegação ou quando for ele hipossuficiente, segundo as regras ordinárias de experiências;
(...)$q$,
   $q$https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm$q$, null),
  ($q$lei$q$, $q$$q$, $q$8078$q$, $q$14$q$,
   $q$Código de Defesa do Consumidor, art. 14: o fornecedor de serviços responde independentemente de culpa$q$,
   $q$Art. 14. O fornecedor de serviços responde, independentemente da existência de culpa, pela reparação dos danos causados aos consumidores por defeitos relativos à prestação dos serviços, bem como por informações insuficientes ou inadequadas sobre sua fruição e riscos.
§ 1° O serviço é defeituoso quando não fornece a segurança que o consumidor dele pode esperar, levando-se em consideração as circunstâncias relevantes, entre as quais:
I - o modo de seu fornecimento;
II - o resultado e os riscos que razoavelmente dele se esperam;
III - a época em que foi fornecido.
§ 2º O serviço não é considerado defeituoso pela adoção de novas técnicas.
§ 3° O fornecedor de serviços só não será responsabilizado quando provar:
I - que, tendo prestado o serviço, o defeito inexiste;
II - a culpa exclusiva do consumidor ou de terceiro.
§ 4° A responsabilidade pessoal dos profissionais liberais será apurada mediante a verificação de culpa.$q$,
   $q$https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm$q$, null),
  ($q$lei$q$, $q$$q$, $q$8078$q$, $q$101$q$,
   $q$Código de Defesa do Consumidor, art. 101: a ação pode ser proposta no domicílio do autor$q$,
   $q$Art. 101. Na ação de responsabilidade civil do fornecedor de produtos e serviços, sem prejuízo do disposto nos Capítulos I e II deste título, serão observadas as seguintes normas:
I - a ação pode ser proposta no domicílio do autor;
(...)$q$,
   $q$https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm$q$, null),
  ($q$lei$q$, $q$$q$, $q$10406$q$, $q$186$q$,
   $q$Código Civil, art. 186: ato ilícito, ainda que o dano seja só moral$q$,
   $q$Art. 186. Aquele que, por ação ou omissão voluntária, negligência ou imprudência, violar direito e causar dano a outrem, ainda que exclusivamente moral, comete ato ilícito.$q$,
   $q$https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm$q$, null),
  ($q$lei$q$, $q$$q$, $q$10406$q$, $q$927$q$,
   $q$Código Civil, art. 927: quem causa dano por ato ilícito fica obrigado a repará-lo$q$,
   $q$Art. 927. Aquele que, por ato ilícito (arts. 186 e 187), causar dano a outrem, fica obrigado a repará-lo.
Parágrafo único. Haverá obrigação de reparar o dano, independentemente de culpa, nos casos especificados em lei, ou quando a atividade normalmente desenvolvida pelo autor do dano implicar, por sua natureza, risco para os direitos de outrem.$q$,
   $q$https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm$q$, null),
  ($q$lei$q$, $q$$q$, $q$10406$q$, $q$734$q$,
   $q$Código Civil, art. 734: o transportador responde pelos danos às pessoas transportadas e às bagagens$q$,
   $q$Art. 734. O transportador responde pelos danos causados às pessoas transportadas e suas bagagens, salvo motivo de força maior, sendo nula qualquer cláusula excludente da responsabilidade.
Parágrafo único. É lícito ao transportador exigir a declaração do valor da bagagem a fim de fixar o limite da indenização.$q$,
   $q$https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm$q$, null),
  ($q$lei$q$, $q$$q$, $q$10406$q$, $q$737$q$,
   $q$Código Civil, art. 737: o transportador está sujeito aos horários e itinerários previstos$q$,
   $q$Art. 737. O transportador está sujeito aos horários e itinerários previstos, sob pena de responder por perdas e danos, salvo motivo de força maior.$q$,
   $q$https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm$q$, null),
  ($q$constituicao$q$, $q$$q$, $q$1988$q$, $q$5$q$,
   $q$Constituição Federal, art. 5º, V e X: indenização por dano material e moral$q$,
   $q$Art. 5º Todos são iguais perante a lei, sem distinção de qualquer natureza, garantindo-se aos brasileiros e aos estrangeiros residentes no País a inviolabilidade do direito à vida, à liberdade, à igualdade, à segurança e à propriedade, nos termos seguintes:
(...)
V - é assegurado o direito de resposta, proporcional ao agravo, além da indenização por dano material, moral ou à imagem;
(...)
X - são invioláveis a intimidade, a vida privada, a honra e a imagem das pessoas, assegurado o direito a indenização pelo dano material ou moral decorrente de sua violação;
(...)$q$,
   $q$https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm$q$, null),
  ($q$lei$q$, $q$$q$, $q$9099$q$, $q$3$q$,
   $q$Lei dos Juizados Especiais, art. 3º: causas de até quarenta salários mínimos$q$,
   $q$Art. 3º O Juizado Especial Cível tem competência para conciliação, processo e julgamento das causas cíveis de menor complexidade, assim consideradas:
I - as causas cujo valor não exceda a quarenta vezes o salário mínimo;
(...)$q$,
   $q$https://www.planalto.gov.br/ccivil_03/leis/l9099.htm$q$, null),
  ($q$lei$q$, $q$$q$, $q$9099$q$, $q$4$q$,
   $q$Lei dos Juizados Especiais, art. 4º: foro do domicílio do autor nas ações de reparação de dano$q$,
   $q$Art. 4º É competente, para as causas previstas nesta Lei, o Juizado do foro:
(...)
III - do domicílio do autor ou do local do ato ou fato, nas ações para reparação de dano de qualquer natureza.
(...)$q$,
   $q$https://www.planalto.gov.br/ccivil_03/leis/l9099.htm$q$, null),
  ($q$lei$q$, $q$$q$, $q$9099$q$, $q$8$q$,
   $q$Lei dos Juizados Especiais, art. 8º: o incapaz não pode ser parte no juizado especial$q$,
   $q$Art. 8º Não poderão ser partes, no processo instituído por esta Lei, o incapaz, o preso, as pessoas jurídicas de direito público, as empresas públicas da União, a massa falida e o insolvente civil.
(...)$q$,
   $q$https://www.planalto.gov.br/ccivil_03/leis/l9099.htm$q$, null),
  ($q$lei$q$, $q$$q$, $q$13105$q$, $q$98$q$,
   $q$Código de Processo Civil, art. 98: gratuidade da justiça$q$,
   $q$Art. 98. A pessoa natural ou jurídica, brasileira ou estrangeira, com insuficiência de recursos para pagar as custas, as despesas processuais e os honorários advocatícios tem direito à gratuidade da justiça, na forma da lei.$q$,
   $q$https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm$q$, null),
  ($q$lei$q$, $q$$q$, $q$13105$q$, $q$178$q$,
   $q$Código de Processo Civil, art. 178: o Ministério Público intervém nos processos que envolvam interesse de incapaz$q$,
   $q$Art. 178. O Ministério Público será intimado para, no prazo de 30 (trinta) dias, intervir como fiscal da ordem jurídica nas hipóteses previstas em lei ou na Constituição Federal e nos processos que envolvam:
(...)
II - interesse de incapaz;
(...)$q$,
   $q$https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm$q$, null),
  ($q$decreto$q$, $q$$q$, $q$5910/2006$q$, $q$19$q$,
   $q$Convenção de Montreal (Decreto nº 5.910/2006), art. 19: responsabilidade do transportador pelo atraso$q$,
   $q$O transportador é responsável pelo dano ocasionado por atrasos no transporte aéreo de passageiros, bagagem ou carga. Não obstante, o transportador não será responsável pelo dano ocasionado por atraso se prova que ele e seus prepostos adotaram todas as medidas que eram razoavelmente necessárias para evitar o dano ou que lhes foi impossível, a um e a outros, adotar tais medidas.$q$,
   $q$https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2006/decreto/d5910.htm$q$, null),
  ($q$resolucao$q$, $q$ANAC$q$, $q$400$q$, $q$20$q$,
   $q$Resolução nº 400 da ANAC, art. 20: dever de informar sobre atraso e cancelamento$q$,
   $q$Art. 20. O transportador deverá informar imediatamente ao passageiro pelos meios de comunicação disponíveis:
I - que o voo irá atrasar em relação ao horário originalmente contratado, indicando a nova previsão do horário de partida; e
II - sobre o cancelamento do voo ou interrupção do serviço.
§ 1º O transportador deverá manter o passageiro informado, no máximo, a cada 30 (trinta) minutos quanto à previsão do novo horário de partida do voo nos casos de atraso.
§ 2º A informação sobre o motivo do atraso, do cancelamento, da interrupção do serviço e da preterição deverá ser prestada por escrito pelo transportador, sempre que solicitada pelo passageiro.$q$,
   $q$https://www.anac.gov.br/participacao-social/consultas-publicas/audiencias/2016/aud03/RA20160400Retificada.pdf$q$, $q$Texto conferido no arquivo da ANAC da Resolução como aprovada e retificada em dezembro de 2016. A página do texto compilado da ANAC recusa a leitura automática; alterações posteriores deste artigo não foram conferidas.$q$),
  ($q$resolucao$q$, $q$ANAC$q$, $q$400$q$, $q$21$q$,
   $q$Resolução nº 400 da ANAC, art. 21: reacomodação, reembolso ou outra modalidade de transporte$q$,
   $q$Art. 21. O transportador deverá oferecer as alternativas de reacomodação, reembolso e execução do serviço por outra modalidade de transporte, devendo a escolha ser do passageiro, nos seguintes casos:
I - atraso de voo por mais de quatro horas em relação ao horário originalmente contratado;
II - cancelamento de voo ou interrupção do serviço;
III - preterição de passageiro; e
IV - perda de voo subsequente pelo passageiro, nos voos com conexão, inclusive nos casos de troca de aeroportos, quando a causa da perda for do transportador.
Parágrafo único. As alternativas previstas no caput deste artigo deverão ser imediatamente oferecidas aos passageiros quando o transportador dispuser antecipadamente da informação de que o voo atrasará mais de 4 (quatro) horas em relação ao horário originalmente contratado.$q$,
   $q$https://www.anac.gov.br/participacao-social/consultas-publicas/audiencias/2016/aud03/RA20160400Retificada.pdf$q$, $q$Texto conferido no arquivo da ANAC da Resolução como aprovada e retificada em dezembro de 2016. A página do texto compilado da ANAC recusa a leitura automática; alterações posteriores deste artigo não foram conferidas.$q$),
  ($q$resolucao$q$, $q$ANAC$q$, $q$400$q$, $q$26$q$,
   $q$Resolução nº 400 da ANAC, art. 26: casos de assistência material$q$,
   $q$Art. 26. A assistência material ao passageiro deve ser oferecida nos seguintes casos:
I - atraso do voo;
II - cancelamento do voo;
III - interrupção de serviço; ou
IV - preterição de passageiro.$q$,
   $q$https://www.anac.gov.br/participacao-social/consultas-publicas/audiencias/2016/aud03/RA20160400Retificada.pdf$q$, $q$Texto conferido no arquivo da ANAC da Resolução como aprovada e retificada em dezembro de 2016. A página do texto compilado da ANAC recusa a leitura automática; alterações posteriores deste artigo não foram conferidas.$q$),
  ($q$resolucao$q$, $q$ANAC$q$, $q$400$q$, $q$27$q$,
   $q$Resolução nº 400 da ANAC, art. 27: assistência material conforme o tempo de espera$q$,
   $q$Art. 27. A assistência material consiste em satisfazer as necessidades do passageiro e deverá ser oferecida gratuitamente pelo transportador, conforme o tempo de espera, ainda que os passageiros estejam a bordo da aeronave com portas abertas, nos seguintes termos:
I - superior a 1 (uma) hora: facilidades de comunicação;
II - superior a 2 (duas) horas: alimentação, de acordo com o horário, por meio do fornecimento de refeição ou de voucher individual; e
III - superior a 4 (quatro) horas: serviço de hospedagem, em caso de pernoite, e traslado de ida e volta.
§ 1º O transportador poderá deixar de oferecer serviço de hospedagem para o passageiro que residir na localidade do aeroporto de origem, garantido o traslado de ida e volta.
§ 2º No caso de Passageiro com Necessidade de Assistência Especial - PNAE e de seus acompanhantes, nos termos da Resolução nº 280, de 2013, a assistência prevista no inciso III do caput deste artigo deverá ser fornecida independentemente da exigência de pernoite, salvo se puder ser substituída por acomodação em local que atenda suas necessidades e com concordância do passageiro ou acompanhante.
§ 3º O transportador poderá deixar de oferecer assistência material quando o passageiro optar pela reacomodação em voo próprio do transportador a ser realizado em data e horário de conveniência do passageiro ou pelo reembolso integral da passagem aérea.$q$,
   $q$https://www.anac.gov.br/participacao-social/consultas-publicas/audiencias/2016/aud03/RA20160400Retificada.pdf$q$, $q$Texto conferido no arquivo da ANAC da Resolução como aprovada e retificada em dezembro de 2016. A página do texto compilado da ANAC recusa a leitura automática; alterações posteriores deste artigo não foram conferidas.$q$),
  ($q$tema$q$, $q$STF$q$, $q$210$q$, null,
   $q$Tema 210 do STF: prevalência das Convenções de Varsóvia e Montreal sobre o Código de Defesa do Consumidor na responsabilidade do transportador aéreo internacional$q$,
   $q$Nos termos do art. 178 da Constituição da República, as normas e os tratados internacionais limitadores da responsabilidade das transportadoras aéreas de passageiros, especialmente as Convenções de Varsóvia e Montreal, têm prevalência em relação ao Código de Defesa do Consumidor.$q$,
   $q$https://www.stf.jus.br/arquivo/informativo/documento/informativo866.htm$q$, $q$Tese do RE 636.331 (Tema 210), no Informativo 866 do STF; a página do tema registra o trânsito em julgado em 13/12/2022. O Tema 1.240 restringiu a prevalência aos danos materiais.$q$),
  ($q$tema$q$, $q$STF$q$, $q$1240$q$, null,
   $q$Tema 1.240 do STF: as Convenções de Varsóvia e Montreal não se aplicam aos danos extrapatrimoniais do transporte aéreo internacional$q$,
   $q$Não se aplicam as Convenções de Varsóvia e Montreal às hipóteses de danos extrapatrimoniais decorrentes de contrato de transporte aéreo internacional.$q$,
   $q$https://portal.stf.jus.br/jurisprudenciaRepercussao/verAndamentoProcesso.asp?incidente=6450365&numeroProcesso=1394401&classeProcesso=RE&numeroTema=1240$q$, $q$Tese do RE 1.394.401 (Tema 1.240), na página do tema no portal do STF.$q$)
) as s(kind, issuer, number, article, title, quote, url, note)
on conflict do nothing;

-- The two models, provisional until the curator reviews them: they cite only the sources above, as the
-- library writes them, and leave each fact of a case to the AI or to a lawyer ([COMPLETAR: ...]).
insert into public.draft_templates (org_id, name, proceeding_kind, body, is_default, provisional)
values
  (null, 'Inicial do juizado especial: problema no voo (modelo do ONE)', 'juizado', $model$EXCELENTÍSSIMO(A) SENHOR(A) JUIZ(A) DE DIREITO DO [[JUIZO]]

[[PARTES]], por seus advogados abaixo assinados, vêm, respeitosamente, à presença de Vossa Excelência propor

AÇÃO DE INDENIZAÇÃO POR DANOS MATERIAIS E MORAIS

em face de [[RE]], pelos fatos e fundamentos a seguir expostos.

I. DOS FATOS

[COMPLETAR: narrar, na ordem em que aconteceram, a compra da passagem, o voo contratado com número, data, origem, destino e horários previstos, o problema ocorrido, o tempo total de espera e o horário em que a parte autora chegou ao destino, as informações e a assistência que a companhia deu ou deixou de dar, os gastos que a parte autora teve e os compromissos que perdeu.]

II. DO DIREITO

DA RELAÇÃO DE CONSUMO

A parte autora é consumidora, nos termos do art. 2º da Lei nº 8.078, e a ré é fornecedora de serviço de transporte aéreo, nos termos do art. 3º da Lei nº 8.078. A relação entre as partes é, portanto, de consumo.

DA RESPONSABILIDADE DA COMPANHIA AÉREA

A ré responde, independentemente da existência de culpa, pela reparação dos danos causados por defeito na prestação do serviço, como estabelece o art. 14 da Lei nº 8.078. O transportador está sujeito aos horários e itinerários previstos, sob pena de responder por perdas e danos, conforme o art. 737 da Lei nº 10.406, e responde pelos danos causados às pessoas transportadas e às suas bagagens, nos termos do art. 734 da Lei nº 10.406.

DO DEVER DE INFORMAR, DE REACOMODAR E DE PRESTAR ASSISTÊNCIA

O transportador deve informar imediatamente o passageiro sobre o atraso, o cancelamento ou a interrupção do serviço, conforme o art. 20 da Resolução nº 400 da ANAC. Nos casos de atraso superior a quatro horas, cancelamento, interrupção do serviço, preterição e perda de conexão por causa do transportador, deve oferecer reacomodação, reembolso ou execução do serviço por outra modalidade de transporte, à escolha do passageiro, nos termos do art. 21 da Resolução nº 400 da ANAC. Deve, ainda, prestar assistência material gratuita conforme o tempo de espera, como determinam o art. 26 da Resolução nº 400 da ANAC e o art. 27 da Resolução nº 400 da ANAC.

[COMPLETAR: apontar, com base nos fatos, quais desses deveres a ré deixou de cumprir.]

DO TRANSPORTE AÉREO INTERNACIONAL

No transporte aéreo internacional, o transportador é responsável pelo dano ocasionado por atraso, nos termos do art. 19 do Decreto nº 5.910/2006. As convenções internacionais prevalecem sobre a Lei nº 8.078 quanto aos danos materiais (Tema 210 do STF), mas não se aplicam aos danos extrapatrimoniais decorrentes do contrato de transporte aéreo internacional (Tema 1.240 do STF), cuja reparação segue a legislação de proteção ao consumidor.

DOS DANOS MATERIAIS

[COMPLETAR: listar os gastos de cada parte autora causados pelo problema no voo, com o documento que comprova cada um.] A efetiva reparação dos danos patrimoniais é direito básico do consumidor, nos termos do art. 6º, VI, da Lei nº 8.078, e quem causa dano a outrem fica obrigado a repará-lo, conforme o art. 186 da Lei nº 10.406 e o art. 927 da Lei nº 10.406.

DOS DANOS MORAIS

A indenização por dano moral é assegurada pelo art. 5º, V e X, da Constituição Federal, e a efetiva reparação dos danos morais do consumidor é direito básico previsto no art. 6º, VI, da Lei nº 8.078. [COMPLETAR: descrever, com os fatos do caso, o que cada parte autora passou: o tempo de espera, a falta de informação ou de assistência, os compromissos perdidos e as demais consequências concretas.]

DA INVERSÃO DO ÔNUS DA PROVA

A ré detém os registros do voo, das comunicações com os passageiros e da assistência prestada, o que torna a parte autora hipossuficiente na produção dessa prova. Requer-se, por isso, a inversão do ônus da prova, nos termos do art. 6º, VIII, da Lei nº 8.078.

DA COMPETÊNCIA

A ação é proposta no foro do domicílio da parte autora, como permitem o art. 4º, III, da Lei nº 9.099 e o art. 101, I, da Lei nº 8.078. O valor pedido por cada parte autora está dentro do limite do art. 3º, I, da Lei nº 9.099.

III. DOS PEDIDOS

Diante do exposto, a parte autora requer:

a) a citação da ré para comparecer à audiência de conciliação e, querendo, apresentar resposta, sob pena de revelia;

b) a inversão do ônus da prova, nos termos do art. 6º, VIII, da Lei nº 8.078;

c) a condenação da ré ao pagamento, a cada parte autora, das indenizações por danos materiais e morais conforme o pedido de cada uma: [[PEDIDO_POR_PARTE]];

d) a produção de todas as provas admitidas em direito, em especial a documental que acompanha esta inicial.

Dá-se à causa o valor de [[VALOR_DA_CAUSA]].

Termos em que pede deferimento.

[[ADVOGADOS]]$model$, true, true),
  (null, 'Inicial da vara cível: família com criança ou valor acima do juizado (modelo do ONE)', 'comum',
   $model$EXCELENTÍSSIMO(A) SENHOR(A) JUIZ(A) DE DIREITO DA [[JUIZO]]

[[PARTES]], por seus advogados abaixo assinados, vêm, respeitosamente, à presença de Vossa Excelência propor

AÇÃO DE INDENIZAÇÃO POR DANOS MATERIAIS E MORAIS, PELO PROCEDIMENTO COMUM

em face de [[RE]], pelos fatos e fundamentos a seguir expostos.

I. DA GRATUIDADE DA JUSTIÇA

A parte autora não tem condições de arcar com as custas e as despesas do processo sem prejuízo do próprio sustento e requer a gratuidade da justiça, nos termos do art. 98 da Lei nº 13.105. [COMPLETAR: confirmar quais partes autoras pedem a gratuidade e juntar a declaração de cada uma.]

II. DOS FATOS

[COMPLETAR: narrar, na ordem em que aconteceram, a compra da passagem, o voo contratado com número, data, origem, destino e horários previstos, quem viajou, o problema ocorrido, o tempo total de espera e o horário em que a família chegou ao destino, as informações e a assistência que a companhia deu ou deixou de dar, os gastos que a família teve e os compromissos que perdeu.]

III. DO DIREITO

DO PROCEDIMENTO COMUM

A ação segue o procedimento comum perante este juízo porque [COMPLETAR: há parte autora menor de idade, e o incapaz não pode ser parte no juizado especial, nos termos do art. 8º da Lei nº 9.099; ou o valor pedido supera o limite do juizado especial]. A parte autora menor de idade está representada ou assistida por quem responde por ela, conforme a qualificação acima.

DA RELAÇÃO DE CONSUMO

A parte autora é consumidora, nos termos do art. 2º da Lei nº 8.078, e a ré é fornecedora de serviço de transporte aéreo, nos termos do art. 3º da Lei nº 8.078. A relação entre as partes é, portanto, de consumo.

DA RESPONSABILIDADE DA COMPANHIA AÉREA

A ré responde, independentemente da existência de culpa, pela reparação dos danos causados por defeito na prestação do serviço, como estabelece o art. 14 da Lei nº 8.078. O transportador está sujeito aos horários e itinerários previstos, sob pena de responder por perdas e danos, conforme o art. 737 da Lei nº 10.406, e responde pelos danos causados às pessoas transportadas e às suas bagagens, nos termos do art. 734 da Lei nº 10.406.

DO DEVER DE INFORMAR, DE REACOMODAR E DE PRESTAR ASSISTÊNCIA

O transportador deve informar imediatamente o passageiro sobre o atraso, o cancelamento ou a interrupção do serviço, conforme o art. 20 da Resolução nº 400 da ANAC. Nos casos de atraso superior a quatro horas, cancelamento, interrupção do serviço, preterição e perda de conexão por causa do transportador, deve oferecer reacomodação, reembolso ou execução do serviço por outra modalidade de transporte, à escolha do passageiro, nos termos do art. 21 da Resolução nº 400 da ANAC. Deve, ainda, prestar assistência material gratuita conforme o tempo de espera, como determinam o art. 26 da Resolução nº 400 da ANAC e o art. 27 da Resolução nº 400 da ANAC.

[COMPLETAR: apontar, com base nos fatos, quais desses deveres a ré deixou de cumprir, inclusive diante das necessidades das crianças da família.]

DO TRANSPORTE AÉREO INTERNACIONAL

No transporte aéreo internacional, o transportador é responsável pelo dano ocasionado por atraso, nos termos do art. 19 do Decreto nº 5.910/2006. As convenções internacionais prevalecem sobre a Lei nº 8.078 quanto aos danos materiais (Tema 210 do STF), mas não se aplicam aos danos extrapatrimoniais decorrentes do contrato de transporte aéreo internacional (Tema 1.240 do STF), cuja reparação segue a legislação de proteção ao consumidor.

DOS DANOS MATERIAIS

[COMPLETAR: listar os gastos de cada parte autora causados pelo problema no voo, com o documento que comprova cada um.] A efetiva reparação dos danos patrimoniais é direito básico do consumidor, nos termos do art. 6º, VI, da Lei nº 8.078, e quem causa dano a outrem fica obrigado a repará-lo, conforme o art. 186 da Lei nº 10.406 e o art. 927 da Lei nº 10.406.

DOS DANOS MORAIS

A indenização por dano moral é assegurada pelo art. 5º, V e X, da Constituição Federal, e a efetiva reparação dos danos morais do consumidor é direito básico previsto no art. 6º, VI, da Lei nº 8.078. [COMPLETAR: descrever, com os fatos do caso, o que cada parte autora passou, a criança inclusive: o tempo de espera, a falta de informação ou de assistência, os compromissos perdidos e as demais consequências concretas.]

DA INVERSÃO DO ÔNUS DA PROVA

A ré detém os registros do voo, das comunicações com os passageiros e da assistência prestada, o que torna a parte autora hipossuficiente na produção dessa prova. Requer-se, por isso, a inversão do ônus da prova, nos termos do art. 6º, VIII, da Lei nº 8.078.

DA COMPETÊNCIA

A ação é proposta no foro do domicílio da parte autora, como permite o art. 101, I, da Lei nº 8.078.

DA INTERVENÇÃO DO MINISTÉRIO PÚBLICO

Havendo parte autora menor de idade, requer-se a intimação do Ministério Público para intervir como fiscal da ordem jurídica, nos termos do art. 178, II, da Lei nº 13.105.

IV. DOS PEDIDOS

Diante do exposto, a parte autora requer:

a) a concessão da gratuidade da justiça a cada parte autora que a pediu, nos termos do art. 98 da Lei nº 13.105;

b) a citação da ré para comparecer à audiência de conciliação ou de mediação e, querendo, apresentar contestação;

c) a intimação do Ministério Público, havendo parte autora menor de idade;

d) a inversão do ônus da prova, nos termos do art. 6º, VIII, da Lei nº 8.078;

e) a condenação da ré ao pagamento, a cada parte autora, das indenizações por danos materiais e morais conforme o pedido de cada uma: [[PEDIDO_POR_PARTE]];

f) a produção de todas as provas admitidas em direito, em especial a documental que acompanha esta inicial.

Dá-se à causa o valor de [[VALOR_DA_CAUSA]].

Termos em que pede deferimento.

[[ADVOGADOS]]$model$, true, true)
on conflict do nothing;
