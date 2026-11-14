-- ============================================================
-- 0250 · A previsão do caso
--
-- The market's decisions (0190) as the forecast of a case, approved by the
-- owner on 2026-11-14 (https://claude.ai/artifact/SubBY4R3tUiuHuSFgsbC2E).
--
-- The reading, checked against real days of the DJEN before this was built:
--   * `mercado-v2` reads the moral damages from their own clause (`mercado-v1`
--     took the first value after "condeno", the material damages in 11 of 51
--     judgments read), joins a letter and its accent before reading the judge,
--     and reads why a lawsuit was extinguished (`extinction_reason`). A day is
--     recorded only by the rule in force (`record_market_day` takes the rule;
--     its version of four arguments is gone, so code that reads by an older
--     rule fails to record and its day waits), and a decision read by an
--     older rule is read again in place.
--   * The airlines are searched by the short name the courts write
--     (`airlines.court_search_name`): "TAM Linhas Aéreas S.A." found 6
--     communications of a day where "TAM LINHAS AEREAS" found 300. The
--     captures by the long names pause; the new ones read twelve months back.
--   * The courts of the firms' lawsuits are read without anybody asking
--     (`market_plan_captures`, from the reading's sweep).
--   * The operator says whether a sampled decision was read right
--     (`admin_check_market_reading`), counted beside the theses' check.
--
-- The forecast, one rule on every screen:
--   * `market_forecast_of` (internal): the cut nearest the case with at least
--     30 decisions on the merits (the judge, the unit, the comarca, the court,
--     every court; each with the airline first, then without), else the
--     broadest with the setting's sample, else none; its numbers, each with its
--     sample, the moral damages' quartiles, the extinctions by reason and the
--     months. `market_forecast` (0249, the intake's answers) keeps its
--     signature, its keys and its grant, now through it.
--   * `market_expected_cents`: the chance times the median, by claimant.
--   * `case_forecast(proceeding)`: what the case's card and its hearing read,
--     for the firm's members.
--   * `case_forecasts`: each open lawsuit's forecast, refreshed by a sweep, and
--     the one it had when distributed, kept to compare with the judgment;
--     `firm_forecast` sums the firm's open lawsuits and says how the forecast
--     came out.
-- Only to prepare and to project, never to choose a judge (CPC, art. 285):
-- the judge is read only of a lawsuit already distributed.
-- ============================================================

-- ---------- The reading's rule and why a lawsuit was extinguished ----------
alter table public.market_decisions add column extinction_reason text;
alter table public.market_decisions add constraint market_decisions_extinction_check check (
  extinction_reason is null or (
    result = 'extinto'
    and extinction_reason in ('ausencia_autor', 'desistencia', 'reclamacao_previa', 'incompetencia', 'abandono', 'outro')
  )
);
alter table public.market_decisions add constraint market_decisions_rule_check check (rule ~ '^mercado-v[0-9]+$');

-- The key of a decision's text: the same decision the source published under two keys of its own is one.
alter table public.market_decisions add column content_key text;
create unique index market_decisions_content_idx on public.market_decisions (content_key) where content_key is not null;

-- The operator's word on the reading of a sampled decision (its result, value, problem and reason).
alter table public.market_decisions add column reading_ok boolean;
alter table public.market_decisions add column reading_checked_by uuid references public.profiles (id) on delete set null;
alter table public.market_decisions add column reading_checked_at timestamptz;

update public.platform_settings
set value = value || jsonb_build_object('rule', 'mercado-v2', 'days_back', 365)
where key = 'jurimetry';

/** The rule a day of the market is recorded by: older readings are refused. */
create or replace function public.jurimetry_rule()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select s.value ->> 'rule' from public.platform_settings s where s.key = 'jurimetry'), 'mercado-v1');
$$;

revoke all on function public.jurimetry_rule() from public, anon, authenticated;

-- A rule's number, so "mercado-v10" comes after "mercado-v9".
create or replace function public.jurimetry_rule_number(target_rule text)
returns integer
language sql
immutable
as $$
  select coalesce(nullif(substring(coalesce(target_rule, '') from '^mercado-v([0-9]+)$'), '')::integer, 0);
$$;

revoke all on function public.jurimetry_rule_number(text) from public, anon, authenticated;

-- ---------- The airline as the courts write it, short ----------
alter table public.airlines add column court_search_name text;
alter table public.airlines add constraint airlines_court_search_name_check check (
  court_search_name is null or char_length(court_search_name) between 3 and 80
);

update public.airlines a set court_search_name = v.name
from (values
  ('AD', 'AZUL LINHAS AEREAS'),
  ('G3', 'GOL LINHAS AEREAS'),
  ('LA', 'TAM LINHAS AEREAS'),
  ('2Z', 'PASSAREDO')
) as v (iata, name)
where a.iata = v.iata;

-- The captures by the long names pause; the short ones read the setting's days back.
update public.market_captures c set status = 'paused', updated_at = now()
from public.airlines a
where a.iata = c.airline_iata and a.court_search_name is not null and c.party <> a.court_search_name;

insert into public.market_captures (court, party, airline_iata, next_day)
select 'TJGO', a.court_search_name, a.iata, current_date - public.jurimetry_setting('days_back', 365)
from public.airlines a
where a.active and a.court_search_name is not null and exists (select 1 from public.courts c where c.acronym = 'TJGO')
on conflict (court, party) do nothing;

/**
 * Plans the reading of the courts of the firms' lawsuits (service role): each court a lawsuit not closed is in, for
 * each airline with its short name, from the setting's days back. Returns how many were planned.
 */
create or replace function public.market_plan_captures()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  planned integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  insert into public.market_captures (court, party, airline_iata, next_day)
  select k.acronym, a.court_search_name, a.iata, current_date - public.jurimetry_setting('days_back', 365)
  from (
    select distinct p.court as acronym from public.proceedings p
    join public.courts c on c.acronym = p.court
    where p.status <> 'closed'
  ) k
  cross join public.airlines a
  where a.active and a.court_search_name is not null
  on conflict (court, party) do nothing;
  get diagnostics planned = row_count;
  return planned;
end;
$$;

revoke all on function public.market_plan_captures() from public, anon, authenticated;
grant execute on function public.market_plan_captures() to service_role;

-- ---------- A day recorded by the rule in force ----------
drop function public.record_market_day(uuid, date, jsonb, boolean);

/**
 * Records a day of the market as read (service role) by the rule in force: its decisions, each once, a decision read
 * by an older rule read again in place (the operator's word on its reading cleared), and the day after is the next;
 * a day read in part is counted as such. A reading by an older rule is refused, and its day waits. Nothing of a
 * passenger is taken.
 */
create or replace function public.record_market_day(
  target_capture uuid,
  target_day date,
  target_decisions jsonb,
  target_complete boolean,
  target_rule text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  capture public.market_captures%rowtype;
  item jsonb;
  kept integer := 0;
  fresh boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.jurimetry_rule_number(target_rule) < public.jurimetry_rule_number(public.jurimetry_rule()) then
    raise exception 'rule_outdated' using errcode = '22023';
  end if;
  select * into capture from public.market_captures where id = target_capture for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if target_day is distinct from capture.next_day then
    return jsonb_build_object('ok', false, 'code', 'not_the_day');
  end if;
  for item in select * from jsonb_array_elements(coalesce(target_decisions, '[]'::jsonb)) loop
    -- The same decision under another key of the source: counted once, the copy dropped.
    if nullif(item ->> 'content_key', '') is not null and exists (
      select 1 from public.market_decisions m
      where m.content_key = item ->> 'content_key' and m.key <> left(item ->> 'key', 200)
    ) then
      delete from public.market_decisions where key = left(item ->> 'key', 200);
      continue;
    end if;
    begin
      fresh := null;
      insert into public.market_decisions (key, source, court, unit, judge, party, airline_iata, day, instance, result,
                                           moral_cents, per_claimant, problem, prior_complaint, extinction_reason,
                                           thesis, rule, content_key)
      values (
        left(item ->> 'key', 200), coalesce(item ->> 'source', 'djen'), capture.court,
        left(nullif(btrim(item ->> 'unit'), ''), 200), left(nullif(btrim(item ->> 'judge'), ''), 80),
        capture.party, capture.airline_iata, target_day, item ->> 'instance', item ->> 'result',
        nullif(item ->> 'moral_cents', '')::bigint, coalesce((item ->> 'per_claimant')::boolean, false),
        item ->> 'problem', coalesce((item ->> 'prior_complaint')::boolean, false),
        case when item ->> 'result' = 'extinto' then coalesce(nullif(item ->> 'extinction_reason', ''), 'outro') end,
        (select t.slug from public.jurimetry_theses t where t.slug = item ->> 'thesis'),
        target_rule, left(nullif(item ->> 'content_key', ''), 64)
      )
      on conflict (key) do update set
        unit = excluded.unit, judge = excluded.judge, instance = excluded.instance, result = excluded.result,
        moral_cents = excluded.moral_cents, per_claimant = excluded.per_claimant, problem = excluded.problem,
        prior_complaint = excluded.prior_complaint, extinction_reason = excluded.extinction_reason,
        thesis = excluded.thesis, rule = excluded.rule, content_key = excluded.content_key, read_at = now(),
        reading_ok = null, reading_checked_by = null, reading_checked_at = null
      where public.jurimetry_rule_number(market_decisions.rule) < public.jurimetry_rule_number(excluded.rule)
      returning (xmax = 0) into fresh;
      if fresh then
        kept := kept + 1;
      end if;
    exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range
                   or unique_violation then
      -- One decision that does not fit is left out alone.
      null;
    end;
  end loop;
  -- What an older rule kept of this day and the rule in force no longer reads as a decision (an enforcement phase
  -- ended by payment, a challenge to the amount) goes.
  delete from public.market_decisions d
  where d.court = capture.court and d.airline_iata is not distinct from capture.airline_iata and d.day = target_day
    and public.jurimetry_rule_number(d.rule) < public.jurimetry_rule_number(target_rule);
  update public.market_captures set
    next_day = target_day + 1, last_read_at = now(), last_error = null,
    read_days = read_days + 1, decisions = decisions + kept,
    incomplete_days = incomplete_days + case when coalesce(target_complete, true) then 0 else 1 end,
    updated_at = now()
  where id = capture.id;
  return jsonb_build_object('ok', true, 'code', 'recorded', 'kept', kept);
end;
$$;

revoke all on function public.record_market_day(uuid, date, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.record_market_day(uuid, date, jsonb, boolean, text) to service_role;

-- ---------- The forecast ----------

/** The market's problem of a case's incident. */
create or replace function public.market_problem_of(target_incident text)
returns text
language sql
immutable
as $$
  select case
    when target_incident in ('delay', 'missed_connection') then 'delay'
    when target_incident = 'cancellation' then 'cancellation'
    when target_incident = 'overbooking' then 'overbooking'
    when target_incident like 'baggage%' then 'baggage'
    when target_incident is null then null
    else 'other'
  end;
$$;

revoke all on function public.market_problem_of(text) from public, anon, authenticated;

/** The comarca a unit's name begins with, as the TJGO writes it ("Goiânia - 2ª UPJ ..."); null when it does not say. */
create or replace function public.market_comarca_of(target_unit text)
returns text
language sql
immutable
as $$
  select case when position(' - ' in coalesce(target_unit, '')) > 1 then btrim(split_part(target_unit, ' - ', 1)) end;
$$;

revoke all on function public.market_comarca_of(text) from public, anon, authenticated;

/** What a lawsuit's claimants may expect, on average: the chance times the median, by claimant; null without both. */
create or replace function public.market_expected_cents(target_chance integer, target_median bigint, target_claimants integer)
returns bigint
language sql
immutable
as $$
  select case when target_chance is not null and target_median is not null
    then round(target_chance::numeric / 100 * target_median)::bigint * greatest(coalesce(target_claimants, 1), 1) end;
$$;

revoke all on function public.market_expected_cents(integer, bigint, integer) from public, anon, authenticated;

/**
 * The market's forecast of a problem (internal): the cut nearest the case with at least 30 decisions on the merits,
 * else the broadest with the setting's sample, else null. The cuts, nearest first: the judge, the unit, the comarca,
 * the court and every court, each with the airline and then without; a cut needs what it names. `only_level` takes
 * one cut alone (1 to 10, null under the sample); `with_values` adds the moral damages set, in order, to place an
 * offer among them. First instance, the setting's months.
 */
create or replace function public.market_forecast_of(
  target_problem text,
  target_airline text,
  target_court text,
  target_comarca text,
  target_unit text,
  target_judge text,
  only_level integer default null,
  with_values boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  months integer := public.jurimetry_setting('months', 24);
  least_sample integer := public.jurimetry_setting('min_sample', 5);
  since date := (current_date - make_interval(months => months))::date;
  v_court text := nullif(upper(btrim(coalesce(target_court, ''))), '');
  v_airline text := nullif(upper(btrim(coalesce(target_airline, ''))), '');
  v_comarca text := nullif(public.plain_name(target_comarca), '');
  v_unit text := nullif(public.plain_name(target_unit), '');
  v_judge text := nullif(public.plain_name(target_judge), '');
  cut record;
  merits integer;
  c_n integer;
  c_level text;
  c_judge boolean;
  c_unit boolean;
  c_comarca boolean;
  c_court boolean;
  c_airline boolean;
  f_n integer;
  f_level text;
  f_judge boolean;
  f_unit boolean;
  f_comarca boolean;
  f_court boolean;
  f_airline boolean;
  ids uuid[];
  result jsonb;
begin
  if nullif(btrim(coalesce(target_problem, '')), '') is null then
    return null;
  end if;
  for cut in
    select v.n, v.level, v.by_judge, v.by_unit, v.by_comarca, v.by_court, v.by_airline from (values
      (1, 'judge', true, false, false, true, true),
      (2, 'judge', true, false, false, true, false),
      (3, 'unit', false, true, false, true, true),
      (4, 'unit', false, true, false, true, false),
      (5, 'comarca', false, false, true, true, true),
      (6, 'comarca', false, false, true, true, false),
      (7, 'court', false, false, false, true, true),
      (8, 'court', false, false, false, true, false),
      (9, 'all', false, false, false, false, true),
      (10, 'all', false, false, false, false, false)
    ) as v (n, level, by_judge, by_unit, by_comarca, by_court, by_airline)
    where (not v.by_judge or v_judge is not null) and (not v.by_unit or v_unit is not null)
      and (not v.by_comarca or v_comarca is not null) and (not v.by_court or v_court is not null)
      and (not v.by_airline or v_airline is not null)
      and (only_level is null or v.n = only_level)
    order by v.n
  loop
    select count(*) filter (where d.result in ('procedente', 'parcial', 'improcedente')) into merits
    from public.market_decisions d
    where d.instance = 'first' and d.day >= since and d.problem = target_problem
      and (not cut.by_court or d.court = v_court)
      and (not cut.by_judge or public.plain_name(d.judge) = v_judge)
      and (not cut.by_unit or public.plain_name(d.unit) = v_unit)
      and (not cut.by_comarca or public.plain_name(public.market_comarca_of(d.unit)) = v_comarca)
      and (not cut.by_airline or d.airline_iata = v_airline);
    if merits >= 30 and c_n is null then
      c_n := cut.n; c_level := cut.level; c_judge := cut.by_judge; c_unit := cut.by_unit;
      c_comarca := cut.by_comarca; c_court := cut.by_court; c_airline := cut.by_airline;
    end if;
    if merits >= least_sample then
      f_n := cut.n; f_level := cut.level; f_judge := cut.by_judge; f_unit := cut.by_unit;
      f_comarca := cut.by_comarca; f_court := cut.by_court; f_airline := cut.by_airline;
    end if;
  end loop;
  if c_n is null then
    c_n := f_n; c_level := f_level; c_judge := f_judge; c_unit := f_unit;
    c_comarca := f_comarca; c_court := f_court; c_airline := f_airline;
  end if;
  if c_n is null then
    return null;
  end if;

  select coalesce(array_agg(d.id), '{}') into ids
  from public.market_decisions d
  where d.instance = 'first' and d.day >= since and d.problem = target_problem
    and (not c_court or d.court = v_court)
    and (not c_judge or public.plain_name(d.judge) = v_judge)
    and (not c_unit or public.plain_name(d.unit) = v_unit)
    and (not c_comarca or public.plain_name(public.market_comarca_of(d.unit)) = v_comarca)
    and (not c_airline or d.airline_iata = v_airline);

  select jsonb_build_object(
    'cut', jsonb_build_object(
      'level', c_level, 'n', c_n,
      'court', case when c_court then v_court end,
      'comarca', case when c_comarca then target_comarca end,
      'unit', case when c_unit then target_unit end,
      'judge', case when c_judge then target_judge end,
      'airline', case when c_airline then v_airline end,
      'problem', target_problem),
    'decisions', count(*),
    'merits', count(*) filter (where d.result in ('procedente', 'parcial', 'improcedente')),
    'won', count(*) filter (where d.result in ('procedente', 'parcial')),
    'chance_percent', case when count(*) filter (where d.result in ('procedente', 'parcial', 'improcedente')) >= least_sample
      then round(100.0 * count(*) filter (where d.result in ('procedente', 'parcial'))
                 / count(*) filter (where d.result in ('procedente', 'parcial', 'improcedente'))) end,
    'outcomes', jsonb_build_object(
      'procedente', count(*) filter (where d.result = 'procedente'),
      'parcial', count(*) filter (where d.result = 'parcial'),
      'improcedente', count(*) filter (where d.result = 'improcedente'),
      'acordo', count(*) filter (where d.result = 'acordo'),
      'extinto', count(*) filter (where d.result = 'extinto')),
    'base', case
      when count(*) filter (where d.result in ('procedente', 'parcial', 'improcedente')) < 30 then 'pequena'
      when count(*) filter (where d.result in ('procedente', 'parcial', 'improcedente')) < 100 then 'media'
      else 'solida' end,
    'from', min(d.day), 'to', max(d.day), 'min_sample', least_sample,
    -- The courts the decisions come from, so a forecast of every court still says where it was read.
    'courts', coalesce(jsonb_agg(distinct d.court), '[]'::jsonb)
  ) into result
  from public.market_decisions d
  where d.id = any (ids);

  return result || jsonb_build_object(
    'moral', (
      select jsonb_build_object(
        'n', count(*),
        'p25_cents', case when count(*) >= least_sample then (percentile_cont(0.25) within group (order by m.moral_cents))::bigint end,
        'median_cents', case when count(*) >= least_sample then (percentile_cont(0.5) within group (order by m.moral_cents))::bigint end,
        'p75_cents', case when count(*) >= least_sample then (percentile_cont(0.75) within group (order by m.moral_cents))::bigint end)
        || case when with_values then jsonb_build_object('values', case when count(*) >= least_sample
             then (select jsonb_agg(v order by v) from unnest(array_agg(m.moral_cents)) v) end) else '{}'::jsonb end
      from public.market_decisions m
      where m.id = any (ids) and m.moral_cents is not null and not m.per_claimant
    ),
    'extinctions', coalesce((
      select jsonb_object_agg(e.reason, e.n)
      from (
        select coalesce(m.extinction_reason, 'outro') as reason, count(*) as n
        from public.market_decisions m where m.id = any (ids) and m.result = 'extinto'
        group by 1
      ) e
    ), '{}'::jsonb),
    'months', coalesce((
      select jsonb_agg(jsonb_build_object('month', t.month, 'merits', t.merits, 'won', t.won) order by t.month)
      from (
        select to_char(date_trunc('month', m.day), 'YYYY-MM') as month,
               count(*) filter (where m.result in ('procedente', 'parcial', 'improcedente')) as merits,
               count(*) filter (where m.result in ('procedente', 'parcial')) as won
        from public.market_decisions m where m.id = any (ids)
        group by 1
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.market_forecast_of(text, text, text, text, text, text, integer, boolean) from public, anon, authenticated;

/**
 * The market's forecast of a problem (0249, the intake's answers), now through the one rule: its signature, its keys
 * and its grant kept; a unit named as the TJGO names it gives its comarca too.
 */
create or replace function public.market_forecast(
  target_problem text,
  target_airline text default null,
  target_court text default null,
  target_unit text default null,
  target_judge text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return public.market_forecast_of(target_problem, target_airline, target_court,
    public.market_comarca_of(target_unit), target_unit, target_judge);
end;
$$;

revoke all on function public.market_forecast(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.market_forecast(text, text, text, text, text) to service_role;

/** The judge a lawsuit's course names among who answers for it (`proceeding_tracking.snapshot.responsibles`). */
create or replace function public.proceeding_judge(target_proceeding uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(btrim(r ->> 'name'), '')
  from public.proceeding_tracking t,
       jsonb_array_elements(case when jsonb_typeof(t.snapshot -> 'responsibles') = 'array' then t.snapshot -> 'responsibles' else '[]'::jsonb end) r
  where t.proceeding_id = target_proceeding and coalesce(r ->> 'role', '') ~* 'juiz'
  limit 1;
$$;

revoke all on function public.proceeding_judge(uuid) from public, anon, authenticated;

/**
 * A lawsuit's forecast (internal): the case's problem and airline, the lawsuit's court, comarca, unit and judge (the
 * judge only once distributed), its claimants; the forecast with the values set, what each level says beside it, what
 * the claimants may expect, and what the airline does at that unit (settlements and extinctions, every problem).
 */
create or replace function public.proceeding_forecast(target_proceeding uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  claim public.cases%rowtype;
  problem text;
  judge text;
  place_unit text;
  place_comarca text;
  claimants integer;
  forecast jsonb;
  months integer := public.jurimetry_setting('months', 24);
  least_sample integer := public.jurimetry_setting('min_sample', 5);
  since date;
  hearing jsonb;
  level_rows jsonb;
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return null;
  end if;
  select * into claim from public.cases where id = lawsuit.case_id;
  problem := public.market_problem_of(claim.incident);
  -- The unit and the judge only of a lawsuit already distributed (a lawsuit planned carries the unit its forum
  -- foresees, never the one the lottery gives): never to choose one.
  place_unit := case when lawsuit.status <> 'planned' then lawsuit.unit end;
  place_comarca := coalesce(nullif(btrim(lawsuit.comarca), ''), public.market_comarca_of(place_unit));
  judge := case when lawsuit.status <> 'planned' then public.proceeding_judge(lawsuit.id) end;
  select count(*) into claimants
  from public.proceeding_parties pp join public.case_parties cp on cp.id = pp.party_id
  where pp.proceeding_id = lawsuit.id and cp.role = 'claimant';
  forecast := public.market_forecast_of(problem, claim.airline_iata, lawsuit.court,
    place_comarca, place_unit, judge, null, true);

  -- Each level beside the chosen one: the judge (with the airline when it has the sample), the unit, the comarca and
  -- the court with the airline.
  select coalesce(jsonb_agg(x.row order by x.n), '[]'::jsonb) into level_rows
  from (
    select l.n, jsonb_build_object('level', f -> 'cut' ->> 'level', 'cut', f -> 'cut', 'merits', f -> 'merits',
      'won', f -> 'won', 'chance_percent', f -> 'chance_percent', 'median_cents', f -> 'moral' -> 'median_cents') as row
    from (values (1), (3), (5), (7)) as l (n)
    cross join lateral (
      select coalesce(
        public.market_forecast_of(problem, claim.airline_iata, lawsuit.court,
          place_comarca, place_unit, judge, l.n),
        case when l.n = 1 then public.market_forecast_of(problem, claim.airline_iata, lawsuit.court, null, null, judge, 2) end
      ) as f
    ) g
    where g.f is not null
  ) x;

  -- What the airline does at the nearest place with the sample: settlements and extinctions, every problem.
  since := (current_date - make_interval(months => months))::date;
  select jsonb_build_object('level', h.level, 'decisions', h.decisions, 'acordo', h.acordo, 'extinto', h.extinto)
  into hearing
  from (
    select s.level, count(*) as decisions,
           count(*) filter (where d.result = 'acordo') as acordo,
           count(*) filter (where d.result = 'extinto') as extinto,
           s.n
    from (values
      (1, 'unit', public.plain_name(place_unit), null::text),
      (2, 'comarca', null::text, public.plain_name(place_comarca)),
      (3, 'court', null::text, null::text)
    ) as s (n, level, unit_of, comarca_of)
    join public.market_decisions d
      on d.instance = 'first' and d.day >= since and d.court = upper(coalesce(lawsuit.court, ''))
     and (claim.airline_iata is null or d.airline_iata = claim.airline_iata)
     and (s.level <> 'unit' or (s.unit_of is not null and public.plain_name(d.unit) = s.unit_of))
     and (s.level <> 'comarca' or (s.comarca_of is not null and public.plain_name(public.market_comarca_of(d.unit)) = s.comarca_of))
    group by s.n, s.level
    having count(*) >= least_sample
    order by s.n
    limit 1
  ) h;
  if hearing is not null then
    hearing := hearing || jsonb_build_object('reasons', coalesce((
      select jsonb_object_agg(r.reason, r.n) from (
        select coalesce(d.extinction_reason, 'outro') as reason, count(*) as n
        from public.market_decisions d
        where d.instance = 'first' and d.day >= since and d.court = upper(coalesce(lawsuit.court, ''))
          and d.result = 'extinto'
          and (claim.airline_iata is null or d.airline_iata = claim.airline_iata)
          and (hearing ->> 'level' <> 'unit' or public.plain_name(d.unit) = public.plain_name(place_unit))
          and (hearing ->> 'level' <> 'comarca' or public.plain_name(public.market_comarca_of(d.unit))
               = public.plain_name(place_comarca))
        group by 1
      ) r
    ), '{}'::jsonb));
  end if;

  return jsonb_build_object(
    'proceeding', lawsuit.id,
    'case', claim.id,
    'stage', case when lawsuit.status = 'planned' then 'before' else 'distributed' end,
    'problem', problem,
    'airline', claim.airline_iata,
    'court', lawsuit.court,
    'comarca', place_comarca,
    'unit', place_unit,
    'judge', judge,
    'claimants', claimants,
    'forecast', forecast,
    'expected_cents', public.market_expected_cents((forecast ->> 'chance_percent')::integer,
      (forecast -> 'moral' ->> 'median_cents')::bigint, claimants),
    'levels', level_rows,
    'hearing', hearing,
    'rule', public.jurimetry_rule()
  );
end;
$$;

revoke all on function public.proceeding_forecast(uuid) from public, anon, authenticated;

/** The forecast of a hearing's lawsuit, for its guide (0246): the backend's, by the hearing. */
create or replace function public.hearing_forecast(target_hearing uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lawsuit uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select h.proceeding_id into lawsuit from public.hearings h where h.id = target_hearing;
  if lawsuit is null then
    return null;
  end if;
  return public.proceeding_forecast(lawsuit);
end;
$$;

revoke all on function public.hearing_forecast(uuid) from public, anon, authenticated;
grant execute on function public.hearing_forecast(uuid) to service_role;

/** A lawsuit's forecast, for the members of its firm: what the case's card and its hearing read. */
create or replace function public.case_forecast(target_proceeding uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select p.org_id into org from public.proceedings p where p.id = target_proceeding;
  if org is null or not public.is_org_member(org) then
    return null;
  end if;
  return public.proceeding_forecast(target_proceeding);
end;
$$;

revoke all on function public.case_forecast(uuid) from public, anon;
grant execute on function public.case_forecast(uuid) to authenticated;

-- ---------- Each open lawsuit's forecast, and the one it had when distributed ----------
create table public.case_forecasts (
  proceeding_id uuid primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  level text,
  merits integer,
  chance_percent integer,
  median_cents bigint,
  claimants integer not null default 0,
  expected_cents bigint,
  refreshed_at timestamptz not null default now(),
  -- What the forecast said the first time it was read of the lawsuit filed: what the judgment is compared with.
  distributed_at timestamptz,
  distributed_level text,
  distributed_merits integer,
  distributed_chance integer,
  distributed_median_cents bigint,
  foreign key (proceeding_id, org_id) references public.proceedings (id, org_id) on delete cascade,
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  constraint case_forecasts_chance_check check (chance_percent is null or chance_percent between 0 and 100),
  constraint case_forecasts_distributed_check check (distributed_chance is null or distributed_chance between 0 and 100)
);

create index case_forecasts_org_idx on public.case_forecasts (org_id);
create index case_forecasts_refreshed_idx on public.case_forecasts (refreshed_at);

alter table public.case_forecasts enable row level security;
create policy "case_forecasts_select_member" on public.case_forecasts
  for select to authenticated using (public.is_org_member(org_id));
revoke all on table public.case_forecasts from public, anon, authenticated;
grant select on table public.case_forecasts to authenticated;
create trigger guard_impersonation_case_forecasts after insert or update or delete on public.case_forecasts
  for each statement execute function public.guard_impersonation_readonly();

/**
 * Refreshes the forecast of the open lawsuits (service role), the oldest read first: each once a day, and at once a
 * lawsuit just distributed, whose forecast then is kept to compare with its judgment. Returns how many were read.
 */
create or replace function public.refresh_case_forecasts(target_limit integer default 40)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit record;
  answer jsonb;
  forecast jsonb;
  done integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  for lawsuit in
    select p.id, p.org_id, p.case_id, (p.status <> 'planned') as distributed
    from public.proceedings p
    join public.cases c on c.id = p.case_id
    left join public.case_forecasts f on f.proceeding_id = p.id
    where p.status <> 'closed' and c.closed_at is null
      and (f.proceeding_id is null or f.refreshed_at < now() - interval '20 hours'
           or (p.status <> 'planned' and f.distributed_at is null))
    order by (f.proceeding_id is null) desc, (p.status <> 'planned' and f.distributed_at is null) desc, f.refreshed_at nulls first
    limit greatest(least(coalesce(target_limit, 40), 200), 1)
  loop
    answer := public.proceeding_forecast(lawsuit.id);
    forecast := answer -> 'forecast';
    insert into public.case_forecasts as f (proceeding_id, org_id, case_id, level, merits, chance_percent, median_cents,
                                            claimants, expected_cents, refreshed_at,
                                            distributed_at, distributed_level, distributed_merits, distributed_chance,
                                            distributed_median_cents)
    values (
      lawsuit.id, lawsuit.org_id, lawsuit.case_id, forecast -> 'cut' ->> 'level', (forecast ->> 'merits')::integer,
      (forecast ->> 'chance_percent')::integer, (forecast -> 'moral' ->> 'median_cents')::bigint,
      coalesce((answer ->> 'claimants')::integer, 0), (answer ->> 'expected_cents')::bigint, now(),
      case when lawsuit.distributed and forecast ->> 'chance_percent' is not null then now() end,
      case when lawsuit.distributed and forecast ->> 'chance_percent' is not null then forecast -> 'cut' ->> 'level' end,
      case when lawsuit.distributed and forecast ->> 'chance_percent' is not null then (forecast ->> 'merits')::integer end,
      case when lawsuit.distributed then (forecast ->> 'chance_percent')::integer end,
      case when lawsuit.distributed and forecast ->> 'chance_percent' is not null then (forecast -> 'moral' ->> 'median_cents')::bigint end
    )
    on conflict (proceeding_id) do update set
      level = excluded.level, merits = excluded.merits, chance_percent = excluded.chance_percent,
      median_cents = excluded.median_cents, claimants = excluded.claimants, expected_cents = excluded.expected_cents,
      refreshed_at = now(),
      distributed_at = coalesce(f.distributed_at, excluded.distributed_at),
      distributed_level = case when f.distributed_at is null then excluded.distributed_level else f.distributed_level end,
      distributed_merits = case when f.distributed_at is null then excluded.distributed_merits else f.distributed_merits end,
      distributed_chance = case when f.distributed_at is null then excluded.distributed_chance else f.distributed_chance end,
      distributed_median_cents = case when f.distributed_at is null then excluded.distributed_median_cents else f.distributed_median_cents end;
    done := done + 1;
  end loop;
  return done;
end;
$$;

revoke all on function public.refresh_case_forecasts(integer) from public, anon, authenticated;
grant execute on function public.refresh_case_forecasts(integer) to service_role;

/**
 * The firm's forecast (its members): the open lawsuits with a forecast, what their claimants may expect in all, by
 * band of chance and by airline; and how the forecast came out, the forecast each lawsuit had when distributed beside
 * its first judgment the firm has (a fact confirmed), each lawsuit once. Test cases only when asked.
 */
create or replace function public.firm_forecast(target_org uuid, with_tests boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if target_org is null or not public.is_org_member(target_org) then
    return null;
  end if;
  return (
    with open_lawsuits as (
      select f.*, c.airline_iata
      from public.case_forecasts f
      join public.proceedings p on p.id = f.proceeding_id
      join public.cases c on c.id = f.case_id
      where f.org_id = target_org and p.status <> 'closed' and c.closed_at is null and (with_tests or not c.is_test)
    ),
    judged as (
      select f.distributed_chance,
             (select s.result from public.lawsuit_facts s
              where s.proceeding_id = f.proceeding_id and s.kind = 'sentenca' and s.confirmed
              order by s.happened_on, s.created_at limit 1) as result
      from public.case_forecasts f
      join public.cases c on c.id = f.case_id
      where f.org_id = target_org and f.distributed_chance is not null and (with_tests or not c.is_test)
    ),
    outcome as (select * from judged where result is not null)
    select jsonb_build_object(
      'refreshed_at', (select max(refreshed_at) from open_lawsuits),
      'with_forecast', (select count(*) from open_lawsuits where chance_percent is not null),
      'without_forecast', (select count(*) from open_lawsuits where chance_percent is null),
      'expected_cents', (select coalesce(sum(expected_cents), 0) from open_lawsuits),
      'bands', jsonb_build_object(
        'high', (select count(*) from open_lawsuits where chance_percent >= 80),
        'mid', (select count(*) from open_lawsuits where chance_percent between 60 and 79),
        'low', (select count(*) from open_lawsuits where chance_percent < 60)),
      'airlines', coalesce((
        select jsonb_agg(jsonb_build_object('airline', a.airline_iata,
                                            'name', (select l.name from public.airlines l where l.iata = a.airline_iata),
                                            'lawsuits', a.n, 'expected_cents', a.cents)
                         order by a.cents desc nulls last)
        from (select airline_iata, count(*) as n, sum(expected_cents) as cents
              from open_lawsuits where chance_percent is not null group by airline_iata) a
      ), '[]'::jsonb),
      'accuracy', jsonb_build_object(
        'judged', (select count(*) from outcome),
        'as_forecast', (select count(*) from outcome
                        where (result in ('procedente', 'parcial')) = (distributed_chance >= 50)),
        'forecast_percent', (select round(avg(distributed_chance)) from outcome),
        'won_percent', (select round(100.0 * count(*) filter (where result in ('procedente', 'parcial')) / nullif(count(*), 0))
                        from outcome),
        'min_sample', public.jurimetry_setting('min_sample', 5))
    )
  );
end;
$$;

revoke all on function public.firm_forecast(uuid, boolean) from public, anon;
grant execute on function public.firm_forecast(uuid, boolean) to authenticated;

-- ---------- The operator's word on the reading ----------

/** Says whether a decision was read right (the operator's): its result, value, problem and reason against the source. */
create or replace function public.admin_check_market_reading(target_decision uuid, target_ok boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_ok is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  update public.market_decisions
  set reading_ok = target_ok, reading_checked_by = auth.uid(), reading_checked_at = now()
  where id = target_decision;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'jurimetry.reading_checked', 'market_decision', target_decision::text,
          jsonb_build_object('ok', target_ok));
  return jsonb_build_object('ok', true, 'code', 'checked');
end;
$$;

revoke all on function public.admin_check_market_reading(uuid, boolean) from public, anon;
grant execute on function public.admin_check_market_reading(uuid, boolean) to authenticated;

/** How the reading's check goes (the operator's): decisions checked by the rule in force, and how many were right. */
create or replace function public.admin_market_reading()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'rule', public.jurimetry_rule(),
    'read_by_rule', (select count(*) from public.market_decisions where rule = public.jurimetry_rule()),
    'decisions', (select count(*) from public.market_decisions),
    'checked', (select count(*) from public.market_decisions where reading_ok is not null),
    'right', (select count(*) from public.market_decisions where reading_ok),
    'sample', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'key', d.key, 'court', d.court, 'unit', d.unit, 'day', d.day,
        'result', d.result, 'moral_cents', d.moral_cents, 'per_claimant', d.per_claimant, 'problem', d.problem,
        'extinction_reason', d.extinction_reason, 'judge', d.judge) order by d.day desc)
      from (
        select * from public.market_decisions
        where reading_ok is null and source = 'djen' and rule = public.jurimetry_rule()
        order by md5(id::text) limit 10
      ) d
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.admin_market_reading() from public, anon;
grant execute on function public.admin_market_reading() to authenticated;
