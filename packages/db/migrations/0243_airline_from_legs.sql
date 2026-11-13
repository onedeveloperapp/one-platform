-- ============================================================
-- The airline of a case read from its legs (0243). Since 0239 the intake
-- asks no airline (the owner, 2026-11-13: the documents bring it), and the
-- legs ONE read from a boarding pass (AD4221, AD4702) never named the
-- case's airline: the piece came back with "[COMPLETAR: razão social da
-- companhia]" and "[COMPLETAR: CNPJ da companhia]", which no rule of ONE
-- could approve, and waited for a lawyer (the owner's test of the same
-- day). Now:
--
--   * a case with no airline takes the one of its first leg's flight number
--     (its two-letter code, an airline of the platform's table), whoever
--     wrote the leg: a document ONE read, the client, the firm;
--   * the cases of today with no airline and with legs have it now;
--   * a piece ONE carries that was written before the case had its airline
--     is written again (`case_pieces_to_redo`, redefined from 0100), as one
--     written before the client's account (0097), and the case is looked at.
-- ============================================================

/** The airline of a flight number by its two-letter code ("AD4221" is AD), when the platform knows it; else null. Internal. */
create or replace function public.airline_of_flight(target_flight text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select a.iata from public.airlines a
  where a.active and a.iata = upper(left(btrim(coalesce(target_flight, '')), 2));
$$;

revoke all on function public.airline_of_flight(text) from public, anon, authenticated;

/**
 * A case with no airline takes the one of its first leg (0243): written when a leg comes or changes its flight, only
 * while the case has none, on the record. Internal.
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
  end if;
  return null;
end;
$$;

revoke all on function public.flight_segments_case_airline() from public, anon, authenticated;

create trigger flight_segments_case_airline
after insert or update of flight_number, position on public.flight_segments
for each row execute function public.flight_segments_case_airline();

/**
 * The pieces ONE writes again in a case (replaces 0100's): as there (older than the account's last change, never
 * while the client is being asked), and also the ones written before the case had its airline read from its legs
 * (0243). Internal.
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
    and (
      (w.written_at < public.case_account_changed_at(target_case)
       and public.case_account_state(target_case) in ('ready', 'incomplete'))
      or w.written_at < (select max(e.at) from public.case_events e
                         where e.case_id = target_case and e.kind = 'airline_read_from_legs')
    )
  order by w.requested_at, w.draft_id;
$$;

revoke all on function public.case_pieces_to_redo(uuid) from public, anon, authenticated;

-- The cases of today with no airline and with legs take it now, the record saying so.
with named as (
  select c.id as case_id, c.org_id,
         (select s.flight_number from public.flight_segments s
          where s.case_id = c.id and s.flight_number is not null order by s.position, s.id limit 1) as flight
  from public.cases c
  where c.airline_iata is null and c.status not in ('closed', 'declined')
), applied as (
  update public.cases c set airline_iata = public.airline_of_flight(n.flight)
  from named n
  where c.id = n.case_id and public.airline_of_flight(n.flight) is not null
  returning c.id, c.org_id, c.airline_iata, n.flight
)
select public.record_case_event(a.org_id, a.id, 'airline_read_from_legs', 'system',
  jsonb_build_object('airline', a.airline_iata, 'flight', a.flight))
from applied a;

-- The cases with a piece to write again now are looked at.
select public.wake_case_advance(k.id)
from public.cases k
where k.status not in ('filed', 'closed', 'declined')
  and exists (select 1 from public.case_pieces_to_redo(k.id));
