-- ONE · 0030 · The flights of a case, checked against what a source recorded
--
-- Each leg of a case is checked against ANAC's official record of the
-- flights operated in Brazil (the VRA, one file a month, a few weeks after
-- it): the backend downloads the month of a leg's flight, finds the leg's
-- flight in it (`@flyee/flights/check`) and keeps what the record says as
-- evidence. A person may also ask FlightAware about a leg the record cannot
-- answer (a flight of the last weeks, a leg abroad): each answer is billed
-- to the platform, so the database decides when (a ceiling a day per firm, a
-- wait per leg). What the case says next to what a source says (agrees,
-- differs) is read by the pure rule from both, never stored as a verdict.
--
--   airlines.vra_designators   the ICAO designators the record names an airline's flights by
--   flight_checks              per leg and per source: what was asked and what the source said
--   setting `flights`          the address of the record's files, the tolerance, the ceilings

-- ---------- The airlines, as the record names them ----------

/** True when every element is an ICAO airline designator (three letters). Internal. */
create or replace function public.icao_designators_ok(designators text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(d ~ '^[A-Z]{3}$'), true) and coalesce(cardinality(designators), 0) <= 6
  from unnest(designators) as d;
$$;

revoke all on function public.icao_designators_ok(text[]) from public, anon, authenticated;

-- The record names an airline by its ICAO designator ("GLO"), a ticket by its IATA one ("G3"). LATAM sells
-- under "LA" the flights of LATAM Brasil ("TAM"), LATAM Chile ("LAN"), LATAM Peru ("LPE"), LATAM Paraguay
-- ("LAP") and LATAM Ecuador ("LNE"), all of which fly to Brazil (the record of August 2026: 26,699, 1,310,
-- 462, 105 and 22 flights), with no codeshare of another named on their lines.
alter table public.airlines add column vra_designators text[] not null default '{}';
alter table public.airlines add constraint airlines_vra_designators_check check (public.icao_designators_ok(vra_designators));

update public.airlines a set vra_designators = d.designators
from (values
  ('AD', array['AZU']), ('G3', array['GLO']), ('LA', array['TAM', 'LAN', 'LPE', 'LAP', 'LNE']), ('JJ', array['TAM']),
  ('2Z', array['PTB']),
  ('TP', array['TAP']), ('AA', array['AAL']), ('UA', array['UAL']), ('DL', array['DAL']), ('CM', array['CMP']),
  ('AV', array['AVA']), ('AR', array['ARG']), ('AF', array['AFR']), ('KL', array['KLM']), ('IB', array['IBE']),
  ('UX', array['AEA']), ('LH', array['DLH']), ('BA', array['BAW']), ('EK', array['UAE']), ('QR', array['QTR']),
  ('TK', array['THY']), ('ET', array['ETH']), ('AM', array['AMX']), ('H2', array['SKU']), ('JA', array['JAT'])
) as d (iata, designators)
where a.iata = d.iata;

-- ---------- What the checks read ----------

insert into public.platform_settings (key, value, is_public) values
  ('flights', jsonb_build_object(
    -- Where ANAC publishes a month of the record ({ano}, {mes}): data, so a new address is a setting.
    'vra_url', 'https://siros.anac.gov.br/siros/registros/diversos/vra/{ano}/VRA_{ano}_{mes}.csv',
    -- A month not out yet is asked again after this many hours.
    'vra_retry_hours', 24,
    -- A month this many months gone that is still not there is not coming: its legs' checks are given up,
    -- saying so (never "not found": the file was never read), and a person asks again.
    'vra_missing_after_months', 3,
    -- From how many minutes apart a time of the case and one of a source are said to differ.
    'agreement_minutes', 15,
    -- What a firm may ask of FlightAware: answers a day, and minutes between two answers of one leg.
    'lookups_per_day', 30,
    'lookup_cooldown_minutes', 60,
    -- A lookup whose answer did not come back in this many minutes is lost: it may be asked again at once.
    'lookup_working_minutes', 5,
    -- A check claimed and never finished goes back after this many minutes, and is given up after the attempts.
    'working_minutes', 20,
    'max_attempts', 5
  ), true)
