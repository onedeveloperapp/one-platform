-- ============================================================
-- 0113 · The closing goals of the controladoria
--
-- Phase 1 of the plan of the controladoria, the outcome of the cases and
-- the firm's finance: a goal of closings for a period, for every case of
-- the firm or for a part of them (a module, a kind of problem, where the
-- cases came from, one partner agency), with how many closings it asks.
-- It is the first registration in the pattern of phase 0: listed with the
-- bar, created and changed in the side panel, archived with its reason
-- and brought back, every change on the record.
--
-- What counts as a closing is the plan of the case's journey's to say (the
-- two plans gave each piece one owner): until it does, `firm_closing_goals`
-- answers `rule` and every goal's `closings` as null, and the screens say
-- the count is not on yet. The goal is registered all the same, so the
-- firm's targets are on record from the start.
--
-- Partners and the controladoria create, change, archive and bring back a
-- goal (in a firm where nobody is a partner, who manages the firm account:
-- `decides_for_firm`); never a support visit; anybody of the firm reads.
-- ============================================================

create table public.closing_goals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The period, in days of Brasília, both included.
  starts_on date not null,
  ends_on date not null,
  -- The part of the cases it is of; each null is every one.
  module_key text references public.product_modules (key) on delete restrict,
  incident text,
  origin text,
  partnership_id uuid,
  -- How many closings it asks.
  target integer not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete set null,
  archive_reason text,
  unique (id, org_id),
  foreign key (partnership_id, org_id) references public.partner_links (id, org_id) on delete set null (partnership_id),
  constraint closing_goals_period_check check (ends_on >= starts_on and ends_on - starts_on <= 366),
  constraint closing_goals_target_check check (target between 1 and 1000000),
  constraint closing_goals_incident_check check (incident is null or incident ~ '^[a-z][a-z0-9_-]{1,40}$'),
  constraint closing_goals_origin_check check (origin is null or origin in (
    'agency', 'referral', 'ads', 'organic', 'returning_client', 'other'
  )),
  -- A partner agency is a part of the cases that came from agencies.
  constraint closing_goals_partnership_check check (partnership_id is null or origin = 'agency'),
  constraint closing_goals_archive_check check (
    (archived_at is null and archive_reason is null and archived_by is null)
    or (archived_at is not null and char_length(archive_reason) between 3 and 300)
  )
);

create index closing_goals_org_idx on public.closing_goals (org_id, ends_on desc);

alter table public.closing_goals enable row level security;
create policy "closing_goals_select_member" on public.closing_goals
  for select to authenticated using (public.is_org_member(org_id));
revoke all on table public.closing_goals from public, anon, authenticated;
grant select on table public.closing_goals to authenticated;
create trigger guard_impersonation_closing_goals after insert or update or delete on public.closing_goals
  for each statement execute function public.guard_impersonation_readonly();

