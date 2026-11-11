-- ============================================================
-- The jurimetry (0190), phase 5 of the case journey plan: how the courts
-- decide passengers' lawsuits, read from the market's public decisions, by
-- unit and by judge, to prepare a piece and to project, never to choose a
-- judge (distribution is by lottery, CPC, art. 285; the natural judge
-- holds, CF, art. 5º, XXXVII and LIII; choosing a judge is a sign of
-- abusive litigation, Recomendação CNJ 159/2024).
--
-- 5.1 The sources: what is read is planned per court and airline
-- (`market_captures`, a day at a time from the setting's days back, the
-- airline as its company is named in court), read by `packages/jurimetrics`
-- (the DJEN's public API, slowly, within its window), and of each decision
-- ONE keeps only the decision, the unit, the judge and the airline
-- (`market_decisions`): never a passenger's name nor the lawsuit's number.
-- 5.2 The unit's profile, 5.4 the judge's (`market_profile`): decisions
-- read, the success rate, the median moral damages by kind of problem, the
-- extinctions for want of a prior complaint (what item 3.5 reads); each
-- number with its sample, and nothing of fewer than five becomes a rate or
-- a median. 5.3 The theses: a catalog that is data (`jurimetry_theses`, the
-- words each is read by), each decision's grounds read against it by rule at
-- the moment it is read (the text is never kept); in the shadow until the
-- operator checked a sample and the reading met the setting's goal, and
-- only then read by the piece (`unit_theses_for_piece`). 5.5 The projection
-- (`market_projection`): by unit, kind of problem and airline.
-- ============================================================

create table public.jurimetry_theses (
  slug text primary key,
  name text not null,
  -- Whether it favours the passenger or the airline.
  side text not null,
  position integer not null,
  -- The words the rule reads it by, in a decision's grounds without accents and in lower case (`teses-v1`).
  patterns text[] not null,
  constraint jurimetry_theses_slug_check check (slug ~ '^[a-z][a-z0-9_]{2,60}$'),
  constraint jurimetry_theses_side_check check (side in ('favor', 'contra')),
  constraint jurimetry_theses_patterns_check check (cardinality(patterns) between 1 and 20)
);

alter table public.jurimetry_theses enable row level security;
create policy "jurimetry_theses_select_all" on public.jurimetry_theses for select to authenticated using (true);
grant select on table public.jurimetry_theses to authenticated;

insert into public.jurimetry_theses (slug, name, side, position, patterns) values
  ('fortuito_interno', 'Problema técnico ou operacional é risco da companhia (fortuito interno)', 'favor', 10,
   array['fortuito interno', 'risco da atividade', 'manutencao (nao programada|da aeronave)']),
  ('dano_moral_presumido', 'Dano moral presumido pelo atraso ou cancelamento', 'favor', 20,
   array['dano moral (presumido|in re ipsa)', 'in re ipsa']),
  ('falta_de_assistencia', 'Falta de assistência material ao passageiro', 'favor', 30,
   array['assistencia material', 'sem (alimentacao|hospedagem)']),
  ('forca_maior_clima', 'Força maior por condições meteorológicas', 'contra', 40,
   array['condicoes meteorologicas', 'forca maior', 'mau tempo']),
  ('mero_aborrecimento', 'Mero aborrecimento, sem dano moral', 'contra', 50,
   array['mero aborrecimento', 'mero dissabor']),
  ('falta_de_prova_do_dano', 'O dano moral precisa ser provado', 'contra', 60,
   array['dano moral nao (e|se) presum', 'nao (comprovou|demonstrou) [a-z ]{0,40}(abalo|dano)']),
  ('reacomodacao_razoavel', 'O passageiro foi reacomodado em tempo razoável', 'contra', 70,
   array['reacomodad[oa] [a-z ]{0,60}(razoavel|mesmo dia)']),
  ('suspensao_tema_1417', 'Suspensão pelo Tema 1.417 do STF', 'contra', 80,
   array['tema 1\.?417'])
on conflict (slug) do nothing;

create table public.market_captures (
  id uuid primary key default gen_random_uuid(),
  court text not null references public.courts (acronym) on delete cascade,
  -- The airline as its company is named in court, which the DJEN is asked by.
  party text not null,
  airline_iata text references public.airlines (iata) on delete set null,
  -- The next day to read.
  next_day date not null,
  status text not null default 'active',
  last_read_at timestamptz,
  last_error text,
  read_days integer not null default 0,
  decisions integer not null default 0,
  -- Days that held more than one reading takes: said, never taken as whole.
  incomplete_days integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (court, party),
  constraint market_captures_status_check check (status in ('active', 'paused')),
  constraint market_captures_party_check check (char_length(party) between 3 and 200),
  constraint market_captures_error_check check (last_error is null or last_error ~ '^[a-z][a-z0-9_]{1,59}$')
);

alter table public.market_captures enable row level security;
revoke all on table public.market_captures from public, anon, authenticated;

create table public.market_decisions (
  id uuid primary key default gen_random_uuid(),
  -- The source's own key (the DJEN's hash): a decision is read once, and the operator opens it at the source by it.
  key text not null unique,
  source text not null,
  court text not null,
  unit text,
  judge text,
  party text not null,
  airline_iata text references public.airlines (iata) on delete set null,
  day date not null,
  instance text not null,
  result text not null,
  moral_cents bigint,
  per_claimant boolean not null default false,
  problem text not null,
  prior_complaint boolean not null default false,
  -- The thesis the rule read in its grounds (`teses-v1`), in the shadow until released; and the operator's word.
  thesis text references public.jurimetry_theses (slug) on delete set null,
  thesis_checked text,
  checked_by uuid references public.profiles (id) on delete set null,
  checked_at timestamptz,
  rule text not null default 'mercado-v1',
  read_at timestamptz not null default now(),
  constraint market_decisions_source_check check (source in ('djen', 'fake')),
  constraint market_decisions_instance_check check (instance in ('first', 'appeal')),
  constraint market_decisions_result_check check (result in ('procedente', 'parcial', 'improcedente', 'acordo', 'extinto')),
  constraint market_decisions_problem_check check (problem in ('delay', 'cancellation', 'overbooking', 'baggage', 'other')),
  constraint market_decisions_moral_check check (moral_cents is null or moral_cents between 1 and 100000000),
  -- The operator's word is a slug of the catalog or `nenhuma`, checked by the function that writes it.
  constraint market_decisions_checked_check check (thesis_checked is null or thesis_checked ~ '^[a-z][a-z0-9_]{2,60}$')
);

