-- ============================================================
-- 0291 · Every page of a list reaches every row, once
--
-- The audit of the lists of 2026-11-25 found four reads whose pages could
-- not be trusted:
--
-- 1. The agency's passengers (`pax_travelers_page`, 0194) were ordered by the
--    next departure and the moment of registration alone. A spreadsheet is
--    registered in one transaction, so its passengers share that moment and,
--    with no flight yet, the whole order: a passenger could come on two pages
--    and another on none. The id now decides a tie.
-- 2. The answers of a module (`firm_module_approvals`, 0078) counted and
--    paged the texts of pieces the queue never shows: it may now leave one
--    task out, of the page and of the total.
-- 3. The audit trail and 4. the sign-in trail of the operator's console are
--    read a page at a time, searched in the database (`admin_audit_events`,
--    `admin_access_events`): the console held the latest 200 events and
--    paged those, and the sign-in trail listed nothing at all (its embed of
--    the profile was ambiguous).
-- ============================================================

/** The agency's list (0106, 0194), filtered by a stage of the funnel, in one order a tie never breaks. */
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
    -- The same day and hour of departure, and the same instant of registration (a spreadsheet is one transaction),
    -- still say one order: the id decides, or a passenger could be on two pages and another on none.
    select f.*, row_number() over (order by f.next_departure nulls last, f.created_at desc, f.id) as ord
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

/**
 * The answers of the AI about the cases of a module (0078), now able to leave out one task: the queue of
 * `/aprovacoes` never holds the text of a piece (it is approved on its case), and when it asked for the oldest
 * waiting and dropped the pieces afterwards, a module whose oldest were pieces showed "N waiting" over no card at
 * all, and counted pieces that were never to be shown. The task left out is out of the page and of the total alike.
 * The arguments of before still answer as before. The signature changes, so the function of 0078 goes first.
 */
drop function if exists public.firm_module_approvals(uuid, text, boolean, integer);

create function public.firm_module_approvals(
  target_org uuid,
  target_module text,
  target_decided boolean default false,
  target_limit integer default 50,
  target_except_task text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  size integer := least(greatest(coalesce(target_limit, 50), 1), 200);
  except_task text := nullif(btrim(coalesce(target_except_task, '')), '');
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_module is null then
    raise exception 'invalid_module' using errcode = '22023';
  end if;
  if coalesce(target_decided, false) then
    return jsonb_build_object('ids', coalesce((
      select jsonb_agg(d.id order by d.decided_at desc nulls last, d.id)
      from (
        select a.id, a.decided_at from public.approvals a
        where a.org_id = target_org and a.status in ('approved', 'rejected', 'returned')
          and (except_task is null or a.task <> except_task)
          and public.ai_run_in_module(a.run_id, target_module)
        order by a.decided_at desc nulls last, a.id
        limit size
      ) d
    ), '[]'::jsonb));
  end if;
  return (
    with waiting as (
      select a.id, a.created_at from public.approvals a
      where a.org_id = target_org and a.status = 'pending'
        and (except_task is null or a.task <> except_task)
        and public.ai_run_in_module(a.run_id, target_module)
    )
    select jsonb_build_object(
      'total', (select count(*) from waiting),
      'ids', coalesce((
        select jsonb_agg(w.id order by w.created_at, w.id)
        from (select * from waiting order by created_at, id limit size) w
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.firm_module_approvals(uuid, text, boolean, integer, text) from public, anon;
grant execute on function public.firm_module_approvals(uuid, text, boolean, integer, text) to authenticated;

/**
 * The platform's audit trail for the operator's console (`/admin/audit`), a page at a time with how many match: the
 * console read the latest 200 and paged them in the browser, so every older event was out of reach and its search
 * said "nothing" of what it never held. The search is every word of it in what the console shows of an event: the
 * action, the entity, who did it and the firm. Only the platform's operator reads it.
 */
create or replace function public.admin_audit_events(
  target_search text default null,
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
  words text[] := array_remove(string_to_array(lower(btrim(coalesce(target_search, ''))), ' '), '');
  size integer := least(greatest(coalesce(target_limit, 25), 1), 100);
  skip integer := least(greatest(coalesce(target_offset, 0), 0), 1000000);
begin
  if auth.uid() is null or not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return (
    with matched as (
      select e.id, e.action, e.entity_type, e.entity_id, e.metadata, e.created_at, e.actor_type,
             p.display_name as actor_name, o.name as org_name
      from public.audit_events e
      left join public.profiles p on p.id = e.actor_id
      left join public.organizations o on o.id = e.org_id
      where cardinality(words) = 0 or not exists (
        select 1 from unnest(words) as word
        where strpos(lower(concat_ws(' ', e.action, e.entity_type, e.entity_id, p.display_name, o.name)), word) = 0)
    )
    select jsonb_build_object(
      'total', (select count(*) from matched),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', m.id, 'action', m.action, 'entity_type', m.entity_type, 'entity_id', m.entity_id,
            'metadata', m.metadata, 'created_at', m.created_at, 'actor_type', m.actor_type,
            'actor_name', m.actor_name, 'org_name', m.org_name)
          order by m.created_at desc, m.id desc)
        from (select * from matched order by created_at desc, id desc limit size offset skip) m
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.admin_audit_events(text, integer, integer) from public, anon;
grant execute on function public.admin_audit_events(text, integer, integer) to authenticated;

/**
 * The sign-in trail for the operator's console, a page at a time with how many match. The console embedded the
 * person's profile, but an access names two profiles (who signed in, and the operator of a support visit), so the
 * API refused the embed as ambiguous and the console listed nothing. Here each is named: who signed in and, of a
 * support visit, the operator who opened it. The search is every word of it in the name, the address, the device
 * and the level of the sign-in. Only the platform's operator reads it.
 */
create or replace function public.admin_access_events(
  target_search text default null,
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
  words text[] := array_remove(string_to_array(lower(btrim(coalesce(target_search, ''))), ' '), '');
  size integer := least(greatest(coalesce(target_limit, 25), 1), 100);
  skip integer := least(greatest(coalesce(target_offset, 0), 0), 1000000);
begin
  if auth.uid() is null or not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return (
    with matched as (
      select a.id, a.ip, a.user_agent, a.aal, a.created_at,
             p.display_name as user_name, s.display_name as support_name, a.impersonated_by is not null as support
      from public.access_events a
      left join public.profiles p on p.id = a.user_id
      left join public.profiles s on s.id = a.impersonated_by
      where cardinality(words) = 0 or not exists (
        select 1 from unnest(words) as word
        where strpos(lower(concat_ws(' ', p.display_name, s.display_name, a.ip, a.user_agent, a.aal)), word) = 0)
    )
    select jsonb_build_object(
      'total', (select count(*) from matched),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
            'id', m.id, 'ip', m.ip, 'user_agent', m.user_agent, 'aal', m.aal, 'created_at', m.created_at,
            'user_name', m.user_name, 'support', m.support, 'support_name', m.support_name)
          order by m.created_at desc, m.id desc)
        from (select * from matched order by created_at desc, id desc limit size offset skip) m
      ), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function public.admin_access_events(text, integer, integer) from public, anon;
grant execute on function public.admin_access_events(text, integer, integer) to authenticated;
