-- ============================================================
-- 0144_deadline_portal_day: a term of a publication runs from the earlier of
-- the two intimations (rule `prazo-v2`, `@flyee/rules/deadlines`).
--
-- A court's act often reaches the lawyer twice: published in the DJEN, and
-- intimated in the court's own system, where it is made on the day the lawyer
-- read it, the next business day when read on a day with none, or on the tenth
-- day when unread (Lei nº 11.419/2006, art. 5º, §§ 1º to 3º). Which one a term
-- runs from is the STJ's Tema 1.180, whose thesis is not taken as settled: the
-- count runs from the earlier of the two, which never puts a deadline later
-- than it is, and says so (`portal_first`).
--
-- The day of the intimation in the system is a person's word, for now
-- (`deadlines.portal_on`, `set_deadline_portal_day`): who signs or runs the
-- firm's deadlines gives it on a deadline of a publication, and the deadline
-- is counted again and goes back to be confirmed, as any change of what it is
-- counted from. The backend hands it to the rule (`deadline_to_count`).
-- Reading it from the course of the lawsuit waits for the real titles of the
-- court's movements.
-- ============================================================

alter table public.deadlines add column portal_on date;

-- A count may say the system intimated first, and its day may then be earlier than the publication's.
alter table public.deadlines drop constraint deadlines_assumptions_check;
alter table public.deadlines add constraint deadlines_assumptions_check check (assumptions <@ array[
  'calendar_unchecked', 'comarca_unknown', 'local_days_unchecked', 'scope_unknown', 'partial_start',
  'start_not_business', 'djen_before_rule', 'calendar_suspension', 'portal_first'
]::text[]);
alter table public.deadlines drop constraint deadlines_due_check;
alter table public.deadlines add constraint deadlines_due_check check (
  due_on is null or due_on >= least(trigger_on, case when trigger = 'publication' then portal_on end)
);
alter table public.deadlines add constraint deadlines_portal_check check (
  portal_on is null or portal_on between date '2019-01-01' and date '2100-12-31'
);

/**
 * What the count of a deadline came to (0034), taking a start earlier than
 * the publication when the court's own system intimated the act first.
 */
