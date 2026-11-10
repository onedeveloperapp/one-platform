-- ============================================================
-- 0157 · Os documentos do cliente que volta
--
-- The plan of the finance, decision 6 (and phase 9's limit): a client the
-- firm already served does not send again the identity and a recent proof of
-- address it accepted in an earlier case. While a new case is gathered
-- (`intake`, `documents`, `signature`), each of its claimants and guardians
-- who has, in another case of the same firm (a test case only from a test
-- case), an accepted identity, or a proof of address accepted within the
-- setting's 90 days, owes that document in the new case: the backend copies
-- the file in storage (a document's file is one case's) and the database
-- records the copy as an accepted document of the new case, said as brought
-- from the earlier one (`source` `reuse`, `reused_from`), told in the
-- timeline as ONE's. Only what the new case does not have yet of that person
-- and kind; never the same source twice in a case (a person who refuses the
-- copy asks the client for a new one, as with any document).
--
--   document_reuses_due     the backend's: what is owed, a few at a time;
--   record_document_reuse   the backend's: the copy as the new case's document.
-- ============================================================

update public.platform_settings
set value = value || jsonb_build_object('document_reuse',
  jsonb_build_object('kinds', jsonb_build_array('identity', 'address_proof'), 'address_days', 90))
where key = 'cases' and not value ? 'document_reuse';

alter table public.case_documents add column reused_from uuid references public.case_documents (id) on delete set null;
alter table public.case_documents drop constraint case_documents_source_check;
alter table public.case_documents add constraint case_documents_source_check
  check (source in ('client', 'firm', 'whatsapp', 'signature', 'partner', 'reuse'));
create unique index case_documents_reused_idx on public.case_documents (case_id, reused_from) where reused_from is not null;

/**
 * What a new case is owed of its people's earlier documents (internal): each claimant or guardian of a case being
 * gathered, each kind the setting names that the case has no document of for that person (one being sent, kept or
 * accepted), and the latest accepted one of that person and kind in another case of the firm (a proof of address only
 * within the setting's days), never a source the case already took.
 */
create or replace view public.document_reuse_candidates
with (security_invoker = true)
as
select distinct on (tc.id, tp.id, sd.kind)
  tc.org_id, tc.id as target_case, tp.id as target_party, sd.id as source_document, sd.kind, sd.file_id
from public.cases tc
join public.case_parties tp on tp.case_id = tc.id and tp.role in ('claimant', 'guardian')
join public.case_parties sp on sp.person_id = tp.person_id and sp.case_id <> tc.id and sp.org_id = tc.org_id
join public.case_documents sd on sd.party_id = sp.id and sd.case_id = sp.case_id and sd.status = 'accepted'
join public.cases sc on sc.id = sd.case_id and sc.is_test = tc.is_test
join public.files sf on sf.id = sd.file_id and sf.status = 'stored'
where tc.status in ('intake', 'documents', 'signature')
  and sd.kind in (select jsonb_array_elements_text(coalesce(public.cases_setting('document_reuse') -> 'kinds', '[]'::jsonb)))
  and (sd.kind <> 'address_proof' or coalesce(sd.decided_at, sd.created_at) >= now() - make_interval(days =>
        coalesce((public.cases_setting('document_reuse') ->> 'address_days')::integer, 90)))
  and not exists (
    select 1 from public.case_documents d
    where d.case_id = tc.id and d.party_id = tp.id and d.kind = sd.kind and d.status in ('uploading', 'received', 'accepted')
  )
  and not exists (select 1 from public.case_documents d where d.case_id = tc.id and d.reused_from = sd.id)
order by tc.id, tp.id, sd.kind, coalesce(sd.decided_at, sd.created_at) desc, sd.id;

revoke all on public.document_reuse_candidates from public, anon, authenticated;
grant select on public.document_reuse_candidates to service_role;

/** What the backend copies now, a few at a time, with where the source file is (the backend's). */
create or replace function public.document_reuses_due(target_limit integer default 20)
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
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'org_id', c.org_id, 'target_case', c.target_case, 'target_party', c.target_party,
      'source_document', c.source_document, 'kind', c.kind,
      'source_path', f.storage_path, 'purpose', f.purpose, 'new_id', gen_random_uuid()
    ))
    from (select * from public.document_reuse_candidates limit least(greatest(coalesce(target_limit, 20), 1), 100)) c
    join public.files f on f.id = c.file_id
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.document_reuses_due(integer) from public, anon, authenticated;
grant execute on function public.document_reuses_due(integer) to service_role;

/**
 * The copy the backend made, recorded (the backend's): only while the new case still owes that document (else
 * `not_due`, and the backend removes the copy), as a file of the firm measured as the source was and an accepted
 * document of the new case, brought from the earlier one, told in the timeline as ONE's.
 */
create or replace function public.record_document_reuse(
  target_source uuid,
  target_case uuid,
  target_party uuid,
  target_file uuid,
  target_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  source_document public.case_documents%rowtype;
  source_file public.files%rowtype;
  document uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.document_reuse_candidates c
    where c.target_case = record_document_reuse.target_case and c.target_party = record_document_reuse.target_party
      and c.source_document = record_document_reuse.target_source
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_due');
  end if;
  select * into source_document from public.case_documents where id = target_source;
  select * into source_file from public.files where id = source_document.file_id;
  if target_path is distinct from 'org/' || source_file.org_id::text || '/' || source_file.purpose || '/' || target_file::text then
    return jsonb_build_object('ok', false, 'code', 'invalid_path');
  end if;
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
    detected_mime, expires_at, confirmed_at)
  values (target_file, source_file.org_id, source_file.purpose, target_path, source_file.name, source_file.declared_mime,
    source_file.declared_bytes, 'stored', source_file.sha256, source_file.bytes, source_file.detected_mime, now(), now());
  insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, status, decided_at, reused_from)
  values (source_document.org_id, target_case, target_party, target_file, source_document.kind, 'reuse', 'accepted', now(),
    source_document.id)
  returning id into document;
  perform public.record_case_event(source_document.org_id, target_case, 'document_reused', 'system',
    jsonb_build_object('document', document, 'kind', source_document.kind,
      'from_case', (select c.seq from public.cases c where c.id = source_document.case_id)));
  return jsonb_build_object('ok', true, 'document', document);
end;
$$;

revoke all on function public.record_document_reuse(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_document_reuse(uuid, uuid, uuid, uuid, text) to service_role;