on conflict (key) do nothing;

/** An integer of the setting `flights`, or the fallback. Internal. */
create or replace function public.flights_setting(setting text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when s.value ->> setting ~ '^[0-9]{1,9}$' then (s.value ->> setting)::integer end
     from public.platform_settings s where s.key = 'flights'),
    fallback
  );
$$;

revoke all on function public.flights_setting(text, integer) from public, anon, authenticated;

-- ---------- The checks ----------

create table public.flight_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  segment_id uuid not null,
  -- vra          ANAC's official record, asked by the backend for every leg;
  -- flightaware  FlightAware, asked by a person, for a leg the record cannot answer.
  source text not null,
  -- waiting        the backend owes it (the record) or its answer is on its way (FlightAware);
  -- incomplete     the leg has no flight number or no scheduled departure: nothing to ask;
  -- not_published  the record of the leg's month is not out yet: asked again later;
  -- found          the source has the leg's flight (`record`);
  -- not_found      the source has no such flight on that day ("not found" is never "did not fly");
  -- failed         the work was given up, or the last answer could not be had: a person asks again.
  status text not null,
  -- The rule that matched and read the flight (`@flyee/flights/check`).
  version text,
  -- What the source said of the flight, as it said it: a flight of the record (Brasília times) or a
  -- provider's answer (instants). Never anything of a person.
  record jsonb,
  -- How the flight was found to be the leg's: the airline's own number, a codeshare, or the route.
  matched_by text,
  -- The month of the record the flight was looked for in.
  month text,
  checked_at timestamptz,
  -- A person's request (FlightAware).
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz,
  -- The backend's work (the record), and each lookup of FlightAware: every claim numbered, never set back.
  work_claims integer not null default 0,
  work_claimed_at timestamptz,
  work_attempts integer not null default 0,
  work_after timestamptz,
  work_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (segment_id, source),
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (segment_id, org_id) references public.flight_segments (id, org_id) on delete cascade,
  constraint flight_checks_source_check check (source in ('vra', 'flightaware')),
  constraint flight_checks_status_check check (
    status in ('waiting', 'incomplete', 'not_published', 'found', 'not_found', 'failed')
  ),
  -- A check found has what the source said; a lookup of FlightAware asked again keeps the last answer
  -- while the new one is on its way, and when it could not be had.
  constraint flight_checks_record_check check (
    (status <> 'found' or record is not null)
    and (record is null or status = 'found' or (source = 'flightaware' and status in ('waiting', 'failed')))
  ),
  constraint flight_checks_record_shape_check check (
    record is null or (jsonb_typeof(record) = 'object' and octet_length(record::text) <= 4000)
  ),
  constraint flight_checks_matched_check check (matched_by is null or matched_by in ('operator', 'codeshare', 'route')),
  constraint flight_checks_month_check check (month is null or month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint flight_checks_version_check check (version is null or version ~ '^[a-z0-9-]{3,40}$'),
  constraint flight_checks_error_check check (work_error is null or work_error ~ '^[a-z][a-z0-9_]{1,59}$')
);

create index flight_checks_case_idx on public.flight_checks (case_id);
create index flight_checks_work_idx on public.flight_checks (work_after nulls first, created_at)
  where source = 'vra' and status in ('waiting', 'not_published') and work_claimed_at is null;
create index flight_checks_claimed_idx on public.flight_checks (work_claimed_at) where work_claimed_at is not null;

alter table public.flight_checks enable row level security;
create policy "flight_checks_select_member" on public.flight_checks
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.flight_checks to authenticated;
create trigger flight_checks_updated_at before update on public.flight_checks
  for each row execute function public.set_updated_at();
create trigger guard_impersonation_flight_checks after insert or update or delete on public.flight_checks
  for each statement execute function public.guard_impersonation_readonly();