create index market_decisions_unit_idx on public.market_decisions (court, public.plain_name(unit), day);
create index market_decisions_judge_idx on public.market_decisions (court, public.plain_name(judge), day) where judge is not null;
create index market_decisions_airline_idx on public.market_decisions (court, airline_iata, problem, day);

alter table public.market_decisions enable row level security;
revoke all on table public.market_decisions from public, anon, authenticated;

-- What is read: TJGO first (the pilot's court), each company of the operators as named in court, from the setting's
-- days back.
insert into public.platform_settings (key, value)
values ('jurimetry', jsonb_build_object(
  'days_back', 180, 'days_per_run', 4, 'min_sample', 5, 'months', 24,
  'theses_released', false, 'theses_min_checked', 30, 'theses_min_agreement', 90
))
on conflict (key) do nothing;

insert into public.market_captures (court, party, airline_iata, next_day)
select 'TJGO', a.legal_name, a.iata, current_date - 180
from public.airlines a
where a.active and a.legal_name is not null and exists (select 1 from public.courts c where c.acronym = 'TJGO')
on conflict (court, party) do nothing;

/** The setting `jurimetry`'s number of a key, or the default. */
create or replace function public.jurimetry_setting(target_key text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (s.value ->> target_key)::integer from public.platform_settings s where s.key = 'jurimetry'), fallback);
$$;

revoke all on function public.jurimetry_setting(text, integer) from public, anon, authenticated;

/** Whether the reading of the theses was released to the profiles and the pieces (5.3). */
create or replace function public.jurimetry_theses_released()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (s.value ->> 'theses_released')::boolean from public.platform_settings s where s.key = 'jurimetry'), false);
$$;

