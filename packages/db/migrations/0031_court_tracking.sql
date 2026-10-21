-- 0031_court_tracking.sql
--
-- The course of each lawsuit a firm has with a number ("andamento"), read
-- from the court by the backend: TJGO's lawsuits from the public webservice
-- of its Projudi, the others from an aggregator of many courts once one is
-- chosen (`@flyee/courts`, `ProceedingSource`). What the court shows of a
-- lawsuit is kept as last read, and each movement once, under the source's
-- own id. What the firm has not seen yet is counted, and a person says they
-- saw it.
--
--   setting `tracking`       how often a lawsuit is read, how long to wait for one the court does not show
--   proceeding_tracking      one per lawsuit with a number that was filed, kept by a trigger on proceedings
--   movements                each movement of a lawsuit, once
--
-- Nothing of a lawyer's login is ever asked or kept: the sources read by the
-- number alone.

-- ---------- What the reading reads ----------

insert into public.platform_settings (key, value, is_public) values
  ('tracking', jsonb_build_object(
    -- A lawsuit is read again this many hours after its last read.
    'read_hours', 24,
    -- One the court does not show (yet: a lawsuit just filed takes a while) is asked again after this many.
    'not_found_hours', 72,
    -- A person may ask for a reading now once in this many minutes per lawsuit.
    'request_cooldown_minutes', 30,
    -- A source that refused the platform's key, or whose balance ran out, is asked again after this many minutes,
    -- with no attempt of the lawsuit spent: it is the platform's to fix, never the lawsuit's.
    'release_minutes', 60,
    -- A reading claimed and never finished goes back after this many minutes, and is given up after the attempts.
    'working_minutes', 20,
    'max_attempts', 5,
    -- The hours of Brasília the routine readings of TJGO's Projudi go in, from one to the other (a courtesy
    -- to the tribunal, whose machines serve the public in the day); a reading a person asks for goes at once.
    'projudi_from_hour', 22,
    'projudi_to_hour', 6
  ), false)
on conflict (key) do nothing;

/** An integer of the setting `tracking`, or the fallback. Internal. */
create or replace function public.tracking_setting(setting text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when s.value ->> setting ~ '^[0-9]{1,9}$' then (s.value ->> setting)::integer end
     from public.platform_settings s where s.key = 'tracking'),
    fallback
  );
$$;

revoke all on function public.tracking_setting(text, integer) from public, anon, authenticated;

-- ---------- The tracking of a lawsuit ----------

create table public.proceeding_tracking (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  proceeding_id uuid not null,
  -- The number read, 20 digits: the lawsuit's, when it was last set.
  cnj text not null,
  -- projudi     TJGO's own system, by its public webservice;
  -- aggregator  a vendor that reads many courts, for every other court.
  source text not null,
  -- waiting    owed a reading;
  -- tracked    read, and read again in its time;
  -- not_found  the court does not show it (yet), asked again later;
  -- secret     the court shows nothing of its course (segredo de justiça);
  -- failed     the reading was given up: a person asks again;
  -- off        the lawsuit was closed, or lost its number: not read.
  status text not null,
  -- What the court shows of the lawsuit as last read (`CourtProceeding`), never its parties' list.
  snapshot jsonb,
  -- Which source read it last: "projudi", or the aggregator's name. Another aggregator is another copy: what the
  -- one before read goes, and the next reading is a first one.
  vendor text,
  movements_count integer not null default 0,
  last_movement_at timestamptz,
  -- The last whole reading; the last time the source answered for it, whatever it said; and when the next
  -- reading is owed.
  read_at timestamptz,
  checked_at timestamptz,
  next_read_at timestamptz,
  -- The firm saw what was learned up to this moment. The first whole reading sets it: a history is not news.
  seen_until timestamptz,
  -- The movements learned since, which nobody of the firm said they saw.
  unseen_count integer not null default 0,
  -- A person's request of a reading now.
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz,
  -- The backend's work: every claim numbered, never set back.
  work_claims integer not null default 0,
  work_claimed_at timestamptz,
  work_attempts integer not null default 0,
  work_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proceeding_id),
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (proceeding_id, org_id) references public.proceedings (id, org_id) on delete cascade,
  constraint proceeding_tracking_cnj_check check (cnj ~ '^[0-9]{20}$'),
  constraint proceeding_tracking_source_check check (source in ('projudi', 'aggregator')),
  constraint proceeding_tracking_status_check check (
    status in ('waiting', 'tracked', 'not_found', 'secret', 'failed', 'off')
  ),
  constraint proceeding_tracking_snapshot_check check (
    snapshot is null or (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 65536)
  ),
  constraint proceeding_tracking_error_check check (work_error is null or work_error ~ '^[a-z][a-z0-9_]{1,59}$'),
  constraint proceeding_tracking_unseen_check check (unseen_count >= 0),
  constraint proceeding_tracking_vendor_check check (vendor is null or vendor ~ '^[a-z][a-z0-9_-]{1,39}$')
);