/**
 * A leg written (by the firm or by the client on their link) owes a check of
 * the record when it has a flight number and a scheduled departure. A leg
 * whose flight, route or day changed is another flight: its checks start
 * over, and what a source said of the flight it was is dropped. A change of
 * its actual times changes no check: what the case says is read next to
 * what the source said, every time.
 */
create or replace function public.flight_segments_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.flight_number is not distinct from old.flight_number
     and new.origin_iata is not distinct from old.origin_iata
     and new.destination_iata is not distinct from old.destination_iata
     and new.scheduled_departure_local is not distinct from old.scheduled_departure_local then
    return new;
  end if;
  delete from public.flight_checks where segment_id = new.id and source = 'flightaware';
  insert into public.flight_checks (org_id, case_id, segment_id, source, status)
  values (new.org_id, new.case_id, new.id, 'vra',
          case when new.flight_number is null or new.scheduled_departure_local is null then 'incomplete' else 'waiting' end)
  on conflict (segment_id, source) do update set
    status = excluded.status, version = null, record = null, matched_by = null, month = null, checked_at = null,
    work_claimed_at = null, work_attempts = 0, work_after = null, work_error = null;
  return new;
end;
$$;

revoke all on function public.flight_segments_check() from public, anon, authenticated;

create trigger flight_segments_check after insert or update on public.flight_segments
  for each row execute function public.flight_segments_check();

-- The legs already written owe their check too.
insert into public.flight_checks (org_id, case_id, segment_id, source, status)
select s.org_id, s.case_id, s.id, 'vra',
       case when s.flight_number is null or s.scheduled_departure_local is null then 'incomplete' else 'waiting' end
from public.flight_segments s
on conflict (segment_id, source) do nothing;

-- ---------- The backend's half (the record) ----------

/**
 * Claims the checks of the record the backend owes (or the one named), each
 * with the number of its claim and what the leg is: its flight, the
 * airline's designators in the record, the airports with their ICAO codes
 * and offsets, and the scheduled departure as the ticket prints it. A claim
 * never finished goes back first, and is given up after its attempts.
 * Service role only.
 */
