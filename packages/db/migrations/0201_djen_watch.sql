-- ============================================================
-- 0201 · The watch over the DJEN and the notice of a court that changes
-- its system (M3, sprint S10).
--
-- The DJEN is where the firms learn of their terms: when it stops answering,
-- or publishes its communications with no text, a term may run unseen. Once
-- an hour the backend takes one look at the public API (`djen_probes`): what
-- one state court made available on the last weekday, the courts taken in
-- turn, so each is seen about once a day. Each look records whether the API
-- answered, how long it took, how many communications the page held, how
-- many came with no text, and, by the kind of lawsuit each is of, which
-- system their links point to.
--
-- From the looks the database says:
--   * since when the DJEN does not answer (`djen_watch_state`): the operator
--     reads it in /admin/ai at once; a firm that reads the DJEN is told on its
--     center of what waits only past the setting's day, with what to do
--     (look at the intimations in the court's own system), since ONE tries
--     again by itself and a short outage asks nothing of a person;
--   * whether the gazette publishes its texts empty (the share of the day's
--     communications with no text);
--   * which courts' links now point mostly to another system than the
--     platform's table says (`court_system_signals`): a court that moves its
--     new lawsuits to another system shows in its links before any act is
--     read. The operator sees each signal beside the court's row, and a
--     person who approves the system ONE named for a lawsuit is shown the
--     signal of its court before approving.
--
-- Counts only: nothing of a party, a lawsuit or a firm is kept of a look.
-- ============================================================

insert into public.platform_settings (key, value)
values ('djen_watch', jsonb_build_object(
  -- How often the backend looks at the API, in minutes.
  'probe_minutes', 60,
  -- From how many hours without an answer a firm that reads the DJEN is told.
  'firm_down_hours', 24,
  -- From what share of the day's communications with no text the gazette is said to publish them empty.
  'empty_percent', 50,
  -- The days of looks a signal of another system reads, the least links it needs and the share they must reach.
  'signal_days', 30,
  'signal_min', 20,
  'signal_percent', 25,
  -- How long a look is kept.
  'keep_days', 90
))
on conflict (key) do nothing;

create or replace function public.djen_watch_setting(target_key text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (s.value ->> target_key)::integer from public.platform_settings s where s.key = 'djen_watch'), fallback);
$$;

revoke all on function public.djen_watch_setting(text, integer) from public, anon, authenticated;

create table public.djen_probes (
  id uuid primary key default gen_random_uuid(),
  court text not null references public.courts (acronym) on delete cascade,
  -- The day of Brasília the look asked for.
  day date not null,
  at timestamptz not null default now(),
  -- ok            the API answered a listing;
  -- error         it did not answer, refused, or answered what is no listing;
  -- rate_limited  it said the window of calls was spent (no outage).
  outcome text not null,
  latency_ms integer,
  items integer not null default 0,
  without_text integer not null default 0,
  -- Links by kind of lawsuit and system: {"juizado": {"projudi": 40, "pje": 3}}.
  systems jsonb not null default '{}'::jsonb,
  error text,
  constraint djen_probes_outcome_check check (outcome in ('ok', 'error', 'rate_limited')),
  constraint djen_probes_counts_check check (items >= 0 and without_text between 0 and items
    and (latency_ms is null or latency_ms >= 0)),
  constraint djen_probes_systems_check check (jsonb_typeof(systems) = 'object'),
  constraint djen_probes_error_check check (error is null or char_length(error) <= 200)
);

create index djen_probes_at_idx on public.djen_probes (at desc);
create index djen_probes_court_idx on public.djen_probes (court, at desc);

-- Nobody of a firm reads a look: the operator reads the watch through its functions.
alter table public.djen_probes enable row level security;
revoke all on table public.djen_probes from anon, authenticated;

/**
 * The court the backend looks at now (the backend's): none while the last look is newer than the setting's minutes;
 * else the state court looked at the longest ago, and the last weekday of Brasília before today.
 */
create or replace function public.djen_probe_due()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  last_at timestamptz;
  target text;
  target_day date := today - 1;
begin
  select max(p.at) into last_at from public.djen_probes p;
  if last_at is not null and last_at > now() - make_interval(mins => greatest(public.djen_watch_setting('probe_minutes', 60), 5)) then
    return null;
  end if;
  while extract(isodow from target_day) > 5 loop
    target_day := target_day - 1;
  end loop;
  select c.acronym into target
  from public.courts c
  left join lateral (select max(p.at) as at from public.djen_probes p where p.court = c.acronym) seen on true
  order by seen.at nulls first, c.acronym
  limit 1;
  if target is null then
    return null;
  end if;
  return jsonb_build_object('court', target, 'day', target_day);