revoke all on function public.jurimetry_theses_released() from public, anon, authenticated;

/** The days of the market owed a reading now (service role): the oldest reading first, a few a run. */
create or replace function public.market_days_due(target_limit integer default 4)
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
  return coalesce((
    select jsonb_agg(jsonb_build_object('capture_id', c.id, 'court', c.court, 'party', c.party, 'day', c.next_day)
                     order by c.last_read_at nulls first, c.next_day)
    from (
      select * from public.market_captures m
      where m.status = 'active' and m.next_day < (now() at time zone 'America/Sao_Paulo')::date
        -- A reading that failed waits a while before the same day is asked again.
        and (m.last_error is null or m.last_read_at < now() - interval '30 minutes')
      order by m.last_read_at nulls first, m.next_day
      limit greatest(least(coalesce(target_limit, 4), 20), 1)
    ) c
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.market_days_due(integer) from public, anon, authenticated;
grant execute on function public.market_days_due(integer) to service_role;

/**
 * Records a day of the market as read (service role): its decisions, each once (the thesis the rule read kept in the
 * shadow), and the day after is the next; a day read in part is counted as such. Nothing of a passenger is taken.
 */
create or replace function public.record_market_day(target_capture uuid, target_day date, target_decisions jsonb, target_complete boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  capture public.market_captures%rowtype;
  item jsonb;
  kept integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into capture from public.market_captures where id = target_capture for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if target_day is distinct from capture.next_day then
    return jsonb_build_object('ok', false, 'code', 'not_the_day');
  end if;
  for item in select * from jsonb_array_elements(coalesce(target_decisions, '[]'::jsonb)) loop
    begin
      insert into public.market_decisions (key, source, court, unit, judge, party, airline_iata, day, instance, result,
                                           moral_cents, per_claimant, problem, prior_complaint, thesis)
      values (
        left(item ->> 'key', 200), coalesce(item ->> 'source', 'djen'), capture.court,
        left(nullif(btrim(item ->> 'unit'), ''), 200), left(nullif(btrim(item ->> 'judge'), ''), 80),
        capture.party, capture.airline_iata, target_day, item ->> 'instance', item ->> 'result',
        nullif(item ->> 'moral_cents', '')::bigint, coalesce((item ->> 'per_claimant')::boolean, false),
        item ->> 'problem', coalesce((item ->> 'prior_complaint')::boolean, false),
        (select t.slug from public.jurimetry_theses t where t.slug = item ->> 'thesis')
      )
      on conflict (key) do nothing;
      if found then
        kept := kept + 1;
      end if;
    exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
      -- One decision that does not fit is left out alone.
      null;
    end;
  end loop;
  update public.market_captures set
    next_day = target_day + 1, last_read_at = now(), last_error = null,
    read_days = read_days + 1, decisions = decisions + kept,
    incomplete_days = incomplete_days + case when coalesce(target_complete, true) then 0 else 1 end,
    updated_at = now()
  where id = capture.id;
  return jsonb_build_object('ok', true, 'code', 'recorded', 'kept', kept);
end;
$$;

revoke all on function public.record_market_day(uuid, date, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.record_market_day(uuid, date, jsonb, boolean) to service_role;

/** A reading of the market that failed (service role): the day stays the next, tried again after a while. */
create or replace function public.record_market_error(target_capture uuid, target_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.market_captures
  set last_read_at = now(),
      last_error = coalesce(substring(lower(coalesce(target_error, '')) from '^[a-z][a-z0-9_]{1,59}'), 'failed'),
      updated_at = now()
  where id = target_capture;
end;
$$;

revoke all on function public.record_market_error(uuid, text) from public, anon, authenticated;
grant execute on function public.record_market_error(uuid, text) to service_role;

/** The median of a set of values, or null for fewer than the sample asks. */
create or replace function public.market_median(target_values bigint[], target_min integer)
returns bigint
language sql
immutable
as $$
  select case when coalesce(cardinality(target_values), 0) >= target_min
    then (select (percentile_cont(0.5) within group (order by v))::bigint from unnest(target_values) as v) end;
$$;

revoke all on function public.market_median(bigint[], integer) from public, anon, authenticated;

/** The numbers of a set of decisions, each with its sample: nothing of fewer than the setting's five is a rate or a median. */
create or replace function public.market_numbers(target_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  least_sample integer := public.jurimetry_setting('min_sample', 5);
  released boolean := public.jurimetry_theses_released();
  result jsonb;
begin
  select jsonb_build_object(
    'decisions', count(*),
    'merits', count(*) filter (where d.result in ('procedente', 'parcial', 'improcedente')),
    'won', count(*) filter (where d.result in ('procedente', 'parcial')),
    'success_percent', case when count(*) filter (where d.result in ('procedente', 'parcial', 'improcedente')) >= least_sample
      then round(100.0 * count(*) filter (where d.result in ('procedente', 'parcial'))
                 / count(*) filter (where d.result in ('procedente', 'parcial', 'improcedente'))) end,
    'settlements', count(*) filter (where d.result = 'acordo'),
    'extinct', count(*) filter (where d.result = 'extinto'),
    'prior_complaint', count(*) filter (where d.prior_complaint),
    'prior_complaint_percent', case when count(*) >= least_sample
      then round(100.0 * count(*) filter (where d.prior_complaint) / count(*)) end,
    'from', min(d.day), 'to', max(d.day)
  ) into result
  from public.market_decisions d
  where d.id = any (target_ids);
  return result || jsonb_build_object(
    'min_sample', least_sample,
    'theses_released', released,
    'moral', coalesce((
      select jsonb_object_agg(p.problem, jsonb_build_object('n', p.n, 'median_cents', p.median))
      from (
        select m.problem, count(*) as n, public.market_median(array_agg(m.moral_cents), least_sample) as median
        from public.market_decisions m
        where m.id = any (target_ids) and m.moral_cents is not null and not m.per_claimant
        group by m.problem
      ) p
    ), '{}'::jsonb),
    'theses', case when released then coalesce((
      select jsonb_agg(jsonb_build_object('slug', t.slug, 'name', t.name, 'side', t.side, 'n', t.n) order by t.n desc)
      from (
        select j.slug, j.name, j.side, count(*) as n from public.market_decisions m
        join public.jurimetry_theses j on j.slug = m.thesis
        where m.id = any (target_ids)
        group by j.slug, j.name, j.side
        having count(*) >= least_sample
      ) t
    ), '[]'::jsonb) end
  );
end;
$$;

revoke all on function public.market_numbers(uuid[]) from public, anon, authenticated;

/**
 * How a unit decides, and its judge (5.2, 5.4): the market's decisions of the unit (and of the judge, when named) in
 * the setting's months, as numbers with their samples, beside the whole court's. Public data, read by anybody signed
 * in; only to prepare and to project. A unit or a judge is matched by the words the court writes, without accents.
 */
create or replace function public.market_profile(target_court text, target_unit text, target_judge text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  months integer := public.jurimetry_setting('months', 24);
  acronym text := upper(coalesce(target_court, ''));
  since date := (current_date - make_interval(months => months))::date;
  unit_ids uuid[];
  judge_ids uuid[];
  court_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select coalesce(array_agg(d.id), '{}') into unit_ids from public.market_decisions d
  where d.court = acronym and d.instance = 'first' and d.day >= since
    and target_unit is not null and public.plain_name(d.unit) = public.plain_name(target_unit);
  if nullif(btrim(coalesce(target_judge, '')), '') is not null then
    select coalesce(array_agg(d.id), '{}') into judge_ids from public.market_decisions d
    where d.court = acronym and d.day >= since and public.plain_name(d.judge) = public.plain_name(target_judge);
  end if;
  select coalesce(array_agg(d.id), '{}') into court_ids from public.market_decisions d
  where d.court = acronym and d.instance = 'first' and d.day >= since;
  return jsonb_build_object(
    'unit', public.market_numbers(unit_ids),
    'judge', case when judge_ids is null then null else public.market_numbers(judge_ids) end,
    'court', public.market_numbers(court_ids)
  );
end;
$$;

revoke all on function public.market_profile(text, text, text) from public, anon;
grant execute on function public.market_profile(text, text, text) to authenticated;

/**
 * The projection by unit (5.5): for a court, an airline and a kind of problem (each optional), each unit's numbers in
 * the setting's months, the most decisions first. Public data, read by anybody signed in.
 */
create or replace function public.market_projection(target_court text, target_airline text default null, target_problem text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  months integer := public.jurimetry_setting('months', 24);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('unit', u.unit, 'numbers', public.market_numbers(u.ids)) order by cardinality(u.ids) desc)
    from (
      select min(d.unit) as unit, array_agg(d.id) as ids
      from public.market_decisions d
      where d.court = upper(coalesce(target_court, '')) and d.instance = 'first' and d.unit is not null
        and d.day >= (current_date - make_interval(months => months))::date
        and (target_airline is null or d.airline_iata = target_airline)
        and (target_problem is null or d.problem = target_problem)
      group by public.plain_name(d.unit)
      order by count(*) desc
      limit 40
    ) u
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.market_projection(text, text, text) from public, anon;
grant execute on function public.market_projection(text, text, text) to authenticated;

/**
 * The theses of the unit of a piece's lawsuit (5.3), once the operator released the reading of the theses: each
 * with how many of the unit's decisions it won and lost in, of the setting's sample at least. Service role, for the
 * worker of a piece, by the draft; nothing while the theses are in the shadow.
 */
create or replace function public.unit_theses_for_piece(target_draft uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  least_sample integer := public.jurimetry_setting('min_sample', 5);
  months integer := public.jurimetry_setting('months', 24);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.jurimetry_theses_released() then
    return null;
  end if;
  select p.* into lawsuit from public.case_drafts d join public.proceedings p on p.id = d.proceeding_id
  where d.id = target_draft;
  if not found or lawsuit.unit is null then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('tese', t.name, 'lado', t.side, 'acolhida', t.won, 'rejeitada', t.lost)
                     order by t.won + t.lost desc)
    from (
      select j.name, j.side,
             count(*) filter (where d.result in ('procedente', 'parcial')) as won,
             count(*) filter (where d.result = 'improcedente') as lost
      from public.market_decisions d
      join public.jurimetry_theses j on j.slug = d.thesis
      where d.court = lawsuit.court and public.plain_name(d.unit) = public.plain_name(lawsuit.unit)
        and d.day >= (current_date - make_interval(months => months))::date
      group by j.name, j.side
      having count(*) >= least_sample
    ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.unit_theses_for_piece(uuid) from public, anon, authenticated;
grant execute on function public.unit_theses_for_piece(uuid) to service_role;

-- ---------- The operator's ----------

/** How the reading of the market goes (the operator's): each court and airline read, how far, and what failed. */
create or replace function public.admin_market_health()
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
    'captures', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'court', c.court, 'party', c.party, 'airline', c.airline_iata,
        'next_day', c.next_day, 'status', c.status, 'last_read_at', c.last_read_at, 'last_error', c.last_error,
        'read_days', c.read_days, 'decisions', c.decisions, 'incomplete_days', c.incomplete_days) order by c.court, c.party)
      from public.market_captures c
    ), '[]'::jsonb),
    'decisions', (select count(*) from public.market_decisions),
    'theses', jsonb_build_object(
      'released', public.jurimetry_theses_released(),
      'checked', (select count(*) from public.market_decisions where thesis_checked is not null),
      'agreed', (select count(*) from public.market_decisions
                 where thesis_checked is not null and coalesce(thesis, 'nenhuma') = thesis_checked),
      'min_checked', public.jurimetry_setting('theses_min_checked', 30),
      'min_agreement', public.jurimetry_setting('theses_min_agreement', 90)
    )
  );
end;
$$;

revoke all on function public.admin_market_health() from public, anon;
grant execute on function public.admin_market_health() to authenticated;

/** Decisions to check the reading of the theses against (the operator's): never checked, the latest first, with their key at the source. */
create or replace function public.admin_market_thesis_sample(target_limit integer default 10)
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
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', d.id, 'key', d.key, 'court', d.court, 'unit', d.unit, 'day', d.day,
                                        'result', d.result, 'thesis', d.thesis) order by d.day desc)
    from (
      select * from public.market_decisions where thesis_checked is null and source = 'djen'
      order by day desc limit greatest(least(coalesce(target_limit, 10), 50), 1)
    ) d
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_market_thesis_sample(integer) from public, anon;
grant execute on function public.admin_market_thesis_sample(integer) to authenticated;

/** The operator says which thesis a decision rests on, read at the source (`nenhuma` for none), on the record. */
create or replace function public.admin_check_market_thesis(target_decision uuid, target_thesis text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_thesis is distinct from 'nenhuma'
     and not exists (select 1 from public.jurimetry_theses t where t.slug = target_thesis) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  update public.market_decisions set thesis_checked = target_thesis, checked_by = auth.uid(), checked_at = now()
  where id = target_decision;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  insert into public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'jurimetry.thesis_checked', 'market_decision', target_decision::text,
          jsonb_build_object('thesis', target_thesis));
  return jsonb_build_object('ok', true, 'code', 'checked');
end;
$$;

revoke all on function public.admin_check_market_thesis(uuid, text) from public, anon;
grant execute on function public.admin_check_market_thesis(uuid, text) to authenticated;

/**
 * The operator releases the reading of the theses to the profiles and the pieces, or holds it again (5.3): released
 * only once the setting's sample was checked and the rule agreed with the operator in the setting's share of it.
 * With the second factor, on the record.
 */
create or replace function public.admin_release_market_theses(target_released boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  checked integer := (select count(*) from public.market_decisions where thesis_checked is not null);
  agreed integer := (select count(*) from public.market_decisions
                     where thesis_checked is not null and coalesce(thesis, 'nenhuma') = thesis_checked);
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.is_aal2() then
    return jsonb_build_object('ok', false, 'code', 'second_factor');
  end if;
  if coalesce(target_released, false)
     and (checked < public.jurimetry_setting('theses_min_checked', 30)
          or 100 * agreed < public.jurimetry_setting('theses_min_agreement', 90) * checked) then
    return jsonb_build_object('ok', false, 'code', 'goal_not_met', 'checked', checked, 'agreed', agreed);
  end if;
  update public.platform_settings set value = value || jsonb_build_object('theses_released', coalesce(target_released, false))
  where key = 'jurimetry';
  insert into public.audit_events (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), 'jurimetry.theses_released', 'platform_setting', 'jurimetry',
          jsonb_build_object('released', coalesce(target_released, false), 'checked', checked, 'agreed', agreed));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.admin_release_market_theses(boolean) from public, anon;
grant execute on function public.admin_release_market_theses(boolean) to authenticated;

-- A ninth version of `caso.peca.minuta`: a piece reads the theses of its unit, once released.
insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'caso.peca.minuta',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'caso.peca.minuta'),
  v.provider, v.model, v.effort,
  v.system_prompt || E'\n\nTeses da unidade: quando os fatos trouxerem "teses_da_unidade", são as teses que as decisões deste juízo costumam acolher e rejeitar, com quantas decisões cada uma. Use-as para escolher e ordenar os fundamentos, respondendo de antemão às que favorecem a companhia; não diga na peça que leu as decisões do juízo nem cite números delas.',
  v.output_schema, v.max_tokens, false,
  'A peça lê as teses que o juízo costuma acolher e rejeitar.'
from public.prompt_versions v
where v.task = 'caso.peca.minuta' and v.is_active
  and strpos(v.system_prompt, 'teses_da_unidade') = 0;

update public.prompt_versions as v set is_active = false
where v.task = 'caso.peca.minuta' and v.is_active
  and strpos(v.system_prompt, 'teses_da_unidade') = 0
  and exists (
    select 1 from public.prompt_versions w
    where w.task = v.task and w.version > v.version and strpos(w.system_prompt, 'teses_da_unidade') > 0
  );
update public.prompt_versions set is_active = true
where task = 'caso.peca.minuta'
  and version = (select max(w.version) from public.prompt_versions w where w.task = 'caso.peca.minuta')
  and strpos(system_prompt, 'teses_da_unidade') > 0;
