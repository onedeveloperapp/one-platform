-- ============================================================
-- 0141_judgment_deadlines: a judgment proposes the terms the law gives it.
--
-- Until now ONE read a term only from a publication triaged as a deadline
-- (0040), so the term to appeal a judgment waited for a person to press
-- "Calcular prazo". A judgment is a decision said to be the lawsuit's
-- judgment (`publications.judgment`, 0096 and 0107), whoever said it, and the
-- law gives its terms: ONE proposes them where the firm lets ONE propose the
-- deadlines of its publications (`publication_deadline`, 0040), and the
-- backend counts and confirms them as any deadline ONE proposes (0034,
-- `deadline_confirm`).
--
--   * embargos de declaração (CPC, art. 1.023; Lei nº 9.099/1995, art. 49),
--     of every judgment;
--   * the appeal of the lawsuit's kind: recurso inominado in the small-claims
--     court (Lei nº 9.099/1995, art. 42), apelação in the civil court (CPC,
--     art. 1.003, § 5º); none of an acórdão, and none of a publication of no
--     lawsuit of the firm, whose kind is not known.
--
-- The days and the way they count are the act's own (`deadline_acts`). Each
-- act once per publication, whoever wrote it first: a person who already
-- proposed the appeal keeps theirs. A publication that stops being the
-- judgment (a person's word, or a triage changed to another word, 0096) takes
-- back what ONE proposed of it and nobody of the firm confirmed. A judgment
-- that only now has its lawsuit (the lawsuit's number came later) is given
-- the appeal then. The judgments of the last 14 days are given their terms
-- now; an older one is a person's, as before.
-- ============================================================

-- The acts a judgment's terms are, as ONE proposes and takes them back.
create or replace function public.judgment_deadline_acts()
returns text[]
language sql
immutable
as $$
  select array['embargos_declaracao', 'recurso_inominado', 'apelacao']::text[];
$$;

revoke all on function public.judgment_deadline_acts() from public, anon, authenticated;

/**
 * ONE proposes the terms of a judgment: embargos de declaração, and the
 * appeal of its lawsuit's kind (none of an acórdão, nor of a publication of
 * no lawsuit of the firm). Only of a publication in force said to be the
 * judgment, in a firm that lets ONE propose the deadlines of its publications
 * (`publication_deadline`). Each act once per publication, whoever wrote it;
 * the firm's ceiling of open deadlines per publication holds. Written as
 * ONE's (`proposed_auto`, nobody's `created_by`), on the record and in the
 * case's timeline; the backend counts it as any other. Answers how many it
 * proposed. Internal: called by the trigger below and by this migration.
 */
create or replace function public.one_propose_judgment_deadlines(target_publication uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  publication public.publications%rowtype;
  lawsuit_kind text;
  wanted text[] := array['embargos_declaracao'];
  act_row public.deadline_acts%rowtype;
  open_count integer;
  new_id uuid;
  made integer := 0;
begin
  select * into publication from public.publications where id = target_publication;
  if not found or not publication.active or publication.judgment is not true
     or publication.category is distinct from 'decisao' then
    return 0;
  end if;
  if public.firm_autonomy_mode(publication.org_id, 'publication_deadline') is distinct from 'auto' then
    return 0;
  end if;
  if publication.proceeding_id is not null then
    select p.kind into lawsuit_kind from public.proceedings p
    where p.id = publication.proceeding_id and p.org_id = publication.org_id;
  end if;
  -- An acórdão is the appeal's own judgment: its terms are no recurso inominado nor apelação.
  if lower(coalesce(publication.document_type, '')) !~ 'ac[oó]rd[aã]o' then
    wanted := wanted || case lawsuit_kind
      when 'juizado' then array['recurso_inominado']
      when 'comum' then array['apelacao']
      else array[]::text[]
    end;
  end if;

  for act_row in
    select * from public.deadline_acts a where a.slug = any (wanted) and a.active order by a.position
  loop
    continue when exists (
      select 1 from public.deadlines d where d.publication_id = publication.id and d.act = act_row.slug
    );
    continue when public.deadline_input_refusal(public.deadline_text(act_row.name), act_row.slug, 'publication',
      publication.available_on, act_row.days, act_row.counting) is not null;
    select count(*) into open_count from public.deadlines d
    where d.org_id = publication.org_id and d.publication_id = publication.id and d.status in ('proposed', 'confirmed');
    exit when open_count >= greatest(public.deadlines_setting('max_open', 20), 1);

    insert into public.deadlines (
      org_id, cnj, court, case_id, proceeding_id, publication_id, title, act, trigger, trigger_on, days, counting,
      created_by, proposed_auto
    ) values (
      publication.org_id, publication.cnj, publication.court, publication.case_id, publication.proceeding_id,
      publication.id, public.deadline_text(act_row.name), act_row.slug, 'publication', publication.available_on,
      act_row.days, act_row.counting, null, true
    )
    returning id into new_id;

    insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
    values (publication.org_id, null, 'system', 'deadline.proposed', 'deadline', new_id::text, jsonb_strip_nulls(jsonb_build_object(
      'publication', publication.id, 'proceeding', publication.proceeding_id, 'act', act_row.slug, 'days', act_row.days,
      'counting', act_row.counting, 'trigger', 'publication', 'auto', true, 'from', 'judgment'
    )));
    if publication.case_id is not null then
      perform public.record_case_event(publication.org_id, publication.case_id, 'deadline_proposed', 'system',
        jsonb_build_object('deadline', new_id));
    end if;
    made := made + 1;
  end loop;
  return made;
end;
$$;

revoke all on function public.one_propose_judgment_deadlines(uuid) from public, anon, authenticated;

/**
 * A publication that stops being the judgment takes back the terms ONE
 * proposed of it and nobody of the firm confirmed: still proposed, or
 * confirmed by ONE itself. One a person confirmed, or wrote, stays theirs.
 * On the record and in the case's timeline as ONE's. Answers how many.
 */
create or replace function public.one_withdraw_judgment_deadlines(target_publication uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  taken record;
  made integer := 0;
begin
  for taken in
    select d.id, d.org_id, d.case_id, d.status, d.due_on from public.deadlines d
    where d.publication_id = target_publication
      and d.act = any (public.judgment_deadline_acts())
      and d.proposed_auto and d.created_by is null
      and (d.status = 'proposed' or (d.status = 'confirmed' and d.confirmed_auto))
    for update
  loop
    update public.deadlines
    set status = 'dismissed', dismiss_reason = 'A publicação não é a sentença.', dismissed_by = null, dismissed_at = now()
    where id = taken.id;
    insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
    values (taken.org_id, null, 'system', 'deadline.dismissed', 'deadline', taken.id::text, jsonb_strip_nulls(jsonb_build_object(
      'was', taken.status, 'due_on', taken.due_on, 'auto', true, 'reason', 'not_judgment'
    )));
    if taken.case_id is not null then
      perform public.record_case_event(taken.org_id, taken.case_id, 'deadline_dismissed', 'system',
        jsonb_build_object('deadline', taken.id));
    end if;
    made := made + 1;
  end loop;
  return made;
end;
$$;

revoke all on function public.one_withdraw_judgment_deadlines(uuid) from public, anon, authenticated;

/**
 * What a publication's word on the judgment brings: its terms when it becomes
 * the judgment, or when a judgment comes to have its lawsuit (the appeal is
 * of the lawsuit's kind); what ONE proposed of it taken back when it stops
 * being one.
 */
create or replace function public.publications_judgment_deadlines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.judgment is true then
    perform public.one_propose_judgment_deadlines(new.id);
  elsif old.judgment is true then
    perform public.one_withdraw_judgment_deadlines(new.id);
  end if;
  return null;
end;
$$;

revoke all on function public.publications_judgment_deadlines() from public, anon, authenticated;

create trigger publications_judgment_deadlines after update on public.publications
  for each row
  -- A lawsuit let go (its number corrected, or the lawsuit removed with its case or its firm) gives nothing.
  when (old.judgment is distinct from new.judgment
        or (new.judgment is true and new.proceeding_id is not null
            and old.proceeding_id is distinct from new.proceeding_id))
  execute function public.publications_judgment_deadlines();

-- The judgments of the last 14 days are given their terms now: their appeal may still be running. An older one is a
-- person's, as before.
do $$
declare
  found_publication uuid;
begin
  for found_publication in
    select p.id from public.publications p
    where p.judgment is true and p.active and p.category = 'decisao'
      and p.available_on >= (now() at time zone 'America/Sao_Paulo')::date - 14
    order by p.available_on, p.id
  loop
    perform public.one_propose_judgment_deadlines(found_publication);
  end loop;
end;
$$;
