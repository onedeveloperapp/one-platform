-- ============================================================
-- 0094_confirm_and_go_on: what kept the owner's test case still on
-- 2026-11-04, and the agency's reminder before a flight.
--
-- 1. A person of the firm confirms what ONE read of a person in their
--    documents (`confirm_person_read_fields`): the marks of 0063 go, and the
--    case's timeline says the data were checked against the document.
--    Saving a person without changing a field kept every mark, so the card
--    asked forever to check what a person had already checked.
-- 2. A partner or a lawyer of the firm decides that the case goes on
--    without what the client did not answer of their account
--    (`close_account_gaps`): what was missing is kept as what the firm went
--    on without, the client is asked nothing more of it (on the link or in
--    the conversation), and ONE creates the lawsuits; the piece leaves those
--    points for a lawyer to complete. ONE waited for the client's answers
--    with no way forward for the firm (0090).
-- 3. The agency learns which of its passengers fly in the next days with no
--    agreement, while there is still time to send the link: on its home
--    (`pax_departing_unagreed`) and once per trip in its bell
--    (`pax_unagreed_notices_owed`, for the backend). Only who never answered,
--    or whose agreement no longer covers the trip (0086): never who said no
--    or took the agreement back, and nothing is read of any flight (the day
--    is the one the agency registered).
-- ============================================================

-- ---------- 1. The data ONE read, confirmed by a person ----------

/**
 * A person of the firm says the data ONE read of a person in their documents
 * agree with the documents: every mark of what was read goes (the card no
 * longer asks to check them), and the case's timeline says which fields
 * were confirmed. Anybody of the firm who writes the case, never a support
 * visit. Nothing read, nothing to confirm.
 */
