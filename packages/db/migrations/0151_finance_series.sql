-- ============================================================
-- 0151 · O ONE faz uma série das contas que se repetem
--
-- The plan of the finance, phase 5: ONE makes a series of the bills it sees
-- three months in a row in the statement. A movement of the books (an
-- expense or an income, not a transfer nor a client's money) is the same
-- bill when it has the same counterparty (or, with none, the same words of
-- the bank's memo without its numbers), the same way of the money and a
-- value within the setting's 20 percent of the others; seen once in each of
-- the last three whole months, and in no series and no bill still open of
-- the same counterparty and way, it becomes a series of ONE's
-- (`finance_series`), and ONE writes its next month's bill on the day of the
-- month it is usually paid (a source of its own, `series`, marked as ONE's).
-- Each month the sweep writes the next one, and the statement settles it as
-- any bill. A person stops a series with the reason (`stop_finance_series`,
-- the second factor): its bills still open are cancelled with that reason,
-- and that counterparty is never made a series again by ONE.
--
--   finance_series            each series ONE made: who, the way, the
--                             category, the value, the day, the state;
--   finance_series_round      the backend's: finds what repeats and writes
--                             the bills owed, for one firm;
--   finance_series_sweep      the backend's: every firm with its books open;
--   firm_finance_series       what who reads the books sees;
--   stop_finance_series       a person stops one.
-- ============================================================

update public.platform_settings
set value = jsonb_build_object('series_months', 3, 'series_spread_percent', 20, 'series_ahead_days', 31) || value
where key = 'finance' and not value ? 'series_months';

create table public.finance_series (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  direction text not null,
  -- What tells the bill apart: the counterparty's words, or the memo's without its numbers.
  match_key text not null,
  counterparty text,
  category_id uuid references public.finance_categories (id) on delete set null,
  cents bigint not null,
  day integer not null,
  status text not null default 'active',
  last_due_on date,
  created_at timestamptz not null default now(),
  stopped_at timestamptz,
  stopped_by uuid references public.profiles (id) on delete set null,
  stopped_reason text,
  unique (id, org_id),
  unique (org_id, direction, match_key),
  constraint finance_series_direction_check check (direction in ('pay', 'receive')),
  constraint finance_series_status_check check (status in ('active', 'stopped')),
  constraint finance_series_cents_check check (cents > 0),
  constraint finance_series_day_check check (day between 1 and 28),
  constraint finance_series_key_check check (char_length(match_key) between 3 and 200),
  constraint finance_series_stop_check check (
    (status = 'stopped') = (stopped_at is not null)
    and (stopped_reason is null or char_length(stopped_reason) between 3 and 300)
  )
);

alter table public.finance_series enable row level security;
create policy "finance_series_select_reader" on public.finance_series
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_series to authenticated;
create trigger guard_impersonation_finance_series after insert or update or delete on public.finance_series
  for each statement execute function public.guard_impersonation_readonly();

/** What tells two movements apart as one bill: the counterparty's words, else the memo's without its numbers. */
create or replace function public.finance_series_key(target_counterparty text, target_memo text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(left(public.slugify(coalesce(
    nullif(btrim(target_counterparty), ''),
    nullif(btrim(regexp_replace(coalesce(target_memo, ''), '[0-9]+', ' ', 'g')), '')
  )), 200), '');
$$;

revoke all on function public.finance_series_key(text, text) from public, anon, authenticated;

/**
 * For one firm (the backend's): finds what repeated in each of the last whole months the setting asks, makes each a
 * series of ONE's, and writes the bill each active series owes within the setting's days ahead. Answers how many
 * series it made and how many bills it wrote.
 */
create or replace function public.finance_series_round(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  months integer := public.finance_setting('series_months', 3);
  spread integer := public.finance_setting('series_spread_percent', 20);
  ahead integer := public.finance_setting('series_ahead_days', 31);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  first_month date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) - make_interval(months => months))::date;
  this_month date := date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date;
  made integer := 0;
  written integer := 0;
  series public.finance_series%rowtype;
  due date;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if (select o.finance_opened_on from public.organizations o where o.id = target_org) is null then
    return jsonb_build_object('series', 0, 'bills', 0);
  end if;

  -- What repeated: one movement in each of the last whole months, of values close to each other.
  with moves as (
    select case when e.cents < 0 then 'pay' else 'receive' end as direction,
      public.finance_series_key(e.counterparty, l.memo) as match_key,
      e.counterparty, e.category_id, abs(e.cents) as cents, e.occurred_on,
      date_trunc('month', e.occurred_on)::date as month
    from public.finance_entries e
    left join public.finance_statement_lines l on l.id = e.statement_line_id
    where e.org_id = target_org and e.cancelled_at is null and e.kind in ('expense', 'income')
      and e.occurred_on >= first_month and e.occurred_on < this_month
      -- The payment of a bill a person or a series keeps is that bill's: never a series of its own.
      and not exists (select 1 from public.finance_bill_payments p where p.entry_id = e.id and p.undone_at is null)
  ),
  grouped as (
    select direction, match_key,
      (array_agg(counterparty order by occurred_on desc) filter (where counterparty is not null))[1] as counterparty,
      (array_agg(category_id order by occurred_on desc) filter (where category_id is not null))[1] as category_id,
      round(percentile_cont(0.5) within group (order by cents))::bigint as cents,
      least(28, greatest(1, round(avg(extract(day from occurred_on)))::integer)) as day,
      count(*) as moves, count(distinct month) as months_seen, min(cents) as least_cents, max(cents) as most_cents
    from moves
    where match_key is not null
    group by direction, match_key
  )
  insert into public.finance_series (org_id, direction, match_key, counterparty, category_id, cents, day)
  select target_org, g.direction, g.match_key, left(g.counterparty, 120), g.category_id, g.cents, g.day
  from grouped g
  where g.moves = months and g.months_seen = months
    and g.most_cents * 100 <= g.least_cents * (100 + spread)
    -- A bill a person keeps of the same counterparty and way is theirs: ONE makes no series beside it.
    and not exists (
      select 1 from public.finance_bills b
      where b.org_id = target_org and b.direction = g.direction and b.status = 'open'
        and public.finance_series_key(b.counterparty, null) = g.match_key
    )
  on conflict (org_id, direction, match_key) do nothing;
  get diagnostics made = row_count;

  -- The bill each active series owes: one at a time, the next on its day once the one before is no longer open,
  -- within the days ahead, never one already written.
  for series in
    select * from public.finance_series s where s.org_id = target_org and s.status = 'active'
      and not exists (select 1 from public.finance_bills b where b.series_id = s.id and b.org_id = s.org_id and b.status = 'open')
    for update
  loop
    due := make_date(extract(year from today)::integer, extract(month from today)::integer, series.day);
    if due < today then
      due := (due + interval '1 month')::date;
    end if;
    if series.last_due_on is not null and due <= series.last_due_on then
      due := (series.last_due_on + interval '1 month')::date;
    end if;
    if due > today + ahead then
      continue;
    end if;
    insert into public.finance_bills (org_id, direction, counterparty, category_id, cents, due_on, competence_on,
      series_id, source, by_one)
    values (target_org, series.direction, series.counterparty, series.category_id, series.cents, due,
      date_trunc('month', due)::date, series.id, 'series', true);
    update public.finance_series set last_due_on = due where id = series.id;
    written := written + 1;
  end loop;

  if made > 0 then
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, null, 'finance.series_made', 'firm', target_org::text, jsonb_build_object('series', made, 'auto', true));
  end if;
  return jsonb_build_object('series', made, 'bills', written);
end;
$$;

revoke all on function public.finance_series_round(uuid) from public, anon, authenticated;
grant execute on function public.finance_series_round(uuid) to service_role;

/** Every firm with its books open (the backend's daily sweep), a few at a time. */
create or replace function public.finance_series_sweep(target_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  firm uuid;
  answer jsonb;
  made integer := 0;
  written integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  for firm in
    select o.id from public.organizations o where o.finance_opened_on is not null order by o.id
    limit least(greatest(coalesce(target_limit, 200), 1), 2000)
  loop
    answer := public.finance_series_round(firm);
    made := made + coalesce((answer ->> 'series')::integer, 0);
    written := written + coalesce((answer ->> 'bills')::integer, 0);
  end loop;
  return jsonb_build_object('series', made, 'bills', written);
end;
$$;

revoke all on function public.finance_series_sweep(integer) from public, anon, authenticated;
grant execute on function public.finance_series_sweep(integer) to service_role;

/** The firm's series, for who reads the books: each with its next bill still open. */
create or replace function public.firm_finance_series(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.finance_reads(target_org) then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'direction', s.direction, 'counterparty', s.counterparty,
      'category', (select c.name from public.finance_categories c where c.id = s.category_id),
      'cents', s.cents, 'day', s.day, 'status', s.status, 'created_at', s.created_at,
      'stopped_at', s.stopped_at, 'stopped_reason', s.stopped_reason,
      'next_due_on', (select min(b.due_on) from public.finance_bills b
                      where b.series_id = s.id and b.org_id = s.org_id and b.status = 'open')
    ) order by s.status, s.counterparty)
    from public.finance_series s where s.org_id = target_org
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.firm_finance_series(uuid) from public, anon;
grant execute on function public.firm_finance_series(uuid) to authenticated;

/** A person stops a series ONE made, with the reason: its bills still open are cancelled with it. The second factor. */
create or replace function public.stop_finance_series(target_org uuid, target_series uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
  series public.finance_series%rowtype;
  cancelled integer;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if reason is null or char_length(reason) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'reason');
  end if;
  select * into series from public.finance_series s where s.id = target_series and s.org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if series.status = 'stopped' then
    return jsonb_build_object('ok', true, 'cancelled', 0);
  end if;
  update public.finance_series set status = 'stopped', stopped_at = now(), stopped_by = auth.uid(), stopped_reason = reason
  where id = series.id;
  update public.finance_bills set status = 'cancelled', closed_at = now(), closed_by = auth.uid(), closed_reason = reason
  where org_id = target_org and series_id = series.id and status = 'open' and paid_cents = 0;
  get diagnostics cancelled = row_count;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.series_stopped', 'finance_series', series.id::text,
    jsonb_build_object('cancelled', cancelled));
  return jsonb_build_object('ok', true, 'cancelled', cancelled);
end;
$$;

revoke all on function public.stop_finance_series(uuid, uuid, text) from public, anon;
grant execute on function public.stop_finance_series(uuid, uuid, text) to authenticated;
