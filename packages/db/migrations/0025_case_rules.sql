-- ============================================================
-- 0025_case_rules: what the rules of the domain need from the database.
--
-- The rules are code (`packages/rules`): the forum, the kind of proceeding,
-- the Tema 1.417 triage, the count of a lawyer's causes per state. What
-- they decide on is data, kept here:
--
--   minimum_wages        the national minimum wage from the day each act set
--                        it (2023 had two): the small-claims court's ceiling
--                        is forty of them;
--   case_parties         what is asked for each claimant (`claim_cents`);
--   cases                what the airline told the passenger was the cause,
--                        the triage the rule gave (with its version) and the
--                        firm's decision: file now, or hold;
--   case_weather         the weather reports of the airports of the trip,
--                        read from REDEMET by the backend: evidence, kept as
--                        published, with the signs the rule found in them;
--   airports             the offset of each Brazilian airport's local time,
--                        to ask the reports around the flight's own hours;
--   firm_causes_by_state the count per lawyer and state, for the warning of
--                        a supplementary registration at the bar;
--   cases                how a family with a minor goes to court
--                        (`family_choice`): together in the civil court, or
--                        split, a lawyer's choice with its reason;
--   court_notes          what the platform read of how each court decides a
--                        family split, said to the lawyer who chooses one;
--   civil_court_answers  each claimant's word on going to the civil court (for
--                        a minor, who answers for them), in the words shown.
--
-- The checks of the forum, of a minor in the small-claims court and of a
-- family split nobody chose are in `save_proceeding` (0022), where a lawsuit
-- is written; what blocks a filing (a family split nobody chose, a claimant
-- whose word on the civil court is not a yes, `filing_blocker`) is asked when
-- a package is requested (0036) and again when its receipt is attached (0027).
-- ============================================================

-- ---------- The minimum wage ----------

create table public.minimum_wages (
  -- The day it took effect; it holds until the next one.
  valid_from date primary key,
  cents bigint not null,
  -- The act that set it: what a person checks it against.
  act text not null,
  constraint minimum_wages_day_check check (valid_from between date '1995-01-01' and date '2100-01-01'),
  constraint minimum_wages_cents_check check (cents > 0),
  constraint minimum_wages_act_check check (char_length(btrim(act)) between 4 and 200)
);

alter table public.minimum_wages enable row level security;
create policy "minimum_wages_select_all" on public.minimum_wages for select to authenticated using (true);
grant select on table public.minimum_wages to authenticated;

insert into public.minimum_wages (valid_from, cents, act) values
  (date '2022-01-01', 121200, 'Medida Provisória 1.091/2021'),
  (date '2023-01-01', 130200, 'Medida Provisória 1.143/2022'),
  (date '2023-05-01', 132000, 'Medida Provisória 1.172/2023, convertida na Lei 14.663/2023'),
  (date '2024-01-01', 141200, 'Decreto 11.864/2023'),
  (date '2025-01-01', 151800, 'Decreto 12.342/2024'),
  (date '2026-01-01', 162100, 'Decreto 12.797/2025')
on conflict (valid_from) do nothing;

