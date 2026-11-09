-- ============================================================
-- 0119 · A leitura do tribunal que parou é tentada de novo, toda semana
--
-- Phase 1 of the plan of the controladoria: "Tenta de novo, uma vez por
-- semana e até três vezes, uma leitura do tribunal que parou, antes de chamar
-- uma pessoa."
--
-- A reading given up after its attempts (0031: no answer from the source, a
-- claim never finished, an answer that could not be kept) went to a person at
-- once. It now pauses (`paused`): ONE starts it over a week later
-- (`retry_days`, 7) with its attempts back, up to the setting's three times
-- (`weekly_retries`), and only a reading that stops after the last is
-- `failed`, which calls a person: the home counts it and the list's view of the
-- lawsuits that moved shows it (`firm_today.tracking_failed`, `firm_cases`),
-- both of which read `failed` alone, so a paused reading calls nobody. A source
-- that answers (the lawsuit read, in secret, or not shown yet) starts the count
-- over, as another number does. A person may still ask for a reading at any
-- time, of a paused reading as of one given up. The firm's movements not seen
-- yet stay counted while the reading waits.
-- ============================================================

update public.platform_settings
set value = value || '{"weekly_retries": 3, "retry_days": 7}'::jsonb
where key = 'tracking' and not (value ? 'weekly_retries');

alter table public.proceeding_tracking
  add column retry_rounds integer not null default 0,
  add column retry_at timestamptz;

comment on column public.proceeding_tracking.retry_rounds is
  'How many times ONE started over a reading that stopped, since the source last answered for it (0119).';
comment on column public.proceeding_tracking.retry_at is
  'When ONE starts over a paused reading; only of a paused one (0119).';

alter table public.proceeding_tracking drop constraint proceeding_tracking_status_check;
alter table public.proceeding_tracking add constraint proceeding_tracking_status_check check (
  status in ('waiting', 'tracked', 'not_found', 'secret', 'paused', 'failed', 'off')
);
alter table public.proceeding_tracking add constraint proceeding_tracking_retry_check check (
  retry_rounds >= 0 and ((status = 'paused') = (retry_at is not null))
);

create index proceeding_tracking_retry_idx on public.proceeding_tracking (retry_at) where status = 'paused';

/**
 * Keeps the weekly retries true whatever writes the row: a day to start over belongs to a paused reading alone, and a
 * source that answered (or another number, or a lawsuit no longer read) starts the count over.
 */
create or replace function public.proceeding_tracking_retries()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'paused' then
    new.retry_at := null;
  end if;
  if new.cnj is distinct from old.cnj or new.status in ('tracked', 'secret', 'not_found', 'off') then
    new.retry_rounds := 0;
  end if;
  return new;
end;
$$;
revoke all on function public.proceeding_tracking_retries() from public, anon, authenticated;

create trigger proceeding_tracking_retries before update on public.proceeding_tracking
  for each row execute function public.proceeding_tracking_retries();

/**
 * Claims the readings owed (or the one named), from the sources the backend
 * can read now: each with the number of its claim and the lawsuit's number.
 * A person's request comes first (one the source has not answered since);
 * `target_requested_only` claims nothing else (the hours a source is read in
 * by routine have not come). A lawsuit of a case that ended is not read. A
 * claim never finished goes back first, and is given up after its attempts
 * (a request it held is then answered: given up), paused while ONE still
 * starts it over (0119); a paused reading whose day came starts over with its
 * attempts back. `first_read` is a lawsuit never read whole. Service role only.
 */