create or replace function public.claim_flight_checks(target_limit integer default 20, target_check uuid default null)
returns table (
  check_id uuid, claim integer, leg_case uuid, leg_flight text, designators text[], leg_number text,
  origin_icao text, origin_offset integer, destination_icao text, departure_local text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  minutes integer := greatest(public.flights_setting('working_minutes', 20), 1);
  tries integer := greatest(public.flights_setting('max_attempts', 5), 1);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.flight_checks c
  set work_claimed_at = null,
      status = case when c.work_attempts >= tries then 'failed' else c.status end,
      work_error = case when c.work_attempts >= tries then 'abandoned' else c.work_error end
  where c.source = 'vra' and c.work_claimed_at is not null and c.work_claimed_at < now() - make_interval(mins => minutes);

  return query
  with picked as (
    select c.id from public.flight_checks c
    where c.source = 'vra' and c.status in ('waiting', 'not_published') and c.work_claimed_at is null
      and (c.work_after is null or c.work_after <= now())
      and (target_check is null or c.id = target_check)
    order by c.work_after nulls first, c.created_at, c.id
    limit greatest(least(coalesce(target_limit, 20), 100), 1)
    for update skip locked
  )
  update public.flight_checks c
  set work_claimed_at = now(), work_claims = c.work_claims + 1, work_attempts = c.work_attempts + 1
  from picked, public.flight_segments s
  where c.id = picked.id and s.id = c.segment_id
  returning c.id, c.work_claims, c.case_id, s.flight_number,
    coalesce((select a.vra_designators from public.airlines a where a.iata = left(s.flight_number, 2)), '{}'::text[]),
    ltrim(regexp_replace(substr(s.flight_number, 3), '[^0-9]', '', 'g'), '0'),
    (select p.icao from public.airports p where p.iata = s.origin_iata),
    (select p.utc_offset_minutes from public.airports p where p.iata = s.origin_iata),
    (select p.icao from public.airports p where p.iata = s.destination_iata),
    to_char(s.scheduled_departure_local, 'YYYY-MM-DD"T"HH24:MI');
end;
$$;

revoke all on function public.claim_flight_checks(integer, uuid) from public, anon, authenticated;

/**
 * What a check of the record came to, said by the worker that holds its
 * claim (a late worker's word finds its claim over):
 *
 *   found          the flight of the record that is the leg's (`record`, `matched_by`, `month`);
 *   not_found      the month is out and has no such flight;
 *   not_published  the month is not out yet: asked again after the setting's hours, no attempt counted;
 *   retry          a passing failure (ANAC did not answer): asked again after a growing wait;
 *   later          the run did not reach the leg's month (it downloads a few a run): given back for the
 *                  next run, the attempt not counted;
 *   failed         given up: a person asks again.
 *
 * Service role only.
 */
create or replace function public.record_flight_check(
  target_check uuid,
  target_claim integer,
  target_outcome text,
  target_record jsonb default null,
  target_matched_by text default null,
  target_month text default null,
  target_version text default null,
  target_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  found_check public.flight_checks%rowtype;
  tries integer := greatest(public.flights_setting('max_attempts', 5), 1);
  code text := coalesce(substring(lower(coalesce(target_code, '')) from '^[a-z][a-z0-9_]{1,59}'), 'failed');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into found_check from public.flight_checks where id = target_check for update;
  if not found or found_check.source <> 'vra' or found_check.work_claimed_at is null
     or found_check.work_claims is distinct from target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if target_outcome not in ('found', 'not_found', 'not_published', 'retry', 'later', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;
  if target_month is not null and target_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;

  if target_outcome = 'found' then
    if jsonb_typeof(target_record) is distinct from 'object' or octet_length(target_record::text) > 4000
       or coalesce(target_matched_by, '') not in ('operator', 'codeshare', 'route')
       or target_version is null or target_version !~ '^[a-z0-9-]{3,40}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_data');
    end if;
    update public.flight_checks
    set status = 'found', record = target_record, matched_by = target_matched_by, month = target_month,
        version = target_version, checked_at = now(), work_claimed_at = null, work_attempts = 0, work_after = null,
        work_error = null
    where id = found_check.id;
  elsif target_outcome = 'not_found' then
    update public.flight_checks
    set status = 'not_found', record = null, matched_by = null, month = target_month, version = target_version,
        checked_at = now(), work_claimed_at = null, work_attempts = 0, work_after = null, work_error = null
    where id = found_check.id;
  elsif target_outcome = 'not_published' then
    update public.flight_checks
    set status = 'not_published', month = target_month, work_claimed_at = null, work_attempts = 0, work_error = null,
        work_after = now() + make_interval(hours => greatest(public.flights_setting('vra_retry_hours', 24), 1))
    where id = found_check.id;
    return jsonb_build_object('ok', true, 'code', 'not_published');
  elsif target_outcome = 'later' then
    update public.flight_checks
    set work_claimed_at = null, work_attempts = greatest(found_check.work_attempts - 1, 0)
    where id = found_check.id;
    return jsonb_build_object('ok', true, 'code', 'later');
  elsif target_outcome = 'retry' and found_check.work_attempts < tries then
    update public.flight_checks
    set work_claimed_at = null, work_error = code,
        work_after = now() + make_interval(mins => 15 * found_check.work_attempts)
    where id = found_check.id;
    return jsonb_build_object('ok', true, 'code', 'retry');
  else
    update public.flight_checks
    set status = 'failed', work_claimed_at = null, work_after = null, work_error = code
    where id = found_check.id;
    return jsonb_build_object('ok', true, 'code', 'failed');
  end if;

  perform public.record_case_event(found_check.org_id, found_check.case_id, 'flight_checked', 'system',
    jsonb_build_object('segment', found_check.segment_id, 'source', 'vra', 'status', target_outcome));
  return jsonb_build_object('ok', true, 'code', target_outcome);
end;
$$;

revoke all on function public.record_flight_check(uuid, integer, text, jsonb, text, text, text, text) from public, anon, authenticated;

-- ---------- What a person does ----------

/**
 * A person of the firm asks the record again for a leg: one not found (a
 * number corrected elsewhere, a month published late), or one whose work
 * was given up. Never a support visit.
 */
create or replace function public.request_flight_recheck(target_segment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  segment public.flight_segments%rowtype;
  current_case public.cases%rowtype;
begin
  select * into segment from public.flight_segments where id = target_segment;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'segment_not_found');
  end if;
  current_case := public.case_for_writer(segment.case_id);
  if segment.flight_number is null or segment.scheduled_departure_local is null then
    return jsonb_build_object('ok', false, 'code', 'flight_incomplete');
  end if;
  update public.flight_checks
  set status = 'waiting', work_claimed_at = null, work_attempts = 0, work_after = null, work_error = null
  where segment_id = segment.id and source = 'vra' and status in ('not_found', 'failed', 'not_published');
  if not found then
    return jsonb_build_object('ok', false, 'code', 'nothing_to_recheck');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'flights.recheck', 'flight_segment', segment.id::text,
    jsonb_build_object('case', current_case.id));
  return jsonb_build_object('ok', true, 'code', 'waiting');
end;
$$;

revoke all on function public.request_flight_recheck(uuid) from public, anon;
grant execute on function public.request_flight_recheck(uuid) to authenticated;

/**
 * A person of the firm asks FlightAware about a leg. The database says
 * whether it may happen now (the platform pays for every answer): the leg
 * has a flight and a day, the firm is within its answers of the day (counted
 * under a lock of the firm, so two asks at once never pass the ceiling
 * together), and the leg was not asked a moment ago, unless that answer was
 * lost (`lookup_working_minutes`). Each lookup has a number, which the
 * answer must bring back. The leg is read under a lock, so a change to it
 * waits for the lookup to be written and its trigger forgets it. Answers
 * what the server asks: the lookup and its number, the flight under its
 * IATA designator and under each ICAO one of its airline, in order (LATAM's
 * "LA" has five: AeroAPI asks for an ICAO ident, an IATA one being
 * ambiguous), the local date of its scheduled departure, its origin and
 * its destination. Never a support visit.
 */
create or replace function public.begin_flight_lookup(target_segment uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  segment public.flight_segments%rowtype;
  current_case public.cases%rowtype;
  existing public.flight_checks%rowtype;
  ceiling integer := public.flights_setting('lookups_per_day', 30);
  cooldown integer := public.flights_setting('lookup_cooldown_minutes', 60);
  working integer := greatest(public.flights_setting('lookup_working_minutes', 5), 1);
  used integer;
  designators text[];
  lookup public.flight_checks%rowtype;
begin
  select * into segment from public.flight_segments where id = target_segment;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'segment_not_found');
  end if;
  current_case := public.case_for_writer(segment.case_id);
  select * into segment from public.flight_segments where id = target_segment for share;
  if segment.flight_number is null or segment.scheduled_departure_local is null then
    return jsonb_build_object('ok', false, 'code', 'flight_incomplete');
  end if;
  perform pg_advisory_xact_lock(hashtext('flights.lookup'), hashtext(current_case.org_id::text));
  select count(*) into used from public.audit_events a
  where a.org_id = current_case.org_id and a.action = 'flights.lookup' and a.created_at > now() - interval '24 hours';
  if used >= ceiling then
    return jsonb_build_object('ok', false, 'code', 'daily_limit');
  end if;
  select * into existing from public.flight_checks where segment_id = segment.id and source = 'flightaware' for update;
  if found and existing.requested_at > now() - make_interval(mins => cooldown)
     and not (existing.status = 'waiting' and existing.requested_at <= now() - make_interval(mins => working)) then
    return jsonb_build_object('ok', false, 'code', 'lookup_cooldown');
  end if;

  insert into public.flight_checks as held (org_id, case_id, segment_id, source, status, requested_by, requested_at, work_claims)
  values (current_case.org_id, current_case.id, segment.id, 'flightaware', 'waiting', auth.uid(), now(), 1)
  on conflict (segment_id, source) do update set
    status = 'waiting', requested_by = auth.uid(), requested_at = now(), work_error = null,
    work_claims = held.work_claims + 1
  returning * into lookup;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'flights.lookup', 'flight_segment', segment.id::text,
    jsonb_build_object('case', current_case.id));
  designators := (select a.vra_designators from public.airlines a where a.iata = left(segment.flight_number, 2));
  return jsonb_build_object(
    'ok', true,
    'org_id', current_case.org_id,
    'check_id', lookup.id,
    'claim', lookup.work_claims,
    'flight', segment.flight_number,
    'icao_flights', coalesce((
      select jsonb_agg(d || ltrim(regexp_replace(substr(segment.flight_number, 3), '[^0-9]', '', 'g'), '0') order by n)
      from unnest(designators) with ordinality as u (d, n)
    ), '[]'::jsonb),
    'date', to_char(segment.scheduled_departure_local, 'YYYY-MM-DD'),
    'origin', segment.origin_iata,
    'destination', segment.destination_iata
  );
