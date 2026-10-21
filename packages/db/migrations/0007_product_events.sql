-- ============================================================
-- 0007_product_events: usage telemetry.
--
-- Events, never content. One closed vocabulary of event names and ONE
-- allowlist of property keys and values, shared by the two writers:
--   * track_product_event()         a signed-in browser session;
--   * track_product_event_server()  the backend (server actions, the billing
--                                   webhook, jobs).
-- An event says that something happened in a firm, by whom and when. It never
-- carries a client's name, a case number, a document or a text somebody typed:
-- the allowlist below is what makes that true for every row.
--
-- The vocabulary starts with what the platform layer already reports (the
-- account, the firm, the purchase). The product's own events join it as each
-- milestone builds what they measure.
-- ============================================================

-- ---------- Vocabulary ----------

-- The single list of event names. The table check and both writers call it,
-- so adding an event is one `create or replace` of this function.
create or replace function public.product_event_known(event_name text)
returns boolean
language sql
immutable
as $$
  select event_name in (
    'account.created',
    'firm.created',
    'invite.accepted',
    'checkout.started',
    'kit.purchased',
    'subscription.started',
    'subscription.cancel_requested',
    'subscription.canceled',
    'upsell.viewed',
    'upsell.clicked',
    'upsell.purchased',
    'waitlist.joined'
  );
$$;

revoke all on function public.product_event_known(text) from public, anon;
grant execute on function public.product_event_known(text) to authenticated;

-- ---------- Events ----------

create table public.product_events (
  id bigint generated always as identity primary key,
  -- The firm it happened in. NULL for what happens before or outside a firm
  -- (a new account, a waitlist sign-up).
  org_id uuid references public.organizations (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  event_name text not null,
  properties jsonb not null default '{}'::jsonb,
  -- When it happened and when it arrived.
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint product_events_name_check check (public.product_event_known(event_name)),
  constraint product_events_properties_size_check check (octet_length(properties::text) <= 2048)
);

create index product_events_name_idx on public.product_events (event_name, occurred_at desc);
create index product_events_org_idx on public.product_events (org_id, event_name, occurred_at desc);
create index product_events_actor_idx on public.product_events (actor_id, created_at desc);
create index product_events_occurred_idx on public.product_events (occurred_at);

alter table public.product_events enable row level security;

-- Operational data: only the platform operator reads it.
create policy "product_events_select_superadmin" on public.product_events
  for select to authenticated
  using (public.is_superadmin());

grant select on table public.product_events to authenticated;

-- ---------- The property allowlist ----------

/**
 * Returns only the properties this platform agreed to store, each checked
 * against a closed set of VALUES. Anything else is dropped silently: ids, free
 * text, names, numbers of cases, paths. This function is the reason the table
 * can be read without a privacy review of every row.
 */
create or replace function public.product_event_sanitize(target_event text, target_properties jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  props jsonb := coalesce(target_properties, '{}'::jsonb);
begin
  if jsonb_typeof(props) <> 'object' then
    return '{}'::jsonb;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'platform', case when props ->> 'platform' in ('web', 'server') then props ->> 'platform' end,
    'role', case when props ->> 'role' in ('owner', 'admin', 'member') then props ->> 'role' end,
    'firm_function', case
      when props ->> 'firm_function' in ('socio', 'advogado', 'controladoria', 'atendimento')
        then props ->> 'firm_function'
    end,
    'tier_from', case when props ->> 'tier_from' in ('none', 'kit', 'club', 'pro') then props ->> 'tier_from' end,
    'tier_to', case when props ->> 'tier_to' in ('none', 'kit', 'club', 'pro') then props ->> 'tier_to' end,
    'period', case when props ->> 'period' in ('once', 'monthly', 'yearly') then props ->> 'period' end,
    'offer', case when props ->> 'offer' in ('kit', 'club', 'pro') then props ->> 'offer' end,
    'reason', case
      when props ->> 'reason' in (
        'too_expensive', 'not_using', 'missing_tool', 'switched', 'technical', 'temporary', 'other',
        'member', 'admin', 'suspended', 'canceled', 'refund'
      ) then props ->> 'reason'
    end,
    'origin', case
      when props ->> 'origin' in ('home', 'billing', 'menu', 'checkout', 'email', 'site') then props ->> 'origin'
    end,
    -- The entry door a campaign link named (`?origem=`): a short slug, never a
    -- sentence.
    'origem', case when lower(props ->> 'origem') ~ '^[a-z0-9][a-z0-9_-]{0,39}$' then lower(props ->> 'origem') end
  ));
end;
$$;

revoke all on function public.product_event_sanitize(text, jsonb) from public, anon, authenticated;

-- ---------- The one insert path ----------

