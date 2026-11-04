-- ============================================================
-- 0089_agency_keeps_handed_over: a passenger whose case the firm opened
-- stays among the agency's passengers.
--
-- The owner, 2026-11-03: once a passenger said yes and the firm opened
-- their case, the passenger vanished from the agency's list. The list
-- itself kept them (`pax_travelers_page` lists everybody of the
-- partnership, "Com o escritório" on the row of one handed over), but the
-- count of the agency's passengers (`pax_overview.travelers`) counted only
-- the ones still with the agency, and the screen read "no passenger yet"
-- from that count: the agency whose only passenger went to the firm saw an
-- empty page. The agency follows where such a passenger stands (the
-- decision of 2026-10-29: after the registration, the agency sees where the
-- following stands), so the count of its passengers is now the list's:
-- every passenger of the partnership the agency confirmed, handed over or
-- not. The other counts are of what the agency still does, and still leave
-- out who went to the firm, as their filters do.
-- ============================================================

/**
 * 0086, redefined: the agency's counts; the passengers of the partnership are all of them, also the ones whose case
 * the firm opened, as its list shows them.
 */
create or replace function public.pax_overview(target_partnership uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.partner_links%rowtype;
begin
  select * into link from public.partner_links where id = target_partnership;
  if not found or not public.is_partner_member(link.partner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'travelers', (select count(*) from public.pax_travelers t
                  where t.partnership_id = link.id and not t.draft),
    'adults_waiting', (
      select count(*) from public.pax_travelers t
      where t.partnership_id = link.id and t.handed_over_at is null and not t.draft
        and not public.pax_is_minor(t.birth_date)
        and exists (select 1 from public.pax_trips trip where trip.holder_id = t.id)
        and (coalesce(public.pax_consent_state(t.id), 'none') <> 'agreed' or public.pax_reagree(t.id) is not null)
    ),
    'missing_identity', (
      select count(*) from public.pax_travelers t
      where t.partnership_id = link.id and t.handed_over_at is null and not t.draft
        and not exists (select 1 from public.pax_documents d where d.traveler_id = t.id and d.kind = 'identity'
                        and d.reading <> 'uploading')
    ),
    'upcoming', (
      select count(distinct trip.id) from public.pax_trips trip join public.pax_trip_legs l on l.trip_id = trip.id
      where trip.partnership_id = link.id and l.position = 1
        and l.scheduled_departure_local between (now() at time zone 'America/Sao_Paulo') - interval '6 hours'
                                            and (now() at time zone 'America/Sao_Paulo') + interval '48 hours'
    ),
    'watched', (
      select count(*) from public.pax_trips trip
      where trip.partnership_id = link.id and public.pax_trip_state(trip.id) in ('watching', 'alerted')
    ),
    'consent_term', (select max(t.version) from public.pax_consent_terms t where t.partner_id = link.partner_id)
  );
end;
$$;

revoke all on function public.pax_overview(uuid) from public, anon;
grant execute on function public.pax_overview(uuid) to authenticated;