create index proceeding_tracking_case_idx on public.proceeding_tracking (case_id);
create index proceeding_tracking_due_idx on public.proceeding_tracking (next_read_at)
  where status in ('waiting', 'tracked', 'not_found', 'secret') and work_claimed_at is null;
create index proceeding_tracking_claimed_idx on public.proceeding_tracking (work_claimed_at)
  where work_claimed_at is not null;

alter table public.proceeding_tracking enable row level security;
create policy "proceeding_tracking_select_member" on public.proceeding_tracking
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.proceeding_tracking to authenticated;
create trigger proceeding_tracking_updated_at before update on public.proceeding_tracking
  for each row execute function public.set_updated_at();
create trigger guard_impersonation_proceeding_tracking after insert or update or delete on public.proceeding_tracking
  for each statement execute function public.guard_impersonation_readonly();

create table public.movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  proceeding_id uuid not null,
  source text not null,
  -- The source's own id of the movement: reading it twice writes nothing new.
  source_id text not null,
  occurred_at timestamptz not null,
  -- As the source wrote them: what happened, what it adds, who did it (a clerk, a judge, the system).
  title text not null,
  detail text,
  by_name text,
  -- When ONE learned it.
  learned_at timestamptz not null default now(),
  unique (proceeding_id, source, source_id),
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (proceeding_id, org_id) references public.proceedings (id, org_id) on delete cascade,
  constraint movements_source_check check (source in ('projudi', 'aggregator')),
  constraint movements_text_check check (
    char_length(source_id) between 1 and 100 and char_length(title) between 1 and 1000
    and coalesce(char_length(detail), 0) <= 4000 and coalesce(char_length(by_name), 0) <= 300
  )
);

create index movements_proceeding_idx on public.movements (proceeding_id, occurred_at desc);
create index movements_learned_idx on public.movements (org_id, learned_at desc);

alter table public.movements enable row level security;
create policy "movements_select_member" on public.movements
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.movements to authenticated;
create trigger guard_impersonation_movements after insert or update or delete on public.movements
  for each statement execute function public.guard_impersonation_readonly();

/**
 * A lawsuit filed with a number owes its reading; its source is told by the
 * number (TJGO's, segment 8 and code 09, from its Projudi; any other from an
 * aggregator). Another number is another lawsuit: what was read of the old
 * one goes. A lawsuit closed, or with no number, is not read (what was read
 * of it stays while its number does, none of it counted as news any more),
 * and one filed again is owed a reading. A lawsuit of a case that ended is
 * not read either (the claim skips it).
 */
