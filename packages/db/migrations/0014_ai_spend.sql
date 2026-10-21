-- ============================================================
-- 0014_ai_spend: what the platform's use of AI costs.
--
-- Every model call the platform makes records one row here, charged to the
-- firm it was made for (or to nobody: platform overhead), so the cost is a
-- fact and not a guess. This is the money side only: what was asked, with
-- which prompt version, and who approved the answer belong to the AI runs.
--
-- Prices are configuration, never code: `platform_settings` key `ai_prices`,
-- per million tokens in US dollars, shipped EMPTY. A model with no price
-- produces `priced = false` and zero cost, and every report shows the count of
-- unpriced calls beside its total: a zero next to 400 unpriced calls is a
-- missing price list, not a cheap month. Cost is stored in USD micros
-- (millionths of a dollar), because a single call rounds to zero in cents.
--
-- Only the backend writes the ledger: a person able to record a spend could
-- invent the cost of their own firm.
-- ============================================================

create table public.ai_spend (
  id uuid primary key default gen_random_uuid(),
  -- NULL = platform overhead, charged to no firm.
  org_id uuid references public.organizations (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  -- What the money bought: the slug of the AI task (or `other`).
  feature text not null check (feature ~ '^[a-z][a-z0-9_.-]{0,63}$'),
  provider text not null,
  model text not null,
  tokens_in bigint not null default 0 check (tokens_in >= 0),
  tokens_out bigint not null default 0 check (tokens_out >= 0),
  cost_usd_micros bigint not null default 0 check (cost_usd_micros >= 0),
  priced boolean not null default false,
  ref_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.ai_spend is
  'Append-only ledger of AI provider spend, one row per billable call. org_id NULL = platform overhead.';

create index ai_spend_at_idx on public.ai_spend (occurred_at desc);
create index ai_spend_feature_idx on public.ai_spend (feature, occurred_at desc);

alter table public.ai_spend enable row level security;

create policy "ai_spend_select_superadmin" on public.ai_spend
  for select to authenticated
  using (public.is_superadmin());

grant select on table public.ai_spend to authenticated;

-- The price list, with `models` always present.
create or replace function public.ai_price_book()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (
      select case
        when ps.value -> 'models' is null then ps.value || jsonb_build_object('models', '{}'::jsonb)
        else ps.value
      end
      from public.platform_settings ps where ps.key = 'ai_prices'
    ),
    jsonb_build_object('models', '{}'::jsonb)
  );
$$;

revoke all on function public.ai_price_book() from public, anon, authenticated;

create or replace function public.ai_spend_cost(target_model text, target_tokens_in bigint, target_tokens_out bigint)
returns table (cost_usd_micros bigint, priced boolean)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  price jsonb;
  in_rate numeric;
  out_rate numeric;
begin
  price := public.ai_price_book() -> 'models' -> target_model;
  if price is null then
    return query select 0::bigint, false;
    return;
  end if;

  in_rate := nullif(price ->> 'inPerMillion', '')::numeric;
  out_rate := nullif(price ->> 'outPerMillion', '')::numeric;
  if in_rate is null and out_rate is null then
    return query select 0::bigint, false;
    return;
  end if;

  -- A price per million tokens, in dollars, IS the price per token in micros.
  return query select
    round(
      coalesce(target_tokens_in, 0) * coalesce(in_rate, 0)
      + coalesce(target_tokens_out, 0) * coalesce(out_rate, 0)
    )::bigint,
    true;
end;
$$;

revoke all on function public.ai_spend_cost(text, bigint, bigint) from public, anon, authenticated;

create or replace function public.record_ai_spend(
  target_org uuid,
  target_feature text,
  target_provider text,
  target_model text,
  target_tokens_in bigint default 0,
  target_tokens_out bigint default 0,
  target_ref uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  is_service boolean := coalesce(auth.role(), '') = 'service_role';
  priced_cost record;
  new_id uuid;
begin
  if not is_service then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select c.cost_usd_micros, c.priced into priced_cost
  from public.ai_spend_cost(target_model, coalesce(target_tokens_in, 0), coalesce(target_tokens_out, 0)) c;

  insert into public.ai_spend (
    org_id, feature, provider, model, tokens_in, tokens_out, cost_usd_micros, priced, ref_id, created_by
  ) values (
    target_org,
    case when target_feature ~ '^[a-z][a-z0-9_.-]{0,63}$' then target_feature else 'other' end,
    target_provider, target_model,
    coalesce(target_tokens_in, 0), coalesce(target_tokens_out, 0),
    priced_cost.cost_usd_micros, priced_cost.priced, target_ref, auth.uid()
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.record_ai_spend(uuid, text, text, text, bigint, bigint, uuid)
  from public, anon, authenticated;

-- Saving the price list re-prices the ledger, so the first weeks of
-- measurement are not stuck at zero.
create or replace function public.reprice_ai_spend(since timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  if not (public.is_superadmin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not_authorized';
  end if;

  with priced as (
    select s.id, c.cost_usd_micros, c.priced
    from public.ai_spend s
    cross join lateral public.ai_spend_cost(s.model, s.tokens_in, s.tokens_out) c
    where since is null or s.occurred_at >= since
  )
  update public.ai_spend s
  set cost_usd_micros = p.cost_usd_micros,
      priced = p.priced
  from priced p
  where p.id = s.id
    and (s.cost_usd_micros is distinct from p.cost_usd_micros or s.priced is distinct from p.priced);

  get diagnostics touched = row_count;
  return touched;
end;
$$;

revoke all on function public.reprice_ai_spend(timestamptz) from public, anon;
grant execute on function public.reprice_ai_spend(timestamptz) to authenticated;

create or replace function public.admin_ai_spend_overview(window_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result jsonb;
  window_since timestamptz;
  span integer := greatest(coalesce(window_days, 30), 1);
begin
  if not (public.is_superadmin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not_authorized';
  end if;

  window_since := now() - (span || ' days')::interval;

  with windowed as (
    select * from public.ai_spend where occurred_at >= window_since
  )
  select jsonb_build_object(
    'generatedAt', now(),
    'windowDays', span,
    'since', window_since,
    -- When measurement started, so a small number reads as "we only just began
    -- counting" instead of "the AI is nearly free".
    'measuringSince', (select min(occurred_at) from public.ai_spend),
    'usdToBrl', nullif(public.ai_price_book() ->> 'usdToBrl', '')::numeric,
    'pricedModels', (select count(*) from jsonb_object_keys(public.ai_price_book() -> 'models')),
    'totals', (
      select jsonb_build_object(
        'costUsdMicros', coalesce(sum(cost_usd_micros), 0),
        'calls', count(*),
        'unpricedCalls', count(*) filter (where not priced),
        'tokensIn', coalesce(sum(tokens_in), 0),
        'tokensOut', coalesce(sum(tokens_out), 0)
      )
      from windowed
    ),
    'byFeature', coalesce((
      select jsonb_agg(x.f order by x.cost desc)
      from (
        select
          coalesce(sum(cost_usd_micros), 0) as cost,
          jsonb_build_object(
            'feature', feature,
            'costUsdMicros', coalesce(sum(cost_usd_micros), 0),
            'calls', count(*),
            'unpricedCalls', count(*) filter (where not priced)
          ) as f
        from windowed group by feature
      ) x
    ), '[]'::jsonb),
    'byModel', coalesce((
      select jsonb_agg(x.m order by x.cost desc)
      from (
        select
          coalesce(sum(cost_usd_micros), 0) as cost,
          jsonb_build_object(
            'provider', provider,
            'model', model,
            'costUsdMicros', coalesce(sum(cost_usd_micros), 0),
            'calls', count(*),
            'priced', bool_or(priced)
          ) as m
        from windowed group by provider, model
      ) x
    ), '[]'::jsonb),
    -- What each firm cost, the fifty that cost the most. A NULL `orgId` is the
    -- platform's own calls, charged to no firm. `firmsWithSpend` says how many
    -- there are in all, so a cut list is never read as the whole of it.
    'firmsWithSpend', (select count(distinct org_id) from windowed where org_id is not null),
    'byFirm', coalesce((
      select jsonb_agg(x.f order by x.cost desc, x.calls desc, x.name)
      from (
        select
          coalesce(sum(w.cost_usd_micros), 0) as cost,
          count(*) as calls,
          coalesce(o.name, '') as name,
          jsonb_build_object(
            'orgId', w.org_id,
            'name', o.name,
            'costUsdMicros', coalesce(sum(w.cost_usd_micros), 0),
            'calls', count(*),
            'unpricedCalls', count(*) filter (where not w.priced)
          ) as f
        from windowed w
        left join public.organizations o on o.id = w.org_id
        group by w.org_id, o.name
        order by 1 desc, 2 desc
        limit 50
      ) x
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_ai_spend_overview(integer) from public, anon;
grant execute on function public.admin_ai_spend_overview(integer) to authenticated;

insert into public.platform_settings (key, value, is_public)
values ('ai_prices', '{"models": {}}'::jsonb, false)
on conflict (key) do nothing;
