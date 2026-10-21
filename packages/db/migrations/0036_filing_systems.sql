-- ============================================================
-- 0036_filing_systems: what each court's system asks of a filing package,
-- beyond the size of a file (0027), for the packages of eproc and PJe.
--
--   court_systems.max_petition_bytes  the largest petition the system takes,
--                                     when it takes the petition apart from
--                                     the documents and under a limit of its
--                                     own (the PJe of TJCE takes the petition
--                                     as one PDF of up to 1.5 MB); a petition
--                                     is never cut, so a larger one is named
--                                     as a problem;
--   court_systems.file_types          the type the lawyer picks in the system
--                                     for each kind of file of the package,
--                                     as the system names it ("Petição
--                                     inicial (INIC)" in eproc), where it is
--                                     known;
--   filing_packages.petition_limit_bytes  the petition's limit the package was
--                                     built under, as `limit_bytes` is the
--                                     limit of every other file.
--
-- What the lawyer has at hand and does in each system (its login, its
-- signer, its screens) is said by the screen per system; what a court's
-- system really takes is closed by the test of the filing station, done
-- with a lawyer, whose result is a row here and never a constant.
-- ============================================================

alter table public.court_systems add column max_petition_bytes bigint;
alter table public.court_systems add column file_types jsonb not null default '{}'::jsonb;
-- A petition's own limit is never above the limit of a file, which every file of a package keeps.
alter table public.court_systems add constraint court_systems_petition_limit_check
  check (max_petition_bytes is null or (max_petition_bytes > 0
    and (max_file_bytes is null or max_petition_bytes <= max_file_bytes)));

/** The types of a court's system for the kinds of a package: an object of short names, by a kind a package knows. */
create or replace function public.filing_types_ok(types jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(types) = 'object'
    and coalesce((
      select bool_and(
        key in ('petition', 'power_of_attorney', 'identity', 'address_proof', 'ticket', 'boarding_pass', 'receipt',
                'evidence', 'contract', 'other')
        and jsonb_typeof(value) = 'string'
        and char_length(value #>> '{}') between 2 and 80
        and value #>> '{}' = btrim(value #>> '{}')
      )
      from jsonb_each(types)
    ), true);
$$;

revoke all on function public.filing_types_ok(jsonb) from public, anon, authenticated;

alter table public.court_systems add constraint court_systems_file_types_check check (public.filing_types_ok(file_types));

alter table public.filing_packages add column petition_limit_bytes bigint;

-- The eproc of TJSP takes a PDF of up to 11 MB (its manual for lawyers, "Da distribuição de inicial", updated on
-- 20/03/2025, read on 2026-10-11), and so does TJSC's (its answers on the recess, "anexar PDF até 11MB"): the limit
-- of a row nobody confirmed, said as such by the screen until the test of the station confirms it.
update public.court_systems
set max_file_bytes = 11000000,
    notes = concat_ws(' ', notes, 'Limite de 11 MB por PDF no manual do eproc do TJSP para advogados (20/03/2025) e nas perguntas do TJSC; a confirmar no teste do posto.')
where system = 'eproc' and court in ('TJSP', 'TJSC') and max_file_bytes is null and not confirmed;

-- The PJe of TJCE takes the petition as one PDF of up to 1.5 MB, the attachments under the system's own limit
-- (its infographic "Arquivo PDF: petições iniciais e intermediárias", 2024, read on 2026-10-11).
update public.court_systems
set max_petition_bytes = 1500000,
    notes = concat_ws(' ', notes, 'A petição em PDF tem até 1,5 MB (infográfico do PJe do TJCE, 2024); o limite dos anexos é o do sistema, a confirmar no teste do posto.')
where system = 'pje' and court = 'TJCE' and max_petition_bytes is null and not confirmed;

-- The petition's type, as each system names it: eproc's "INIC" in the summary of a filing, the PJe's "Petição
-- inicial" (the tutorials of TJSP's eproc and TJMG's PJe). The types of the other files are the court's list,
-- picked by the lawyer, and join a row when the test of the station reads them.
update public.court_systems set file_types = '{"petition": "Petição inicial (INIC)"}'::jsonb
where system = 'eproc' and file_types = '{}'::jsonb;
update public.court_systems set file_types = '{"petition": "Petição inicial"}'::jsonb
where system = 'pje' and file_types = '{}'::jsonb;

/**
 * The operator records what a court's system asks of a package beyond the
 * size of a file: the petition's own limit and the type of each kind of
 * file, as the system names it. On the record.
 */
create or replace function public.admin_set_court_system_files(
  target_court text,
  target_kind text,
  target_max_petition_bytes bigint,
  target_file_types jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.court_systems set
    max_petition_bytes = target_max_petition_bytes,
    file_types = coalesce(target_file_types, '{}'::jsonb),
    updated_by = caller,
    updated_at = now()
  where court = target_court and proceeding_kind = target_kind;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'admin.court_system.files_set', 'court_system', target_court || '/' || target_kind,
    jsonb_build_object('max_petition_bytes', target_max_petition_bytes,
      'types', (select count(*) from jsonb_object_keys(coalesce(target_file_types, '{}'::jsonb)))));
  return jsonb_build_object('ok', true, 'code', 'saved');
exception when check_violation then
  return jsonb_build_object('ok', false, 'code', 'invalid_value');
end;
$$;

revoke all on function public.admin_set_court_system_files(text, text, bigint, jsonb) from public, anon;
grant execute on function public.admin_set_court_system_files(text, text, bigint, jsonb) to authenticated;

/**
 * The operator records a court's system for a kind of lawsuit (replaces the
 * one of 0021): another system is other screens, so what the one before
 * asked of a package (the petition's own limit, the type of each file) goes
 * with it. A limit of a file below the petition's own is refused.
 */
create or replace function public.admin_set_court_system(
  target_court text,
  target_kind text,
  target_system text,
  target_since date,
  target_max_file_bytes bigint,
  target_source text,
  target_notes text,
  target_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  clean_source text := nullif(btrim(coalesce(target_source, '')), '');
begin
  if caller is null or not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.courts c where c.acronym = target_court) then
    return jsonb_build_object('ok', false, 'code', 'court_not_found');
  end if;
  if clean_source is null or char_length(clean_source) < 8 then
    return jsonb_build_object('ok', false, 'code', 'source_required');
  end if;

  insert into public.court_systems as cs (
    court, proceeding_kind, system, since, max_file_bytes, source, notes, confirmed, updated_by
  ) values (
    target_court, target_kind, target_system, target_since, target_max_file_bytes, left(clean_source, 500),
    nullif(btrim(coalesce(target_notes, '')), ''), coalesce(target_confirmed, false), caller
  )
  on conflict (court, proceeding_kind) do update set
    system = excluded.system,
    since = excluded.since,
    max_file_bytes = excluded.max_file_bytes,
    max_petition_bytes = case when cs.system = excluded.system then cs.max_petition_bytes end,
    file_types = case when cs.system = excluded.system then cs.file_types else '{}'::jsonb end,
    source = excluded.source,
    notes = excluded.notes,
    confirmed = excluded.confirmed,
    updated_by = caller,
    updated_at = now();

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (null, caller, 'admin.court_system.set', 'court_system', target_court || '/' || target_kind,
          jsonb_build_object('system', target_system, 'confirmed', coalesce(target_confirmed, false)));
  return jsonb_build_object('ok', true, 'code', 'saved');
exception when check_violation then
  return jsonb_build_object('ok', false, 'code', 'invalid_value', 'field', 'max_file_bytes');
end;
$$;

revoke all on function public.admin_set_court_system(text, text, text, date, bigint, text, text, boolean) from public, anon;
grant execute on function public.admin_set_court_system(text, text, text, date, bigint, text, text, boolean) to authenticated;

/**
 * A person of the firm asks for the package of a lawsuit not filed yet
 * (replaces the one of 0027): the petition (a PDF of the case a person
 * accepted) and the documents that go with it (accepted too). The lawsuit
 * names its court and its system, whose limits the package keeps: of a
 * file, and of the petition when the system gives it one of its own. Asking
 * again replaces the package in course. Never a support visit.
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
  documents := array(select distinct d from unnest(documents) d where d is not null and d <> target_petition);
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

/**
 * What building a package needs (replaces the one of 0027), for the worker
 * that holds the claim `target_claim`: the package with its limits, and each
 * document with the file that goes (the PDF made of a photo when there is
 * one), its measure and whose it is. Service role only.
 */
create or replace function public.filing_package_to_build(target_package uuid, target_claim integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  package public.filing_packages%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into package from public.filing_packages
  where id = target_package and status = 'requested' and claimed_at is not null and attempts = target_claim;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'package_id', package.id,
    'org_id', package.org_id,
    'claim', package.attempts,
    -- What the person chose: a document that is gone since then shows by its absence below.
    'petition_document_id', package.petition_document_id,
    'document_ids', to_jsonb(package.document_ids),
    'limit_bytes', package.limit_bytes,
    'petition_limit_bytes', package.petition_limit_bytes,
    'name_max_length', public.filing_setting('name_max_length', 80),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'document_id', d.id,
        'kind', d.kind,
        'person', (select pe.full_name from public.case_parties cp join public.people pe on pe.id = cp.person_id where cp.id = d.party_id),
        'file_id', f.id,
        'storage_path', f.storage_path,
        'mime', f.detected_mime,
        'bytes', f.bytes,
        'pages', f.pages
      ) order by d.created_at, d.id)
      from public.case_documents d
      join public.files f on f.id = coalesce(d.normalized_file_id, d.file_id) and f.status = 'stored'
      where d.case_id = package.case_id and d.status = 'accepted'
        and (d.id = package.petition_document_id or d.id = any (package.document_ids))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.filing_package_to_build(uuid, integer) from public, anon, authenticated;

/**
 * A petition under a limit of its own goes whole and under it: whatever a
 * worker sends, the package keeps no petition cut in parts, nor one larger
 * than its limit (`record_filing_package` answers `invalid_items`).
 */
create or replace function public.filing_items_petition_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  package public.filing_packages%rowtype;
begin
  select * into package from public.filing_packages where id = new.package_id;
  if found and package.petition_limit_bytes is not null and new.document_id = package.petition_document_id
     and (new.parts > 1 or new.bytes > package.petition_limit_bytes) then
    raise exception 'petition_over_its_limit' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.filing_items_petition_limit() from public, anon, authenticated;

create trigger filing_items_petition_limit before insert or update on public.filing_package_items
  for each row execute function public.filing_items_petition_limit();