-- Internal. Every writer ends here, so the allowlist cannot be skipped.
create or replace function public.product_event_insert(
  target_actor uuid,
  target_org uuid,
  target_event text,
  target_properties jsonb,
  target_occurred_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_org uuid := target_org;
  happened timestamptz := coalesce(target_occurred_at, now());
begin
  if target_actor is not null and resolved_org is null then
    select m.org_id into resolved_org
    from public.memberships m
    where m.user_id = target_actor
    order by m.created_at asc, m.id asc
    limit 1;
  end if;

  -- A clock we do not control is not evidence. Nothing in the future, nothing
  -- older than a week (a retried webhook), otherwise "now".
  if happened > now() + interval '5 minutes' or happened < now() - interval '7 days' then
    happened := now();
  end if;

  insert into public.product_events (org_id, actor_id, event_name, properties, occurred_at)
  values (
    resolved_org,
    (select p.id from public.profiles p where p.id = target_actor),
    target_event,
    public.product_event_sanitize(target_event, target_properties),
    happened
  );
end;
$$;

revoke all on function public.product_event_insert(uuid, uuid, text, jsonb, timestamptz) from public, anon, authenticated;

-- ---------- Writer 1: the browser session ----------

/**
 * What a signed-in browser may report on its own word: only what it alone can
 * see (an offer shown, an offer clicked). Purchases and everything else that
 * counts toward a metric come from the server writer.
 *
 * Never raises and never blocks the screen: an unknown event, a support
 * session or a caller over the hourly ceiling is dropped silently.
 */
create or replace function public.track_product_event(target_event text, target_properties jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then return; end if;
  if target_event is null or target_event not in ('upsell.viewed', 'upsell.clicked') then
    return;
  end if;
  -- A support visit must not show up as the person's behaviour.
  if public.is_impersonated() then return; end if;

  perform pg_advisory_xact_lock(hashtextextended('product-events:' || caller::text, 0));

  if (select count(*) from public.product_events
      where actor_id = caller and created_at > now() - interval '1 hour') >= 120 then
    return;
  end if;

  perform public.product_event_insert(
    caller,
    null,
    target_event,
    coalesce(target_properties, '{}'::jsonb) || jsonb_build_object('platform', 'web'),
    null
  );
end;
$$;

revoke all on function public.track_product_event(text, jsonb) from public, anon;
grant execute on function public.track_product_event(text, jsonb) to authenticated;

-- ---------- Writer 2: the backend ----------

/**
 * Records an event on behalf of a person (or of nobody: a waitlist sign-up has
 * no account). Service role only. Returns false when the event was dropped
 * because its name is not in the vocabulary.
 */
create or replace function public.track_product_event_server(
  target_actor uuid,
  target_org uuid,
  target_event text,
  target_properties jsonb default '{}'::jsonb,
  target_occurred_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    return false;
  end if;
  if target_event is null or not public.product_event_known(target_event) then
    return false;
  end if;

  perform public.product_event_insert(
    target_actor,
    target_org,
    target_event,
    coalesce(target_properties, '{}'::jsonb) || jsonb_build_object('platform', 'server'),
    target_occurred_at
  );
  return true;
end;
$$;

revoke all on function public.track_product_event_server(uuid, uuid, text, jsonb, timestamptz)
  from public, anon, authenticated;

-- ---------- Daily rollup and retention ----------

-- What the reports read. Raw events are kept 13 months; the rollup stays.
create table public.product_events_daily (
  day date not null,
  event_name text not null,
  events integer not null default 0,
  actors integer not null default 0,
  firms integer not null default 0,
  primary key (day, event_name)
);

alter table public.product_events_daily enable row level security;

create policy "product_events_daily_select_superadmin" on public.product_events_daily
  for select to authenticated
  using (public.is_superadmin());

grant select on table public.product_events_daily to authenticated;

-- Idempotent: recomputes one São Paulo day from the raw events.
create or replace function public.rollup_product_events(target_day date default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  day_to_roll date := coalesce(target_day, ((now() at time zone 'America/Sao_Paulo')::date - 1));
  written integer := 0;
begin
  if auth.role() is distinct from 'service_role' and not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  delete from public.product_events_daily where day = day_to_roll;

  insert into public.product_events_daily (day, event_name, events, actors, firms)
  select
    day_to_roll,
    e.event_name,
    count(*)::integer,
    count(distinct e.actor_id)::integer,
    count(distinct e.org_id)::integer
  from public.product_events e
  where (e.occurred_at at time zone 'America/Sao_Paulo')::date = day_to_roll
  group by e.event_name;
  get diagnostics written = row_count;

  return written;
end;
$$;

revoke all on function public.rollup_product_events(date) from public, anon;
grant execute on function public.rollup_product_events(date) to authenticated;

create or replace function public.purge_product_events(target_keep interval default interval '13 months')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  -- Never less than three months, whatever the caller asks.
  delete from public.product_events
  where occurred_at < now() - greatest(target_keep, interval '3 months');
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_product_events(interval) from public, anon, authenticated;
