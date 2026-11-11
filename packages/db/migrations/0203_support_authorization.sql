-- ============================================================
-- 0203 · The assisted support with the new fence (M3, sprint S10): a support
-- visit reads a firm's data only with the firm's recorded authorization.
--
-- A support visit of ONE's operator (0009) reads as the person visited and
-- writes nothing (the write fence of 0010). The data of a mass-litigation
-- firm is its clients' (documents, accounts, lawsuits under secrecy), so a
-- visit into a firm now needs the firm's own word first: who manages the
-- firm's account, or who decides for it, authorizes the support for a number
-- of hours (the setting's 168 at most), with the second factor and never in
-- a support visit, and may end it at any moment (`support_authorizations`).
-- The backend refuses to open a visit into a firm with no authorization in
-- force (a trigger on `impersonation_sessions`, for the service role that
-- opens them), and records which authorization a visit came under. The
-- operator asks the firm for one from the console (the firm is told on the
-- bell). Everybody of the firm reads whether the support may enter, until
-- when, and the visits made: what the operator said each was for, and when.
-- A visit already in course when an authorization ends lasts its own minutes
-- (0009), and writes nothing.
-- ============================================================

insert into public.platform_settings (key, value)
values ('support_access', jsonb_build_object('max_hours', 168))
on conflict (key) do nothing;

create table public.support_authorizations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  ends_at timestamptz not null,
  -- What the firm said the support is let in for, when it said something.
  note text,
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  constraint support_authorizations_window_check check (ends_at > granted_at),
  constraint support_authorizations_note_check check (note is null or char_length(note) <= 300)
);

create index support_authorizations_org_idx on public.support_authorizations (org_id, ends_at desc);

alter table public.support_authorizations enable row level security;
create policy "support_authorizations_select_member" on public.support_authorizations
  for select to authenticated using (public.is_org_member(org_id) or public.is_superadmin());
grant select on table public.support_authorizations to authenticated;
create trigger guard_impersonation_support_authorizations after insert or update or delete on public.support_authorizations
  for each statement execute function public.guard_impersonation_readonly();

-- Which authorization a visit came under.
alter table public.impersonation_sessions add column authorization_id uuid
  references public.support_authorizations (id) on delete set null;

/** The authorization in force of a firm (internal), or null. */
create or replace function public.support_access_live(target_org uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.id from public.support_authorizations a
  where a.org_id = target_org and a.ended_at is null and a.ends_at > now()
  order by a.ends_at desc
  limit 1;
$$;

revoke all on function public.support_access_live(uuid) from public, anon, authenticated;

/** Who may let the support in (internal): who manages the firm's account, or who decides for it. */
create or replace function public.manages_support_access(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]) or public.decides_for_firm(target_org);
$$;

revoke all on function public.manages_support_access(uuid) from public, anon, authenticated;

/**
 * The backend opens a support visit into a firm only under its authorization in force, and keeps which one. A visit
 * into a person of no firm needs none.
 */
create or replace function public.impersonation_sessions_need_authorization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  live uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' or new.target_org_id is null then
    return new;
  end if;
  live := public.support_access_live(new.target_org_id);
  if live is null then
    raise exception 'support_not_authorized' using errcode = '42501';
  end if;
  new.authorization_id := live;
  return new;
end;
$$;

revoke all on function public.impersonation_sessions_need_authorization() from public, anon, authenticated;

create trigger impersonation_sessions_need_authorization before insert on public.impersonation_sessions
  for each row execute function public.impersonation_sessions_need_authorization();

/**
 * Who manages the firm's account, or decides for it, lets the support in for some hours, with the second factor and
 * never in a support visit; one in force is replaced by the new one. On the record.
 */
