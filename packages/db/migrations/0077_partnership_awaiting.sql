-- ============================================================
-- 0077_partnership_awaiting: what a firm reads of a partnership counts the
-- cases waiting for their client as ONE waits for them.
--
-- `firm_partnership_facts` (0075) counted as waiting for the client only the
-- cases whose reason ONE named last was the client's confirmation of the
-- agency's data. ONE names one reason at a time: a case that also lacked a
-- datum (a marital status, a profession) was not counted, though its lawsuits
-- still wait for the client to say on their link that they finished. The walk
-- of the test that starts from the agency found it (2026-10-30). A case the
-- partnership brought now waits for its client, here as for ONE
-- (`lib/cases/advance-work.ts`), while it is still gathered (intake,
-- documents, signature) and no link of it says its client finished.
-- ============================================================

/**
 * As in 0075, and `awaiting_client` counts the partnership's cases still gathered whose client did not say on any
 * link of the case that they finished: what ONE waits for before it creates their lawsuits (0071).
 */
create or replace function public.firm_partnership_facts(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  manager boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  manager := public.is_superadmin() or public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]);

  return jsonb_build_object(
    'partnerships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'link_id', l.id,
        'module', l.module_key,
        'status', l.status,
        'cases_going', (
          select count(*) from public.cases c
          where c.org_id = target_org and c.partnership_id = l.id and c.status not in ('closed', 'declined')
        ),
        'cases_total', (
          select count(*) from public.cases c where c.org_id = target_org and c.partnership_id = l.id
        ),
        'awaiting_client', (
          select count(*) from public.cases c
          where c.org_id = target_org and c.partnership_id = l.id
            and c.status in ('intake', 'documents', 'signature')
            and not exists (
              select 1 from public.client_links k where k.case_id = c.id and k.finished_at is not null
            )
        ),
        'readings_today', case when manager then coalesce((
          select r.readings from public.pax_reading_days r where r.partnership_id = l.id and r.day = today
        ), 0) end,
        'flight_reads_today', case when manager then coalesce((
          select sum(t.watch_reads)::integer from public.tracked_trips t
          join public.pax_trips p on p.id = t.pax_trip_id
          where p.partnership_id = l.id and t.org_id = target_org and t.watch_day = today
        ), 0) end
      ) order by (l.status = 'active') desc, l.started_at desc)
      from public.partner_links l
      where l.org_id = target_org
    ), '[]'::jsonb),
    'manager', manager,
    'readings_daily', case when manager then greatest(public.partner_setting('reading_daily', 300), 1) end,
    'flight_reads_today', case when manager then coalesce((
      select sum(t.watch_reads)::integer from public.tracked_trips t
      where t.org_id = target_org and t.watch_day = today
    ), 0) end,
    'flight_reads_share', case when manager then
      greatest(public.flight_alerts_setting('watch_firm_daily_reads', 150), 0) end
  );
end;
$$;

revoke all on function public.firm_partnership_facts(uuid) from public, anon;
grant execute on function public.firm_partnership_facts(uuid) to authenticated;
