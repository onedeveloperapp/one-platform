-- ============================================================
-- 0167 · O prazo interno por tipo de ato
--
-- Phase 8 of the plan of the controladoria and the finance: the firm worked to an internal deadline the same business
-- days before every fatal one (`organizations.internal_deadline_days`, 0132). It now says other days for an act of the
-- list (`internal_deadline_by_act`: an act's slug and its days, 0 to 15, 0 switching the internal day off for that act),
-- the firm's days holding for every other act and for a deadline of no act. Who decides for the firm or the
-- controladoria sets it (`set_internal_deadline_days_for_act`, never a support visit, on the record); the agenda, the
-- morning's e-mail and the calendar link hand it out beside the firm's days (`firm_agenda`, `agenda_digests_owed`,
-- `agenda_calendar_feed` redefined from 0132), and the app counts each internal day by its act.
-- ============================================================

alter table public.organizations add column internal_deadline_by_act jsonb not null default '{}'::jsonb;
alter table public.organizations add constraint organizations_internal_deadline_by_act_check
  check (jsonb_typeof(internal_deadline_by_act) = 'object');

/**
 * Who decides for the firm or the controladoria says the internal days of one act of the list, or takes them off
 * (`target_days` null) so the firm's days hold for it again. On the record.
 */
create or replace function public.set_internal_deadline_days_for_act(target_org uuid, target_act text, target_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  before jsonb;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.decides_for_firm(target_org)
     and not public.has_firm_function(target_org, array['controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not exists (select 1 from public.deadline_acts a where a.slug = target_act) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'act');
  end if;
  if target_days is not null and target_days not between 0 and 15 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'days');
  end if;
  select internal_deadline_by_act -> target_act into before from public.organizations where id = target_org for update;
  update public.organizations
  set internal_deadline_by_act = case when target_days is null then internal_deadline_by_act - target_act
                                      else internal_deadline_by_act || jsonb_build_object(target_act, target_days) end
  where id = target_org;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'agenda.internal_days_act_set', 'organization', target_org::text,
    jsonb_build_object('act', target_act, 'before', before, 'after', target_days));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_internal_deadline_days_for_act(uuid, text, integer) from public, anon;
grant execute on function public.set_internal_deadline_days_for_act(uuid, text, integer) to authenticated;

-- ---------- The agenda, the morning's e-mail and the calendar link hand them out ----------

/** The agenda of a span for the person (0132), with the internal days of each act the firm set (0167). */
create or replace function public.firm_agenda(target_org uuid, from_day date, to_day date, target_module text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  prefs public.agenda_preferences%rowtype;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if from_day is null or to_day is null or to_day < from_day or to_day - from_day > 62 then
    return jsonb_build_object('ok', false, 'code', 'invalid_range');
  end if;
  select * into prefs from public.agenda_preferences where org_id = target_org and user_id = auth.uid();
  return public.agenda_items(target_org, from_day, to_day, target_module) || jsonb_build_object(
    'ok', true,
    'internal_days', (select o.internal_deadline_days from public.organizations o where o.id = target_org),
    'internal_by_act', (select o.internal_deadline_by_act from public.organizations o where o.id = target_org),
    'me', jsonb_build_object(
      'id', auth.uid(),
      'whole_firm', public.agenda_whole_firm(target_org, auth.uid()),
      'digest_on', not coalesce(prefs.digest_off, false),
      'calendar_at', prefs.calendar_at,
      'sets_internal_days', public.decides_for_firm(target_org)
        or public.has_firm_function(target_org, array['controladoria']::public.firm_function[])
    )
  );
end;
$$;

revoke all on function public.firm_agenda(uuid, date, date, text) from public, anon;
grant execute on function public.firm_agenda(uuid, date, date, text) to authenticated;

/** Who is owed the morning's e-mail (0132), with the internal days of each act the firm set (0167). */
create or replace function public.agenda_digests_owed(target_day date, target_to date, target_firms integer default 5)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with owed as (
    select m.org_id, m.user_id, u.email, pr.email_unsubscribe_token as stop_token,
      coalesce(nullif(btrim(pr.display_name), ''), split_part(u.email, '@', 1)) as name
    from public.memberships m
    join auth.users u on u.id = m.user_id
    join public.profiles pr on pr.id = m.user_id
    left join public.agenda_preferences ap on ap.org_id = m.org_id and ap.user_id = m.user_id
    where coalesce(ap.digest_off, false) = false and u.email is not null and u.email <> ''
      and not exists (select 1 from public.agenda_digests g where g.org_id = m.org_id and g.user_id = m.user_id and g.day = target_day)
  ),
  firms as (
    select o.id, o.name, o.internal_deadline_days, o.internal_deadline_by_act from public.organizations o
    where o.id in (select org_id from owed)
    order by o.id
    limit greatest(target_firms, 1)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'org_id', f.id, 'firm_name', f.name, 'internal_days', f.internal_deadline_days,
    'internal_by_act', f.internal_deadline_by_act,
    'people', (select jsonb_agg(jsonb_build_object('user_id', w.user_id, 'email', w.email, 'name', w.name, 'stop_token', w.stop_token,
                 'whole_firm', public.agenda_whole_firm(f.id, w.user_id)) order by w.user_id)
               from owed w where w.org_id = f.id),
    'items', public.agenda_items(f.id, target_day, target_to)
  ) order by f.id), '[]'::jsonb)
  from firms f;
$$;

revoke all on function public.agenda_digests_owed(date, date, integer) from public, anon, authenticated;
grant execute on function public.agenda_digests_owed(date, date, integer) to service_role;

/** The calendar of a link (0132), with the internal days of each act the firm set (0167). */
create or replace function public.agenda_calendar_feed(target_hash text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'org_id', ap.org_id, 'user_id', ap.user_id,
    'whole_firm', public.agenda_whole_firm(ap.org_id, ap.user_id),
    'internal_days', o.internal_deadline_days,
    'internal_by_act', o.internal_deadline_by_act
  ) || public.agenda_items(ap.org_id, (now() at time zone 'America/Sao_Paulo')::date - 30,
                           (now() at time zone 'America/Sao_Paulo')::date + 180)
  from public.agenda_preferences ap
  join public.organizations o on o.id = ap.org_id
  where target_hash ~ '^[0-9a-f]{64}$' and ap.calendar_hash = target_hash;
$$;

revoke all on function public.agenda_calendar_feed(text) from public, anon, authenticated;
grant execute on function public.agenda_calendar_feed(text) to service_role;
