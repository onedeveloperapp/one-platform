-- ============================================================
-- 0206 · A copy of a file follows its file, and never holds it (0205).
--
-- `file_copies` pointed at `files` by a foreign key, which made it one of the
-- tables `discard_file` must look at before it forgets a file (the catalog
-- test of 0032): a file with a copy would never be forgotten. A copy is no
-- use of a file; it goes with it. The key goes, and the trigger that queues
-- the removal of the copy's bytes forgets the copy's record in the same
-- statement.
-- ============================================================

alter table public.file_copies drop constraint file_copies_file_id_fkey;

create or replace function public.files_queue_copy_removal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.file_copy_removals (storage_path)
  select c.storage_path from public.file_copies c where c.file_id = old.id;
  delete from public.file_copies where file_id = old.id;
  return old;
end;
$$;

revoke all on function public.files_queue_copy_removal() from public, anon, authenticated;
