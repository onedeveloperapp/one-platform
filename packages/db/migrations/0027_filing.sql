-- ============================================================
-- 0027_filing: the filing package of a lawsuit and its receipt.
--
--   filing_packages       what a lawyer attaches in the court's system for
--                         one lawsuit: the petition and the documents of the
--                         case a person chose, asked by a person and built by
--                         the backend (ordered, named, cut under the limit of
--                         the court's system);
--   filing_package_items  each file of a built package, in its order;
--   filing_receipts       the proof the court's system gave when the lawyer
--                         filed: the file, the case number and the day.
--
-- ONE builds the package and files nothing: the lawyer files in the court's
-- own system, with their own login and their own certificate. The limits of
-- each system are data (`court_systems.max_file_bytes`), and the order and
-- the names are the pure rule of `@flyee/courts/filing`.
-- ============================================================

-- The parts of a package are files of the firm under their own purpose: only the backend writes them.
update public.platform_settings
set value = jsonb_set(value, '{purposes,filing}', jsonb_build_object(
  'people', false,
  'max_bytes', 52428800,
  'mimes', jsonb_build_array('application/pdf')
))
where key = 'files' and not (value -> 'purposes') ? 'filing';

insert into public.platform_settings (key, value, is_public) values
  ('filing', jsonb_build_object(
    -- A package claimed and not finished for this long goes back to the line.
    'working_minutes', 15,
    -- How many times a package is claimed before a passing failure becomes final.
    'max_attempts', 3,
    -- After a passing failure the package waits this long times the attempt before it is tried again.
    'retry_minutes', 5,
    -- The longest name the package gives a file, extension included.
    'name_max_length', 80,
    -- How many documents one package takes besides the petition.
    'max_documents', 60
  ), true)
on conflict (key) do nothing;

-- What the notice of the court says of Projudi's limit (TJGO, 2020: 6 MB for files of 30 pages or more).
-- Kept for every file until the test of the filing station says what the smaller ones take: a file cut
-- smaller than it had to be is still accepted, one larger is refused at the worst moment.
update public.court_systems
set max_file_bytes = 6000000,
    notes = concat_ws(' ', notes, 'Limite de arquivo: aviso do TJGO de 2020 (6 MB para arquivos de 30 páginas ou mais), aplicado a todos até o teste do posto de protocolo.')
where court = 'TJGO' and system = 'projudi' and max_file_bytes is null;

create table public.filing_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  proceeding_id uuid not null,
  -- The court, its system and the kind of lawsuit as they were when the package was asked: what it was built for.
  court text not null,
  system text not null,
  kind text not null,
  -- requested  a person asked; the backend builds it;
  -- ready      built: the files wait for the lawyer;
  -- failed     could not be built (`error`), or something in it cannot go (`problems`);
  -- filed      the lawyer filed it and its receipt is attached;
  -- cancelled  replaced by another, or given up.
  status text not null default 'requested',
  -- The petition and the other documents of the case that go, as the person chose them.
  petition_document_id uuid not null,
  document_ids uuid[] not null default '{}',
  -- The limit of the system the package was built under, and whether a person had confirmed it.
  limit_bytes bigint,
  limit_confirmed boolean not null default false,
  -- What cannot go as it is: [{document_id, code}].
  problems jsonb not null default '[]'::jsonb,
  claimed_at timestamptz,
  attempts integer not null default 0,
  -- After a passing failure: not before this moment.
  retry_after timestamptz,
  error text,
  requested_by uuid references public.profiles (id) on delete set null,
  -- A person of the firm gave it up (`cancel_filing_package`): ONE never asks for another of that lawsuit (0039).
  cancelled_by_person boolean not null default false,
  requested_at timestamptz not null default now(),
  built_at timestamptz,
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (proceeding_id, org_id) references public.proceedings (id, org_id) on delete cascade,
  foreign key (petition_document_id, org_id) references public.case_documents (id, org_id) on delete cascade,
  constraint filing_packages_kind_check check (kind in ('juizado', 'comum')),
  constraint filing_packages_status_check check (status in ('requested', 'ready', 'failed', 'filed', 'cancelled')),
  constraint filing_packages_system_check check (system in ('projudi', 'eproc', 'pje', 'esaj', 'outro')),
  constraint filing_packages_error_check check (error is null or error ~ '^[a-z][a-z0-9_]{1,59}$'),
  constraint filing_packages_problems_check check (jsonb_typeof(problems) = 'array')
);

