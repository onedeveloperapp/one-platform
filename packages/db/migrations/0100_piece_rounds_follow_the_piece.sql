-- ============================================================
-- 0100_piece_rounds_follow_the_piece: ONE asks what a piece lacks only of a
-- piece written after the client's latest answers (2026-11-05).
--
-- In the owner's case the client answered the three questions of 0099 and,
-- thirty seconds later, a second round of seven opened: the piece it read
-- was the one written before those answers (about to be written again with
-- them), and, saying nothing of what it lacked, it fell back to every
-- question of the problem, so the client was asked again whether they were
-- at the airport (they had said they never went) and about a bag in a
-- cancellation. Now:
--
--   - which pieces ONE carries is one reading (`case_pieces_one_writes`:
--     the AI's text, still with a [COMPLETAR], untouched by a lawyer, of a
--     lawsuit still planned, as the firm lets ONE start pieces), read by the
--     rewriting (`case_pieces_to_redo`), by the questions
--     (`piece_interview_scope`) and by the case screen
--     (`case_drafts_one_redo`);
--   - no question is asked of a piece older than the client's latest answer:
--     ONE writes it again first, and asks only what the new one lacks;
--   - a piece written before 0099, which says nothing of what it lacks, is
--     asked only what the account itself said was missing, never every
--     question;
--   - the case screen says, of each piece, whether ONE asks the client what
--     it lacks or writes it again (`case_drafts_one_redo`), so the firm is
--     not asked to review a text ONE is about to replace;
--   - a round opened of such a piece is ended, said in the timeline
--     (`interview_withdrawn`), and the piece is written again.
-- ============================================================

/**
 * The pieces ONE carries in a case: the AI's text, still with a
 * [COMPLETAR], that no lawyer edited, sent back or had rewritten, of a
 * lawsuit still planned, in a case that did not end, as the firm lets ONE
 * start pieces; with when their latest version was written and what its run
 * answered. Internal.
 */