create or replace function public.grant_support_access(target_org uuid, target_hours integer, target_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  most integer := greatest(coalesce((select (s.value ->> 'max_hours')::integer from public.platform_settings s
                                     where s.key = 'support_access'), 168), 1);
  granted public.support_authorizations%rowtype;
  clean_note text := nullif(btrim(coalesce(target_note, '')), '');
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.manages_support_access(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not public.is_aal2() then
    return jsonb_build_object('ok', false, 'code', 'second_factor');
  end if;
  if target_hours is null or target_hours < 1 or target_hours > most then
    return jsonb_build_object('ok', false, 'code', 'invalid_hours', 'max_hours', most);
  end if;
  if clean_note is not null and char_length(clean_note) > 300 then
    return jsonb_build_object('ok', false, 'code', 'note_too_long');
  end if;
  update public.support_authorizations set ended_at = now(), ended_by = auth.uid()
  where org_id = target_org and ended_at is null and ends_at > now();
  insert into public.support_authorizations (org_id, granted_by, ends_at, note)
  values (target_org, auth.uid(), now() + make_interval(hours => target_hours), clean_note)
  returning * into granted;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'support.access_granted', 'organization', target_org::text,
    jsonb_build_object('hours', target_hours, 'ends_at', granted.ends_at));
  return jsonb_build_object('ok', true, 'ends_at', granted.ends_at);
end;
$$;

revoke all on function public.grant_support_access(uuid, integer, text) from public, anon;
grant execute on function public.grant_support_access(uuid, integer, text) to authenticated;

/** The same people end the authorization in force, at once. On the record. Never in a support visit. */
create or replace function public.end_support_access(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ended integer;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.manages_support_access(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  update public.support_authorizations set ended_at = now(), ended_by = auth.uid()
  where org_id = target_org and ended_at is null and ends_at > now();
  get diagnostics ended = row_count;
  if ended > 0 then
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, auth.uid(), 'support.access_ended', 'organization', target_org::text, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'ended', ended > 0);
end;
$$;

revoke all on function public.end_support_access(uuid) from public, anon;
grant execute on function public.end_support_access(uuid) to authenticated;

/**
 * What anybody of the firm reads of the support's access: the authorization in force (who gave it, until when, what
 * for), whether the reader may give or end one, the setting's most hours, and the latest visits made into the firm
 * (when, for how long, what the operator said it was for), never the operator's name.
 */
create or replace function public.firm_support_access(target_org uuid)
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
  return jsonb_build_object(
    'manages', public.manages_support_access(target_org),
    'max_hours', greatest(coalesce((select (s.value ->> 'max_hours')::integer from public.platform_settings s
                                    where s.key = 'support_access'), 168), 1),
    'live', (
      select jsonb_build_object('granted_at', a.granted_at, 'ends_at', a.ends_at, 'note', a.note,
               'granted_by', coalesce(nullif(btrim(p.display_name), ''), 'Alguém do escritório'))
      from public.support_authorizations a
      left join public.profiles p on p.id = a.granted_by
      where a.id = public.support_access_live(target_org)
    ),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object('started_at', s.started_at, 'ended_at', s.ended_at, 'reason', s.reason)
               order by s.started_at desc)
      from (select * from public.impersonation_sessions
            where target_org_id = target_org order by started_at desc limit 10) s
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.firm_support_access(uuid) from public, anon;
grant execute on function public.firm_support_access(uuid) to authenticated;

/**
 * The operator's read before a visit: the firm of the person to visit and whether its authorization is in force,
 * until when. A person of no firm needs none.
 */
create or replace function public.admin_support_access_for(target_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  firm uuid;
  live uuid;
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select m.org_id into firm from public.memberships m where m.user_id = target_user limit 1;
  if firm is null then
    return jsonb_build_object('firm', null, 'authorized', true);
  end if;
  live := public.support_access_live(firm);
  return jsonb_build_object(
    'firm', firm,
    'firm_name', (select o.name from public.organizations o where o.id = firm),
    'authorized', live is not null,
    'ends_at', (select a.ends_at from public.support_authorizations a where a.id = live)
  );
end;
$$;

revoke all on function public.admin_support_access_for(uuid) from public, anon;
grant execute on function public.admin_support_access_for(uuid) to authenticated;

/**
 * The operator asks a firm to let the support in, saying why: answers who of the firm is told (who manages its
 * account or decides for it). On the record.
 */
create or replace function public.admin_request_support_access(target_org uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reason text := btrim(coalesce(target_reason, ''));
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if char_length(reason) < 8 or char_length(reason) > 300 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if not exists (select 1 from public.organizations o where o.id = target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'support.access_requested', 'organization', target_org::text,
    jsonb_build_object('reason', reason));
  return jsonb_build_object(
    'ok', true,
    'people', (select coalesce(jsonb_agg(m.user_id), '[]'::jsonb) from public.memberships m
               where m.org_id = target_org
                 and (m.role in ('owner', 'admin') or public.decides_for_firm_of(target_org, m.user_id)))
  );
end;
$$;

revoke all on function public.admin_request_support_access(uuid, text) from public, anon;
grant execute on function public.admin_request_support_access(uuid, text) to authenticated;