create or replace function public.confirm_person_read_fields(target_case uuid, target_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  person public.people%rowtype;
  fields jsonb;
begin
  if not exists (
    select 1 from public.case_parties cp where cp.case_id = current_case.id and cp.person_id = target_person
  ) then
    return jsonb_build_object('ok', false, 'code', 'person_not_found');
  end if;
  select * into person from public.people where id = target_person for update;
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into fields from jsonb_object_keys(person.read_fields) k;
  if jsonb_array_length(fields) = 0 then
    return jsonb_build_object('ok', true, 'code', 'nothing', 'fields', fields);
  end if;
  update public.people set read_fields = '{}'::jsonb where id = person.id;
  perform public.record_case_event(current_case.org_id, current_case.id, 'person_read_confirmed', 'person',
    jsonb_build_object('person', person.id, 'fields', fields));
  return jsonb_build_object('ok', true, 'code', 'confirmed', 'fields', fields);
end;
$$;

revoke all on function public.confirm_person_read_fields(uuid, uuid) from public, anon;
grant execute on function public.confirm_person_read_fields(uuid, uuid) to authenticated;

-- ---------- 2. The case goes on without what the client did not answer ----------

alter table public.case_statements
  -- What the account still lacked when a partner or a lawyer decided the case goes on without it, when and who.
  add column gaps_closed_topics text[] not null default '{}',
  add column gaps_closed_at timestamptz,
  add column gaps_closed_by uuid references public.profiles (id) on delete set null;

alter table public.case_statements
  add constraint case_statements_gaps_closed_check check (
    cardinality(gaps_closed_topics) <= 12 and (gaps_closed_at is null) = (cardinality(gaps_closed_topics) = 0)
  );

/**
 * A partner or a lawyer decides that the case goes on without what the
 * client did not answer of their account: what was missing becomes what the
 * firm went on without, the questions go (the link and the conversation ask
 * nothing more of them, and an answer the client still writes is refused as
 * nothing to answer), and the account is ready for ONE, which creates the
 * lawsuits at its next look (the change of `missing_topics` wakes the case,
 * 0090). Only an order of the facts in force that still lacks something;
 * never a support visit.
 */
create or replace function public.close_account_gaps(target_case uuid, target_statement uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  statement public.case_statements%rowtype;
begin
  if not public.has_firm_function(current_case.org_id, array['socio', 'advogado']::public.firm_function[]) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into statement from public.case_statements s
  where s.id = target_statement and s.case_id = current_case.id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if statement.chronology_status not in ('approved', 'confirmed') or statement.work is not null
     or cardinality(statement.missing_topics) = 0 then
    return jsonb_build_object('ok', false, 'code', 'nothing_owed');
  end if;
  update public.case_statements set
    gaps_closed_topics = statement.missing_topics,
    gaps_closed_at = now(),
    gaps_closed_by = auth.uid(),
    missing_topics = '{}',
    questions = '{}'
  where id = statement.id;
  perform public.record_case_event(current_case.org_id, current_case.id, 'account_gaps_closed', 'person',
    jsonb_build_object('statement', statement.id, 'topics', to_jsonb(statement.missing_topics)));
  return jsonb_build_object('ok', true, 'code', 'closed', 'topics', to_jsonb(statement.missing_topics));
end;
$$;

revoke all on function public.close_account_gaps(uuid, uuid) from public, anon;
grant execute on function public.close_account_gaps(uuid, uuid) to authenticated;

-- ---------- 3. The agency's passengers who fly soon with no agreement ----------

-- How many days ahead the agency is told of a passenger who flies with no agreement.
update public.platform_settings
set value = value || jsonb_build_object('unagreed_days', 7)
where key = 'partners' and not (value ? 'unagreed_days');

/**
 * The adults of a partnership who hold a trip departing in the setting's next
 * days that ONE does not follow, and who never answered on their link or
 * whose agreement no longer covers that trip (0086): each with their first
 * such departure (the local time the agency registered) and how they stand.
 * Never who said no or took the agreement back, a draft, a passenger with the
 * firm, or a partnership that ended. Internal.
 */
create or replace function public.pax_unagreed_departures(target_partnership uuid)
returns table (traveler_id uuid, trip_id uuid, full_name text, departure timestamp, reagree text, created_by uuid)
language sql
stable
security definer
set search_path = public
as $$
  with window_ as (
    select (now() at time zone 'America/Sao_Paulo') as from_at,
           (now() at time zone 'America/Sao_Paulo')
             + make_interval(days => greatest(public.partner_setting('unagreed_days', 7), 1)) as until_at
  )
  select h.id, first_trip.trip_id, h.full_name, first_trip.departure, public.pax_reagree(h.id), h.created_by
  from public.partner_links link
  join public.pax_travelers h on h.partnership_id = link.id
  cross join window_
  cross join lateral (
    select t.id as trip_id, min(l.scheduled_departure_local) as departure
    from public.pax_trips t
    join public.pax_trip_legs l on l.trip_id = t.id
    where t.holder_id = h.id
      and l.scheduled_departure_local >= window_.from_at
      and l.scheduled_departure_local < window_.until_at
      -- A trip ONE does not follow now: none was made of it, or the one made was stopped.
      and not exists (
        select 1 from public.tracked_trips tt where tt.pax_trip_id = t.id and tt.status <> 'stopped'
      )
    group by t.id
    order by min(l.scheduled_departure_local), t.id
    limit 1
  ) first_trip
  where link.id = target_partnership and link.status = 'active'
    and not h.draft and h.handed_over_at is null
    and not public.pax_is_minor(h.birth_date)
    and (public.pax_consent_state(h.id) is null or public.pax_reagree(h.id) is not null);
$$;

revoke all on function public.pax_unagreed_departures(uuid) from public, anon, authenticated;

/**
 * What the agency's home says of its passengers who fly in the next days
 * with no agreement: the days the setting looks ahead, and each passenger
 * with their departure, why their agreement is owed, and until when the link
 * they were sent is open (null: none open). Anybody of the partner.
 */
create or replace function public.pax_departing_unagreed(target_partnership uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.partner_links%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into link from public.partner_links where id = target_partnership;
  if not found or not public.is_partner_member(link.partner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'days', greatest(public.partner_setting('unagreed_days', 7), 1),
    'travelers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', u.traveler_id,
          'full_name', u.full_name,
          'departure', u.departure,
          'reagree', u.reagree,
          'link_until', (select max(cl.expires_at) from public.pax_confirm_links cl
                         where cl.holder_id = u.traveler_id and cl.ended_at is null and cl.expires_at > now()))
        order by u.departure, u.full_name)
      from public.pax_unagreed_departures(link.id) u
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.pax_departing_unagreed(uuid) from public, anon;
grant execute on function public.pax_departing_unagreed(uuid) to authenticated;

/**
 * For the backend's bell: across every active partnership, each passenger
 * who flies in the next days with no agreement, with their first such trip
 * (the bell's key: one notice per trip) and who is told: who manages the
 * agency, and who registered the passenger while still of the agency.
 * Service role only.
 */
create or replace function public.pax_unagreed_notices_owed(target_limit integer default 200)
returns table (traveler_id uuid, trip_id uuid, full_name text, departure timestamp, recipients uuid[])
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  select u.traveler_id, u.trip_id, u.full_name, u.departure,
         array(
           select pm.user_id from public.partner_members pm
           where pm.partner_id = link.partner_id
             and (pm.role in ('owner', 'admin') or pm.user_id = u.created_by)
           order by pm.user_id
         )
  from public.partner_links link
  cross join lateral public.pax_unagreed_departures(link.id) u
  where link.status = 'active'
  order by u.departure, u.traveler_id
  limit greatest(least(coalesce(target_limit, 200), 1000), 1);
end;
$$;

revoke all on function public.pax_unagreed_notices_owed(integer) from public, anon, authenticated;
grant execute on function public.pax_unagreed_notices_owed(integer) to service_role;