create index filing_packages_case_idx on public.filing_packages (case_id, requested_at desc);
create index filing_packages_queue_idx on public.filing_packages (org_id, requested_at) where status in ('requested', 'ready', 'failed');
-- One package in course per lawsuit: asking again replaces it.
create unique index filing_packages_open_idx on public.filing_packages (proceeding_id) where status in ('requested', 'ready', 'failed');

alter table public.filing_packages enable row level security;
create policy "filing_packages_select_member" on public.filing_packages
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.filing_packages to authenticated;
create trigger guard_impersonation_filing_packages after insert or update or delete on public.filing_packages
  for each statement execute function public.guard_impersonation_readonly();

create table public.filing_package_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  package_id uuid not null,
  -- The order the lawyer attaches the files in, from 1; a document cut in parts keeps their order.
  position integer not null,
  name text not null,
  file_id uuid not null,
  -- The document of the case this file is, or is a part of.
  document_id uuid,
  part integer not null default 1,
  parts integer not null default 1,
  bytes bigint not null,
  pages integer,
  unique (package_id, position),
  unique (package_id, name),
  foreign key (package_id, org_id) references public.filing_packages (id, org_id) on delete cascade,
  foreign key (file_id, org_id) references public.files (id, org_id),
  foreign key (document_id, org_id) references public.case_documents (id, org_id) on delete set null (document_id),
  constraint filing_package_items_position_check check (position > 0 and part between 1 and parts),
  constraint filing_package_items_name_check check (name ~ '^[a-z0-9][a-z0-9-]{0,118}\.pdf$'),
  constraint filing_package_items_bytes_check check (bytes > 0)
);

create index filing_package_items_file_idx on public.filing_package_items (file_id);

alter table public.filing_package_items enable row level security;
create policy "filing_package_items_select_member" on public.filing_package_items
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.filing_package_items to authenticated;
create trigger guard_impersonation_filing_package_items after insert or update or delete on public.filing_package_items
  for each statement execute function public.guard_impersonation_readonly();

create table public.filing_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  package_id uuid not null unique,
  proceeding_id uuid not null,
  -- What the court's system gave: a PDF, or a picture of the screen.
  file_id uuid not null,
  cnj text not null,
  filed_on date not null,
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (package_id, org_id) references public.filing_packages (id, org_id) on delete cascade,
  foreign key (proceeding_id, org_id) references public.proceedings (id, org_id) on delete cascade,
  foreign key (file_id, org_id) references public.files (id, org_id),
  constraint filing_receipts_cnj_check check (public.cnj_is_valid(cnj))
);

alter table public.filing_receipts enable row level security;
create policy "filing_receipts_select_member" on public.filing_receipts
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.filing_receipts to authenticated;
create trigger guard_impersonation_filing_receipts after insert or update or delete on public.filing_receipts
  for each statement execute function public.guard_impersonation_readonly();

/** A setting of the filing packages, or its default. */
create or replace function public.filing_setting(setting text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (s.value ->> setting)::integer from public.platform_settings s where s.key = 'filing'), fallback);
$$;

revoke all on function public.filing_setting(text, integer) from public, anon, authenticated;

/**
 * True for a part cut for a filing package that nothing names any more: no
 * package, and nothing else either. Nothing else should ever name one (the
 * functions that take a file of the firm refuse this purpose); the check
 * stands so that forgetting a part can never take anything with it, nor
 * fail on a reference.
 */
create or replace function public.filing_part_is_free(part public.files)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select part.purpose = 'filing'
    and not exists (select 1 from public.filing_package_items i where i.file_id = part.id)
    and not exists (select 1 from public.filing_receipts r where r.file_id = part.id)
    and not exists (select 1 from public.case_documents d where d.file_id = part.id or d.normalized_file_id = part.id)
    and not exists (select 1 from public.wa_messages m where m.media_file_id = part.id)
    and not exists (select 1 from public.case_statements s where s.audio_file_id = part.id)
    and not exists (select 1 from public.issued_documents d where d.file_id = part.id);
$$;

revoke all on function public.filing_part_is_free(public.files) from public, anon, authenticated;