create or replace function public.proceedings_tracking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.cnj is not distinct from old.cnj and new.status is not distinct from old.status then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.cnj is distinct from new.cnj then
    delete from public.movements where proceeding_id = new.id;
    update public.proceeding_tracking
    set snapshot = null, vendor = null, movements_count = 0, last_movement_at = null, read_at = null, checked_at = null,
        seen_until = null, unseen_count = 0, work_claimed_at = null, work_attempts = 0, work_error = null
    where proceeding_id = new.id;
  end if;
  if new.cnj is not null and new.status = 'filed' then
    insert into public.proceeding_tracking as held (org_id, case_id, proceeding_id, cnj, source, status, next_read_at)
    values (new.org_id, new.case_id, new.id, new.cnj,
            case when substr(new.cnj, 14, 3) = '809' then 'projudi' else 'aggregator' end, 'waiting', now())
    on conflict (proceeding_id) do update set
      cnj = excluded.cnj, source = excluded.source,
      status = case when held.cnj = excluded.cnj and held.status not in ('off', 'failed') then held.status else 'waiting' end,
      next_read_at = case when held.cnj = excluded.cnj and held.status not in ('off', 'failed') then held.next_read_at else now() end,
      work_claimed_at = case when held.cnj = excluded.cnj then held.work_claimed_at end,
      work_attempts = case when held.cnj = excluded.cnj and held.status <> 'failed' then held.work_attempts else 0 end;
  else
    -- Not read any more: what it had that nobody saw stops counting as news, since nobody could clear it.
    update public.proceeding_tracking
    set status = 'off', work_claimed_at = null, next_read_at = null, unseen_count = 0,
        seen_until = case when seen_until is null then null else now() end
    where proceeding_id = new.id;
    if new.cnj is null then
      delete from public.proceeding_tracking where proceeding_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.proceedings_tracking() from public, anon, authenticated;

create trigger proceedings_tracking after insert or update of cnj, status on public.proceedings
  for each row execute function public.proceedings_tracking();

-- The lawsuits filed already owe their reading too.
insert into public.proceeding_tracking (org_id, case_id, proceeding_id, cnj, source, status, next_read_at)
select p.org_id, p.case_id, p.id, p.cnj,
       case when substr(p.cnj, 14, 3) = '809' then 'projudi' else 'aggregator' end, 'waiting', now()
from public.proceedings p
where p.cnj is not null and p.status = 'filed'
on conflict (proceeding_id) do nothing;

-- ---------- The backend's half ----------

/**
 * Claims the readings owed (or the one named), from the sources the backend
 * can read now: each with the number of its claim and the lawsuit's number.
 * A person's request comes first (one the source has not answered since);
 * `target_requested_only` claims nothing else (the hours a source is read in
 * by routine have not come). A lawsuit of a case that ended is not read. A
 * claim never finished goes back first, and is given up after its attempts
 * (a request it held is then answered: given up). `first_read` is a lawsuit
 * never read whole. Service role only.
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
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.proceeding_tracking t
  set work_claimed_at = null,
      status = case when t.work_attempts >= tries then 'failed' else t.status end,
      next_read_at = case when t.work_attempts >= tries then null else t.next_read_at end,
      requested_at = case when t.work_attempts >= tries then null else t.requested_at end,
      work_error = case when t.work_attempts >= tries then 'abandoned' else t.work_error end
  where t.work_claimed_at is not null and t.work_claimed_at < now() - make_interval(mins => minutes);

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
 *   failed     given up (`code`): a person asks again.
 *
 * The first whole reading of a lawsuit (and the first of another aggregator, whose copy is another: what
 * the one before read goes) is its history, and no news. A worker whose claim is not the latest holds
 * nothing: a late one writes nothing. An answer that cannot be kept (`invalid_data`) keeps the claim, and
 * the worker says it failed. Service role only.
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
  else
    -- Given up: a request it answered is answered, and a person asks again.
    update public.proceeding_tracking
    set status = 'failed', work_claimed_at = null, next_read_at = null, requested_at = null, work_error = code
    where id = held.id;
    return jsonb_build_object('ok', true, 'code', 'failed');
  end if;
  return jsonb_build_object('ok', true, 'code', target_outcome);
end;
$$;

revoke all on function public.record_proceeding_read(uuid, integer, text, jsonb, jsonb, text, text) from public, anon, authenticated;

-- ---------- What a person does ----------

/**
 * A person of the firm asks for a lawsuit it follows to be read now (one
 * whose reading was given up starts over). Once in a while per lawsuit.
 * Never a support visit. Answers the tracking and its source, so the server
 * starts the reading at once.
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
      status = case when status = 'failed' then 'waiting' else status end,
      work_attempts = case when status = 'failed' then 0 else work_attempts end,
      work_error = case when status = 'failed' then null else work_error end
  where id = held.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'proceedings.read_requested', 'proceeding', found_proceeding.id::text,
    jsonb_build_object('case', current_case.id, 'source', held.source));
  return jsonb_build_object('ok', true, 'code', 'waiting', 'tracking_id', held.id, 'source', held.source);
end;
$$;

revoke all on function public.request_proceeding_read(uuid) from public, anon;
grant execute on function public.request_proceeding_read(uuid) to authenticated;

/**
 * A person of the firm says they saw what the court did in a lawsuit: what
 * was learned until now stops counting as new. Never a support visit.
 */
