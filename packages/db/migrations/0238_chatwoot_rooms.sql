-- ============================================================
-- 0238_chatwoot_rooms: the team's rooms in the panel of attendance.
--
-- The user's decision of 2026-11-13: the firm's people talk among themselves,
-- outside a client's conversation, in rooms ("Salas") of the firm's panel
-- (0223). A room is an inbox of the team alone in the firm's account (of the
-- API kind, with no webhook and no reply window, nobody assigned by rotation)
-- with one fixed conversation, whose contact has no phone and no e-mail: only
-- who is in the room sees it, and nothing written there leaves the panel (the
-- attendance kit's D26). Its members take part in the conversation, so the
-- panel tells them of each new message, and they call a colleague with @ in a
-- note. Who administers the firm and the partners make the rooms, choose who
-- is in each, rename them, archive them with a reason and bring them back; an
-- archived room keeps its history in the panel, with nobody in it.
--
-- ONE keeps a room's name and its people; what is written in a room lives in
-- the panel only. A member who has not entered the panel yet joins the room
-- when they first do; one who leaves the firm leaves every room. The backend
-- brings the panel up to each room changed, claimed once, as 0223's
-- conversations.
-- ============================================================

-- ---------- The rooms and their people ----------

create table public.chatwoot_rooms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archive_reason text,
  -- The panel's side, the backend's: Chatwoot's numbers of the room's inbox, its contact and its conversation,
  -- and the name and the people (Chatwoot's numbers) the panel was last given.
  chatwoot_inbox_id integer,
  chatwoot_contact_id integer,
  chatwoot_conversation_id integer,
  chatwoot_name text,
  chatwoot_members integer[] not null default '{}',
  -- Something of the room changed after the panel was last brought up to it.
  chatwoot_dirty_at timestamptz default now(),
  chatwoot_synced_at timestamptz,
  chatwoot_claimed_at timestamptz,
  chatwoot_failures integer not null default 0,
  chatwoot_retry_at timestamptz,
  unique (org_id, id),
  constraint chatwoot_rooms_name_check check (char_length(name) between 1 and 60 and name = btrim(name)),
  constraint chatwoot_rooms_archived_check check (
    (archived_at is null and archive_reason is null)
    or (archived_at is not null and char_length(archive_reason) between 3 and 300)
  ),
  constraint chatwoot_rooms_ids_check check (
    coalesce(chatwoot_inbox_id, 1) > 0 and coalesce(chatwoot_contact_id, 1) > 0
    and coalesce(chatwoot_conversation_id, 1) > 0
  ),
  constraint chatwoot_rooms_failures_check check (chatwoot_failures >= 0)
);

-- Two rooms in use never share a name.
create unique index chatwoot_rooms_name_idx on public.chatwoot_rooms (org_id, lower(name)) where archived_at is null;
create index chatwoot_rooms_dirty_idx on public.chatwoot_rooms (chatwoot_dirty_at) where chatwoot_dirty_at is not null;

create table public.chatwoot_room_members (
  room_id uuid not null,
  org_id uuid not null,
  user_id uuid not null,
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (room_id, user_id),
  foreign key (org_id, room_id) references public.chatwoot_rooms (org_id, id) on delete cascade,
  -- Who leaves the firm leaves its rooms.
  foreign key (org_id, user_id) references public.memberships (org_id, user_id) on delete cascade
);

create index chatwoot_room_members_person_idx on public.chatwoot_room_members (org_id, user_id);

-- ---------- Who sees and who manages them ----------

/** Who administers the firm and the partners: they see every room of the firm and manage them. */
create or replace function public.manages_rooms(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid()
      and (m.role in ('owner', 'admin') or m.firm_function = 'socio')
  );
$$;
revoke all on function public.manages_rooms(uuid) from public, anon;
grant execute on function public.manages_rooms(uuid) to authenticated;

/** Whether the person asking is in the room (read past the room's own policy, which asks it). */
create or replace function public.in_room(target_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.chatwoot_room_members r where r.room_id = target_room and r.user_id = auth.uid()
  );
$$;
revoke all on function public.in_room(uuid) from public, anon;
grant execute on function public.in_room(uuid) to authenticated;

alter table public.chatwoot_rooms enable row level security;
alter table public.chatwoot_room_members enable row level security;

-- A room is read by its people, and by who manages the firm's rooms; nobody else of the firm knows of it.
create policy "chatwoot_rooms_select" on public.chatwoot_rooms
  for select to authenticated
  using (public.is_org_member(org_id) and (public.manages_rooms(org_id) or public.in_room(id)));

create policy "chatwoot_room_members_select" on public.chatwoot_room_members
  for select to authenticated
  using (public.is_org_member(org_id) and (public.manages_rooms(org_id) or public.in_room(room_id)));

revoke all on table public.chatwoot_rooms from public, anon, authenticated;
revoke all on table public.chatwoot_room_members from public, anon, authenticated;
grant select on table public.chatwoot_rooms to authenticated;
grant select on table public.chatwoot_room_members to authenticated;
grant select, insert, update, delete on table public.chatwoot_rooms to service_role;
grant select, insert, update, delete on table public.chatwoot_room_members to service_role;

create trigger guard_impersonation_chatwoot_rooms after insert or update or delete on public.chatwoot_rooms
  for each statement execute function public.guard_impersonation_readonly();
create trigger guard_impersonation_chatwoot_room_members after insert or update or delete on public.chatwoot_room_members
  for each statement execute function public.guard_impersonation_readonly();

create trigger chatwoot_rooms_updated_at
  before update on public.chatwoot_rooms
  for each row execute function public.set_updated_at();

-- ---------- What marks a room for the panel ----------

/** A room's people changed (a save, a person who left the firm): the panel is behind. */
create or replace function public.chatwoot_room_members_marks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chatwoot_rooms set chatwoot_dirty_at = clock_timestamp()
  where id = coalesce(new.room_id, old.room_id);
  return null;
end;
$$;

revoke all on function public.chatwoot_room_members_marks() from public, anon, authenticated;

create trigger chatwoot_room_members_marks
  after insert or delete on public.chatwoot_room_members
  for each row execute function public.chatwoot_room_members_marks();

/** A person entered the panel for the first time: the rooms they are in take them in. */
create or replace function public.chatwoot_staff_rooms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chatwoot_rooms r set chatwoot_dirty_at = clock_timestamp()
  where r.org_id = new.org_id and r.archived_at is null
    and exists (select 1 from public.chatwoot_room_members m where m.room_id = r.id and m.user_id = new.user_id);
  return null;
end;
$$;

revoke all on function public.chatwoot_staff_rooms() from public, anon, authenticated;

create trigger chatwoot_staff_rooms
  after insert on public.chatwoot_staff
  for each row execute function public.chatwoot_staff_rooms();

-- ---------- What the firm reads and does ----------

/**
 * The rooms the person sees (theirs; every room of the firm to who manages them), each with its people and whether
 * each has entered the panel yet, and whether the panel has the room up to date.
 */
create or replace function public.firm_rooms(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  manages boolean;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  manages := public.manages_rooms(target_org);
  return jsonb_build_object(
    'manages', manages and not public.is_impersonated(),
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'archived_at', r.archived_at,
        'archive_reason', r.archive_reason,
        'mine', exists (select 1 from public.chatwoot_room_members m where m.room_id = r.id and m.user_id = auth.uid()),
        'in_panel', r.chatwoot_conversation_id is not null,
        'behind', r.chatwoot_dirty_at is not null
          and r.chatwoot_dirty_at > coalesce(r.chatwoot_synced_at, '-infinity'::timestamptz),
        'members', coalesce((
          select jsonb_agg(jsonb_build_object(
            'user_id', m.user_id,
            'in_panel', exists (select 1 from public.chatwoot_staff s where s.org_id = m.org_id and s.user_id = m.user_id)
          ) order by m.added_at, m.user_id)
          from public.chatwoot_room_members m where m.room_id = r.id
        ), '[]'::jsonb)
      ) order by r.archived_at nulls first, lower(r.name))
      from public.chatwoot_rooms r
      where r.org_id = target_org
        and (manages or exists (
          select 1 from public.chatwoot_room_members m where m.room_id = r.id and m.user_id = auth.uid()
        ))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.firm_rooms(uuid) from public, anon;
grant execute on function public.firm_rooms(uuid) to authenticated;

/**
 * Makes a room or changes its name and its people, by who administers the firm or a partner. The name is between 1
 * and 60 characters and no other room in use has it; the people are of the firm, at least one, at most 200.
 */
create or replace function public.save_team_room(
  target_org uuid,
  target_room uuid,
  target_name text,
  target_members uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  person uuid := auth.uid();
  clean text := regexp_replace(btrim(coalesce(target_name, '')), '\s+', ' ', 'g');
  people uuid[];
  room public.chatwoot_rooms%rowtype;
  made boolean := target_room is null;
begin
  if person is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_session');
  end if;
  if not public.manages_rooms(target_org) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if char_length(clean) not between 1 and 60 then
    return jsonb_build_object('ok', false, 'code', 'invalid_name');
  end if;
  select coalesce(array_agg(distinct x), '{}') into people from unnest(coalesce(target_members, '{}')) x where x is not null;
  if cardinality(people) = 0 then
    return jsonb_build_object('ok', false, 'code', 'no_members');
  end if;
  if cardinality(people) > 200 then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;
  if exists (
    select 1 from unnest(people) x
    where not exists (select 1 from public.memberships m where m.org_id = target_org and m.user_id = x)
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_a_member');
  end if;
  if exists (
    select 1 from public.chatwoot_rooms r
    where r.org_id = target_org and r.archived_at is null and lower(r.name) = lower(clean)
      and r.id is distinct from target_room
  ) then
    return jsonb_build_object('ok', false, 'code', 'name_taken');
  end if;

  if made then
    if (select count(*) from public.chatwoot_rooms r where r.org_id = target_org and r.archived_at is null) >= 100 then
      return jsonb_build_object('ok', false, 'code', 'too_many_rooms');
    end if;
    insert into public.chatwoot_rooms (org_id, name, created_by) values (target_org, clean, person)
    returning * into room;
  else
    select * into room from public.chatwoot_rooms r where r.id = target_room and r.org_id = target_org for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if room.archived_at is not null then
      return jsonb_build_object('ok', false, 'code', 'archived');
    end if;
    update public.chatwoot_rooms set name = clean, chatwoot_dirty_at = clock_timestamp() where id = room.id;
  end if;

  delete from public.chatwoot_room_members m where m.room_id = room.id and not (m.user_id = any (people));
  insert into public.chatwoot_room_members (room_id, org_id, user_id, added_by)
  select room.id, target_org, x, person from unnest(people) x
  on conflict (room_id, user_id) do nothing;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (
    target_org, person, case when made then 'atendimento.room_created' else 'atendimento.room_changed' end,
    'chatwoot_room', room.id::text, jsonb_build_object('members', cardinality(people))
  );
  return jsonb_build_object('ok', true, 'id', room.id);
end;
$$;

revoke all on function public.save_team_room(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function public.save_team_room(uuid, uuid, text, uuid[]) to authenticated;

/**
 * Archives a room with its reason (everybody leaves it in the panel, its history stays), or brings it back with no
 * reason (its people return), by who administers the firm or a partner.
 */
create or replace function public.archive_team_room(target_org uuid, target_room uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  person uuid := auth.uid();
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
  room public.chatwoot_rooms%rowtype;
begin
  if person is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_session');
  end if;
  if not public.manages_rooms(target_org) then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  select * into room from public.chatwoot_rooms r where r.id = target_room and r.org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if reason is not null then
    if char_length(reason) not between 3 and 300 then
      return jsonb_build_object('ok', false, 'code', 'invalid_reason');
    end if;
    if room.archived_at is not null then
      return jsonb_build_object('ok', true, 'id', room.id);
    end if;
    update public.chatwoot_rooms
    set archived_at = now(), archive_reason = reason, chatwoot_dirty_at = clock_timestamp()
    where id = room.id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, person, 'atendimento.room_archived', 'chatwoot_room', room.id::text,
            jsonb_build_object('reason', reason));
  else
    if room.archived_at is null then
      return jsonb_build_object('ok', true, 'id', room.id);
    end if;
    if exists (
      select 1 from public.chatwoot_rooms r
      where r.org_id = target_org and r.archived_at is null and lower(r.name) = lower(room.name)
    ) then
      return jsonb_build_object('ok', false, 'code', 'name_taken');
    end if;
    update public.chatwoot_rooms
    set archived_at = null, archive_reason = null, chatwoot_dirty_at = clock_timestamp()
    where id = room.id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, person, 'atendimento.room_restored', 'chatwoot_room', room.id::text, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'id', room.id);
end;
$$;

revoke all on function public.archive_team_room(uuid, uuid, text) from public, anon;
grant execute on function public.archive_team_room(uuid, uuid, text) to authenticated;

-- ---------- The backend's work ----------

/**
 * Rooms whose panel is behind, claimed under a number so a server takes each once: of firms whose account is ready,
 * past any wait a failure set, oldest change first; one room, or the rooms of one firm, when named.
 */
create or replace function public.chatwoot_claim_rooms(
  target_limit integer default 10,
  target_room uuid default null,
  target_org uuid default null,
  stale_seconds integer default 120
)
returns table (room_id uuid, org_id uuid, dirty_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  update public.chatwoot_rooms r set chatwoot_claimed_at = clock_timestamp()
  where r.id in (
    select x.id from public.chatwoot_rooms x
    join public.chatwoot_accounts a on a.org_id = x.org_id and a.status = 'ready'
    where x.chatwoot_dirty_at is not null
      and x.chatwoot_dirty_at > coalesce(x.chatwoot_synced_at, '-infinity'::timestamptz)
      and (target_room is null or x.id = target_room)
      and (target_org is null or x.org_id = target_org)
      and (x.chatwoot_claimed_at is null or x.chatwoot_claimed_at < now() - make_interval(secs => stale_seconds))
      and (x.chatwoot_retry_at is null or x.chatwoot_retry_at <= now())
    order by x.chatwoot_dirty_at
    limit greatest(least(coalesce(target_limit, 10), 50), 1)
    for update of x skip locked
  )
  returning r.id, r.org_id, r.chatwoot_dirty_at;
end;
$$;

revoke all on function public.chatwoot_claim_rooms(integer, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.chatwoot_claim_rooms(integer, uuid, uuid, integer) to service_role;

/**
 * What the backend needs to bring the panel up to a room: its name, whether it is archived, what the panel has of it,
 * and the panel's numbers of the people in it who entered the panel.
 */
create or replace function public.chatwoot_room_work(target_room uuid)
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
  return (
    select jsonb_build_object(
      'id', r.id,
      'org_id', r.org_id,
      'name', r.name,
      'archived', r.archived_at is not null,
      'inbox_id', r.chatwoot_inbox_id,
      'contact_id', r.chatwoot_contact_id,
      'conversation_id', r.chatwoot_conversation_id,
      'panel_name', r.chatwoot_name,
      'panel_members', to_jsonb(r.chatwoot_members),
      'members', coalesce((
        select jsonb_agg(s.chatwoot_user_id order by s.chatwoot_user_id)
        from public.chatwoot_room_members m
        join public.chatwoot_staff s on s.org_id = m.org_id and s.user_id = m.user_id
        where m.room_id = r.id
      ), '[]'::jsonb)
    )
    from public.chatwoot_rooms r where r.id = target_room
  );
end;
$$;

revoke all on function public.chatwoot_room_work(uuid) from public, anon, authenticated;
grant execute on function public.chatwoot_room_work(uuid) to service_role;

/**
 * What the panel now has of a room, kept as each step ends: what is given is kept, the rest stays as it was. A room
 * the panel no longer has is forgotten (`target_forget`), and made there again.
 */
create or replace function public.chatwoot_keep_room(
  target_room uuid,
  target_inbox integer default null,
  target_contact integer default null,
  target_conversation integer default null,
  target_name text default null,
  target_members integer[] default null,
  target_forget boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_forget then
    update public.chatwoot_rooms set
      chatwoot_inbox_id = null, chatwoot_contact_id = null, chatwoot_conversation_id = null,
      chatwoot_name = null, chatwoot_members = '{}'
    where id = target_room;
    return;
  end if;
  update public.chatwoot_rooms set
    chatwoot_inbox_id = coalesce(target_inbox, chatwoot_inbox_id),
    chatwoot_contact_id = coalesce(target_contact, chatwoot_contact_id),
    chatwoot_conversation_id = coalesce(target_conversation, chatwoot_conversation_id),
    chatwoot_name = coalesce(target_name, chatwoot_name),
    chatwoot_members = coalesce(target_members, chatwoot_members)
  where id = target_room;
end;
$$;

revoke all on function public.chatwoot_keep_room(uuid, integer, integer, integer, text, integer[], boolean)
  from public, anon, authenticated;
grant execute on function public.chatwoot_keep_room(uuid, integer, integer, integer, text, integer[], boolean)
  to service_role;

/**
 * A claimed room's work ended. Done, the panel is up to the change it was claimed at (a change since keeps it
 * behind); failed, it waits a while that grows with each failure, up to an hour.
 */
create or replace function public.chatwoot_finish_room(target_room uuid, target_dirty_at timestamptz, target_done boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_done then
    update public.chatwoot_rooms set
      chatwoot_synced_at = greatest(coalesce(chatwoot_synced_at, '-infinity'::timestamptz), target_dirty_at),
      chatwoot_claimed_at = null,
      chatwoot_failures = 0,
      chatwoot_retry_at = null
    where id = target_room;
  else
    update public.chatwoot_rooms set
      chatwoot_claimed_at = null,
      chatwoot_failures = least(chatwoot_failures + 1, 1000),
      chatwoot_retry_at = now() + make_interval(mins => least(power(2, least(chatwoot_failures, 6))::integer, 60))
    where id = target_room;
  end if;
end;
$$;

revoke all on function public.chatwoot_finish_room(uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.chatwoot_finish_room(uuid, timestamptz, boolean) to service_role;