/**
 * Forgets the files of a package that will never be filed: its items, and the
 * parts that were cut for it (files of the `filing` purpose; the documents
 * themselves are the case's and stay). Their objects then have no record,
 * and the upkeep of the bucket removes them.
 */
create or replace function public.drop_filing_package_files(target_package uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  parts uuid[];
begin
  select coalesce(array_agg(i.file_id), '{}') into parts
  from public.filing_package_items i
  join public.files f on f.id = i.file_id
  where i.package_id = target_package and f.purpose = 'filing';
  delete from public.filing_package_items where package_id = target_package;
  delete from public.files f
  where f.id = any (parts) and public.filing_part_is_free(f);
end;
$$;

revoke all on function public.drop_filing_package_files(uuid) from public, anon, authenticated;

/**
 * A person of the firm asks for the package of a lawsuit not filed yet: the
 * petition (a PDF of the case a person accepted) and the documents that go
 * with it (accepted too). The lawsuit names its court and its system. Asking
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
    org_id, case_id, proceeding_id, court, system, petition_document_id, document_ids,
    limit_bytes, limit_confirmed, requested_by
  ) values (
    current_case.org_id, current_case.id, proceeding.id, proceeding.court, proceeding.system, target_petition, documents,
    system_row.max_file_bytes, coalesce(system_row.confirmed, false), auth.uid()
  )
  returning id into package;
  perform public.record_case_event(current_case.org_id, current_case.id, 'filing_package_requested', 'person',
    jsonb_build_object('package', package, 'proceeding', proceeding.id, 'documents', wanted + 1));
  return jsonb_build_object('ok', true, 'code', 'requested', 'package_id', package);
end;
$$;

revoke all on function public.request_filing_package(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.request_filing_package(uuid, uuid, uuid[]) to authenticated;

/** A person gives up the package in course of a lawsuit. */
create or replace function public.cancel_filing_package(target_package uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  package public.filing_packages%rowtype;
  current_case public.cases%rowtype;
begin
  select * into package from public.filing_packages where id = target_package;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(package.case_id);
  select * into package from public.filing_packages where id = target_package for update;
  if package.status not in ('requested', 'ready', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'package_closed');
  end if;
  update public.filing_packages set status = 'cancelled', claimed_at = null, cancelled_by_person = true
  where id = package.id;
  perform public.drop_filing_package_files(package.id);
  perform public.record_case_event(current_case.org_id, current_case.id, 'filing_package_cancelled', 'person',
    jsonb_build_object('package', package.id));
  return jsonb_build_object('ok', true, 'code', 'cancelled');
end;
$$;

revoke all on function public.cancel_filing_package(uuid) from public, anon;
grant execute on function public.cancel_filing_package(uuid) to authenticated;

-- ---------- What the backend does ----------

/**
 * Claims the packages asked and not built (or the one named), after putting
 * back in line the ones claimed and never finished and giving up the ones
 * whose every attempt ended that way, and after forgetting the parts a
 * worker cut and never recorded. Each claim has a number (the attempt it
 * is): the worker hands it back to read the package and to say what it
 * built, so only who holds a claim works under it. Service role only.
 */
create or replace function public.claim_filing_packages(target_limit integer default 5, target_package uuid default null)
returns table (package_id uuid, claim integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  minutes integer := greatest(public.filing_setting('working_minutes', 15), 1);
  tries integer := greatest(public.filing_setting('max_attempts', 3), 1);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.filing_packages p
  set status = case when p.attempts >= tries then 'failed' else p.status end,
      error = case when p.attempts >= tries then 'abandoned' else p.error end,
      claimed_at = null
  where p.status = 'requested' and p.claimed_at < now() - make_interval(mins => minutes);

  -- A part cut by a worker that never said so is nobody's: no package names it.
  delete from public.files f
  where f.purpose = 'filing' and f.created_at < now() - make_interval(mins => minutes * 4)
    and public.filing_part_is_free(f);

  return query
  with picked as (
    select p.id from public.filing_packages p
    where p.status = 'requested' and p.claimed_at is null
      and (p.retry_after is null or p.retry_after <= now())
      and (target_package is null or p.id = target_package)
    order by p.requested_at
    limit greatest(least(coalesce(target_limit, 5), 20), 1)
    for update skip locked
  )
  update public.filing_packages p
  set claimed_at = now(), retry_after = null, attempts = p.attempts + 1
  from picked where p.id = picked.id
  returning p.id, p.attempts;
end;
$$;

revoke all on function public.claim_filing_packages(integer, uuid) from public, anon, authenticated;

/**
 * What building a package needs, for the worker that holds the claim
 * `target_claim`: the package, and each document with the file that goes
 * (the PDF made of a photo when there is one), its measure and whose it is.
 * Nothing for anybody else. Service role only.
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
 * What building a package came to. `ready`: its files, in their order
 * (`items`: position, name, file_id, document_id, part, parts, bytes,
 * pages), each one a stored PDF of the firm under the system's limit.
 * `failed`: what cannot go (`problems`) or a short code. `retry`: a passing
 * failure, back in line until the attempts are spent. Service role only.
 */
create or replace function public.record_filing_package(
  target_package uuid,
  target_claim integer,
  target_outcome text,
  target_items jsonb default '[]'::jsonb,
  target_problems jsonb default '[]'::jsonb,
  target_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  package public.filing_packages%rowtype;
  tries integer := greatest(public.filing_setting('max_attempts', 3), 1);
  pause integer := greatest(public.filing_setting('retry_minutes', 5), 1);
  code text := coalesce(substring(lower(coalesce(target_code, '')) from '^[a-z][a-z0-9_]{1,59}'), 'failed');
  outcome text := target_outcome;
  items jsonb := coalesce(target_items, '[]'::jsonb);
  item jsonb;
  seen integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_outcome is null or target_outcome not in ('ready', 'failed', 'retry') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;
  select * into package from public.filing_packages where id = target_package for update;
  if not found or package.status <> 'requested' or package.claimed_at is null
     or package.attempts is distinct from target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if outcome = 'retry' and package.attempts >= tries then
    outcome := 'failed';
  end if;

  if outcome = 'ready' then
    if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid_items');
    end if;
    for item in select value from jsonb_array_elements(items) loop
      seen := seen + 1;
      -- Each file is a stored PDF of the same firm, under the limit the package was built for, and
      -- the document it is (or is a part of) is one the person chose.
      if (item ->> 'document_id') is null or (item ->> 'file_id') is null
        or not ((item ->> 'document_id')::uuid = package.petition_document_id
                or (item ->> 'document_id')::uuid = any (package.document_ids))
        or coalesce(item ->> 'name', '') !~ '^[a-z0-9][a-z0-9-]{0,118}[.]pdf$'
        or not exists (
          select 1 from public.files f
          where f.id = (item ->> 'file_id')::uuid and f.org_id = package.org_id and f.status = 'stored'
            and f.detected_mime = 'application/pdf'
            -- A PDF that opens: one whose pages could not be counted is protected or damaged.
            and coalesce(f.pages, 0) > 0
            and (package.limit_bytes is null or f.bytes <= package.limit_bytes)
            -- A part cut for this very package (no other names it), or the very file of the document it is said to be.
            and (
              (f.purpose = 'filing' and not exists (select 1 from public.filing_package_items other where other.file_id = f.id))
              or exists (
                select 1 from public.case_documents d
                where d.id = (item ->> 'document_id')::uuid and f.id = coalesce(d.normalized_file_id, d.file_id)
              )
            )
        ) then
        return jsonb_build_object('ok', false, 'code', 'invalid_items');
      end if;
    end loop;
    begin
      insert into public.filing_package_items (org_id, package_id, position, name, file_id, document_id, part, parts, bytes, pages)
      select package.org_id, package.id, (i ->> 'position')::integer, i ->> 'name', f.id, (i ->> 'document_id')::uuid,
             coalesce((i ->> 'part')::integer, 1), coalesce((i ->> 'parts')::integer, 1), f.bytes, f.pages
      from jsonb_array_elements(items) i
      join public.files f on f.id = (i ->> 'file_id')::uuid;
      -- The petition leads the package, whatever the worker sent; every document the person chose is
      -- in it; and a document cut in parts has every one of them, each once.
      if not exists (
           select 1 from public.filing_package_items i
           where i.package_id = package.id and i.position = 1 and i.document_id = package.petition_document_id
         )
         or exists (
           select 1 from unnest(array[package.petition_document_id] || package.document_ids) as chosen (id)
           where not exists (
             select 1 from public.filing_package_items i where i.package_id = package.id and i.document_id = chosen.id
           )
         )
         or exists (
           select 1 from public.filing_package_items i
           where i.package_id = package.id
           group by i.document_id
           having count(*) <> max(i.parts) or count(distinct i.part) <> max(i.parts) or min(i.parts) <> max(i.parts)
             -- The parts of a document sit together, in their own order.
             or max(i.position) - min(i.position) <> count(*) - 1
             or bool_or(i.position - i.part <> (select min(first.position) - 1 from public.filing_package_items first
                                                 where first.package_id = i.package_id and first.document_id = i.document_id))
         )
         -- The places run from 1 with no gap.
         or (select max(i.position) <> count(*) from public.filing_package_items i where i.package_id = package.id) then
        raise check_violation;
      end if;
    exception when unique_violation or check_violation or not_null_violation or invalid_text_representation then
      return jsonb_build_object('ok', false, 'code', 'invalid_items');
    end;
  end if;

  update public.filing_packages set
    status = case outcome when 'ready' then 'ready' when 'failed' then 'failed' else status end,
    problems = case when outcome = 'failed' and jsonb_typeof(coalesce(target_problems, '[]'::jsonb)) = 'array'
      then coalesce(target_problems, '[]'::jsonb) else '[]'::jsonb end,
    error = case when outcome = 'ready' then null else code end,
    claimed_at = null,
    -- Tried again later, a little later each time: a storage that is down is given time to come back.
    retry_after = case when outcome = 'retry' then now() + make_interval(mins => pause * package.attempts) end,
    built_at = case when outcome = 'ready' then now() else built_at end
  where id = package.id;

  if outcome = 'ready' then
    perform public.record_case_event(package.org_id, package.case_id, 'filing_package_ready', 'system',
      jsonb_build_object('package', package.id, 'files', seen));
  elsif outcome = 'failed' then
    perform public.record_case_event(package.org_id, package.case_id, 'filing_package_failed', 'system',
      jsonb_build_object('package', package.id, 'code', code));
  end if;
  return jsonb_build_object('ok', true, 'code', outcome);
end;
$$;

revoke all on function public.record_filing_package(uuid, integer, text, jsonb, jsonb, text) from public, anon, authenticated;

-- ---------- The receipt ----------

/**
 * True when a package no longer says what its lawsuit is: the lawsuit moved
 * to another court, system or kind since the package was asked for, or one of
 * the documents in it is no longer an accepted document of the case.
 */
create or replace function public.filing_package_outdated(package public.filing_packages)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.proceedings p
      where p.id = package.proceeding_id
        and (p.court is distinct from package.court or p.system is distinct from package.system
             or p.kind is distinct from package.kind)
    )
    or exists (
      select 1 from unnest(array[package.petition_document_id] || package.document_ids) as chosen (id)
      where not exists (
        select 1 from public.case_documents d
        where d.id = chosen.id and d.case_id = package.case_id and d.status = 'accepted'
      )
    );
$$;

revoke all on function public.filing_package_outdated(public.filing_packages) from public, anon, authenticated;

/**
 * A partner or a lawyer of the firm attaches the proof the court's system
 * gave: the file they uploaded, the case number and the day. The lawsuit is
 * then filed, under that number (the same checks as writing it by hand), and
 * the package is closed. Never a support visit.
 */
create or replace function public.attach_filing_receipt(
  target_package uuid,
  target_file uuid,
  target_cnj text,
  target_filed_on date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  package public.filing_packages%rowtype;
  proceeding public.proceedings%rowtype;
  current_case public.cases%rowtype;
  saved jsonb;
  cnj_value text := regexp_replace(coalesce(target_cnj, ''), '\D', '', 'g');
begin
  select * into package from public.filing_packages where id = target_package;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(package.case_id);
  select * into package from public.filing_packages where id = target_package for update;
  if not public.has_firm_function(package.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_a_lawyer');
  end if;
  if package.status <> 'ready' then
    return jsonb_build_object('ok', false, 'code', 'package_not_ready');
  end if;
  select * into proceeding from public.proceedings where id = package.proceeding_id;
  if proceeding.status <> 'planned' then
    return jsonb_build_object('ok', false, 'code', 'already_filed');
  end if;
  -- The package is of the lawsuit as it was when it was built: one that moved to another court or
  -- system since, or whose documents are no longer all accepted, is built again before it is filed.
  if public.filing_package_outdated(package) then
    return jsonb_build_object('ok', false, 'code', 'package_outdated');
  end if;
  -- What blocks a filing is asked again (0025): a claimant added since, a guardian changed, a word taken
  -- back, or a minor joined to a family whose adults were planned in the small-claims court.
  if public.filing_blocker(proceeding.id) is not null then
    return jsonb_build_object('ok', false, 'code', public.filing_blocker(proceeding.id));
  end if;
  -- The day the court's system says: one that has come, and not before the case existed. (A package
  -- built again after the filing does not push the day forward.)
  if target_filed_on is null or target_filed_on > (now() at time zone 'America/Sao_Paulo')::date
     or target_filed_on < (current_case.created_at at time zone 'America/Sao_Paulo')::date then
    return jsonb_build_object('ok', false, 'code', 'invalid_date', 'field', 'filed_on');
  end if;
  if not exists (
    select 1 from public.files f
    where f.id = target_file and f.org_id = package.org_id and f.status = 'stored' and f.purpose = 'upload'
      and f.uploaded_by = auth.uid()
      and f.detected_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  ) or exists (select 1 from public.case_documents d where d.file_id = target_file)
    or exists (select 1 from public.filing_receipts r where r.file_id = target_file) then
    return jsonb_build_object('ok', false, 'code', 'file_not_found', 'field', 'file');
  end if;

  -- The lawsuit becomes filed through the one function that writes a lawsuit: the number is checked
  -- against its court, and against every other lawsuit of the firm.
  -- The package is closed first: a lawsuit that becomes filed gives up whatever package it still has
  -- in course (`proceedings_close_filing_packages`), and this one is not in course any more.
  update public.filing_packages set status = 'filed' where id = package.id;
  saved := public.save_proceeding(package.case_id, proceeding.id, jsonb_build_object(
    'kind', proceeding.kind, 'court', proceeding.court, 'comarca', proceeding.comarca, 'unit', proceeding.unit,
    'system', proceeding.system, 'forum_basis', proceeding.forum_basis, 'forum_reason', proceeding.forum_reason,
    'forum_city', proceeding.forum_city, 'status', 'filed', 'cnj', cnj_value, 'filed_at', target_filed_on::text));
  if not coalesce((saved ->> 'ok')::boolean, false) then
    update public.filing_packages set status = 'ready' where id = package.id;
    return saved;
  end if;

  insert into public.filing_receipts (org_id, package_id, proceeding_id, file_id, cnj, filed_on, recorded_by)
  values (package.org_id, package.id, package.proceeding_id, target_file, cnj_value, target_filed_on, auth.uid());
  perform public.record_case_event(package.org_id, package.case_id, 'filing_receipt_attached', 'person',
    jsonb_build_object('package', package.id, 'proceeding', package.proceeding_id));
  return jsonb_build_object('ok', true, 'code', 'filed');
end;
$$;

revoke all on function public.attach_filing_receipt(uuid, uuid, text, date) from public, anon;
grant execute on function public.attach_filing_receipt(uuid, uuid, text, date) to authenticated;

-- ---------- A package follows its lawsuit ----------

/**
 * A lawsuit that is no longer planned (somebody recorded it as filed by hand,
 * or closed it) has nothing left to file: the package it had in course is
 * given up, with the parts cut for it. One already filed keeps its receipt.
 */
create or replace function public.proceedings_close_filing_packages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  closed uuid;
begin
  if new.status = 'planned' or old.status is not distinct from new.status then
    return new;
  end if;
  for closed in
    update public.filing_packages set status = 'cancelled', claimed_at = null
    where proceeding_id = new.id and status in ('requested', 'ready', 'failed')
    returning id
  loop
    perform public.drop_filing_package_files(closed);
    perform public.record_case_event(new.org_id, new.case_id, 'filing_package_cancelled', 'system',
      jsonb_build_object('package', closed, 'proceeding', new.id));
  end loop;
  return new;
end;
$$;

revoke all on function public.proceedings_close_filing_packages() from public, anon, authenticated;

create trigger proceedings_close_filing_packages after update of status on public.proceedings
  for each row execute function public.proceedings_close_filing_packages();

/** A case that ended (closed, or not taken) has nothing left to file either. */
create or replace function public.cases_close_filing_packages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  closed uuid;
begin
  if new.status not in ('closed', 'declined') or old.status is not distinct from new.status then
    return new;
  end if;
  for closed in
    update public.filing_packages set status = 'cancelled', claimed_at = null
    where case_id = new.id and status in ('requested', 'ready', 'failed')
    returning id
  loop
    perform public.drop_filing_package_files(closed);
    perform public.record_case_event(new.org_id, new.id, 'filing_package_cancelled', 'system',
      jsonb_build_object('package', closed));
  end loop;
  return new;
end;
$$;

revoke all on function public.cases_close_filing_packages() from public, anon, authenticated;

create trigger cases_close_filing_packages after update of status on public.cases
  for each row execute function public.cases_close_filing_packages();

-- ---------- What needs somebody today ----------

/**
 * What needs somebody of the firm today (replaces the one of 0026), with one
 * more count: the filing packages that are built and wait for a lawyer.
 */
create or replace function public.firm_today(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  my_function public.firm_function;
  closing_hours integer := greatest(coalesce((public.wa_setting('closing_soon_hours') #>> '{}')::integer, 4), 1);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select m.firm_function into my_function
  from public.memberships m where m.org_id = target_org and m.user_id = auth.uid();
  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'approvals_mine', (
      select count(*) from public.approvals a
      where a.org_id = target_org and a.status = 'pending' and my_function = any (a.approver_functions)
    ),
    'approvals_waiting', (
      select count(*) from public.approvals a where a.org_id = target_org and a.status = 'pending'
    ),
    'conversations_waiting', (
      select count(*) from public.wa_conversations c
      join public.wa_numbers n on n.id = c.number_id
      where c.org_id = target_org and c.status = 'open' and c.last_message_direction = 'in' and n.status = 'active'
        and c.last_inbound_at is not null and c.last_inbound_at >= c.last_message_at
    ),
    'conversations_closing', (
      select count(*) from public.wa_conversations c
      join public.wa_numbers n on n.id = c.number_id
      where c.org_id = target_org and c.status = 'open' and c.last_message_direction = 'in' and n.status = 'active'
        and c.last_inbound_at is not null and c.last_inbound_at >= c.last_message_at
        and public.wa_window_open(c.last_inbound_at)
        and public.wa_window_closes_at(c.last_inbound_at) < now() + make_interval(hours => closing_hours)
    ),
    'sends_failed', (
      select count(*) from public.wa_messages m
      where m.org_id = target_org and m.direction = 'out' and m.status = 'failed'
        and m.created_at > now() - interval '24 hours'
    ),
    'documents_to_review', (
      select count(*) from public.case_documents d where d.org_id = target_org and d.status = 'received'
    ),
    'clients_finished', (
      select count(distinct l.case_id) from public.client_links l
      join public.cases c on c.id = l.case_id
      where l.org_id = target_org and l.finished_at is not null and l.revoked_at is null
        and c.status in ('intake', 'documents', 'signature')
    ),
    'chronologies_contested', (
      select count(distinct s.case_id) from public.case_statements s
      join public.cases c on c.id = s.case_id
      where s.org_id = target_org and s.chronology_status = 'contested'
        and c.status not in ('closed', 'declined')
    ),
    'complaints_overdue', (
      select count(distinct a.case_id) from public.admin_complaints a
      join public.cases c on c.id = a.case_id
      where a.org_id = target_org and a.outcome = 'pending'
        and a.answer_due_on < (now() at time zone 'America/Sao_Paulo')::date
        and c.status not in ('closed', 'declined')
    ),
    'filings_ready', (
      select count(*) from public.filing_packages p
      join public.cases c on c.id = p.case_id
      where p.org_id = target_org and p.status = 'ready' and c.status not in ('closed', 'declined')
    ),
    'whatsapp', case
      when exists (select 1 from public.wa_numbers n where n.org_id = target_org and n.status = 'active') then 'active'
      when exists (select 1 from public.wa_numbers n where n.org_id = target_org) then 'disconnected'
      else 'none'
    end
  );
end;
$$;

revoke all on function public.firm_today(uuid) from public, anon;
grant execute on function public.firm_today(uuid) to authenticated;
