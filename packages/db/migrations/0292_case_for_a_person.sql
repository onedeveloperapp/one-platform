-- ============================================================
-- 0292_case_for_a_person: a case a person of the firm opens, for somebody the firm already has, or of an area of the
-- firm (the owner, 2026-11-25).
--
-- "é possível o próprio escritório iniciar um caso para uma nova ou pessoa já cadastrada?", then "e se o caso não for
-- relacionado ao módulo? vai permitir seguir?". Three things the answer found:
--
-- 1. `create_case` (0022) took a client the firm already had, by the CPF typed or read, and wrote over their record
--    every field of the panel: a phone or an e-mail left blank erased the ones the record had (the client's notices
--    of their lawsuit go to that phone), and the name typed replaced the one on record. What was typed now only fills
--    what a known person's record lacks; a person's data are changed on their case, where they are read and checked
--    (`case_client_person`, one rule for both ways below).
-- 2. Nothing opened a case for a person of the firm from their page: the firm typed them again, or sent their identity
--    again, and without the CPF a second person of the same name was made. `create_case` takes the person
--    (`target_person`), of the firm and not erased.
-- 3. A case of an area of the firm (0274) was opened only by ONE, at the end of the WhatsApp triage. A person of the
--    firm opens one too (`create_area_case`): of an area no module serves, under its script in force, of a kind of case
--    the script lists, with the work outside the lawsuit its script gives; the documents are the kind's, asked on the
--    client's link as for the case ONE opens.
-- ============================================================

-- ---------- 1. The client of a case a person opens ----------

/**
 * The client of a case a person of the firm opens (0292): the person of the firm it was opened from, the one the firm
 * already has with the CPF typed or read, or a new one. What was typed only fills what a known person's record lacks:
 * a field left blank, or one the record already holds, is left as it is. Raises `person_not_found` or a field's code
 * (P0001, the field in the detail). Internal.
 */
