-- ============================================================
-- 0289_the_past_asks_nothing: the history of a lawsuit sets ONE to no work about what had passed.
--
-- The owner's test of 2026-11-24: once the receipt of the test case was attached (a lawsuit filed in 2025, judged in
-- April 2026), ONE read its history from the DJEN (0286) and its deadlines and hearings came in settled, as promised;
-- but ONE also read what each old publication asked (0186) and, where the firm lets it start pieces, asked for them by
-- itself (0189): a manifestation for a term of 15 days opened in March 2026, written five minutes later. Across the
-- portfolio ONE opened from the DJEN the same evening (0287), the history of 17 lawsuits brought 88 old publications,
-- 52 readings of what they asked (the firm told to decide, the client to answer) and 9 pieces started by ONE.
--
-- 1. A publication of the history owes the reading of what it asks only when the court published it within the
--    reading's days (`publication_actions.days`, 30): measured by the day it was published, where one the DJEN made
--    available to the firm is measured, as before, by the day it was captured. An older one is the lawsuit's past:
--    triaged, its deadlines and hearings read and settled (0286), its judgment read, and nothing asked of anybody.
-- 2. A piece ONE starts by itself from a publication of the history (`intermediate_pieces_owed`) is owed only while
--    a deadline of that publication is still to come; its day gone, there is nothing to answer.
-- 3. What the history already set ONE to do before this migration: the pieces ONE started by itself from such a
--    publication, not approved yet, are given up with why on the case's trail, as `cancel_case_draft` does; and the
--    readings of what an older one asked are taken away (each run stays in `ai_runs`).
-- ============================================================

-- ---------- 1. The reading of what a publication asks ----------

/**
 * A publication triaged, of a case, active and whole, owes what it asks (0186) when it is recent: one the DJEN made
 * available to the firm, captured in the setting's days; one of the lawsuit's history (0286), published in them.
 */
create or replace function public.publications_owe_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  days integer := greatest(coalesce(
    (select (s.value ->> 'days')::integer from public.platform_settings s where s.key = 'publication_actions'), 30), 1);
begin
  if new.category is not null and new.case_id is not null and new.active and not new.truncated
     and (case when new.from_history
               then new.available_on > (now() at time zone 'America/Sao_Paulo')::date - days
               else new.captured_at > now() - make_interval(days => days) end) then
    insert into public.publication_actions (org_id, publication_id, case_id)
    values (new.org_id, new.id, new.case_id)
    on conflict (publication_id) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.publications_owe_action() from public, anon, authenticated;

-- ---------- 2. The pieces ONE starts by itself ----------

/**
 * What ONE asks for by itself (service role), as 0189 lists it: the pieces owed in firms that let ONE start pieces
 * (`start_piece`), of a lawsuit the court has, of a case going: what a publication asks (its action read in the
 * setting's days), and what a condemnation's next step is. An appeal or embargos only once a lawyer decided that path
 * (0185). A publication of the lawsuit's history (0286) asks a piece only while one of its deadlines is still to come.
 */
create or replace function public.intermediate_pieces_owed(target_limit integer default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  days integer := greatest(coalesce((
    select (s.value ->> 'pieces_days')::integer from public.platform_settings s where s.key = 'filing_submit'), 30), 1);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(owed) from (
      select jsonb_build_object('proceeding_id', p.id, 'case_id', c.id, 'kind', k.slug, 'publication_id', pa.publication_id,
                                'source', 'publication:' || pa.publication_id::text) as owed
      from public.publication_actions pa
      join public.publications pu on pu.id = pa.publication_id and pu.active
      join public.proceedings p on p.id = pu.proceeding_id and p.status = 'filed' and p.cnj is not null
      join public.cases c on c.id = p.case_id and c.status not in ('closed', 'declined')
      join public.piece_kinds k on pa.action = any (k.from_actions)
      where pa.status = 'done' and pa.done_at > now() - make_interval(days => days)
        and public.firm_autonomy_mode(c.org_id, 'start_piece') = 'auto'
        and (not pu.from_history or exists (
          select 1 from public.deadlines dl
          where dl.publication_id = pu.id and dl.status in ('proposed', 'confirmed')
            and coalesce(dl.due_on, dl.computed_due_on) >= (now() at time zone 'America/Sao_Paulo')::date))
        and (k.slug not in ('recurso', 'embargos') or exists (
          select 1 from public.judgment_paths jp
          where jp.proceeding_id = p.id
            and jp.decision = case k.slug when 'embargos' then 'embargos_declaracao'
                                          else (case p.kind when 'comum' then 'apelacao' else 'recurso_inominado' end) end))
        and not exists (select 1 from public.case_drafts d
                        where d.proceeding_id = p.id and d.piece_kind = k.slug
                          and d.source_key = 'publication:' || pa.publication_id::text)
      union all
      select jsonb_build_object('proceeding_id', p.id, 'case_id', c.id, 'kind', k.slug, 'publication_id', null,
                                'source', 'amount:' || a.next_step)
      from public.lawsuit_amounts a
      join public.proceedings p on p.id = a.proceeding_id and p.status = 'filed' and p.cnj is not null
      join public.cases c on c.id = p.case_id and c.status not in ('closed', 'declined')
      join public.piece_kinds k on k.from_amount_step = a.next_step
      where public.firm_autonomy_mode(c.org_id, 'start_piece') = 'auto'
        and not exists (select 1 from public.case_drafts d
                        where d.proceeding_id = p.id and d.piece_kind = k.slug and d.source_key = 'amount:' || a.next_step)
      limit greatest(least(coalesce(target_limit, 20), 50), 1)
    ) rows
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.intermediate_pieces_owed(integer) from public, anon, authenticated;
grant execute on function public.intermediate_pieces_owed(integer) to service_role;

-- ---------- 3. What the history already set ONE to do ----------

do $$
declare
  days integer := greatest(coalesce(
    (select (s.value ->> 'days')::integer from public.platform_settings s where s.key = 'publication_actions'), 30), 1);
  piece record;
begin
  -- ONE's pieces from a publication of the history with no deadline still to come, not approved yet: given up.
  for piece in
    select d.id, d.org_id, d.case_id
    from public.case_drafts d
    join public.publications p on d.source_key = 'publication:' || p.id::text
    where p.from_history and d.requested_auto and d.status in ('generating', 'proposed', 'failed', 'rejected')
      and not exists (
        select 1 from public.deadlines dl
        where dl.publication_id = p.id and dl.status in ('proposed', 'confirmed')
          and coalesce(dl.due_on, dl.computed_due_on) >= (now() at time zone 'America/Sao_Paulo')::date)
    order by d.requested_at
    for update of d
  loop
    perform public.withdraw_draft_approvals(piece.id,
      'O ONE pediu esta peça por uma publicação do histórico do processo, cujo prazo já tinha passado quando o caso entrou no ONE.');
    update public.case_drafts
    set status = 'cancelled', work = null, work_claimed_at = null, waits_for = null, auto_approval_owed = false
    where id = piece.id;
    perform public.record_case_event(piece.org_id, piece.case_id, 'draft_cancelled', 'system',
      jsonb_build_object('draft', piece.id, 'reason', 'history'));
  end loop;

  -- The readings of what an older publication of the history asked: taken away, as rule 1 would never have owed them.
  delete from public.publication_actions a
  using public.publications p
  where p.id = a.publication_id and p.from_history
    and p.available_on <= (now() at time zone 'America/Sao_Paulo')::date - days;
end;
$$;
