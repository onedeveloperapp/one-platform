-- ============================================================
-- What a piece leaves to complete, and ONE's approval tried again (0245).
-- The owner's test of 2026-11-13: a piece's marks of the defendant (its
-- legal name, its CNPJ) are filled from the case's airline when the piece
-- is read; with no airline they read "[COMPLETAR: ...]", ONE's only try to
-- approve the piece was spent on them, and the case's top said "Revise e
-- aprove a peça" with no word of why. Now:
--
--   * a firm reads what each piece being written leaves to complete, in
--     the words its filled text says them (`case_drafts_gaps`), for the
--     case's top to say;
--   * once the case's airline is read from its legs (0243), the pieces ONE
--     wrote and nobody touched are owed ONE's approval again: what kept it
--     from approving them may be filled now (the trigger of 0243,
--     redefined); and the pieces of that day are owed it too.
-- ============================================================

/**
 * What each piece of a case still being written leaves to complete (0245): its id and the words of each
 * "[COMPLETAR: ...]" its filled text has, once each, for the case's top to say. For anybody of the firm.
 */
create or replace function public.case_drafts_gaps(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_object_agg(g.draft_id::text, g.gaps)
    from (
      select d.id as draft_id,
             (select coalesce(jsonb_agg(distinct btrim(m[1])), '[]'::jsonb)
              from regexp_matches(public.case_draft_filled(d.id, v.body), '\[COMPLETAR:\s*([^\]]+)\]', 'g') m) as gaps
      from public.case_drafts d
      join public.case_draft_versions v on v.draft_id = d.id and v.version = d.version
      where d.case_id = current_case.id and d.status = 'proposed'
    ) g
    where jsonb_array_length(g.gaps) > 0
  ), '{}'::jsonb);
end;
$$;

revoke all on function public.case_drafts_gaps(uuid) from public, anon;
grant execute on function public.case_drafts_gaps(uuid) to authenticated;

/** The pieces of a case ONE wrote and nobody touched, owed ONE's approval again: what kept it may be filled now. Internal. */
create or replace function public.rearm_draft_approvals(target_case uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  rearmed integer;
begin
  update public.case_drafts d set auto_approval_owed = true
  where d.case_id = target_case and d.status = 'proposed' and d.mode = 'ai' and d.work is null
    and d.version = 1 and d.revisions = 0 and d.revision_note is null and not d.auto_approval_owed
    and d.approved_at is null
    and not exists (
      select 1 from public.case_draft_versions w where w.draft_id = d.id and (w.author = 'person' or w.note is not null)
    );
  get diagnostics rearmed = row_count;
  return rearmed;
end;
$$;

revoke all on function public.rearm_draft_approvals(uuid) from public, anon, authenticated;

/**
 * A case with no airline takes the one of its first leg (0243, redefined): as before, and its pieces ONE wrote are
 * owed ONE's approval again, the defendant's marks now filled (0245). Internal.
 */
create or replace function public.flight_segments_case_airline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  airline text;
  first_flight text;
begin
  if not exists (select 1 from public.cases c where c.id = new.case_id and c.airline_iata is null) then
    return null;
  end if;
  select s.flight_number into first_flight from public.flight_segments s
  where s.case_id = new.case_id and s.flight_number is not null
  order by s.position, s.id limit 1;
  airline := public.airline_of_flight(first_flight);
  if airline is null then
    return null;
  end if;
  update public.cases set airline_iata = airline where id = new.case_id and airline_iata is null;
  if found then
    perform public.record_case_event(new.org_id, new.case_id, 'airline_read_from_legs', 'system',
      jsonb_build_object('airline', airline, 'flight', first_flight));
    perform public.rearm_draft_approvals(new.case_id);
  end if;
  return null;
end;
$$;

revoke all on function public.flight_segments_case_airline() from public, anon, authenticated;

-- The pieces of the cases whose airline was read from their legs after the piece was written: owed ONE's approval.
select public.rearm_draft_approvals(k.id)
from public.cases k
where k.status not in ('filed', 'closed', 'declined')
  and exists (
    select 1 from public.case_drafts d
    join public.case_draft_versions v on v.draft_id = d.id and v.version = d.version
    where d.case_id = k.id and d.status = 'proposed'
      and v.created_at < (select max(e.at) from public.case_events e
                          where e.case_id = k.id and e.kind = 'airline_read_from_legs')
  );
