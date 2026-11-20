-- 0255_ai_provider_health
--
-- The platform's AI account, as the runs found it (2026-11-20). Anthropic refused ONE's key from 2026-11-06 to
-- 2026-11-20: every run failed with no token spent, each work that asked spent its tries and was given up (a firm's
-- power of attorney sent in its setup among them, "o ONE tentou algumas vezes e não conseguiu"), and nobody was told.
--
-- * A run that fails because the provider refused the platform's account (`provider_account`: a key it does not know,
--   no credit; `@flyee/ai/errors`) marks its provider down (`ai_provider_health`, by a trigger on `ai_runs`); the first
--   run of that provider that succeeds marks it up again. Nothing here is a firm's: the account is the platform's.
-- * While a provider is down the backend pauses the sweeps whose tasks it answers (`ai_providers_down`, with the tasks
--   whose instructions in force name it, read by the sweeps' runner), so no firm's work spends a try on it, and asks the provider once a beat whether the account is
--   back (`record_ai_provider_check`).
-- * The operator is told once when a provider goes down and once when it comes back (`claim_ai_health_alerts`, the
--   bell and the e-mail of each operator), and reads how each provider stands in `/admin/ai` (`admin_ai_health`).
-- * A person of a firm reads only whether the platform's AI is down and since when (`platform_ai_status`): a screen
--   whose work waits for it says so, never the provider nor the reason.

-- ---------- How each provider stands ----------

create table public.ai_provider_health (
  provider text primary key,
  -- Set while the provider refuses the platform's account; null when it answers.
  down_since timestamptz,
  last_failure_at timestamptz,
  -- Runs refused since it went down.
  failures integer not null default 0,
  -- The model of the last run refused: the check of the account asks it again.
  model text,
  last_ok_at timestamptz,
  -- The last time the backend asked the provider whether the account is back.
  checked_at timestamptz,
  recovered_at timestamptz,
  -- The moment the outage it came back from began: its return is told only when that outage was.
  recovered_from timestamptz,
  -- The outage and the return the operator was told of (the moments themselves, so each is told once).
  alerted_down timestamptz,
  alerted_up timestamptz,
  constraint ai_provider_health_provider_check check (provider ~ '^[a-z][a-z0-9_-]{1,39}$'),
  constraint ai_provider_health_failures_check check (failures >= 0)
);

alter table public.ai_provider_health enable row level security;
-- Read and written only through the functions below.
revoke all on table public.ai_provider_health from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_provider_health to service_role;

/** Marks a provider down when one of its runs is refused for the platform's account, and up when one succeeds. */
create or replace function public.ai_runs_provider_health()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'failed' and new.error_code = 'provider_account'
     and (tg_op = 'INSERT' or old.status is distinct from new.status or old.error_code is distinct from new.error_code) then
    insert into public.ai_provider_health as h (provider, down_since, last_failure_at, failures, model)
    values (new.provider, now(), now(), 1, new.model)
    on conflict (provider) do update
    set down_since = coalesce(h.down_since, now()),
        last_failure_at = now(),
        failures = case when h.down_since is null then 1 else h.failures + 1 end,
        model = excluded.model;
  elsif new.status = 'succeeded' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    -- Only a provider that was down is written: the run of every day touches nothing here.
    update public.ai_provider_health h
    set down_since = null, recovered_at = now(), recovered_from = h.down_since, last_ok_at = now()
    where h.provider = new.provider and h.down_since is not null;
  end if;
  return null;
end;
$$;

revoke all on function public.ai_runs_provider_health() from public, anon, authenticated;

create trigger ai_runs_provider_health
  after insert or update of status, error_code on public.ai_runs
  for each row execute function public.ai_runs_provider_health();

-- ---------- What the backend reads and writes ----------

/**
 * The providers down, for the backend's sweeps (none: the AI works): each with the model to ask again and the tasks
 * whose instructions in force name it, so a work waits only for the provider its own tasks use.
 */
create or replace function public.ai_providers_down()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'provider', h.provider,
      'model', h.model,
      'since', h.down_since,
      'tasks', (
        select coalesce(jsonb_agg(distinct v.task), '[]'::jsonb)
        from public.prompt_versions v
        where v.is_active and v.provider = h.provider
      )
    ) order by h.provider),
    '[]'::jsonb)
  from public.ai_provider_health h
  where h.down_since is not null;
