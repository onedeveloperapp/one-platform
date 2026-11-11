-- ============================================================
-- 0205 · The backup adapted (M3, sprint S10): a copy of the firms' files.
--
-- The logical backup copies the tables (packages/backup), never the vault; the
-- files a firm keeps (`firm-files`: documents, statements, pieces) had no copy
-- at all. Each stored file is now copied by the backend into a second private
-- bucket (`firm-files-copy`), a few at a time, and recorded (`file_copies`).
-- A copy never outlives its file: when a file's record goes (a person erased,
-- a firm cleared, a file taken back), the removal of its copy is queued in the
-- same statement (`file_copy_removals`) and the backend removes it, so an
-- erasure reaches the copy too. Both tables are the backend's alone.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('firm-files-copy', 'firm-files-copy', false)
on conflict (id) do nothing;

create table public.file_copies (
  file_id uuid primary key references public.files (id) on delete cascade,
  storage_path text not null,
  copied_at timestamptz not null default now()
);

alter table public.file_copies enable row level security;
revoke all on table public.file_copies from anon, authenticated;

create table public.file_copy_removals (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null,
  queued_at timestamptz not null default now(),
  tries integer not null default 0
);

create index file_copy_removals_queued_idx on public.file_copy_removals (queued_at);

alter table public.file_copy_removals enable row level security;
revoke all on table public.file_copy_removals from anon, authenticated;

/** A file whose record goes queues the removal of its copy, in the same statement. */
create or replace function public.files_queue_copy_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.file_copy_removals (storage_path)
  select c.storage_path from public.file_copies c where c.file_id = old.id;
  return old;
end;
$$;

revoke all on function public.files_queue_copy_removal() from public, anon, authenticated;

create trigger files_queue_copy_removal before delete on public.files
  for each row execute function public.files_queue_copy_removal();

/** The stored files with no copy yet (the backend's), the oldest first, ten minutes after they were stored. */
create or replace function public.files_to_copy(target_limit integer default 50)
returns table (file_id uuid, storage_path text)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.storage_path from public.files f
  where f.status = 'stored' and f.confirmed_at < now() - interval '10 minutes'
    and not exists (select 1 from public.file_copies c where c.file_id = f.id)
  order by f.confirmed_at
  limit greatest(least(coalesce(target_limit, 50), 500), 1);
$$;

revoke all on function public.files_to_copy(integer) from public, anon, authenticated;
grant execute on function public.files_to_copy(integer) to service_role;

/**
 * The backend records a copy it made. A file whose record went meanwhile is not recorded, and answers so, for the
 * backend to remove the copy it just made.
 */
create or replace function public.record_file_copy(target_file uuid, target_path text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.files f where f.id = target_file and f.status = 'stored') then
    return false;
  end if;
  insert into public.file_copies (file_id, storage_path) values (target_file, target_path)
  on conflict (file_id) do nothing;
  return true;
end;
$$;

revoke all on function public.record_file_copy(uuid, text) from public, anon, authenticated;
grant execute on function public.record_file_copy(uuid, text) to service_role;

/** The copies to remove (the backend's), the oldest first. */
create or replace function public.file_copy_removals_due(target_limit integer default 100)
returns table (id uuid, storage_path text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.storage_path from public.file_copy_removals r
  order by r.queued_at
  limit greatest(least(coalesce(target_limit, 100), 1000), 1);
$$;

revoke all on function public.file_copy_removals_due(integer) from public, anon, authenticated;
grant execute on function public.file_copy_removals_due(integer) to service_role;

/** What came of a removal: done (forgotten), or tried again later. */
create or replace function public.finish_file_copy_removal(target_removal uuid, target_done boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if target_done then
    delete from public.file_copy_removals where id = target_removal;
  else
    update public.file_copy_removals set tries = tries + 1 where id = target_removal;
  end if;
end;
$$;

revoke all on function public.finish_file_copy_removal(uuid, boolean) from public, anon, authenticated;
grant execute on function public.finish_file_copy_removal(uuid, boolean) to service_role;
