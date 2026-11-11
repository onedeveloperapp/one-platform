-- ============================================================
-- 0175 · O arquivo da nota fiscal emitida nunca é esquecido
--
-- `discard_file` redefined from 0170 (the latest that redefined it, by the name migrations apply in), so a file an
-- invoice the firm issued names (`finance_invoices.file_id`, 0165) is answered `in_use` and never forgotten. Any later
-- redefinition of `discard_file` starts from this body.
-- ============================================================

/** Whether a file is named by a row that stays (0170), an invoice's included (0165). Service role. */
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
     or exists (select 1 from public.filing_submissions s where s.receipt_file_id = file.id)
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
     or exists (select 1 from public.finance_invoices i where i.file_id = file.id) then
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