create or replace function public.case_client_person(
  target_org uuid,
  target_person uuid,
  target_client jsonb,
  target_caller uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  client jsonb := coalesce(target_client, '{}'::jsonb);
  typed_cpf text := nullif(regexp_replace(coalesce(client ->> 'cpf', ''), '\D', '', 'g'), '');
  known public.people%rowtype;
  person uuid;
  fields jsonb;
  applied jsonb;
begin
  if target_person is not null then
    select p.id into person from public.people p
    where p.id = target_person and p.org_id = target_org and p.erased_at is null;
    if person is null then
      raise exception using errcode = 'P0001', message = 'person_not_found', detail = '';
    end if;
    return person;
  end if;

  -- A client the firm already has, by CPF, is the same person.
  if typed_cpf is not null then
    select * into known from public.people p where p.org_id = target_org and p.cpf = typed_cpf;
  end if;
  if known.id is null then
    insert into public.people (org_id, full_name, created_by)
    values (target_org, left(regexp_replace(btrim(client ->> 'full_name'), '\s+', ' ', 'g'), 200), target_caller)
    returning id into person;
    fields := client;
  else
    person := known.id;
    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into fields
    from jsonb_each(client) e
    where jsonb_typeof(e.value) = 'string' and btrim(e.value #>> '{}') <> ''
      and nullif(btrim(coalesce(to_jsonb(known) ->> e.key, '')), '') is null;
  end if;

  applied := public.apply_person_fields(person, fields, 'firm');
  if not (applied ->> 'ok')::boolean then
    raise exception using errcode = 'P0001', message = applied ->> 'code', detail = coalesce(applied ->> 'field', '');
  end if;
  return person;
end;
$$;

revoke all on function public.case_client_person(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

-- ---------- 2. A case of a module, for somebody new or a person of the firm ----------

drop function public.create_case(uuid, text, text, date, jsonb, text, text);

/**
 * Opens a case of the module (0022): what happened, with which airline and when, and its client, a person of the
 * firm (`target_person`, 0292) or the one the panel gives (only the name is needed; a CPF the firm has is that
 * person, whose record keeps what it holds).
 */
create function public.create_case(
  target_org uuid,
  target_incident text,
  target_airline text,
  target_flight_date date,
  target_client jsonb,
  target_origin text default null,
  target_summary text default null,
  target_person uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  next_seq integer;
  new_case uuid;
  person uuid;
  party uuid;
  client jsonb := coalesce(target_client, '{}'::jsonb);
  failed_field text;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_incident is null or target_incident not in (
    'delay', 'cancellation', 'overbooking', 'missed_connection', 'downgrade',
    'baggage_lost', 'baggage_damaged', 'baggage_delayed', 'other'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_incident', 'field', 'incident');
  end if;
  if target_airline is not null and not exists (select 1 from public.airlines a where a.iata = target_airline and a.active) then
    return jsonb_build_object('ok', false, 'code', 'unknown_airline', 'field', 'airline');
  end if;
  if target_flight_date is not null and (target_flight_date < date '2000-01-01' or target_flight_date > current_date + 400) then
    return jsonb_build_object('ok', false, 'code', 'invalid_flight_date', 'field', 'flight_date');
  end if;
  if target_origin is not null and target_origin not in ('agency', 'referral', 'ads', 'organic', 'returning_client', 'other') then
    return jsonb_build_object('ok', false, 'code', 'invalid_origin', 'field', 'origin');
  end if;
  if target_person is null
     and (jsonb_typeof(client) <> 'object' or char_length(btrim(coalesce(client ->> 'full_name', ''))) < 3) then
    return jsonb_build_object('ok', false, 'code', 'invalid_name', 'field', 'full_name');
  end if;

  begin
    -- One number at a time per firm. `no key update`: two cases being opened still wait for each other,
    -- while a row that only points at the firm (a message that arrives, an event of another case) is
    -- never held behind them, however many cases one call opens (the import of a portfolio, 0032).
    perform 1 from public.organizations where id = target_org for no key update;
    select coalesce(max(c.seq), 0) + 1 into next_seq from public.cases c where c.org_id = target_org;

    insert into public.cases (org_id, seq, incident, airline_iata, flight_date, origin, summary, created_by)
    values (target_org, next_seq, target_incident, target_airline, target_flight_date, target_origin,
            nullif(left(btrim(coalesce(target_summary, '')), 4000), ''), caller)
    returning id into new_case;

    person := public.case_client_person(target_org, target_person, client, caller);

    insert into public.case_parties (org_id, case_id, person_id, role)
    values (target_org, new_case, person, 'claimant')
    returning id into party;

    perform public.record_case_event(target_org, new_case, 'created', 'person',
      jsonb_build_object('seq', next_seq, 'incident', target_incident));
  exception when sqlstate 'P0001' then
    get stacked diagnostics failed_field = pg_exception_detail;
    return jsonb_build_object('ok', false, 'code', sqlerrm, 'field', nullif(failed_field, ''));
  end;

  return jsonb_build_object('ok', true, 'code', 'created', 'case_id', new_case, 'seq', next_seq,
                            'person_id', person, 'party_id', party);
end;
$$;

revoke all on function public.create_case(uuid, text, text, date, jsonb, text, text, uuid) from public, anon;
grant execute on function public.create_case(uuid, text, text, date, jsonb, text, text, uuid) to authenticated;

-- ---------- 3. A case of an area of the firm, opened by a person ----------

/**
 * Opens a case of an area of the firm (0274) by a person of the firm: an area no module serves, not taken out, under
 * its script in force, of a kind of case the script lists, with its client as `create_case` takes one, and the work
 * outside the lawsuit the script gives that kind. The documents are the kind's, asked on the client's link.
 */
create or replace function public.create_area_case(
  target_org uuid,
  target_area uuid,
  target_type text,
  target_client jsonb,
  target_person uuid default null,
  target_origin text default null,
  target_summary text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  area public.firm_areas%rowtype;
  script public.firm_area_scripts%rowtype;
  next_seq integer;
  new_case uuid;
  person uuid;
  party uuid;
  client jsonb := coalesce(target_client, '{}'::jsonb);
  failed_field text;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select a.* into area from public.firm_areas a
  left join public.law_areas l on l.key = a.law_area
  where a.id = target_area and a.org_id = target_org and a.removed_at is null and l.module is null;
  if area.id is null then
    return jsonb_build_object('ok', false, 'code', 'area_not_found', 'field', 'area');
  end if;
  select * into script from public.firm_area_scripts s where s.id = public.area_script_in_force(area.id);
  if script.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_area_script', 'field', 'area');
  end if;
  if target_type is null or not exists (
    select 1 from jsonb_array_elements(coalesce(script.script -> 'tipos', '[]'::jsonb)) t where t ->> 'chave' = target_type
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_case_type', 'field', 'case_type');
  end if;
  if target_origin is not null and target_origin not in ('agency', 'referral', 'ads', 'organic', 'returning_client', 'other') then
    return jsonb_build_object('ok', false, 'code', 'invalid_origin', 'field', 'origin');
  end if;
  if target_person is null
     and (jsonb_typeof(client) <> 'object' or char_length(btrim(coalesce(client ->> 'full_name', ''))) < 3) then
    return jsonb_build_object('ok', false, 'code', 'invalid_name', 'field', 'full_name');
  end if;

  begin
    perform 1 from public.organizations where id = target_org for no key update;
    select coalesce(max(c.seq), 0) + 1 into next_seq from public.cases c where c.org_id = target_org;

    insert into public.cases (org_id, seq, module, incident, area_id, area_script_id, case_type, origin, summary, created_by)
    values (target_org, next_seq, null, null, area.id, script.id, target_type, target_origin,
            nullif(left(btrim(coalesce(target_summary, '')), 4000), ''), caller)
    returning id into new_case;

    person := public.case_client_person(target_org, target_person, client, caller);

    insert into public.case_parties (org_id, case_id, person_id, role)
    values (target_org, new_case, person, 'claimant')
    returning id into party;

    perform public.record_case_event(target_org, new_case, 'created', 'person',
      jsonb_build_object('seq', next_seq, 'area', area.name, 'case_type', target_type, 'script_version', script.version));
    -- The work outside the lawsuit of its kind of case, from its script.
    perform public.case_tasks_from_script(new_case);
  exception when sqlstate 'P0001' then
    get stacked diagnostics failed_field = pg_exception_detail;
    return jsonb_build_object('ok', false, 'code', sqlerrm, 'field', nullif(failed_field, ''));
  end;

  return jsonb_build_object('ok', true, 'code', 'created', 'case_id', new_case, 'seq', next_seq,
                            'person_id', person, 'party_id', party);
end;
$$;

revoke all on function public.create_area_case(uuid, uuid, text, jsonb, uuid, text, text) from public, anon;
grant execute on function public.create_area_case(uuid, uuid, text, jsonb, uuid, text, text) to authenticated;
