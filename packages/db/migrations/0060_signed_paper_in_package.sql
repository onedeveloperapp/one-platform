-- ============================================================
-- 0060_signed_paper_in_package: a paper that came back signed goes in the filing package as its signed version.
--
-- The rehearsal of the end-to-end test (2026-10-26) found it: the client signed the power of attorney ONE issued
-- (0054) and the firm confirmed the signature, so the case held both documents accepted, the original and the
-- signed one; the package ONE asked for carried the original, unsigned, and left the signed one out (a filing
-- takes one paper of a kind per person). A lawsuit filed with that package goes with a power of attorney nobody
-- signed.
--
-- `request_filing_package` (replaces the one of 0036) now takes, for each document asked that went to be signed
-- and came back signed (its envelope `signed`, the signed document accepted in the same case), the signed document
-- in its place, whoever asks: ONE (0039), or a person of the firm. Nothing else of the request changes.
-- ============================================================

/**
 * A person of the firm, or ONE for the case it carries, asks for the package
 * of a lawsuit not filed yet: the petition (a PDF of the case a person
 * accepted) and the documents that go with it (accepted too), each document
 * that came back signed taken as its signed version. The lawsuit names its
 * court and its system, whose limits the package keeps: of a file, and of
 * the petition when the system gives it one of its own. Asking again
 * replaces the package in course. Never a support visit.
 */
create or replace function public.request_filing_package(
  target_proceeding uuid,
  target_petition uuid,
  target_documents uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  proceeding public.proceedings%rowtype;
  current_case public.cases%rowtype;
  documents uuid[] := coalesce(target_documents, '{}');
  wanted integer;
  package uuid;
  replaced uuid;
  system_row public.court_systems%rowtype;
begin
  select * into proceeding from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'proceeding_not_found');
  end if;
  current_case := public.case_for_writer(proceeding.case_id);
  -- Read again under the lock of its case: a receipt may have just filed it.
  select * into proceeding from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'proceeding_not_found');
  end if;
  if proceeding.status <> 'planned' then
    return jsonb_build_object('ok', false, 'code', 'already_filed');
  end if;
  if proceeding.court is null or proceeding.system is null then
    return jsonb_build_object('ok', false, 'code', 'forum_incomplete');
  end if;
  -- What blocks a filing (0025): a small-claims lawsuit beside a minor of a family nobody split, or a lawsuit
  -- in the civil court with a claimant whose word on it (for a minor, who answers for them) is not a yes.
  if public.filing_blocker(proceeding.id) is not null then
    return jsonb_build_object('ok', false, 'code', public.filing_blocker(proceeding.id));
  end if;
  if not exists (
    select 1 from public.case_documents d
    join public.files f on f.id = coalesce(d.normalized_file_id, d.file_id)
    where d.id = target_petition and d.case_id = current_case.id and d.kind = 'petition' and d.status = 'accepted'
      and f.status = 'stored' and f.detected_mime = 'application/pdf'
  ) then
    return jsonb_build_object('ok', false, 'code', 'petition_not_found', 'field', 'petition');
  end if;
  -- A document that went to be signed and came back signed goes as its signed version (0060): the latest envelope
  -- of it that is signed, whose signed document the case accepted.
  documents := array(
    select distinct coalesce(signed.id, d)
    from unnest(documents) d
    left join lateral (
      select e.signed_document_id as id
      from public.signature_envelopes e
      join public.case_documents s on s.id = e.signed_document_id
      where e.document_id = d and e.status = 'signed' and e.signed_document_id <> d
        and s.case_id = current_case.id and s.status = 'accepted'
      order by e.updated_at desc, e.id
      limit 1
    ) signed on true
    where d is not null and d <> target_petition
  );
  wanted := coalesce(array_length(documents, 1), 0);
  if wanted > public.filing_setting('max_documents', 60) then
    return jsonb_build_object('ok', false, 'code', 'too_many_documents');
  end if;
  if wanted <> (
    select count(*) from public.case_documents d
    where d.id = any (documents) and d.case_id = current_case.id and d.status = 'accepted' and d.kind <> 'petition'
  ) then
    return jsonb_build_object('ok', false, 'code', 'document_not_found', 'field', 'documents');
  end if;

  select * into system_row from public.court_systems cs
  where cs.court = proceeding.court and cs.proceeding_kind = proceeding.kind and cs.system = proceeding.system;

  for replaced in
    update public.filing_packages set status = 'cancelled', claimed_at = null
    where proceeding_id = proceeding.id and status in ('requested', 'ready', 'failed')
    returning id
  loop
    perform public.drop_filing_package_files(replaced);
  end loop;

  insert into public.filing_packages (
    org_id, case_id, proceeding_id, court, system, kind, petition_document_id, document_ids,
    limit_bytes, petition_limit_bytes, limit_confirmed, requested_by
  ) values (
    current_case.org_id, current_case.id, proceeding.id, proceeding.court, proceeding.system, proceeding.kind,
    target_petition, documents,
    system_row.max_file_bytes, system_row.max_petition_bytes, coalesce(system_row.confirmed, false), auth.uid()
  )
  returning id into package;
  perform public.record_case_event(current_case.org_id, current_case.id, 'filing_package_requested',
    public.case_actor(current_case.id),
    jsonb_build_object('package', package, 'proceeding', proceeding.id, 'documents', wanted + 1));
  return jsonb_build_object('ok', true, 'code', 'requested', 'package_id', package);
end;
$$;

revoke all on function public.request_filing_package(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.request_filing_package(uuid, uuid, uuid[]) to authenticated;
