-- ============================================================
-- 0265_filing_screen_file_kept: the screen of the court ONE kept for a
-- lawyer's confirmation (0264, `filing_submissions.summary_file_id`) is a
-- file the database looks at before it forgets one: `discard_file` (last
-- redefined in 0189) refuses a file a submission names as its screen, as it
-- refuses its receipt. Nothing else changes.
-- ============================================================

create or replace function public.discard_file(target_file uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  file public.files%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into file from public.files where id = target_file for update;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'not_found');
  end if;
  if exists (select 1 from public.issued_documents d where d.file_id = file.id)
     or exists (select 1 from public.case_documents d where d.file_id = file.id or d.normalized_file_id = file.id)
     or exists (select 1 from public.case_statements s where s.audio_file_id = file.id)
     or exists (select 1 from public.wa_messages m where m.media_file_id = file.id)
     or exists (select 1 from public.filing_package_items i where i.file_id = file.id or i.signed_file_id = file.id)
     or exists (select 1 from public.filing_receipts r where r.file_id = file.id)
     or exists (select 1 from public.filing_submissions s where s.receipt_file_id = file.id or s.summary_file_id = file.id)
     or exists (select 1 from public.template_imports i where i.file_id = file.id)
     or exists (select 1 from public.pax_documents d where d.file_id = file.id)
     -- The receipt of a cost of a case (0131).
     or exists (select 1 from public.case_costs c where c.file_id = file.id)
     -- The document of a bill or an entry of the books (0140).
     or exists (select 1 from public.finance_bills b where b.file_id = file.id)
     or exists (select 1 from public.finance_entries e where e.file_id = file.id)
     -- A document of a trip of a person the firm registered, before any case (0170).
     or exists (select 1 from public.tracked_trip_documents d where d.file_id = file.id)
     -- The invoice the firm issued, kept with its record (0165).
     or exists (select 1 from public.finance_invoices i where i.file_id = file.id)
     -- The receipt the court gave of an intermediate piece ONE filed (0189).
     or exists (select 1 from public.case_drafts d where d.receipt_file_id = file.id) then
    return jsonb_build_object('ok', false, 'code', 'in_use');
  end if;

  delete from public.files where id = file.id;
  -- A file a partner held is none of the firm's trail (`confirm_file`, 0070).
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (case when file.partner_id is null then file.org_id end, null, 'file.discarded', 'file', file.id::text,
          jsonb_strip_nulls(jsonb_build_object('purpose', file.purpose, 'status', file.status, 'partner', file.partner_id)));
  return jsonb_build_object('ok', true, 'code', 'discarded');
end;
$$;

revoke all on function public.discard_file(uuid) from public, anon, authenticated;