create or replace function public.record_deadline_count(
  target_deadline uuid,
  target_claim integer,
  target_revision integer,
  target_outcome text,
  target_result jsonb default null,
  target_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_deadline public.deadlines%rowtype;
  tries integer := greatest(public.deadlines_setting('max_attempts', 3), 1);
  pause integer := greatest(public.deadlines_setting('retry_minutes', 10), 1);
  code text := coalesce(substring(lower(coalesce(target_code, '')) from '^[a-z][a-z0-9_]{1,59}'), 'failed');
  outcome text := target_outcome;
  due date;
  starts date;
  published date;
  codes text[];
  used_court text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_outcome is null or target_outcome not in ('counted', 'retry', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;
  select * into current_deadline from public.deadlines where id = target_deadline for update;
  if not found or current_deadline.count_claimed_at is null or current_deadline.count_claims is distinct from target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if target_revision is distinct from current_deadline.revision or current_deadline.status not in ('proposed', 'confirmed') then
    -- Counted from what is no longer so: the try does not count, and the deadline waits for its next count.
    update public.deadlines set count_claimed_at = null, count_attempts = greatest(count_attempts - 1, 0)
    where id = current_deadline.id;
    return jsonb_build_object('ok', true, 'code', 'changed');
  end if;

  if outcome = 'counted' then
    begin
      if jsonb_typeof(target_result) is distinct from 'object'
         or coalesce(target_result ->> 'rule', '') !~ '^prazo-v[0-9]{1,3}$'
         or (target_result ->> 'days')::integer is distinct from current_deadline.days
         or target_result ->> 'trigger' is distinct from current_deadline.trigger
         or target_result ->> 'counting' is distinct from current_deadline.counting
         or (target_result ->> 'triggerDay')::date is distinct from current_deadline.trigger_on
         or jsonb_typeof(target_result -> 'assumptions') is distinct from 'array'
         or jsonb_typeof(target_result -> 'skipped') is distinct from 'array'
         or octet_length(target_result::text) > 32000 then
        raise exception 'invalid_result' using errcode = '22023';
      end if;
      due := (target_result ->> 'dueOn')::date;
      starts := (target_result ->> 'startsOn')::date;
      published := (target_result ->> 'publishedOn')::date;
      -- A term may start before the publication when the system intimated the act first (0144).
      if due is null or starts is null or due < starts
         or starts <= least(current_deadline.trigger_on,
              case when current_deadline.trigger = 'publication' then current_deadline.portal_on end)
         or (current_deadline.trigger = 'publication') <> (published is not null) then
        raise exception 'invalid_result' using errcode = '22023';
      end if;
      select coalesce(array_agg(distinct a ->> 'code'), '{}') into codes
      from jsonb_array_elements(target_result -> 'assumptions') a;
      used_court := target_result #>> '{place,court}';
      if used_court is not null and used_court !~ '^[A-Z0-9-]{2,12}$' then
        raise exception 'invalid_result' using errcode = '22023';
      end if;
      update public.deadlines set
        computed_revision = revision,
        rule_version = target_result ->> 'rule',
        published_on = published,
        starts_on = starts,
        computed_due_on = due,
        explanation = target_result,
        assumptions = codes,
        computed_at = now(),
        court = coalesce(used_court, court),
        count_claimed_at = null,
        count_attempts = 0,
        count_retry_after = null,
        count_error = null,
        due_on = case when status = 'proposed' then due else due_on end
      where id = current_deadline.id;
      -- The firm lets ONE confirm its deadlines (0016, `deadline_confirm`): one still waiting for confirmation
      -- is confirmed on the day the rule counted, which is the earlier day wherever the rule could not know.
      if current_deadline.status = 'proposed'
         and public.firm_autonomy_mode(current_deadline.org_id, 'deadline_confirm') = 'auto' then
        perform public.confirm_deadline_unattended(current_deadline.id);
      end if;
      return jsonb_build_object('ok', true, 'code', 'counted', 'due_on', due);
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
                    or invalid_parameter_value or check_violation or numeric_value_out_of_range then
      outcome := 'failed';
      code := 'invalid_result';
    end;
  end if;

  if outcome = 'retry' and current_deadline.count_attempts >= tries then
    outcome := 'failed';
  end if;
  update public.deadlines set
    count_claimed_at = null,
    count_retry_after = case when outcome = 'retry' then now() + make_interval(mins => pause * greatest(count_attempts, 1)) end,
    -- A final failure spends the attempts: the sweep does not pick it again until something changes.
    count_attempts = case when outcome = 'failed' then tries else count_attempts end,
    count_error = code
  where id = current_deadline.id;
  return jsonb_build_object('ok', true, 'code', outcome);
end;
$$;

revoke all on function public.record_deadline_count(uuid, integer, integer, text, jsonb, text) from public, anon, authenticated;

/**
 * Who signs or runs the firm's deadlines gives, or takes back, the day the
 * act of a deadline's publication was intimated in the court's own system.
 * Only for a deadline that runs from its publication, open, of a day from 30
 * days before the publication was made available to today; never a support
 * visit. A new day sends the deadline back to be counted and confirmed.
 */
create or replace function public.set_deadline_portal_day(target_deadline uuid, target_day date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_deadline public.deadlines%rowtype := public.deadline_for_writer(target_deadline);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if current_deadline.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.has_firm_function(current_deadline.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if current_deadline.status not in ('proposed', 'confirmed') then
    return jsonb_build_object('ok', false, 'code', 'closed');
  end if;
  if current_deadline.trigger <> 'publication' or current_deadline.publication_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'portal_on');
  end if;
  if target_day is not null and (target_day > today or target_day < current_deadline.trigger_on - 30) then
    return jsonb_build_object('ok', false, 'code', 'invalid_day', 'field', 'portal_on');
  end if;
  if target_day is not distinct from current_deadline.portal_on then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;

  update public.deadlines set
    portal_on = target_day,
    revision = revision + 1,
    count_attempts = 0,
    count_error = null,
    count_retry_after = null,
    status = 'proposed',
    due_on = null,
    corrected = false,
    correction_reason = null,
    confirmed_against = null,
    confirmed_revision = null,
    confirmed_by = null,
    confirmed_auto = false,
    confirmed_at = null
  where id = current_deadline.id;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_deadline.org_id, auth.uid(), 'deadline.portal_day', 'deadline', current_deadline.id::text,
    jsonb_build_object('day', target_day, 'was_confirmed', current_deadline.status = 'confirmed'));
  if current_deadline.case_id is not null then
    perform public.record_case_event(current_deadline.org_id, current_deadline.case_id, 'deadline_updated', 'person',
      jsonb_build_object('deadline', current_deadline.id));
  end if;
  return jsonb_build_object('ok', true, 'code', 'set');
end;
$$;

revoke all on function public.set_deadline_portal_day(uuid, date) from public, anon;
grant execute on function public.set_deadline_portal_day(uuid, date) to authenticated;

-- What the backend counts a deadline from (0034), with the day of the intimation in the system for a term of a publication.
create or replace function public.deadline_to_count(target_deadline uuid, target_claim integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_deadline public.deadlines%rowtype;
  lawsuit public.proceedings%rowtype;
  court_code text;
  first_year integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into current_deadline from public.deadlines d
  where d.id = target_deadline and d.count_claimed_at is not null and d.count_claims = target_claim;
  if not found then
    return null;
  end if;
  if current_deadline.proceeding_id is not null then
    select * into lawsuit from public.proceedings p where p.id = current_deadline.proceeding_id;
  end if;
  court_code := coalesce(lawsuit.court, current_deadline.court);
  -- The calendar from the year of the earlier start: an intimation in the system may come before the publication.
  first_year := extract(year from least(current_deadline.trigger_on,
    case when current_deadline.trigger = 'publication' then current_deadline.portal_on end))::integer;
  return jsonb_build_object(
    'id', current_deadline.id,
    'org_id', current_deadline.org_id,
    'claim', current_deadline.count_claims,
    'revision', current_deadline.revision,
    'trigger', current_deadline.trigger,
    'trigger_on', current_deadline.trigger_on,
    'days', current_deadline.days,
    'counting', current_deadline.counting,
    'portal_on', case when current_deadline.trigger = 'publication' then current_deadline.portal_on end,
    'court', court_code,
    'place', jsonb_build_object('proceeding_kind', lawsuit.kind, 'system', lawsuit.system, 'comarca', lawsuit.comarca)
  ) || public.court_calendar(court_code, first_year);
end;
$$;

revoke all on function public.deadline_to_count(uuid, integer) from public, anon, authenticated;
grant execute on function public.deadline_to_count(uuid, integer) to service_role;
