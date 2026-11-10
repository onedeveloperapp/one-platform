-- ============================================================
-- 0153 · O arquivo do recibo fica com quem lê os livros
--
-- 0152 kept a receipt's file to who reads the books by asking, in the
-- policy of `files`, whether an issued document of kind `recibo` names the
-- file. That question was asked under the policy of `issued_documents`,
-- which hides a receipt from whoever does not read the books: for them no
-- receipt named the file, and the file showed. The question is now asked
-- past the policies, by a function that answers only whether the file is a
-- receipt's.
--
--   file_is_receipt   whether a file is the document of a receipt.
-- ============================================================

/** Whether a file is the document of a receipt (read past the policies, which hide the receipt itself). */
create or replace function public.file_is_receipt(target_file uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.issued_documents i where i.file_id = target_file and i.kind = 'recibo');
$$;

revoke all on function public.file_is_receipt(uuid) from public, anon;
grant execute on function public.file_is_receipt(uuid) to authenticated;

drop policy "files_select_member" on public.files;
create policy "files_select_member" on public.files
  for select to authenticated
  using (
    public.is_org_member(org_id) and partner_id is null and (purpose <> 'finance' or public.finance_reads(org_id))
    and (purpose <> 'issued' or public.finance_reads(org_id) or not public.file_is_receipt(id))
  );