end;
$$;

revoke all on function public.begin_flight_lookup(uuid) from public, anon;
grant execute on function public.begin_flight_lookup(uuid) to authenticated;

/**
 * What FlightAware answered for a leg a person asked about, written by the
 * backend: the flight it knows (`found`), none (`not_found`), or no answer
 * (`unavailable`: the last answer it had stays, and the leg may be asked
 * again at once). Only for the lookup it answers, by its id and number: a
 * leg whose flight changed meanwhile lost that lookup (the trigger forgets
 * it), and a lookup asked again after one was lost has another number, so
 * a late answer is never kept as another's. Service role only.
 */
create or replace function public.record_flight_lookup(
  target_check uuid,
  target_claim integer,
  target_outcome text,
  target_record jsonb default null,
  target_version text default null,
  target_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  found_check public.flight_checks%rowtype;
  code text := coalesce(substring(lower(coalesce(target_code, '')) from '^[a-z][a-z0-9_]{1,59}'), 'unavailable');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into found_check from public.flight_checks
  where id = target_check and source = 'flightaware' for update;
  if not found or found_check.status <> 'waiting' or found_check.work_claims is distinct from target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_waiting');
  end if;
  if target_outcome = 'found' then
    if jsonb_typeof(target_record) is distinct from 'object' or octet_length(target_record::text) > 4000
       or target_version is null or target_version !~ '^[a-z0-9-]{3,40}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_data');
    end if;
    update public.flight_checks
    set status = 'found', record = target_record, version = target_version, checked_at = now(), work_error = null
    where id = found_check.id;
  elsif target_outcome = 'not_found' then
    update public.flight_checks
    set status = 'not_found', record = null, version = target_version, checked_at = now(), work_error = null
    where id = found_check.id;
  elsif target_outcome = 'unavailable' then
    -- No answer is no answer: the wait is given back, and what was had before stays.
    update public.flight_checks
    set status = case when record is not null then 'found' else 'failed' end, requested_at = null, work_error = code
    where id = found_check.id;
    return jsonb_build_object('ok', true, 'code', 'unavailable');
  else
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;
  perform public.record_case_event(found_check.org_id, found_check.case_id, 'flight_looked_up', 'person',
    jsonb_build_object('segment', found_check.segment_id, 'source', 'flightaware', 'status', target_outcome));
  return jsonb_build_object('ok', true, 'code', target_outcome);
end;
$$;

revoke all on function public.record_flight_lookup(uuid, integer, text, jsonb, text, text) from public, anon, authenticated;
