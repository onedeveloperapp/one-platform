-- ============================================================
-- The agency's people by the same funnel as the firm's.
--
-- The owner decided on 2026-11-11 that a person is registered as "Nova
-- pessoa", in the firm and in the partner's area alike, and that where each
-- person stands is the funnel, never a choice made when registering. In the
-- agency's list, each passenger says their stage (`pax_stage`):
--   * `firm`, "Com o escritório": a trip of theirs became a case (the agency
--     is never told whether the passenger signed with the firm);
--   * `lead`: their agreement to be followed is in force;
--   * `contact`: anything else (registered, the link not answered, refused,
--     taken back, or a yes that no longer covers their trips).
-- `pax_overview` counts each stage, and `pax_travelers_page` filters by it
-- and says it on each row (both redefined from 0106).
-- ============================================================

/** Where a passenger of an agency stands in the funnel, as the agency sees it (internal). */
create or replace function public.pax_stage(target_traveler uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when t.handed_over_at is not null then 'firm'
    when public.pax_consent_state(coalesce(t.guardian_id, t.id)) = 'agreed'
         and public.pax_reagree(coalesce(t.guardian_id, t.id)) is null then 'lead'
    else 'contact'
  end
  from public.pax_travelers t
  where t.id = target_traveler;
$$;

revoke all on function public.pax_stage(uuid) from public, anon, authenticated;

/** What the agency's list counts (0106), with each stage of the funnel (0194). */
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
    'contacts', (select count(*) from public.pax_travelers t
                 where t.partnership_id = link.id and not t.draft and public.pax_stage(t.id) = 'contact'),
    'leads', (select count(*) from public.pax_travelers t
              where t.partnership_id = link.id and not t.draft and public.pax_stage(t.id) = 'lead'),
    'with_firm', (select count(*) from public.pax_travelers t
                  where t.partnership_id = link.id and not t.draft and public.pax_stage(t.id) = 'firm'),
    'adults_waiting', (
      select count(*) from public.pax_travelers t
      where t.partnership_id = link.id and not t.draft
        and (t.handed_over_at is null or public.pax_reagree(t.id) is not null)
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
        -- The trip that became a case is the firm's, as the list's next departure leaves it out.
        and public.pax_trip_state(trip.id) <> 'case_opened'
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

/** The agency's list (0106), filtered by a stage of the funnel and saying each row's (0194). */
create or replace function public.pax_travelers_page(
  target_partnership uuid,
  target_search text default null,
  target_filter text default 'all',
  target_limit integer default 25,
  target_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.partner_links%rowtype;
  term text := nullif(lower(public.plain_name(btrim(coalesce(target_search, '')))), '');
  digits text := nullif(regexp_replace(coalesce(target_search, ''), '\D', '', 'g'), '');
  page_size integer := greatest(least(coalesce(target_limit, 25), 100), 1);
  rows jsonb;
  total integer;
begin
  select * into link from public.partner_links where id = target_partnership;
  if not found or not public.is_partner_member(link.partner_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  with matched as (
    select t.*,
      public.pax_consent_state(coalesce(t.guardian_id, t.id)) as consent,
      public.pax_reagree(coalesce(t.guardian_id, t.id)) as reagree,
      public.pax_stage(t.id) as stage,
      (select min(l.scheduled_departure_local) from public.pax_trip_legs l
       join public.pax_trip_travelers tt on tt.trip_id = l.trip_id
       where tt.traveler_id = t.id and l.scheduled_departure_local >= (now() at time zone 'America/Sao_Paulo') - interval '1 day'
         -- The trip that became a case is the firm's: the agency's next trip is another.
         and public.pax_trip_state(l.trip_id) <> 'case_opened') as next_departure
    from public.pax_travelers t
    where t.partnership_id = link.id and not t.draft
      -- A name by its words in any order; a CPF by how it starts.
      and (term is null
           or not exists (
             select 1 from unnest(string_to_array(term, ' ')) as word
             where word <> '' and strpos(lower(public.plain_name(t.full_name)), word) = 0)
           or (digits is not null and char_length(digits) >= 3 and t.cpf like digits || '%'))
  ), filtered as (
    select * from matched m
    where case coalesce(target_filter, 'all')
      when 'contact' then m.stage = 'contact'
      when 'lead' then m.stage = 'lead'
      when 'firm' then m.stage = 'firm'
      when 'waiting_consent' then (m.handed_over_at is null or m.reagree is not null)
        and (coalesce(m.consent, 'none') <> 'agreed' or m.reagree is not null)
      when 'missing_identity' then m.handed_over_at is null and not exists (
        select 1 from public.pax_documents d where d.traveler_id = m.id and d.kind = 'identity' and d.reading <> 'uploading')
      when 'upcoming' then m.next_departure is not null
        and m.next_departure <= (now() at time zone 'America/Sao_Paulo') + interval '48 hours'
      else true end
  ), ordered as (
    select f.*, row_number() over (order by f.next_departure nulls last, f.created_at desc) as ord
    from filtered f
  )
  -- The total counts the whole list, also for a page past its end; only the page's rows are read whole.
  select (select count(*) from ordered)::integer,
    coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.id, 'full_name', o.full_name, 'cpf', o.cpf, 'birth_date', o.birth_date, 'phone', o.phone,
          'guardian_id', o.guardian_id, 'minor', public.pax_is_minor(o.birth_date), 'consent', o.consent,
          'reagree', o.reagree, 'stage', o.stage,
          'next_departure', o.next_departure, 'handed_over_at', o.handed_over_at,
          'kinds', (select coalesce(jsonb_agg(distinct d.kind), '[]'::jsonb) from public.pax_documents d
                    where d.traveler_id = o.id and d.reading <> 'uploading'),
          'reading', coalesce((select bool_or(d.reading in ('pending', 'working')) from public.pax_documents d
                               where d.traveler_id = o.id), false))
        order by o.ord)
      from ordered o
      where o.ord > greatest(coalesce(target_offset, 0), 0) and o.ord <= greatest(coalesce(target_offset, 0), 0) + page_size
    ), '[]'::jsonb)
  into total, rows;
  return jsonb_build_object('rows', rows, 'total', total);
end;
$$;

revoke all on function public.pax_travelers_page(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.pax_travelers_page(uuid, text, text, integer, integer) to authenticated;
