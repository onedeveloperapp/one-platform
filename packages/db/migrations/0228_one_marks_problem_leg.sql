-- ============================================================
-- 0228 · ONE marks the leg where the problem happened
--
-- The owner, 2026-11-12, on the case screen's clarity: the card of the trip said "Falta marcar o trecho do
-- problema" beside a check that it was done, and nothing said which leg or how. ONE does what needs no person:
-- a trip of one leg has its problem on that leg, and a trip of several on the one leg ANAC's record gives as
-- cancelled, diverted or late (the pure rule `problemLeg` of `@flyee/flights/check`, which the backend applies
-- once the legs were checked, `apps/web/src/modules/direito-do-passageiro/flights/checks-work.ts`). Only when the
-- rule cannot tell does the card ask a person, with each leg one click away.
--
-- Who marked the leg is kept on it (`affected_by`): a person (the firm on the case, the client on the link, an
-- agency, a ticket read into legs) or ONE, so the card says what ONE marked and that it may err. A person's mark
-- or unmark is a person's whatever it was before (a trigger, so the save functions stay as they are); ONE marks
-- only through `one_mark_problem_leg`, only before the lawsuit, and only while no leg of the case is marked, so it
-- never overrides what a person said. The timeline tells it (`leg_marked_by_one`, the leg and its flight number).
-- ============================================================

alter table public.flight_segments add column affected_by text;
alter table public.flight_segments add constraint flight_segments_affected_by_check
  check (affected_by is null or affected_by in ('person', 'one'));

-- The legs marked before this were marked by a person.
update public.flight_segments set affected_by = 'person' where affected;

create or replace function public.flight_segments_affected_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- ONE's own mark says so itself.
  if coalesce(current_setting('one.marking_leg', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' or new.affected is distinct from old.affected then
    new.affected_by := case when new.affected then 'person' else null end;
  else
    new.affected_by := old.affected_by;
  end if;
  return new;
end;
$$;

create trigger flight_segments_affected_by
  before insert or update on public.flight_segments
  for each row execute function public.flight_segments_affected_by();

revoke all on function public.flight_segments_affected_by() from public, anon, authenticated;

create or replace function public.one_mark_problem_leg(target_case uuid, target_segment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  the_case public.cases%rowtype;
  leg public.flight_segments%rowtype;
begin
  select * into the_case from public.cases where id = target_case for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'case_not_found');
  end if;
  -- Once the lawsuit went to court, the leg is what the piece said.
  if the_case.status in ('filed', 'closed', 'declined') then
    return jsonb_build_object('ok', true, 'marked', false);
  end if;
  -- A leg somebody marked (a person, or ONE before) stays: ONE never overrides it.
  if exists (select 1 from public.flight_segments where case_id = target_case and affected) then
    return jsonb_build_object('ok', true, 'marked', false);
  end if;
  select * into leg from public.flight_segments where id = target_segment and case_id = target_case;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'segment_not_found');
  end if;

  perform set_config('one.marking_leg', 'on', true);
  update public.flight_segments set affected = true, affected_by = 'one', updated_at = now() where id = leg.id;
  perform set_config('one.marking_leg', '', true);

  perform public.record_case_event(the_case.org_id, target_case, 'leg_marked_by_one', 'system',
    jsonb_build_object('segment', leg.id, 'flight', leg.flight_number));
  return jsonb_build_object('ok', true, 'marked', true);
end;
$$;

revoke all on function public.one_mark_problem_leg(uuid, uuid) from public, anon, authenticated;
grant execute on function public.one_mark_problem_leg(uuid, uuid) to service_role;