create or replace function public.case_pieces_one_writes(target_case uuid)
returns table (draft_id uuid, proceeding_id uuid, template_id uuid, kind text, written_at timestamptz, output jsonb,
               requested_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.proceeding_id, d.template_id, p.kind, v.created_at, r.output, d.requested_at
  from public.cases k
  join public.case_drafts d on d.case_id = k.id
  join public.proceedings p on p.id = d.proceeding_id and p.status = 'planned'
  join public.case_draft_versions v on v.draft_id = d.id and v.version = d.version
  left join public.ai_runs r on r.id = v.run_id
  where k.id = target_case
    and k.status not in ('filed', 'closed', 'declined')
    and d.status = 'proposed' and d.work is null and d.mode = 'ai'
    and d.revision_note is null and d.revisions = 0
    and strpos(v.body, '[COMPLETAR') > 0
    and not exists (
      select 1 from public.case_draft_versions w
      where w.draft_id = d.id and (w.author = 'person' or w.note is not null)
    )
    and public.firm_autonomy_mode(k.org_id, 'start_piece') = 'auto';
$$;

revoke all on function public.case_pieces_one_writes(uuid) from public, anon, authenticated;

/**
 * The pieces ONE writes again in a case (replaces the one of 0099): the ones
 * it carries whose latest version is older than the account's last change,
 * never while the client is being asked. Internal.
 */
create or replace function public.case_pieces_to_redo(target_case uuid)
returns table (draft_id uuid, proceeding_id uuid, template_id uuid, kind text)
language sql
stable
security definer
set search_path = public
as $$
  select w.draft_id, w.proceeding_id, w.template_id, w.kind
  from public.case_pieces_one_writes(target_case) w
  where not exists (select 1 from public.case_interviews i where i.case_id = target_case and i.status = 'open')
    and w.written_at < public.case_account_changed_at(target_case)
    and public.case_account_state(target_case) in ('ready', 'incomplete')
  order by w.requested_at, w.draft_id;
$$;

revoke all on function public.case_pieces_to_redo(uuid) from public, anon, authenticated;

/**
 * What ONE asks the client for a piece of the case (replaces the one of
 * 0099): only of pieces written after the client's latest answer (one older
 * is written again first), what each said it leaves to complete; a piece
 * written before 0099 says nothing, and only what the account said was
 * missing stands for it. Only questions of the case's problem never
 * answered, in the order they are asked; empty when ONE asks nothing.
 * Internal.
 */
create or replace function public.piece_interview_scope(target_case uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  status_now text;
  applicable text[];
  changed timestamptz;
  wanted text[] := '{}';
  piece record;
  topics text[];
begin
  select * into current_case from public.cases where id = target_case;
  if not found or current_case.status in ('filed', 'closed', 'declined') then
    return '{}';
  end if;
  applicable := public.interview_questions_of(current_case.incident);
  if cardinality(applicable) = 0 or public.case_interview_person(current_case.id) is null then
    return '{}';
  end if;
  select i.status into status_now from public.case_interviews i where i.case_id = current_case.id;
  if status_now is not null and status_now <> 'done' then
    return '{}';
  end if;
  changed := public.case_account_changed_at(current_case.id);
  -- A piece older than what the client last said is written again first: what it lacks may be answered already.
  if changed is not null
     and exists (select 1 from public.case_pieces_one_writes(current_case.id) w where w.written_at < changed) then
    return '{}';
  end if;
  for piece in select w.output from public.case_pieces_one_writes(current_case.id) w loop
    if jsonb_typeof(piece.output -> 'pendencias') = 'array' then
      wanted := wanted || array(select jsonb_array_elements_text(piece.output -> 'pendencias'));
    else
      select coalesce(array_agg(distinct t.topic), '{}') into topics
      from public.case_statements s cross join lateral unnest(s.missing_topics) as t(topic)
      where s.case_id = current_case.id;
      wanted := wanted || array(
        select m.question from unnest(topics) as t(topic)
        join (values ('aviso', 'aviso_local'), ('aviso', 'aviso_quando'), ('aviso', 'motivo'), ('solucao', 'solucao'),
                     ('chegada', 'chegada'), ('assistencia', 'assistencia'), ('gastos', 'gastos'),
                     ('consequencias', 'consequencias')) as m(topic, question) on m.topic = t.topic);
    end if;
  end loop;
  return array(
    select q.question from unnest(applicable) with ordinality as q(question, n)
    where q.question = any (wanted)
      and not exists (
        select 1 from public.case_interview_answers a where a.case_id = current_case.id and a.question = q.question)
    order by q.n
  );
end;
$$;

revoke all on function public.piece_interview_scope(uuid) from public, anon, authenticated;

/**
 * What ONE is doing with each piece it carries in a case, for the case
 * screen: `asking` while the client is asked what it lacks, `rewriting`
 * once ONE owes it a new text with the client's answers. A piece absent
 * from the answer waits for a lawyer as before. Anybody of the firm.
 */
create or replace function public.case_drafts_one_redo(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  asking boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  asking := exists (select 1 from public.case_interviews i where i.case_id = current_case.id and i.status = 'open');
  return coalesce((
    select jsonb_object_agg(w.draft_id::text, case when asking then 'asking' else 'rewriting' end)
    from public.case_pieces_one_writes(current_case.id) w
    where asking
       or exists (select 1 from public.case_pieces_to_redo(current_case.id) r where r.draft_id = w.draft_id)
  ), '{}'::jsonb);
end;
$$;

revoke all on function public.case_drafts_one_redo(uuid) from public, anon;
grant execute on function public.case_drafts_one_redo(uuid) to authenticated;

-- ---------- The rounds already opened of a piece older than the client's answers ----------

-- A round whose case's piece is older than an answer to a question outside the round was opened of a piece ONE
-- owed a rewriting: it ends, said as such, and the piece is written again (the case is woken by the end of it).
do $$
declare
  interview record;
begin
  for interview in
    select i.id, i.org_id, i.case_id
    from public.case_interviews i
    where i.status = 'open' and i.scope is not null
      and exists (
        select 1 from public.case_pieces_one_writes(i.case_id) w
        where w.written_at < (
          select max(a.answered_at) from public.case_interview_answers a
          where a.interview_id = i.id and a.status in ('answered', 'unknown') and not (a.question = any (i.scope))
        )
      )
  loop
    update public.case_interviews
    set status = 'done', finished_at = now(), current_question = null, asked_at = null, asks = 0, reminded_at = null
    where id = interview.id;
    perform public.record_case_event(interview.org_id, interview.case_id, 'interview_withdrawn', 'system',
      jsonb_build_object('interview', interview.id));
  end loop;
end;
$$;