insert into public.platform_settings (key, value, is_public) values
  -- How many minimum wages make the small-claims court's ceiling (Lei 9.099/1995, art. 3, I).
  ('small_claims', jsonb_build_object('ceiling_minimum_wages', 40), true),
  -- What makes a weather sign in a report, and the hours around the flight the reports are read for.
  ('tema_1417', jsonb_build_object(
    'visibility_below_meters', 1500,
    'ceiling_below_feet', 500,
    'gust_above_knots', 35,
    'hours_before', 3,
    'hours_after', 3,
    -- How long a case waits before its reports may be read again (the key is the platform's).
    'read_cooldown_minutes', 10
  ), true)
on conflict (key) do nothing;

-- ---------- What each claimant asks ----------

alter table public.case_parties add column claim_cents bigint;
alter table public.case_parties add constraint case_parties_claim_check
  check (claim_cents is null or (role = 'claimant' and claim_cents between 1 and 100000000000));

/** What is asked for one claimant of the case, in centavos; null clears it. A person of the firm, never a support visit. */
create or replace function public.set_party_claim(target_case uuid, target_party uuid, target_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
begin
  if target_cents is not null and (target_cents < 1 or target_cents > 100000000000) then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount', 'field', 'claim');
  end if;
  update public.case_parties set claim_cents = target_cents
  where id = target_party and case_id = current_case.id and role = 'claimant';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'party_not_found');
  end if;
  perform public.record_case_event(current_case.org_id, current_case.id, 'claim_set', 'person',
    jsonb_build_object('party', target_party));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_party_claim(uuid, uuid, bigint) from public, anon;
grant execute on function public.set_party_claim(uuid, uuid, bigint) to authenticated;

-- ---------- The Tema 1.417 triage ----------

-- What the airline told the passenger was the cause (the questionnaire), the
-- triage the rule gave on it (written by the backend, which runs the rule),
-- and the firm's decision.
alter table public.cases add column airline_stated_cause text;
alter table public.cases add column suspension_triage jsonb;
-- What was asked of REDEMET the last time the reports were read, and when a
-- read was last asked for (a case waits a while before the next one).
alter table public.cases add column weather_read jsonb;
alter table public.cases add column weather_requested_at timestamptz;
-- pending  nobody decided yet;
-- file     the firm files now;
-- hold     the firm holds it while the suspension lasts.
alter table public.cases add column suspension_decision text not null default 'pending';
alter table public.cases add column suspension_decided_by uuid references public.profiles (id) on delete set null;
alter table public.cases add column suspension_decided_at timestamptz;
-- Decided by ONE from the triage, where the firm lets it (0016, `file_or_hold`): decided again by each new
-- triage until a person decides.
alter table public.cases add column suspension_decided_auto boolean not null default false;
alter table public.cases add constraint cases_stated_cause_check check (airline_stated_cause is null or airline_stated_cause in (
  'weather', 'airport_infrastructure', 'authority', 'pandemic', 'maintenance', 'crew', 'network', 'overbooking',
  'none_given', 'other'
));
alter table public.cases add constraint cases_suspension_triage_check check (
  suspension_triage is null or (
    jsonb_typeof(suspension_triage) = 'object'
    and suspension_triage ->> 'risk' in ('high', 'medium', 'low', 'out_of_scope', 'unknown')
    and jsonb_typeof(suspension_triage -> 'grounds') = 'array'
    and coalesce(suspension_triage ->> 'rule', '') ~ '^[a-z0-9.-]{3,40}$'
    and octet_length(suspension_triage::text) <= 2000
  )
);
alter table public.cases add constraint cases_suspension_decision_check
  check (suspension_decision in ('pending', 'file', 'hold'));

/**
 * The firm's part of the triage: what the airline said was the cause (anybody
 * of the firm writes it down), and the decision, file now or hold, which is
 * a lawyer's (a partner or a lawyer of the firm). A decision left out stays
 * as it is, so a screen opened earlier never undoes a colleague's. Never
 * from a support visit. What the rule answers is not written here: the
 * backend runs the rule and records it (`record_suspension_triage`).
 */
create or replace function public.save_suspension(
  target_case uuid,
  target_stated_cause text,
  target_decision text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  stated text := nullif(btrim(coalesce(target_stated_cause, '')), '');
  decision text := nullif(btrim(coalesce(target_decision, '')), '');
  decides boolean;
begin
  if stated is not null and stated not in (
    'weather', 'airport_infrastructure', 'authority', 'pandemic', 'maintenance', 'crew', 'network', 'overbooking',
    'none_given', 'other'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'stated_cause');
  end if;
  if decision is not null and decision not in ('pending', 'file', 'hold') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'decision');
  end if;
  -- A decision a lawyer gives over one ONE took is theirs, even of the same value: ONE decides no more.
  decides := decision is not null
    and (decision is distinct from current_case.suspension_decision or current_case.suspension_decided_auto
         or current_case.suspension_decided_at is null);
  if decides and not public.has_firm_function(current_case.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_a_lawyer', 'field', 'decision');
  end if;
  update public.cases set
    airline_stated_cause = stated,
    suspension_decision = case when decides then decision else suspension_decision end,
    suspension_decided_by = case when decides then auth.uid() else suspension_decided_by end,
    suspension_decided_at = case when decides then now() else suspension_decided_at end,
    suspension_decided_auto = case when decides then false else suspension_decided_auto end
  where id = current_case.id;
  perform public.record_case_event(current_case.org_id, current_case.id, 'suspension_saved', 'person',
    jsonb_strip_nulls(jsonb_build_object('decision', case when decides then decision end)));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.save_suspension(uuid, text, text) from public, anon;
grant execute on function public.save_suspension(uuid, text, text) to authenticated;

-- Deciding to file now or to hold while the national suspension lasts is ONE's by default, from the rule's
-- triage: a high risk holds, a medium or low one or a case out of its scope files, and a risk the rule could not
-- tell decides nothing. A firm may have a partner or a lawyer decide every case.
insert into public.autonomy_decisions (key, position, modes) values
  ('file_or_hold', 50, array['auto', 'approval'])
on conflict (key) do nothing;

/**
 * What the rule answered for the case (`@flyee/rules/suspension`, with its
 * version), written by the backend that ran it on what the database holds:
 * a person can never write a triage. Where the firm lets ONE decide to file
 * or to hold, the triage decides it (a high risk holds, anything else
 * files), again at each new triage, until a person decides. Service role
 * only.
 */
create or replace function public.record_suspension_triage(target_case uuid, target_triage jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  decided text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  begin
    update public.cases
    set suspension_triage = case when target_triage is null then null else target_triage || jsonb_build_object('at', now()) end
    where id = target_case
    returning * into current_case;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end;
  if current_case.id is null then
    return jsonb_build_object('ok', false, 'code', 'case_not_found');
  end if;
  -- ONE decides while no person did (a person who set it back to pending decided too).
  if (current_case.suspension_decided_at is null or current_case.suspension_decided_auto)
     and public.firm_autonomy_mode(current_case.org_id, 'file_or_hold') = 'auto' then
    -- A high risk holds; a risk the rule could not tell, or no triage, decides nothing.
    decided := case current_case.suspension_triage ->> 'risk'
      when 'high' then 'hold'
      when 'medium' then 'file'
      when 'low' then 'file'
      when 'out_of_scope' then 'file'
      else 'pending'
    end;
    if decided is distinct from current_case.suspension_decision then
      update public.cases set
        suspension_decision = decided,
        suspension_decided_by = null,
        suspension_decided_at = case when decided = 'pending' then null else now() end,
        suspension_decided_auto = decided <> 'pending'
      where id = current_case.id;
      perform public.record_case_event(current_case.org_id, current_case.id, 'suspension_saved', 'system',
        jsonb_build_object('decision', decided, 'auto', true));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.record_suspension_triage(uuid, jsonb) from public, anon, authenticated;

-- ---------- Where an airport is ----------

-- The municipality an airport sits in, when it is not the city it serves (the
-- city of the reference data, OurAirports): where a fact at the airport
-- happened, so a forum of the place of the fact can be there. Seeded for the
-- large airports where the two differ; null means the same city.
alter table public.airports add column municipality text;
alter table public.airports add constraint airports_municipality_check
  check (municipality is null or char_length(btrim(municipality)) between 2 and 120);
update public.airports a set municipality = m.name
from (values
  ('GRU', 'Guarulhos'),
  ('CNF', 'Confins'),
  ('CWB', 'São José dos Pinhais'),
  ('NAT', 'São Gonçalo do Amarante'),
  ('CGB', 'Várzea Grande'),
  ('MCZ', 'Rio Largo'),
  ('JPA', 'Bayeux')
) as m (iata, name)
where a.iata = m.iata;

-- ---------- The weather of the trip ----------

-- The offset of the local time of each Brazilian airport, by its state (no
-- daylight saving since 2019). Western Amazonas keeps Acre's time: the
-- part of the state west of the line of Lei nº 12.876/2013, from Tabatinga
-- to Porto Acre. None of the airports seeded lies there (Tabatinga is on
-- the line, and keeps Manaus's time); of the airports with an IATA code,
-- only Eirunepé's does, and it is set should it join (worked out from
-- OurAirports' coordinates on 2026-10-10).
alter table public.airports add column utc_offset_minutes integer;
alter table public.airports add constraint airports_offset_check
  check (utc_offset_minutes is null or utc_offset_minutes between -720 and 840);
update public.airports set utc_offset_minutes = case
    when iata = 'FEN' then -120
    when uf = 'AC' or iata = 'ERN' then -300
    when uf in ('AM', 'MT', 'MS', 'RO', 'RR') then -240
    else -180
  end
where country = 'BR';

create table public.case_weather (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  icao text not null,
  observed_at timestamptz not null,
  -- The report as REDEMET published it.
  raw text not null,
  -- What `@flyee/rules/weather` found in it, under the thresholds of the moment.
  signs text[] not null default '{}',
  source text not null default 'redemet',
  read_at timestamptz not null default now(),
  unique (case_id, icao, observed_at),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  constraint case_weather_icao_check check (icao ~ '^[A-Z0-9]{4}$'),
  constraint case_weather_raw_check check (char_length(raw) between 8 and 1000),
  constraint case_weather_source_check check (source in ('redemet')),
  constraint case_weather_signs_check check (cardinality(signs) <= 20)
);

create index case_weather_case_idx on public.case_weather (case_id, observed_at);

alter table public.case_weather enable row level security;
create policy "case_weather_select_member" on public.case_weather
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.case_weather to authenticated;
create trigger guard_impersonation_case_weather after insert or update or delete on public.case_weather
  for each statement execute function public.guard_impersonation_readonly();

/**
 * A person of the firm asks for the reports of a case to be read. The
 * database says whether it may happen now: the key is the platform's, so a
 * case waits a while between two reads (the setting's `read_cooldown_minutes`).
 * Never from a support visit.
 */
create or replace function public.begin_case_weather_read(target_case uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  minutes integer := greatest(coalesce(
    (select (s.value ->> 'read_cooldown_minutes')::integer from public.platform_settings s where s.key = 'tema_1417'), 10), 0);
begin
  if current_case.weather_requested_at > now() - make_interval(mins => minutes) then
    return jsonb_build_object('ok', false, 'code', 'weather_cooldown');
  end if;
  update public.cases set weather_requested_at = now() where id = current_case.id;
  return jsonb_build_object('ok', true, 'code', 'started');
end;
$$;

revoke all on function public.begin_case_weather_read(uuid) from public, anon;
grant execute on function public.begin_case_weather_read(uuid) to authenticated;

/**
 * A read that was allowed and then failed (REDEMET did not answer) gives the
 * wait back, so the person may try again at once. The backend only: a person
 * could otherwise undo the wait themselves.
 */
create or replace function public.release_case_weather_read(target_case uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.cases set weather_requested_at = null where id = target_case;
end;
$$;

revoke all on function public.release_case_weather_read(uuid) from public, anon, authenticated;

/**
 * Keeps the reports the backend read for a case: the set read now replaces
 * what was kept (a leg corrected since no longer leaves the wrong day's
 * weather behind), each report once, with the signs found in it, beside what
 * was asked (the airports and their hours), so "read and nothing found" is
 * never taken for "never read". The backend only (the server reads REDEMET
 * with the platform's key, after the person was allowed to ask): a person
 * can never write a report as evidence.
 */
create or replace function public.record_case_weather(target_case uuid, target_observations jsonb, target_windows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  kept integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case for no key update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'case_not_found');
  end if;
  if jsonb_typeof(target_observations) is distinct from 'array' or jsonb_array_length(target_observations) > 500
     or jsonb_typeof(target_windows) is distinct from 'array' or jsonb_array_length(target_windows) > 40
     or octet_length(target_windows::text) > 6000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  begin
    delete from public.case_weather where case_id = current_case.id;
    with given as (
      -- Two messages of the same minute (a correction): the last one handed in stands.
      select distinct on (upper(o.value ->> 'icao'), (o.value ->> 'observed_at')::timestamptz)
        upper(o.value ->> 'icao') as icao, (o.value ->> 'observed_at')::timestamptz as observed_at, o.value ->> 'raw' as raw,
        coalesce(array(select jsonb_array_elements_text(o.value -> 'signs')), '{}') as signs
      from jsonb_array_elements(target_observations) with ordinality as o (value, position)
      order by upper(o.value ->> 'icao'), (o.value ->> 'observed_at')::timestamptz, o.position desc
    ),
    inserted as (
      insert into public.case_weather (org_id, case_id, icao, observed_at, raw, signs)
      select current_case.org_id, current_case.id, g.icao, g.observed_at, g.raw, g.signs from given g
      returning 1
    )
    select count(*) into kept from inserted;
  exception when check_violation or not_null_violation or invalid_text_representation or invalid_datetime_format
              or datetime_field_overflow or unique_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end;
  update public.cases set weather_read = jsonb_build_object('at', now(), 'windows', target_windows)
  where id = current_case.id;
  perform public.record_case_event(current_case.org_id, current_case.id, 'weather_read', 'system',
    jsonb_build_object('count', kept));
  return jsonb_build_object('ok', true, 'code', 'recorded', 'count', kept);
end;
$$;

revoke all on function public.record_case_weather(uuid, jsonb, jsonb) from public, anon, authenticated;

-- ---------- A lawyer's causes per state ----------

/**
 * How many causes each lawyer of the firm signs in each state, in a year:
 * the lawsuits filed that year (`filed`) and the ones still planned
 * (`planned`), by the state of their court. What `@flyee/rules/state-count`
 * weighs against the lawyer's registrations at the bar. Only for a person of
 * the firm; counts, never a case.
 */
create or replace function public.firm_causes_by_state(target_org uuid, target_year integer)
returns table (user_id uuid, uf text, filed integer, planned integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  select pl.user_id, c.uf,
    -- Filed that year: by the day it was filed, or, when nobody wrote it down, by the year in its number.
    count(*) filter (
      where p.status in ('filed', 'closed')
        and coalesce(extract(year from p.filed_at)::integer, substr(p.cnj, 10, 4)::integer) = target_year
    )::integer,
    -- Planned, in a case that still goes ahead.
    count(*) filter (where p.status = 'planned' and k.status not in ('closed', 'declined'))::integer
  from public.proceedings p
  join public.cases k on k.id = p.case_id
  join public.proceeding_lawyers pl on pl.proceeding_id = p.id
  join public.courts c on c.acronym = p.court
  where p.org_id = target_org
  group by pl.user_id, c.uf;
end;
$$;

revoke all on function public.firm_causes_by_state(uuid, integer) from public, anon;
grant execute on function public.firm_causes_by_state(uuid, integer) to authenticated;

-- ---------- The lawsuits the rules plan ----------

/**
 * Creates, at once and under the case's lock, the lawsuits the rules plan for
 * a case that has none (`@flyee/rules/proceedings` and `forum`, run by the
 * app): each one written by `save_proceeding`, with every check it makes,
 * and with the lawyers who sign it when the plan names them (ONE names who
 * the firm set to sign, 0039). All of them, or none: two requests never
 * create them twice, and a lawsuit that is refused leaves no other behind.
 */
create or replace function public.create_planned_proceedings(target_case uuid, target_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  planned jsonb;
  saved jsonb;
  created integer := 0;
begin
  if jsonb_typeof(target_plan) is distinct from 'array' or jsonb_array_length(target_plan) not between 1 and 4 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  if exists (select 1 from public.proceedings p where p.case_id = current_case.id) then
    return jsonb_build_object('ok', false, 'code', 'proceedings_exist');
  end if;
  begin
    for planned in select value from jsonb_array_elements(target_plan) loop
      saved := public.save_proceeding(
        current_case.id, null, coalesce(planned -> 'fields', '{}'::jsonb),
        array(select jsonb_array_elements_text(coalesce(planned -> 'parties', '[]'::jsonb))::uuid),
        array(select jsonb_array_elements_text(coalesce(planned -> 'lawyers', '[]'::jsonb))::uuid)
      );
      if not coalesce((saved ->> 'ok')::boolean, false) then
        raise exception using errcode = 'P0001', message = coalesce(saved ->> 'code', 'failed');
      end if;
      created := created + 1;
    end loop;
  exception
    when sqlstate 'P0001' then
      return jsonb_build_object('ok', false, 'code', sqlerrm);
    when invalid_text_representation then
      return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end;
  return jsonb_build_object('ok', true, 'code', 'created', 'count', created);
end;
$$;

revoke all on function public.create_planned_proceedings(uuid, jsonb) from public, anon;
grant execute on function public.create_planned_proceedings(uuid, jsonb) to authenticated;

-- ---------- The family and the civil court ----------

-- What the rule of the kind decides on for a family with a minor (`@flyee/rules/proceedings`,
-- tipo-de-processo-v2): together, one lawsuit of the whole family in the civil court, which is the default
-- (the owner's decision of 2026-10-14); or split, the small-claims court for the adults who may be there and
-- the civil court for the minors, which is a lawyer's choice, recorded with its reason. Courts have taken the
-- split for abusive fragmentation (`court_notes` below says where), so it is never made by default.
alter table public.cases add column family_choice text not null default 'together';
alter table public.cases add column family_choice_reason text;
alter table public.cases add column family_choice_by uuid references public.profiles (id) on delete set null;
alter table public.cases add column family_choice_at timestamptz;
alter table public.cases add constraint cases_family_choice_check check (
  family_choice in ('together', 'split')
  and (family_choice = 'split') = (family_choice_reason is not null)
  and (family_choice_reason is null or char_length(family_choice_reason) between 8 and 1000)
);

/** Whether a claimant of a case is a minor today: not eighteen yet, or one somebody answers for with no birth date on record. */
create or replace function public.case_party_is_minor(target_party uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case when p.birth_date is null then cp.guardian_id is not null
                else p.birth_date > (now() at time zone 'America/Sao_Paulo')::date - interval '18 years' end
    from public.case_parties cp
    join public.people p on p.id = cp.person_id
    where cp.id = target_party
  ), false);
$$;

revoke all on function public.case_party_is_minor(uuid) from public, anon, authenticated;

/** A case whose family has a minor among its claimants. */
create or replace function public.case_has_minor_claimant(target_case uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.case_parties cp
    where cp.case_id = target_case and cp.role = 'claimant' and public.case_party_is_minor(cp.id)
  );
$$;

revoke all on function public.case_has_minor_claimant(uuid) from public, anon, authenticated;

/**
 * A partner or a lawyer of the firm chooses how a family goes to court:
 * together (the default) or split, with the reason. Before any lawsuit is
 * planned the choice plans them; once some are, it records what they are: a
 * split beside a small-claims lawsuit planned already (adults planned before
 * a minor joined), the family together only with none planned beside its
 * minor. Never from a support visit.
 */
create or replace function public.set_family_choice(target_case uuid, target_choice text, target_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  choice text := nullif(btrim(coalesce(target_choice, '')), '');
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
begin
  if not public.has_firm_function(current_case.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_a_lawyer');
  end if;
  if choice is null or choice not in ('together', 'split') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'choice');
  end if;
  if choice = 'together' then
    reason := null;
  elsif reason is null or char_length(reason) not between 8 and 1000 then
    return jsonb_build_object('ok', false, 'code', 'family_reason_required', 'field', 'reason');
  end if;
  if choice = current_case.family_choice and reason is not distinct from current_case.family_choice_reason then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  -- With lawsuits planned, the choice says what they are: a split is recorded only beside a small-claims
  -- lawsuit planned already, and the family is put back together only with none planned beside its minor.
  if exists (select 1 from public.proceedings p where p.case_id = current_case.id and p.status = 'planned') and (
    (choice = 'split' and not exists (
      select 1 from public.proceedings p
      where p.case_id = current_case.id and p.status = 'planned' and p.kind = 'juizado'
    ))
    or (choice = 'together' and public.case_has_minor_claimant(current_case.id) and exists (
      select 1 from public.proceedings p
      where p.case_id = current_case.id and p.status = 'planned' and p.kind = 'juizado'
    ))
  ) then
    return jsonb_build_object('ok', false, 'code', 'proceedings_planned');
  end if;
  update public.cases set
    family_choice = choice,
    family_choice_reason = reason,
    family_choice_by = auth.uid(),
    family_choice_at = now()
  where id = current_case.id;
  perform public.record_case_event(current_case.org_id, current_case.id, 'family_choice_saved', 'person',
    jsonb_build_object('choice', choice));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_family_choice(uuid, text, text) from public, anon;
grant execute on function public.set_family_choice(uuid, text, text) to authenticated;

/** Whether the sources of a court's note are sources: each a label and an address on the web. */
create or replace function public.court_note_sources_ok(sources jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(sources) = 'array'
    and jsonb_array_length(sources) between 1 and 10
    and octet_length(sources::text) <= 4000
    and not exists (
      select 1 from jsonb_array_elements(sources) as item
      where jsonb_typeof(item) <> 'object'
         or char_length(btrim(coalesce(item ->> 'label', ''))) not between 3 and 200
         or coalesce(item ->> 'url', '') !~ '^https://[^[:space:]]{4,}$'
         or char_length(item ->> 'url') > 600
    );
$$;

revoke all on function public.court_note_sources_ok(jsonb) from public, anon, authenticated;

/**
 * What the platform read of how a court decides a question the rules leave
 * to a lawyer's choice, said to the lawyer where they choose: for now, a
 * family split between the small-claims court and the civil court. Each note
 * says what was decided, where it was read, and when. Kept by the operator.
 */
create table public.court_notes (
  court text not null references public.courts (acronym) on delete cascade,
  topic text not null,
  -- against: the court's decisions read went against the split; divided: its bodies disagree.
  stance text not null,
  summary text not null,
  -- Each decision or act read: its label and its address.
  sources jsonb not null,
  read_on date not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (court, topic),
  constraint court_notes_topic_check check (topic in ('family_split')),
  constraint court_notes_stance_check check (stance in ('against', 'divided')),
  constraint court_notes_summary_check check (char_length(btrim(summary)) between 40 and 2000),
  constraint court_notes_sources_check check (public.court_note_sources_ok(sources)),
  constraint court_notes_read_check check (read_on between date '2020-01-01' and date '2100-01-01')
);

alter table public.court_notes enable row level security;
create policy "court_notes_select_all" on public.court_notes for select to authenticated using (true);
grant select on table public.court_notes to authenticated;

/** The operator writes a court's note, or a new reading of it. */
create or replace function public.admin_save_court_note(
  target_court text,
  target_topic text,
  target_stance text,
  target_summary text,
  target_sources jsonb,
  target_read_on date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  court_code text := upper(btrim(coalesce(target_court, '')));
  topic_value text := btrim(coalesce(target_topic, ''));
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.courts c where c.acronym = court_code) then
    return jsonb_build_object('ok', false, 'code', 'unknown_court');
  end if;
  insert into public.court_notes as n (court, topic, stance, summary, sources, read_on, updated_by)
  values (court_code, topic_value, btrim(coalesce(target_stance, '')), btrim(coalesce(target_summary, '')),
    coalesce(target_sources, '[]'::jsonb), target_read_on, caller)
  on conflict (court, topic) do update set
    stance = excluded.stance,
    summary = excluded.summary,
    sources = excluded.sources,
    read_on = excluded.read_on,
    updated_by = caller,
    updated_at = now();
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'admin.court_note.saved', 'court_note', court_code || ':' || topic_value,
    jsonb_build_object('stance', btrim(coalesce(target_stance, ''))));
  return jsonb_build_object('ok', true, 'code', 'saved');
exception when check_violation or not_null_violation then
  return jsonb_build_object('ok', false, 'code', 'invalid_value');
end;
$$;

revoke all on function public.admin_save_court_note(text, text, text, text, jsonb, date) from public, anon;
grant execute on function public.admin_save_court_note(text, text, text, text, jsonb, date) to authenticated;

/** The operator takes a court's note away. */
create or replace function public.admin_remove_court_note(target_court text, target_topic text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  court_code text := upper(btrim(coalesce(target_court, '')));
  topic_value text := btrim(coalesce(target_topic, ''));
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  delete from public.court_notes where court = court_code and topic = topic_value;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'admin.court_note.removed', 'court_note', court_code || ':' || topic_value, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'code', 'removed');
end;
$$;

revoke all on function public.admin_remove_court_note(text, text) from public, anon;
grant execute on function public.admin_remove_court_note(text, text) to authenticated;

-- Read on 2026-10-13 in the courts' own bases of decisions (the TJMT's through the search of its portal,
-- which these addresses repeat, so a search's results may change; the TJDFT's by each decision's page).
-- Public decisions, named by their body and day, never by the parties.
insert into public.court_notes (court, topic, stance, summary, sources, read_on) values
  ('TJMT', 'family_split', 'against',
   'A 5ª Câmara de Direito Privado extinguiu em março e abril de 2026 a ação do menor proposta na vara cível enquanto os pais estavam no juizado, por fracionamento, mesmo com o argumento de que o menor não pode ser parte no juizado (Lei 9.099/1995, art. 8º). A 2ª Câmara, em junho de 2026, tirou a indenização de um menor numa família que propôs quatro ações. Outras câmaras censuraram a falta de pedido de reunião ou de distribuição por dependência entre as ações da família.',
   jsonb_build_array(
     jsonb_build_object('label', 'TJMT, 5ª Câmara de Direito Privado, 17/03/2026 e 28/04/2026 (busca no portal do tribunal)',
       'url', 'https://jurisprudencia.tjmt.jus.br/consulta/judicial?aba=Acordao&txtBusca=%22fracionamento%22%20a%C3%A9rea%20%22juizado%20especial%22%20%22justi%C3%A7a%20comum%22&tipoBusca=1&thesaurus=false&exibirArquivados=true'),
     jsonb_build_object('label', 'TJMT, 2ª Câmara de Direito Privado, 10/06/2026 (busca no portal do tribunal)',
       'url', 'https://jurisprudencia.tjmt.jus.br/consulta/judicial?aba=Acordao&txtBusca=%22membros%20da%20mesma%20fam%C3%ADlia%22%20a%C3%A9rea%20a%C3%A7%C3%B5es&tipoBusca=1&thesaurus=false&exibirArquivados=true'),
     jsonb_build_object('label', 'TJMT, 3ª Câmara de Direito Privado, 09/04/2026 (busca no portal do tribunal)',
       'url', 'https://jurisprudencia.tjmt.jus.br/consulta/judicial?aba=Acordao&txtBusca=%22n%C3%BAcleo%20familiar%22%20%22transporte%20a%C3%A9reo%22%20%22interesse%20de%20agir%22&tipoBusca=1&thesaurus=false&exibirArquivados=true')
   ),
   date '2026-10-13'),
  ('TJDFT', 'family_split', 'divided',
   'As turmas cíveis divergem. A 2ª Turma Cível, em março de 2026, decidiu que nada impedia a família de propor uma só ação na vara cível, extinguiu a ação dos menores, aplicou multa por má-fé de 10% do valor da causa e mandou ofício à OAB, num caso que também dividia a viagem por trecho. A 7ª Turma Cível, em junho de 2025, aceitou a ação do menor na vara cível com os pais no juizado, e disse que duas ações dos pais, uma de cada, mudariam a conclusão.',
   jsonb_build_array(
     jsonb_build_object('label', 'TJDFT, 2ª Turma Cível, 25/03/2026',
       'url', 'https://jurisdf.tjdft.jus.br/acordaos/94424ea2-a86b-427d-b9cc-11ad64deb5a0'),
     jsonb_build_object('label', 'TJDFT, 2ª Turma Cível, embargos, 29/07/2026',
       'url', 'https://jurisdf.tjdft.jus.br/acordaos/bb865fb4-ca72-40fa-86ab-37d55fc66813'),
     jsonb_build_object('label', 'TJDFT, 7ª Turma Cível, 18/06/2025',
       'url', 'https://jurisdf.tjdft.jus.br/acordaos/a9c47ffd-0fdf-4f50-bd9e-34a386a9e0a0')
   ),
   date '2026-10-13')
on conflict (court, topic) do nothing;

-- ---------- The client's word on the civil court ----------

-- The civil court costs what the small-claims court, as a rule, does not: costs of the lawsuit, due at its
-- start unless a judge grants free justice, and, if the claim loses, the costs and the other side's lawyer's
-- fees, which under free justice may be charged only if the person can pay within five years of the end of
-- the lawsuit, and are then extinguished (CPC, art. 98, § 3º). So each claimant of a lawsuit there says they
-- accept it (for a minor, who answers for them), in the words of this setting, kept as they were shown: one
-- for a minor (`{nome}` is the minor's name), one for an adult who goes with a family that has a minor, one
-- for any other adult. The page answers in the very words it showed: the words themselves are compared.
insert into public.platform_settings (key, value, is_public) values
  ('civil_court_consent', jsonb_build_object(
    'version', 1,
    'minor', '{nome} é menor de idade e por isso não pode ser parte no juizado especial, onde, em regra, não há custas na primeira instância. A ação de {nome} é proposta na vara cível. Na vara cível há custas do processo, pagas no começo da ação, a não ser que o juiz conceda justiça gratuita, que o escritório pode pedir. Se a ação for perdida, pode haver condenação a pagar as custas e os honorários do advogado da companhia aérea. Para quem tem justiça gratuita, essa cobrança só pode ser feita se, em até cinco anos depois do fim do processo, a pessoa passar a poder pagar; depois disso, ela deixa de existir. O Ministério Público acompanha a ação de quem é menor, e o caminho costuma ser mais longo do que no juizado. Aceito que a ação de {nome} seja proposta na vara cível.',
    'adult_family', 'A família viaja com criança ou adolescente, que não pode ser parte no juizado especial. Para a família não ficar dividida em ações separadas sobre a mesma viagem, o que alguns tribunais já recusaram, todos entram juntos numa ação só, na vara cível. No juizado, em regra, não há custas na primeira instância. Na vara cível há custas do processo, pagas no começo da ação, a não ser que o juiz conceda justiça gratuita, que o escritório pode pedir. Se a ação for perdida, pode haver condenação a pagar as custas e os honorários do advogado da companhia aérea. Para quem tem justiça gratuita, essa cobrança só pode ser feita se, em até cinco anos depois do fim do processo, a pessoa passar a poder pagar; depois disso, ela deixa de existir. O caminho costuma ser mais longo do que no juizado. Aceito que a minha ação seja proposta na vara cível, junto com a família.',
    'adult', 'A sua ação é proposta na vara cível, e não no juizado especial, onde, em regra, não há custas na primeira instância. Na vara cível há custas do processo, pagas no começo da ação, a não ser que o juiz conceda justiça gratuita, que o escritório pode pedir. Se a ação for perdida, pode haver condenação a pagar as custas e os honorários do advogado da companhia aérea. Para quem tem justiça gratuita, essa cobrança só pode ser feita se, em até cinco anos depois do fim do processo, a pessoa passar a poder pagar; depois disso, ela deixa de existir. O caminho costuma ser mais longo do que no juizado. Aceito que a minha ação seja proposta na vara cível.',
    -- How many times a link may accept for one claimant in a day: saying no always passes.
    'answers_per_day', 10
  ), false)
on conflict (key) do nothing;

/** Who gives a claimant's word on the civil court today: the claimant, or, for a minor, who answers for them (null when nobody does yet). */
create or replace function public.civil_court_answerer(target_party uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case when public.case_party_is_minor(cp.id) then g.person_id else cp.person_id end
  from public.case_parties cp
  left join public.case_parties g on g.id = cp.guardian_id
  where cp.id = target_party;
$$;

revoke all on function public.civil_court_answerer(uuid) from public, anon, authenticated;

/**
 * The words a claimant's answer on the civil court is given in now: a
 * minor's (with the name written in), an adult's who goes with a family that
 * has a minor and was not split, or another adult's. Null with no setting,
 * or words too long to keep.
 */
create or replace function public.civil_court_wording(target_party uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select filled.words
  from public.platform_settings s
  cross join public.case_parties cp
  join public.people p on p.id = cp.person_id
  cross join lateral (
    select case
      when public.case_party_is_minor(cp.id) then 'minor'
      when public.case_has_minor_claimant(cp.case_id)
           and (select c.family_choice from public.cases c where c.id = cp.case_id) = 'together' then 'adult_family'
      else 'adult'
    end as template
  ) chosen
  cross join lateral (select replace(s.value ->> chosen.template, '{nome}', p.full_name) as words) filled
  where s.key = 'civil_court_consent' and cp.id = target_party
    and char_length(coalesce(filled.words, '')) between 40 and 2200;
$$;

revoke all on function public.civil_court_wording(uuid) from public, anon, authenticated;

/** The version of the words in force: kept beside each answer. */
create or replace function public.civil_court_version()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when s.value ->> 'version' ~ '^[0-9]{1,6}$' then (s.value ->> 'version')::integer end
  from public.platform_settings s where s.key = 'civil_court_consent';
$$;

revoke all on function public.civil_court_version() from public, anon, authenticated;

/**
 * Each answer a claimant gave (or who answers for a minor), kept as it was
 * given and never rewritten: the one in force per claimant has no
 * `replaced_at`; a later answer about the same claimant replaces it. An
 * answer counts only while who gave it is who gives the claimant's word
 * today (`civil_court_answerer`): a guardian changed, or a minor who came of
 * age, is asked again.
 */
create table public.civil_court_answers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  -- The claimant whose claim goes to the civil court.
  party_id uuid not null,
  -- Who answered: the claimant, or who answers for a minor.
  person_id uuid not null,
  accepted boolean not null,
  -- The words, as they were shown or read to the person, and their version.
  wording text not null,
  version integer not null,
  -- client: on their own link; firm: a person of the firm recorded it, saying how.
  source text not null,
  note text,
  link_id uuid references public.client_links (id) on delete set null,
  -- What the server saw of the client's request (its browser, its address): never the caller's to write.
  evidence jsonb,
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  replaced_at timestamptz,
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (party_id, org_id) references public.case_parties (id, org_id) on delete cascade,
  foreign key (person_id, org_id) references public.people (id, org_id) on delete cascade,
  constraint civil_court_answers_source_check check (source in ('client', 'firm')),
  constraint civil_court_answers_note_check check (
    (source = 'firm') = (note is not null) and (note is null or char_length(note) between 8 and 500)
  ),
  constraint civil_court_answers_wording_check check (char_length(wording) between 40 and 2200),
  constraint civil_court_answers_version_check check (version >= 1),
  constraint civil_court_answers_evidence_check check (
    evidence is null or (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 1000)
  )
);

-- One answer in force per claimant.
create unique index civil_court_answers_current_idx on public.civil_court_answers (party_id) where replaced_at is null;
create index civil_court_answers_case_idx on public.civil_court_answers (case_id, recorded_at desc);
create index civil_court_answers_declined_idx on public.civil_court_answers (org_id, case_id)
  where replaced_at is null and not accepted;

alter table public.civil_court_answers enable row level security;
create policy "civil_court_answers_select_member" on public.civil_court_answers
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.civil_court_answers to authenticated;
create trigger guard_impersonation_civil_court_answers after insert or update or delete on public.civil_court_answers
  for each statement execute function public.guard_impersonation_readonly();

/** The answer in force of a claimant, when it was given by who gives their word today. */
create or replace function public.civil_court_answer_in_force(target_party uuid)
returns public.civil_court_answers
language sql
stable
security definer
set search_path = public
as $$
  select a.* from public.civil_court_answers a
  where a.party_id = target_party and a.replaced_at is null
    and a.person_id is not distinct from public.civil_court_answerer(target_party);
$$;

revoke all on function public.civil_court_answer_in_force(uuid) from public, anon, authenticated;

/**
 * Whose word on the civil court a case needs, and had: each claimant of a
 * lawsuit in the civil court still planned (whose word is asked) or filed
 * with a word given (the firm's record of it), with who gives it today and the
 * answer in force of that person, if any. What the screens and the client's
 * link show; the gate of a filing reads the same answer (`filing_blocker`).
 */
create or replace function public.civil_court_needs(target_case uuid)
returns table (
  party_id uuid,
  proceeding_id uuid,
  planned boolean,
  minor boolean,
  answerer_id uuid,
  answer_id uuid,
  accepted boolean,
  source text,
  recorded_at timestamptz,
  note text
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (cp.id)
    cp.id, p.id, p.status = 'planned', public.case_party_is_minor(cp.id), public.civil_court_answerer(cp.id),
    a.id, a.accepted, a.source, a.recorded_at, a.note
  from public.proceedings p
  join public.proceeding_parties pp on pp.proceeding_id = p.id
  join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
  left join lateral (select * from public.civil_court_answer_in_force(cp.id)) a on a.id is not null
  where p.case_id = target_case and p.kind = 'comum'
    and (p.status = 'planned' or (p.status = 'filed' and a.id is not null))
  -- A claimant of a lawsuit still planned is asked; one only of a filed lawsuit is the record.
  order by cp.id, (p.status = 'planned') desc, p.created_at, p.id;
$$;

revoke all on function public.civil_court_needs(uuid) from public, anon, authenticated;

/**
 * Why a lawsuit's filing may not go on now, or null: a small-claims lawsuit
 * beside a minor of a family nobody split (`family_split_unchosen`), or a
 * lawsuit in the civil court with a claimant whose word in force, given by
 * who gives it today, is not a yes (`civil_court_unanswered`). Asked when a
 * package is requested (0036) and again when its receipt is attached (0027):
 * the claimants, their guardians and the answers may change in between.
 */
create or replace function public.filing_blocker(target_proceeding uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.kind = 'juizado' and c.family_choice = 'together' and public.case_has_minor_claimant(c.id)
      then 'family_split_unchosen'
    when p.kind = 'comum' and exists (
      select 1 from public.proceeding_parties pp
      where pp.proceeding_id = p.id
        and coalesce((public.civil_court_answer_in_force(pp.party_id)).accepted, false) is not true
    ) then 'civil_court_unanswered'
  end
  from public.proceedings p
  join public.cases c on c.id = p.case_id
  where p.id = target_proceeding;
$$;

revoke all on function public.filing_blocker(uuid) from public, anon, authenticated;

/**
 * What keeps each lawsuit named from being filed now, for a member of its
 * firm: the screens say it beside a package built before it changed, so no
 * lawyer files what the receipt would then refuse.
 */
create or replace function public.filing_blockers(target_org uuid, target_proceedings uuid[])
returns table (proceeding_id uuid, code text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  select p.id, public.filing_blocker(p.id)
  from public.proceedings p
  where p.org_id = target_org and p.id = any (coalesce(target_proceedings, '{}'::uuid[])) and p.status = 'planned'
    and public.filing_blocker(p.id) is not null;
end;
$$;

revoke all on function public.filing_blockers(uuid, uuid[]) from public, anon;
grant execute on function public.filing_blockers(uuid, uuid[]) to authenticated;

/**
 * An answer was given against the civil court: the packages in course of the
 * lawsuits planned there with that claimant are given up (0027), each told
 * in the case's timeline, so nothing is filed in a court the person said no
 * to while the firm talks it over.
 */
create or replace function public.civil_court_declined(target_party uuid, target_actor text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  dropped record;
begin
  for dropped in
    update public.filing_packages fp set status = 'cancelled', claimed_at = null
    where fp.status in ('requested', 'ready', 'failed') and fp.proceeding_id in (
      select p.id from public.proceedings p
      join public.proceeding_parties pp on pp.proceeding_id = p.id
      where pp.party_id = target_party and p.status = 'planned' and p.kind = 'comum'
    )
    returning fp.id, fp.org_id, fp.case_id, fp.proceeding_id
  loop
    perform public.drop_filing_package_files(dropped.id);
    perform public.record_case_event(dropped.org_id, dropped.case_id, 'filing_package_cancelled', target_actor,
      jsonb_build_object('package', dropped.id, 'proceeding', dropped.proceeding_id, 'reason', 'civil_court_declined'));
  end loop;
end;
$$;

revoke all on function public.civil_court_declined(uuid, text) from public, anon, authenticated;

/** What a case needs and had of its claimants' word on the civil court, for the firm's screen, with the words in force. */
create or replace function public.case_civil_court(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
begin
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    return jsonb_build_object('ok', false, 'code', 'case_not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'needs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'party_id', n.party_id, 'proceeding_id', n.proceeding_id, 'planned', n.planned, 'minor', n.minor,
        'answerer_id', n.answerer_id, 'answer_id', n.answer_id, 'accepted', n.accepted, 'source', n.source,
        'recorded_at', n.recorded_at, 'note', n.note,
        'wording', case when n.planned then public.civil_court_wording(n.party_id) end
      ) order by n.party_id)
      from public.civil_court_needs(current_case.id) n
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.case_civil_court(uuid) from public, anon;
grant execute on function public.case_civil_court(uuid) to authenticated;

/**
 * A person of the firm records a claimant's answer on the civil court, given
 * to the firm some other way than the link (in person, on the phone, on a
 * signed paper), saying how, in the very words the screen showed
 * (`target_wording`: when they changed since, nothing is recorded), about the
 * answer the person read (`target_seen`: the answer in force they saw, or
 * null when there was none; another answer given since is not overwritten
 * unseen). Only for a lawsuit still planned. Never from a support visit.
 */
create or replace function public.record_civil_court_answer(
  target_case uuid,
  target_party uuid,
  target_accepted boolean,
  target_note text,
  target_seen uuid,
  target_wording text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  need record;
  note_value text := nullif(btrim(coalesce(target_note, '')), '');
  wording text;
  version integer := public.civil_court_version();
begin
  if target_accepted is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'accepted');
  end if;
  if note_value is null or char_length(note_value) not between 8 and 500 then
    return jsonb_build_object('ok', false, 'code', 'how_required', 'field', 'note');
  end if;
  select * into need from public.civil_court_needs(current_case.id) n where n.party_id = target_party and n.planned;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'party_not_found');
  end if;
  if need.answerer_id is null then
    return jsonb_build_object('ok', false, 'code', 'no_guardian');
  end if;
  if need.answer_id is distinct from target_seen then
    return jsonb_build_object('ok', false, 'code', 'answer_changed');
  end if;
  wording := public.civil_court_wording(target_party);
  if wording is null or version is null then
    return jsonb_build_object('ok', false, 'code', 'wording_unavailable');
  end if;
  if target_wording is distinct from wording then
    return jsonb_build_object('ok', false, 'code', 'wording_changed');
  end if;
  update public.civil_court_answers set replaced_at = now() where party_id = target_party and replaced_at is null;
  insert into public.civil_court_answers (
    org_id, case_id, party_id, person_id, accepted, wording, version, source, note, recorded_by
  ) values (
    current_case.org_id, current_case.id, target_party, need.answerer_id, target_accepted, wording, version,
    'firm', note_value, auth.uid()
  );
  if not target_accepted then
    perform public.civil_court_declined(target_party, 'person');
  end if;
  perform public.record_case_event(current_case.org_id, current_case.id, 'civil_court_recorded', 'person',
    jsonb_build_object('party', target_party, 'accepted', target_accepted));
  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.record_civil_court_answer(uuid, uuid, boolean, text, uuid, text) from public, anon;
grant execute on function public.record_civil_court_answer(uuid, uuid, boolean, text, uuid, text) to authenticated;

/**
 * What a link asks its person about the civil court: their own claim when it
 * is planned there, and the claims of the minors they answer for, each with
 * the words in force and the answer they gave so far.
 */
create or replace function public.client_link_civil_court(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now()
     or not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id) then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'party_id', n.party_id, 'name', pe.full_name, 'minor', n.minor,
        'wording', public.civil_court_wording(n.party_id), 'accepted', n.accepted, 'recorded_at', n.recorded_at,
        'source', n.source
      ) order by n.minor, pe.full_name, n.party_id)
      from public.civil_court_needs(link.case_id) n
      join public.case_parties cp on cp.id = n.party_id
      join public.people pe on pe.id = cp.person_id
      where n.planned and n.answerer_id = link.person_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.client_link_civil_court(text) from public;
grant execute on function public.client_link_civil_court(text) to anon, authenticated;

/**
 * The client answers on their link, for their own claim or a minor's they
 * answer for, in the very words the link showed them (`target_wording`: when
 * the words changed since, nothing is recorded and the page reads again).
 * Nothing is rewritten: each answer stays on record with what the server saw
 * of the request. A link accepts for one claimant a few times a day, and
 * says no whenever asked. Called by the backend only: the evidence is never
 * the caller's to write.
 */
create or replace function public.client_link_answer_civil_court(
  target_token text,
  target_party uuid,
  target_accepted boolean,
  target_wording text,
  target_evidence jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  need record;
  evidence jsonb := coalesce(target_evidence, '{}'::jsonb);
  wording text;
  version integer := public.civil_court_version();
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now()
     or not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id) then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_accepted is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_value');
  end if;
  -- The case's row is held: two answers given at once take turns, and the second finds the first.
  perform 1 from public.cases c where c.id = link.case_id for no key update;
  select * into need from public.civil_court_needs(link.case_id) n
  where n.party_id = target_party and n.planned and n.answerer_id = link.person_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_asked');
  end if;
  wording := public.civil_court_wording(target_party);
  if wording is null or version is null or target_wording is distinct from wording then
    return jsonb_build_object('ok', false, 'code', 'wording_changed');
  end if;
  if need.accepted is not distinct from target_accepted then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  if target_accepted and (
    select count(*) from public.civil_court_answers a
    where a.party_id = target_party and a.source = 'client' and a.accepted and a.recorded_at > now() - interval '24 hours'
  ) >= greatest(coalesce((
    select case when s.value ->> 'answers_per_day' ~ '^[0-9]{1,4}$' then (s.value ->> 'answers_per_day')::integer end
    from public.platform_settings s where s.key = 'civil_court_consent'), 10), 1) then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;

  update public.civil_court_answers set replaced_at = now() where party_id = target_party and replaced_at is null;
  evidence := jsonb_strip_nulls(jsonb_build_object(
    'user_agent', left(case when jsonb_typeof(evidence) = 'object' then evidence ->> 'user_agent' end, 300),
    'ip', left(case when jsonb_typeof(evidence) = 'object' then evidence ->> 'ip' end, 64),
    'channel', 'link'
  ));
  insert into public.civil_court_answers (
    org_id, case_id, party_id, person_id, accepted, wording, version, source, link_id, evidence
  ) values (
    link.org_id, link.case_id, target_party, link.person_id, target_accepted, wording, version, 'client', link.id, evidence
  );
  if not target_accepted then
    perform public.civil_court_declined(target_party, 'client');
  end if;
  perform public.record_case_event(link.org_id, link.case_id, 'civil_court_answered', 'client',
    jsonb_build_object('party', target_party, 'accepted', target_accepted));
  return jsonb_build_object('ok', true, 'code', case when target_accepted then 'accepted' else 'declined' end);
end;
$$;

revoke all on function public.client_link_answer_civil_court(text, uuid, boolean, text, jsonb) from public, anon, authenticated;
