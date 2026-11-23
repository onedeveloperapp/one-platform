-- ============================================================
-- A paper sent back unsigned is refused where it arrives (0281). The
-- owner's test of 2026-11-23: a client sent the power of attorney and the
-- contract back exactly as ONE issued them, with no signature, and the firm
-- was asked to confirm them as signed by gov.br. The backend, finishing an
-- upload of the client's link, now reads whether the PDF carries a
-- signature (`pdfSignatures` of `@flyee/documents/pdf-signature`) when the
-- upload is a paper sent back for an envelope, and refuses one with none at
-- once, with why: what the database hands it of an upload says so
-- (`client_link_upload_to_finish`, replaced from 0024, adds `envelope_id`).
-- ============================================================

/**
 * What the backend needs to finish an upload of a link (replaces 0024's): as there, and the envelope a paper sent back
 * signed belongs to (0281), null for any other document. Service role only.
 */
create or replace function public.client_link_upload_to_finish(target_token text, target_document uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype;
  document public.case_documents%rowtype;
  file public.files%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  link := public.client_link_by_token(target_token);
  if link.id is null then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  select * into document from public.case_documents
  where id = target_document and link_id = link.id and case_id = link.case_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into file from public.files where id = document.file_id;
  return jsonb_build_object(
    'ok', true, 'code', 'found', 'kind', document.kind, 'status', document.status, 'quality', document.quality,
    'file_id', document.file_id, 'storage_path', file.storage_path, 'file_status', file.status,
    'envelope_id', document.envelope_id
  );
end;
$$;

revoke all on function public.client_link_upload_to_finish(text, uuid) from public, anon, authenticated;