$$;

revoke all on function public.ai_providers_down() from public, anon, authenticated;
grant execute on function public.ai_providers_down() to service_role;

/**
 * What the backend's check of the account found: `true`, the provider answered (it is up again); `false`, it refused
 * the account again. A check that could not reach the provider is not recorded.
 */
create or replace function public.record_ai_provider_check(target_provider text, target_ok boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  was_down boolean;
begin
  if target_provider is null or target_ok is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  select h.down_since is not null into was_down from public.ai_provider_health h where h.provider = target_provider
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if target_ok then
    update public.ai_provider_health h
    set down_since = null,
        recovered_at = case when was_down then now() else h.recovered_at end,
        recovered_from = case when was_down then h.down_since else h.recovered_from end,
        last_ok_at = now(),
        checked_at = now()
    where h.provider = target_provider;
    return jsonb_build_object('ok', true, 'code', case when was_down then 'recovered' else 'up' end);
  end if;
  update public.ai_provider_health h set checked_at = now() where h.provider = target_provider;
  return jsonb_build_object('ok', true, 'code', 'still_down');
end;
$$;

revoke all on function public.record_ai_provider_check(text, boolean) from public, anon, authenticated;
grant execute on function public.record_ai_provider_check(text, boolean) to service_role;

/**
 * What the operator is owed a word on, each once: a provider that went down, and one that came back after the
 * operator was told it was down. Claimed here (the moment told is kept), then sent by the backend.
 */
create or replace function public.claim_ai_health_alerts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  owed jsonb;
begin
  with down as (
    update public.ai_provider_health h
    set alerted_down = h.down_since
    where h.down_since is not null and h.alerted_down is distinct from h.down_since
    returning jsonb_build_object('provider', h.provider, 'kind', 'down', 'at', h.down_since, 'failures', h.failures)
      as alert
  ), up as (
    update public.ai_provider_health h
    set alerted_up = h.recovered_at
    where h.down_since is null and h.recovered_at is not null and h.alerted_down = h.recovered_from
      and h.alerted_up is distinct from h.recovered_at
    returning jsonb_build_object('provider', h.provider, 'kind', 'up', 'at', h.recovered_at, 'since', h.recovered_from)
      as alert
  )
  select coalesce(jsonb_agg(alert), '[]'::jsonb) into owed
  from (select alert from down union all select alert from up) owed_alerts;
  return owed;
end;
$$;

revoke all on function public.claim_ai_health_alerts() from public, anon, authenticated;
grant execute on function public.claim_ai_health_alerts() to service_role;

-- ---------- What people read ----------

/** Whether the platform's AI is down, and since when: for any person of a firm, never the provider nor the reason. */
create or replace function public.platform_ai_status()
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
  return (
    select jsonb_build_object('down', count(*) > 0, 'since', min(h.down_since))
    from public.ai_provider_health h
    where h.down_since is not null
  );
end;
$$;

revoke all on function public.platform_ai_status() from public, anon;
grant execute on function public.platform_ai_status() to authenticated;

/** How each provider stands (the operator's). */
create or replace function public.admin_ai_health()
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
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'provider', h.provider,
      'down_since', h.down_since,
      'failures', h.failures,
      'model', h.model,
      'last_failure_at', h.last_failure_at,
      'last_ok_at', h.last_ok_at,
      'checked_at', h.checked_at,
      'recovered_at', h.recovered_at
    ) order by h.down_since nulls last, h.provider), '[]'::jsonb)
    from public.ai_provider_health h
  );
end;
$$;

revoke all on function public.admin_ai_health() from public, anon;
grant execute on function public.admin_ai_health() to authenticated;
