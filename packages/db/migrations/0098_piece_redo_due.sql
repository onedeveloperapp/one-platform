-- ============================================================
-- 0098_piece_redo_due: the sweep takes a case whose piece is to be written
-- again (2026-11-05).
--
-- 0097 wrote the piece again in the look of a case, but the sweep hands a
-- case to the worker only when something is due for it (`claim_case_
-- advances`, 0055), and nothing due knew of a piece to write again: the
-- owner's case, woken, was set aside by the sweep fifteen seconds later
-- without the worker ever looking at it. Which pieces are to be written
-- again is now one reading (`case_pieces_to_redo`), what the sweep asks
-- (`case_advance_steps_due`, redefined) and what the worker writes from
-- (`advance_redo_pieces`, redefined); the cases that have one now are woken.
-- ============================================================

/**
 * The pieces ONE writes again in a case: the AI's first text, still with a
 * [COMPLETAR], that nobody of the firm edited, sent back or had rewritten, of
 * a lawsuit still planned, whose latest version is older than the account's
 * last change, in a case that did not end, as the firm lets ONE start pieces.
 * Internal.
 */
create or replace function public.case_pieces_to_redo(target_case uuid)
returns table (draft_id uuid, proceeding_id uuid, template_id uuid, kind text)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.proceeding_id, d.template_id, p.kind
  from public.cases k
  join public.case_drafts d on d.case_id = k.id
  join public.proceedings p on p.id = d.proceeding_id and p.status = 'planned'
  join public.case_draft_versions v on v.draft_id = d.id and v.version = d.version
  where k.id = target_case
    and k.status not in ('filed', 'closed', 'declined')
    and d.status = 'proposed' and d.work is null and d.mode = 'ai'
    and d.revision_note is null and d.revisions = 0
    and strpos(v.body, '[COMPLETAR') > 0
    and not exists (
      select 1 from public.case_draft_versions w
      where w.draft_id = d.id and (w.author = 'person' or w.note is not null)
    )
    and v.created_at < public.case_account_changed_at(k.id)
    and public.firm_autonomy_mode(k.org_id, 'start_piece') = 'auto'
    and public.case_account_state(k.id) in ('ready', 'incomplete')
  order by d.requested_at, d.id;
$$;

revoke all on function public.case_pieces_to_redo(uuid) from public, anon, authenticated;

/**
 * Whether ONE may do something for a lawsuit of a case: its piece, its
 * package, or its piece written again with the client's account (replaces the
 * one of 0039).
 */
create or replace function public.case_advance_steps_due(target_case uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.case_advance_package_due(target_case) or exists (
    select 1 from public.proceedings p
    join public.cases k on k.id = p.case_id
    where p.case_id = target_case and p.status = 'planned' and k.status not in ('filed', 'closed', 'declined')
      and public.firm_autonomy_mode(k.org_id, 'start_piece') = 'auto' and public.advance_piece_due(p.id)
  ) or exists (select 1 from public.case_pieces_to_redo(target_case));
$$;

revoke all on function public.case_advance_steps_due(uuid) from public, anon, authenticated;

/**
 * ONE writes again, in the look of the case it holds, each piece the account
 * came after (`case_pieces_to_redo`): the piece before is given up (what
 * waited of it leaves the queue) and a new first text is asked from the same
 * model (else the firm's model of the kind), told in the timeline; one that
 * cannot be asked leaves the piece as it was. Answers the new pieces to
 * follow. Service role, with the case's claim (replaces the one of 0097).
 */
create or replace function public.advance_redo_pieces(target_case uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  draft record;
  template uuid;
  answer jsonb;
  drafts jsonb := '[]'::jsonb;
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
  for draft in select * from public.case_pieces_to_redo(target_case) loop
    template := coalesce(
      (select t.id from public.draft_templates t
       where t.id = draft.template_id and (t.org_id = current_case.org_id or t.org_id is null)),
      public.draft_template_for(current_case.org_id, draft.kind));
    continue when template is null;
    begin
      perform public.withdraw_draft_approvals(draft.draft_id,
        'O ONE refez a peça com o relato do cliente, que chegou depois do primeiro texto.');
      update public.case_drafts set status = 'cancelled', work = null, work_claimed_at = null
      where id = draft.draft_id and status = 'proposed' and work is null;
      answer := public.request_case_draft(draft.proceeding_id, template, 'ai');
      if not coalesce((answer ->> 'ok')::boolean, false) then
        raise exception 'redo_refused' using errcode = 'P0001';
      end if;
      drafts := drafts || jsonb_build_array(answer ->> 'draft_id');
      perform public.record_case_event(current_case.org_id, target_case, 'draft_redone', 'system',
        jsonb_build_object('draft', draft.draft_id, 'new_draft', answer ->> 'draft_id', 'proceeding', draft.proceeding_id));
    exception when sqlstate 'P0001' then
      -- Nothing of this one stays: the piece keeps its text for a lawyer.
      null;
    end;
  end loop;
  perform set_config('one.system_case', '', true);
  return jsonb_build_object('ok', true, 'code', case when jsonb_array_length(drafts) > 0 then 'redone' else 'none' end,
                            'drafts', drafts);
end;
$$;

revoke all on function public.advance_redo_pieces(uuid, integer) from public, anon, authenticated;

-- The cases that have a piece to write again now were set aside by the sweep: they are looked at again.
select public.wake_case_advance(k.id)
from public.cases k
where k.status not in ('filed', 'closed', 'declined')
  and exists (select 1 from public.case_pieces_to_redo(k.id));