end;
$$;

revoke all on function public.djen_probe_due() from public, anon, authenticated;
grant execute on function public.djen_probe_due() to service_role;

/** The backend records a look (and forgets the looks past the setting's days). Counts only. */
create or replace function public.record_djen_probe(
  target_court text,
  target_day date,
  target_outcome text,
  target_latency integer,
  target_items integer,
  target_without_text integer,
  target_systems jsonb,
  target_error text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  recorded uuid;
  clean jsonb := '{}'::jsonb;
  kind text;
  system text;
  n integer;
begin
  -- Only the kinds and systems the platform knows, each a count.
  for kind in select k from unnest(array['juizado', 'comum']) k loop
    if jsonb_typeof(coalesce(target_systems, '{}'::jsonb) -> kind) = 'object' then
      for system in select s from unnest(array['projudi', 'eproc', 'pje', 'esaj', 'outro']) s loop
        n := case when jsonb_typeof(target_systems -> kind -> system) = 'number'
                  then greatest((target_systems -> kind ->> system)::numeric, 0)::integer end;
        if coalesce(n, 0) > 0 then
          clean := jsonb_set(clean, array[kind], coalesce(clean -> kind, '{}'::jsonb) || jsonb_build_object(system, n));
        end if;
      end loop;
    end if;
  end loop;
  insert into public.djen_probes (court, day, outcome, latency_ms, items, without_text, systems, error)
  values (upper(btrim(target_court)), target_day, target_outcome, greatest(target_latency, 0),
    greatest(coalesce(target_items, 0), 0), least(greatest(coalesce(target_without_text, 0), 0), greatest(coalesce(target_items, 0), 0)),
    case when target_outcome = 'ok' then clean else '{}'::jsonb end, left(target_error, 200))
  returning id into recorded;
  delete from public.djen_probes where at < now() - make_interval(days => greatest(public.djen_watch_setting('keep_days', 90), 7));
  return recorded;
end;
$$;

revoke all on function public.record_djen_probe(text, date, text, integer, integer, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_djen_probe(text, date, text, integer, integer, integer, jsonb, text) to service_role;

/**
 * How the DJEN stands by the looks (internal): the last look, the last answer, since when it does not answer (the
 * first failed look after the last answer, when the latest failed), and the share of the last day's communications
 * that came with no text. A watch with no recent look says nothing of an outage: the reading may be off here.
 */
create or replace function public.djen_watch_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with last_probe as (
    select p.at, p.outcome from public.djen_probes p where p.outcome <> 'rate_limited' order by p.at desc limit 1
  ), last_ok as (
    select max(p.at) as at from public.djen_probes p where p.outcome = 'ok'
  ), down as (
    select min(p.at) as since from public.djen_probes p, last_ok
    where p.outcome = 'error' and (last_ok.at is null or p.at > last_ok.at)
  ), day as (
    select coalesce(sum(p.items), 0) as items, coalesce(sum(p.without_text), 0) as without_text
    from public.djen_probes p where p.outcome = 'ok' and p.at > now() - interval '24 hours'
  )
  select jsonb_build_object(
    'last_probe_at', (select at from last_probe),
    'last_ok_at', (select at from last_ok),
    'fresh', coalesce((select at > now() - make_interval(mins => 3 * greatest(public.djen_watch_setting('probe_minutes', 60), 5))
                       from last_probe), false),
    'down_since', case when (select outcome from last_probe) = 'error' then (select since from down) end,
    'day_items', (select items from day),
    'day_without_text', (select without_text from day),
    'empty', (select items >= 10 and without_text * 100 >= items * greatest(public.djen_watch_setting('empty_percent', 50), 1) from day)
  );
$$;

revoke all on function public.djen_watch_state() from public, anon, authenticated;

/**
 * The courts whose links point mostly to another system than the platform's table says (internal), from the looks
 * of the setting's days: for each court and kind, the system seen the most other than the table's, when it reaches
 * the setting's share and count. A court and kind the table does not have yet is a signal too.
 */
create or replace function public.court_system_signals()
returns table (court text, kind text, table_system text, confirmed boolean, seen_system text, seen integer, total integer,
               percent integer, first_seen date)
language sql
stable
security definer
set search_path = public
as $$
  with looks as (
    select p.court, k.key as kind, s.key as system, (s.value #>> '{}')::integer as n, p.day
    from public.djen_probes p,
         jsonb_each(p.systems) k,
         jsonb_each(k.value) s
    where p.outcome = 'ok'
      and p.day > (now() at time zone 'America/Sao_Paulo')::date - greatest(public.djen_watch_setting('signal_days', 30), 1)
  ), sums as (
    select l.court, l.kind, l.system, sum(l.n)::integer as n, min(l.day) as first_seen
    from looks l group by l.court, l.kind, l.system
  ), totals as (
    select s.court, s.kind, sum(s.n)::integer as total from sums s group by s.court, s.kind
  ), ranked as (
    select s.*, t.total, cs.system as table_system, coalesce(cs.confirmed, false) as confirmed,
           row_number() over (partition by s.court, s.kind order by s.n desc, s.system) as rank
    from sums s
    join totals t on t.court = s.court and t.kind = s.kind
    left join public.court_systems cs on cs.court = s.court and cs.proceeding_kind = s.kind
    where s.system is distinct from cs.system and s.system <> 'outro'
  )
  select r.court, r.kind, r.table_system, r.confirmed, r.system, r.n, r.total,
         (r.n * 100 / greatest(r.total, 1))::integer, r.first_seen
  from ranked r
  where r.rank = 1
    and r.n >= greatest(public.djen_watch_setting('signal_min', 20), 1)
    and r.n * 100 >= r.total * greatest(public.djen_watch_setting('signal_percent', 25), 1)
  order by r.court, r.kind;
$$;

revoke all on function public.court_system_signals() from public, anon, authenticated;

/**
 * The signal of a court and kind, for a person who approves the system ONE named for a lawsuit there (anybody signed
 * in: public facts of the gazette, nothing of a firm). Null when the links agree with the table.
 */
create or replace function public.court_system_signal(target_court text, target_kind text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.uid() is null then null else (
    select jsonb_build_object('seen_system', s.seen_system, 'seen', s.seen, 'total', s.total, 'percent', s.percent,
                              'first_seen', s.first_seen, 'table_system', s.table_system)
    from public.court_system_signals() s
    where s.court = upper(btrim(target_court)) and s.kind = target_kind
  ) end;
$$;

revoke all on function public.court_system_signal(text, text) from public, anon;
grant execute on function public.court_system_signal(text, text) to authenticated;

/**
 * What a firm that reads the DJEN is told of an outage (anybody of the firm): only past the setting's hours, with a
 * fresh look that failed, and only where the firm has a registration whose reading is on. Null otherwise.
 */
create or replace function public.firm_djen_outage(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  state jsonb;
  since timestamptz;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.djen_captures c where c.org_id = target_org and c.active) then
    return null;
  end if;
  state := public.djen_watch_state();
  since := (state ->> 'down_since')::timestamptz;
  if since is null or not coalesce((state ->> 'fresh')::boolean, false)
     or since > now() - make_interval(hours => greatest(public.djen_watch_setting('firm_down_hours', 24), 1)) then
    return null;
  end if;
  return jsonb_build_object('down_since', since, 'last_ok_at', state ->> 'last_ok_at');
end;
$$;

revoke all on function public.firm_djen_outage(uuid) from public, anon;
grant execute on function public.firm_djen_outage(uuid) to authenticated;

/** The operator's watch: how the DJEN stands, the latest looks and the signals of another system. */
create or replace function public.admin_djen_watch()
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
    'state', public.djen_watch_state(),
    'probes', coalesce((
      select jsonb_agg(jsonb_build_object('court', p.court, 'day', p.day, 'at', p.at, 'outcome', p.outcome,
               'latency_ms', p.latency_ms, 'items', p.items, 'without_text', p.without_text, 'error', p.error) order by p.at desc)
      from (select * from public.djen_probes order by at desc limit 30) p
    ), '[]'::jsonb),
    'signals', coalesce((
      select jsonb_agg(jsonb_build_object('court', s.court, 'kind', s.kind, 'table_system', s.table_system,
               'confirmed', s.confirmed, 'seen_system', s.seen_system, 'seen', s.seen, 'total', s.total,
               'percent', s.percent, 'first_seen', s.first_seen))
      from public.court_system_signals() s
    ), '[]'::jsonb),
    'courts_seen', (select count(distinct p.court) from public.djen_probes p
                    where p.at > now() - make_interval(days => greatest(public.djen_watch_setting('signal_days', 30), 1)))
  );
end;
$$;

revoke all on function public.admin_djen_watch() from public, anon;
grant execute on function public.admin_djen_watch() to authenticated;