create or replace function public.claim_proceeding_reads(
  target_sources text[],
  target_limit integer default 10,
  target_requested_only boolean default false,
  target_tracking uuid default null
)
returns table (tracking_id uuid, claim integer, cnj text, source text, first_read boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  minutes integer := greatest(public.tracking_setting('working_minutes', 20), 1);
  tries integer := greatest(public.tracking_setting('max_attempts', 5), 1);
  weekly integer := greatest(public.tracking_setting('weekly_retries', 3), 0);
  days integer := greatest(public.tracking_setting('retry_days', 7), 1);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.proceeding_tracking t
  set work_claimed_at = null,
      status = case
        when t.work_attempts < tries then t.status
        when t.retry_rounds < weekly then 'paused'
        else 'failed'
      end,
      retry_at = case
        when t.work_attempts >= tries and t.retry_rounds < weekly then now() + make_interval(days => days)
        else t.retry_at
      end,
      next_read_at = case when t.work_attempts >= tries then null else t.next_read_at end,
      requested_at = case when t.work_attempts >= tries then null else t.requested_at end,
      work_error = case when t.work_attempts >= tries then 'abandoned' else t.work_error end
  where t.work_claimed_at is not null and t.work_claimed_at < now() - make_interval(mins => minutes);

  -- A reading that stopped, its week past: ONE starts it over, once more of the setting's times.
  update public.proceeding_tracking t
  set status = 'waiting', next_read_at = now(), work_attempts = 0, work_error = null,
      retry_rounds = t.retry_rounds + 1
  where t.status = 'paused' and t.retry_at <= now()
    and exists (select 1 from public.cases c where c.id = t.case_id and c.status not in ('closed', 'declined'));

  return query
  with picked as (
    select t.id from public.proceeding_tracking t
    where t.status in ('waiting', 'tracked', 'not_found', 'secret') and t.work_claimed_at is null
      and t.next_read_at is not null and t.next_read_at <= now()
      and t.source = any (coalesce(target_sources, '{}'::text[]))
      and (target_tracking is null or t.id = target_tracking)
      and (not target_requested_only or (t.requested_at is not null and t.requested_at > coalesce(t.checked_at, '-infinity')))
      and exists (select 1 from public.cases c where c.id = t.case_id and c.status not in ('closed', 'declined'))
    order by (t.requested_at is not null and t.requested_at > coalesce(t.checked_at, '-infinity')) desc,
      t.next_read_at, t.id
    limit greatest(least(coalesce(target_limit, 10), 100), 1)
    for update skip locked
  )
  update public.proceeding_tracking t
  set work_claimed_at = now(), work_claims = t.work_claims + 1, work_attempts = t.work_attempts + 1
  from picked
  where t.id = picked.id
  returning t.id, t.work_claims, t.cnj, t.source, t.seen_until is null;
end;
$$;

revoke all on function public.claim_proceeding_reads(text[], integer, boolean, uuid) from public, anon, authenticated;

/**
 * What a reading came to, said by the worker that holds its claim:
 *
 *   read       the lawsuit as the court shows it (`snapshot`) and its movements (`movements`: an array of
 *              { id, at, title, detail, by }), each kept once; the ones learned now that were not there
 *              before are told in the case's timeline, but on the first reading (a history is not news);
 *   secret     the court shows nothing of its course;
 *   not_found  the source does not have it (yet): asked again after `not_found_hours`;
 *   retry      no answer (`code`): asked again after a growing wait, given up after the attempts;
 *   release    the source refused the platform's key or its balance ran out (`code`): asked again after
 *              `release_minutes`, the attempt given back, for it is not the lawsuit's to bear;
 *   failed     given up (`code`).
 *
 * A reading given up pauses while ONE still starts it over a week later (0119: `paused`, answered as such),
 * and calls a person only once those times are spent (`failed`). The first whole reading of a lawsuit (and
 * the first of another aggregator, whose copy is another: what the one before read goes) is its history, and
 * no news. A worker whose claim is not the latest holds nothing: a late one writes nothing. An answer that
 * cannot be kept (`invalid_data`) keeps the claim, and the worker says it failed. Service role only.
 */
create or replace function public.record_proceeding_read(
  target_tracking uuid,
  target_claim integer,
  target_outcome text,
  target_snapshot jsonb default null,
  target_movements jsonb default null,
  target_code text default null,
  target_vendor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  held public.proceeding_tracking%rowtype;
  tries integer := greatest(public.tracking_setting('max_attempts', 5), 1);
  hours integer := greatest(public.tracking_setting('read_hours', 24), 1);
  missing_hours integer := greatest(public.tracking_setting('not_found_hours', 72), 1);
  weekly integer := greatest(public.tracking_setting('weekly_retries', 3), 0);
  days integer := greatest(public.tracking_setting('retry_days', 7), 1);
  code text := coalesce(substring(lower(coalesce(target_code, '')) from '^[a-z][a-z0-9_]{1,59}'), 'failed');
  learned integer := 0;
  first boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into held from public.proceeding_tracking where id = target_tracking for update;
  if not found or held.work_claimed_at is null or held.work_claims is distinct from target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if target_outcome not in ('read', 'secret', 'not_found', 'retry', 'release', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;

  if target_outcome in ('read', 'secret') then
    if jsonb_typeof(target_snapshot) is distinct from 'object' or octet_length(target_snapshot::text) > 65536
       or (target_vendor is not null and target_vendor !~ '^[a-z][a-z0-9_-]{1,39}$') then
      return jsonb_build_object('ok', false, 'code', 'invalid_data');
    end if;
    -- Another aggregator is another copy, with ids of its own: what the one before read goes.
    if held.vendor is not null and target_vendor is not null and held.vendor <> target_vendor then
      delete from public.movements where proceeding_id = held.proceeding_id and source = held.source;
      update public.proceeding_tracking
      set movements_count = 0, last_movement_at = null, seen_until = null, unseen_count = 0
      where id = held.id
      returning * into held;
    end if;
  end if;
  first := held.seen_until is null;
  if target_outcome = 'read' then
    if jsonb_typeof(target_movements) is distinct from 'array' or jsonb_array_length(target_movements) > 5000
       or exists (
         select 1 from jsonb_array_elements(target_movements) m
         where jsonb_typeof(m) <> 'object'
           or coalesce(m ->> 'id', '') !~ '^[A-Za-z0-9._:-]{1,100}$'
           or coalesce(m ->> 'at', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}:[0-9]{2})$'
           or char_length(btrim(coalesce(m ->> 'title', ''))) not between 1 and 1000
           or coalesce(char_length(m ->> 'detail'), 0) > 4000
           or coalesce(char_length(m ->> 'by'), 0) > 300
       ) then
      return jsonb_build_object('ok', false, 'code', 'invalid_data');
    end if;
    with added as (
      insert into public.movements (org_id, case_id, proceeding_id, source, source_id, occurred_at, title, detail, by_name)
      select held.org_id, held.case_id, held.proceeding_id, held.source, m ->> 'id', (m ->> 'at')::timestamptz,
             btrim(m ->> 'title'), nullif(btrim(coalesce(m ->> 'detail', '')), ''), nullif(btrim(coalesce(m ->> 'by', '')), '')
      from jsonb_array_elements(target_movements) m
      on conflict (proceeding_id, source, source_id) do nothing
      returning 1
    )
    select count(*) into learned from added;
    update public.proceeding_tracking t
    set status = 'tracked', snapshot = target_snapshot, vendor = coalesce(target_vendor, t.vendor), checked_at = now(),
        movements_count = (select count(*) from public.movements m where m.proceeding_id = held.proceeding_id),
        last_movement_at = (select max(m.occurred_at) from public.movements m where m.proceeding_id = held.proceeding_id),
        read_at = now(), next_read_at = now() + make_interval(hours => hours),
        seen_until = case when first then now() else t.seen_until end,
        unseen_count = case when first then 0 else t.unseen_count + learned end,
        work_claimed_at = null, work_attempts = 0, work_error = null
    where t.id = held.id;
    if not first and learned > 0 then
      perform public.record_case_event(held.org_id, held.case_id, 'court_moved', 'system',
        jsonb_build_object('proceeding', held.proceeding_id, 'source', coalesce(target_vendor, held.source), 'count', learned));
    end if;
    return jsonb_build_object('ok', true, 'code', 'read', 'learned', learned);
  elsif target_outcome = 'secret' then
    update public.proceeding_tracking
    set status = 'secret', snapshot = target_snapshot, vendor = coalesce(target_vendor, vendor), checked_at = now(),
        next_read_at = now() + make_interval(hours => hours),
        work_claimed_at = null, work_attempts = 0, work_error = null
    where id = held.id;
  elsif target_outcome = 'not_found' then
    update public.proceeding_tracking
    set status = 'not_found', next_read_at = now() + make_interval(hours => missing_hours), checked_at = now(),
        work_claimed_at = null, work_attempts = 0, work_error = null
    where id = held.id;
  elsif target_outcome = 'retry' and held.work_attempts < tries then
    update public.proceeding_tracking
    set work_claimed_at = null, work_error = code,
        next_read_at = now() + make_interval(mins => 15 * held.work_attempts)
    where id = held.id;
    return jsonb_build_object('ok', true, 'code', 'retry');
  elsif target_outcome = 'release' then
    update public.proceeding_tracking
    set work_claimed_at = null, work_error = code, work_attempts = greatest(held.work_attempts - 1, 0),
        next_read_at = now() + make_interval(mins => greatest(public.tracking_setting('release_minutes', 60), 1))
    where id = held.id;
    return jsonb_build_object('ok', true, 'code', 'release');
  elsif held.retry_rounds < weekly then
    -- Given up for now: a request it answered is answered, and ONE starts it over in a week.
    update public.proceeding_tracking
    set status = 'paused', retry_at = now() + make_interval(days => days), work_claimed_at = null,
        next_read_at = null, requested_at = null, work_error = code
    where id = held.id;
    return jsonb_build_object('ok', true, 'code', 'paused');
  else
    -- Given up, the weekly tries spent: a request it answered is answered, and a person asks again.
    update public.proceeding_tracking
    set status = 'failed', work_claimed_at = null, next_read_at = null, requested_at = null, work_error = code
    where id = held.id;
    return jsonb_build_object('ok', true, 'code', 'failed');
  end if;
  return jsonb_build_object('ok', true, 'code', target_outcome);
end;
$$;

revoke all on function public.record_proceeding_read(uuid, integer, text, jsonb, jsonb, text, text) from public, anon, authenticated;

/**
 * A person of the firm asks for a lawsuit it follows to be read now (one
 * whose reading was given up, or paused for ONE's next try, starts over).
 * Once in a while per lawsuit. Never a support visit. Answers the tracking
 * and its source, so the server starts the reading at once.
 */
create or replace function public.request_proceeding_read(target_proceeding uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  found_proceeding public.proceedings%rowtype;
  current_case public.cases%rowtype;
  held public.proceeding_tracking%rowtype;
  cooldown integer := greatest(public.tracking_setting('request_cooldown_minutes', 30), 1);
begin
  select * into found_proceeding from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'proceeding_not_found');
  end if;
  current_case := public.case_for_writer(found_proceeding.case_id);
  select * into held from public.proceeding_tracking where proceeding_id = found_proceeding.id for update;
  if not found or held.status = 'off' then
    return jsonb_build_object('ok', false, 'code', 'not_tracked');
  end if;
  if held.requested_at is not null and held.requested_at > now() - make_interval(mins => cooldown) then
    return jsonb_build_object('ok', false, 'code', 'read_cooldown');
  end if;
  update public.proceeding_tracking
  set requested_at = now(), requested_by = auth.uid(), next_read_at = now(),
      status = case when status in ('failed', 'paused') then 'waiting' else status end,
      work_attempts = case when status in ('failed', 'paused') then 0 else work_attempts end,
      work_error = case when status in ('failed', 'paused') then null else work_error end
  where id = held.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'proceedings.read_requested', 'proceeding', found_proceeding.id::text,
    jsonb_build_object('case', current_case.id, 'source', held.source));
  return jsonb_build_object('ok', true, 'code', 'waiting', 'tracking_id', held.id, 'source', held.source);
end;
$$;

revoke all on function public.request_proceeding_read(uuid) from public, anon;
grant execute on function public.request_proceeding_read(uuid) to authenticated;