create or replace function public.acknowledge_proceeding_movements(target_proceeding uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  found_proceeding public.proceedings%rowtype;
  current_case public.cases%rowtype;
begin
  select * into found_proceeding from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'proceeding_not_found');
  end if;
  current_case := public.case_for_writer(found_proceeding.case_id);
  update public.proceeding_tracking set seen_until = now(), unseen_count = 0 where proceeding_id = found_proceeding.id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_tracked');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'proceedings.movements_seen', 'proceeding', found_proceeding.id::text,
    jsonb_build_object('case', current_case.id));
  return jsonb_build_object('ok', true, 'code', 'seen');
end;
$$;

revoke all on function public.acknowledge_proceeding_movements(uuid) from public, anon;
grant execute on function public.acknowledge_proceeding_movements(uuid) to authenticated;

-- ---------- What needs somebody today ----------

/**
 * What needs somebody of the firm today (replaces the one of 0029), with the
 * course of the lawsuits: the ones with movements nobody of the firm saw
 * yet, and the others whose reading was given up (a lawsuit counted once).
 */
create or replace function public.firm_today(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  my_function public.firm_function;
  late_hours integer := greatest(public.publications_setting('late_hours', 24), 1);
  left_days integer := greatest(public.publications_setting('left_out_days', 7), 1);
  closing_hours integer := greatest(coalesce((public.wa_setting('closing_soon_hours') #>> '{}')::integer, 4), 1);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select m.firm_function into my_function
  from public.memberships m where m.org_id = target_org and m.user_id = auth.uid();
  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'approvals_mine', (
      select count(*) from public.approvals a
      where a.org_id = target_org and a.status = 'pending' and my_function = any (a.approver_functions)
    ),
    'approvals_waiting', (
      select count(*) from public.approvals a where a.org_id = target_org and a.status = 'pending'
    ),
    'conversations_waiting', (
      select count(*) from public.wa_conversations c
      join public.wa_numbers n on n.id = c.number_id
      where c.org_id = target_org and c.status = 'open' and c.last_message_direction = 'in' and n.status = 'active'
        and c.last_inbound_at is not null and c.last_inbound_at >= c.last_message_at
    ),
    'conversations_closing', (
      select count(*) from public.wa_conversations c
      join public.wa_numbers n on n.id = c.number_id
      where c.org_id = target_org and c.status = 'open' and c.last_message_direction = 'in' and n.status = 'active'
        and c.last_inbound_at is not null and c.last_inbound_at >= c.last_message_at
        and public.wa_window_open(c.last_inbound_at)
        and public.wa_window_closes_at(c.last_inbound_at) < now() + make_interval(hours => closing_hours)
    ),
    'sends_failed', (
      select count(*) from public.wa_messages m
      where m.org_id = target_org and m.direction = 'out' and m.status = 'failed'
        and m.created_at > now() - interval '24 hours'
    ),
    'documents_to_review', (
      select count(*) from public.case_documents d where d.org_id = target_org and d.status = 'received'
    ),
    'clients_finished', (
      select count(distinct l.case_id) from public.client_links l
      join public.cases c on c.id = l.case_id
      where l.org_id = target_org and l.finished_at is not null and l.revoked_at is null
        and c.status in ('intake', 'documents', 'signature')
    ),
    'chronologies_contested', (
      select count(distinct s.case_id) from public.case_statements s
      join public.cases c on c.id = s.case_id
      where s.org_id = target_org and s.chronology_status = 'contested'
        and c.status not in ('closed', 'declined')
    ),
    'complaints_overdue', (
      select count(distinct a.case_id) from public.admin_complaints a
      join public.cases c on c.id = a.case_id
      where a.org_id = target_org and a.outcome = 'pending'
        and a.answer_due_on < (now() at time zone 'America/Sao_Paulo')::date
        and c.status not in ('closed', 'declined')
    ),
    'filings_ready', (
      select count(*) from public.filing_packages p
      join public.cases c on c.id = p.case_id
      where p.org_id = target_org and p.status = 'ready' and c.status not in ('closed', 'declined')
    ),
    'drafts_waiting', (
      select count(*) from public.case_drafts d
      join public.cases c on c.id = d.case_id
      join public.proceedings p on p.id = d.proceeding_id
      where d.org_id = target_org and c.status not in ('closed', 'declined') and p.status = 'planned'
        and (
          (d.status = 'proposed' and d.work is distinct from 'revise' and not exists (
            select 1 from public.approvals a where a.run_id = d.run_id and a.status = 'pending'
          ))
          or d.status = 'failed'
          or (d.status = 'approved' and d.work is null)
        )
    ),
    'publications_new', (
      select count(*) from public.publications p
      where p.org_id = target_org and p.category is null and p.active
    ),
    'publications_cancelled', (
      select count(*) from public.publications p where p.org_id = target_org and p.cancel_pending
    ),
    'djen_late', (
      select count(*) from public.djen_captures c
      where c.org_id = target_org and c.active
        and coalesce(c.captured_at, c.created_at) < now() - make_interval(hours => late_hours)
    ) + (
      -- A registration no sweep has seen for that long: the reading itself is not running.
      select count(*) from public.oab_registrations r
      join public.memberships m on m.user_id = r.user_id
      where m.org_id = target_org
        and greatest(r.created_at, m.created_at) < now() - make_interval(hours => late_hours)
        and not exists (
          select 1 from public.djen_captures c where c.org_id = m.org_id and c.uf = r.uf and c.number = r.number
        )
    ),
    'djen_incomplete', (
      select count(*) from public.djen_captures c
      where c.org_id = target_org and c.active and c.last_skipped > 0
        and c.skipped_at > now() - make_interval(days => left_days)
    ),
    'djen_stopped', (
      select count(*) from public.djen_captures c
      where c.org_id = target_org and not c.active and c.user_id is not null
        and exists (
          select 1 from public.proceeding_lawyers pl
          join public.proceedings p on p.id = pl.proceeding_id
          where pl.org_id = c.org_id and pl.user_id = c.user_id and p.status = 'filed'
        )
    ),
    'movements_new', (
      select count(*) from public.proceeding_tracking t
      join public.cases c on c.id = t.case_id
      where t.org_id = target_org and t.status <> 'off' and t.unseen_count > 0 and c.status not in ('closed', 'declined')
    ),
    'tracking_failed', (
      select count(*) from public.proceeding_tracking t
      join public.cases c on c.id = t.case_id
      where t.org_id = target_org and t.status = 'failed' and t.unseen_count = 0 and c.status not in ('closed', 'declined')
    ),
    'whatsapp', case
      when exists (select 1 from public.wa_numbers n where n.org_id = target_org and n.status = 'active') then 'active'
      when exists (select 1 from public.wa_numbers n where n.org_id = target_org) then 'disconnected'
      else 'none'
    end
  );
end;
$$;

revoke all on function public.firm_today(uuid) from public, anon;
grant execute on function public.firm_today(uuid) to authenticated;