/** Who creates, changes, archives and brings back the firm's closing goals: a partner or the controladoria. */
create or replace function public.may_manage_closing_goals(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public.is_org_member(target_org) and (
    public.decides_for_firm(target_org)
    or public.has_firm_function(target_org, array['controladoria']::public.firm_function[])
  );
$$;

revoke all on function public.may_manage_closing_goals(uuid) from public, anon;
grant execute on function public.may_manage_closing_goals(uuid) to authenticated;

/**
 * Creates a closing goal (no `target_goal`) or changes one the firm has and nobody archived. The module is one the
 * firm has, the partner agency one of the firm's partnerships (of that module, when one is named), the kind of
 * problem written as the catalog writes it. Answers `{ok, id}`, or `{ok: false, code}` for what a person puts right:
 * `support_visit`, `not_allowed`, `not_found`, `archived`, `module`, `partnership`.
 */
create or replace function public.save_closing_goal(
  target_org uuid,
  target_goal uuid,
  target_starts_on date,
  target_ends_on date,
  target_module text,
  target_incident text,
  target_origin text,
  target_partnership uuid,
  target_target integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  goal_id uuid;
  prior public.closing_goals;
  partnership_module text;
  origin_wanted text := nullif(btrim(coalesce(target_origin, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.may_manage_closing_goals(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if target_module is not null and not exists (
    select 1 from public.firm_modules m where m.org_id = target_org and m.module_key = target_module
  ) then
    return jsonb_build_object('ok', false, 'code', 'module');
  end if;
  if target_partnership is not null then
    select l.module_key into partnership_module
    from public.partner_links l where l.id = target_partnership and l.org_id = target_org;
    if partnership_module is null or (target_module is not null and partnership_module <> target_module) then
      return jsonb_build_object('ok', false, 'code', 'partnership');
    end if;
    origin_wanted := 'agency';
  end if;

  if target_goal is null then
    insert into public.closing_goals (
      org_id, starts_on, ends_on, module_key, incident, origin, partnership_id, target, created_by, updated_by
    ) values (
      target_org, target_starts_on, target_ends_on, target_module, nullif(btrim(coalesce(target_incident, '')), ''),
      origin_wanted, target_partnership, target_target, auth.uid(), auth.uid()
    )
    returning id into goal_id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, auth.uid(), 'closing_goal.created', 'closing_goal', goal_id::text,
            jsonb_strip_nulls(jsonb_build_object(
              'starts_on', target_starts_on, 'ends_on', target_ends_on, 'module', target_module,
              'incident', nullif(btrim(coalesce(target_incident, '')), ''), 'origin', origin_wanted,
              'partnership', target_partnership, 'target', target_target)));
    return jsonb_build_object('ok', true, 'id', goal_id);
  end if;

  select * into prior from public.closing_goals g
  where g.id = target_goal and g.org_id = target_org
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if prior.archived_at is not null then
    return jsonb_build_object('ok', false, 'code', 'archived');
  end if;
  update public.closing_goals g set
    starts_on = target_starts_on,
    ends_on = target_ends_on,
    module_key = target_module,
    incident = nullif(btrim(coalesce(target_incident, '')), ''),
    origin = origin_wanted,
    partnership_id = target_partnership,
    target = target_target,
    updated_by = auth.uid(),
    updated_at = now()
  where g.id = target_goal;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'closing_goal.changed', 'closing_goal', target_goal::text,
          jsonb_build_object(
            'before', jsonb_strip_nulls(jsonb_build_object(
              'starts_on', prior.starts_on, 'ends_on', prior.ends_on, 'module', prior.module_key,
              'incident', prior.incident, 'origin', prior.origin, 'partnership', prior.partnership_id,
              'target', prior.target)),
            'after', jsonb_strip_nulls(jsonb_build_object(
              'starts_on', target_starts_on, 'ends_on', target_ends_on, 'module', target_module,
              'incident', nullif(btrim(coalesce(target_incident, '')), ''), 'origin', origin_wanted,
              'partnership', target_partnership, 'target', target_target))));
  return jsonb_build_object('ok', true, 'id', target_goal);
end;
$$;

revoke all on function public.save_closing_goal(uuid, uuid, date, date, text, text, text, uuid, integer) from public, anon;
grant execute on function public.save_closing_goal(uuid, uuid, date, date, text, text, text, uuid, integer) to authenticated;

/**
 * Archives a goal with the reason, or brings an archived one back (`target_reason` null). On the record; never a
 * support visit. Answers `{ok}` or `{ok: false, code}`: `support_visit`, `not_allowed`, `not_found`, `reason`,
 * `unchanged` (archiving an archived goal, or bringing back one that is not archived).
 */
create or replace function public.archive_closing_goal(target_org uuid, target_goal uuid, target_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  goal public.closing_goals;
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.may_manage_closing_goals(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  select * into goal from public.closing_goals g where g.id = target_goal and g.org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if target_reason is not null then
    if reason is null or char_length(reason) not between 3 and 300 then
      return jsonb_build_object('ok', false, 'code', 'reason');
    end if;
    if goal.archived_at is not null then
      return jsonb_build_object('ok', false, 'code', 'unchanged');
    end if;
    update public.closing_goals g
    set archived_at = now(), archived_by = auth.uid(), archive_reason = reason, updated_by = auth.uid(), updated_at = now()
    where g.id = target_goal;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, auth.uid(), 'closing_goal.archived', 'closing_goal', target_goal::text,
            jsonb_build_object('reason', reason));
  else
    if goal.archived_at is null then
      return jsonb_build_object('ok', false, 'code', 'unchanged');
    end if;
    update public.closing_goals g
    set archived_at = null, archived_by = null, archive_reason = null, updated_by = auth.uid(), updated_at = now()
    where g.id = target_goal;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, auth.uid(), 'closing_goal.restored', 'closing_goal', target_goal::text, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.archive_closing_goal(uuid, uuid, text) from public, anon;
grant execute on function public.archive_closing_goal(uuid, uuid, text) to authenticated;

/**
 * The firm's closing goals (of one module, or of every one), the latest period first, each with its part of the cases
 * (the partner agency by its name), its target and how many closings it has: null while the rule of what counts as a
 * closing is not on (`rule` null), which the plan of the case's journey gives. Says whether the person reading may
 * manage them. For anybody of the firm.
 */
create or replace function public.firm_closing_goals(target_org uuid, target_module text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'today', today,
    -- What counts as a closing: none yet.
    'rule', null,
    'may_manage', public.may_manage_closing_goals(target_org) and not public.is_impersonated(),
    'goals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'starts_on', g.starts_on,
        'ends_on', g.ends_on,
        'module', g.module_key,
        'incident', g.incident,
        'origin', g.origin,
        'partnership', g.partnership_id,
        'partner', p.name,
        'target', g.target,
        'closings', null,
        'archived_at', g.archived_at,
        'archive_reason', g.archive_reason,
        'updated_at', g.updated_at
      ) order by g.starts_on desc, g.ends_on desc, g.created_at desc)
      from public.closing_goals g
      left join public.partner_links l on l.id = g.partnership_id
      left join public.partners p on p.id = l.partner_id
      where g.org_id = target_org and (target_module is null or g.module_key = target_module)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.firm_closing_goals(uuid, text) from public, anon;
grant execute on function public.firm_closing_goals(uuid, text) to authenticated;
