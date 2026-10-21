-- ============================================================
-- 0042_package_signatures: the files of a filing package, signed by ONE
-- with the cloud signature of a lawyer who signs the lawsuit.
--
-- Where the court's system takes each file already signed (the Projudi of
-- TJGO takes an attached .p7s per document: "será necessário selecionar um
-- documento com extensão .p7s, já assinado com certificado digital", its
-- manual for lawyers, read on 2026-10-14), a package built (0027) owes its
-- signature: ONE signs every file of it with the authorization in force
-- (0041) of a lawyer named to sign its lawsuit (`proceeding_lawyers`), and
-- the lawyer files the .p7s in the court's system as they are. Whether ONE
-- does it alone is the firm's (`sign_package`, a decision of the catalog of
-- 0016, `auto` by default); at `approval`, a lawyer of the lawsuit asks for
-- it with their own authorization (`request_package_signature`).
--
--   court_systems.signed_files       the form a system takes a file already
--                                    signed in (`p7s`), per court and kind;
--                                    seeded for TJGO's Projudi, unconfirmed
--                                    like the rest of the row until the test
--                                    of the filing station.
--   filing_packages.signature_*      what the package owes of its signature:
--                                    `due` (ONE signs it), `waiting` (no
--                                    lawyer of the lawsuit has an
--                                    authorization in force), `signed` (by
--                                    whom, when, under which use of 0041),
--                                    `failed` (given up after its tries);
--                                    null when nothing is owed (a system that
--                                    signs on its own, or a firm that keeps it
--                                    to a person who has not asked).
--   filing_package_items.signed_file_id
--                                    the .p7s of each file, under the
--                                    `filing` purpose like the parts cut for a
--                                    package: it is nothing else, and is
--                                    forgotten with the package.
--
-- A package owes its signature from the moment it is built (a trigger), and
-- what is due is recomputed on every sweep (`claim_package_signatures`): a
-- package built of a system that takes signed files, of a firm that lets
-- ONE sign, that ONE or a partner or a lawyer asked for, owes it; one that waited for an authorization owes it again once
-- the lawyer it waits for has one. The backend claims a package under a
-- number, reads its files (`package_signature_to_sign`, which also chooses
-- the signer: the lawyer who asked, with their own authorization or not at
-- all, or else the lawyer of the lawsuit whose authorization lasts the
-- longest), signs them through `lawyer_signature_open` (the use bound to the
-- package's very files, to the claim and to the signer chosen) and records
-- the .p7s (`record_package_signature`, which checks the use is that
-- signer's, of this package and claim, signed, over these files, the signer
-- still signs the lawsuit, and each .p7s a stored file of the firm named by
-- nothing else). A claim that never came back spends its try. Told in the
-- case's timeline as ONE's.
--
-- A qualified signature carries its holder's data and stands for their
-- word: the .p7s leaves ONE only in the hands of the lawyer whose
-- certificate signed it (`filing_signed_file`), who files it. Another lawyer
-- of the lawsuit who files asks ONE to sign again with their own
-- authorization, and the files of the first go.
-- ============================================================

insert into public.autonomy_decisions (key, position, modes) values
  ('sign_package', 85, array['auto', 'approval'])
on conflict (key) do nothing;

-- The signed copy of a file of a package: the same purpose as a part cut for it.
update public.platform_settings
set value = jsonb_set(value, '{purposes,filing,mimes}',
  (value -> 'purposes' -> 'filing' -> 'mimes') || '["application/pkcs7-mime"]'::jsonb)
where key = 'files' and not (value -> 'purposes' -> 'filing' -> 'mimes') ? 'application/pkcs7-mime';

alter table public.court_systems add column signed_files text;
alter table public.court_systems add constraint court_systems_signed_files_check
  check (signed_files is null or signed_files = 'p7s');

update public.court_systems set signed_files = 'p7s' where court = 'TJGO' and system = 'projudi';

alter table public.filing_packages
  add column signature_status text,
  add column signature_claim integer not null default 0,
  add column signature_claimed_at timestamptz,
  add column signature_attempts integer not null default 0,
  add column signature_retry_after timestamptz,
  add column signature_error text,
  -- A lawyer of the lawsuit who asked for the signature with their own authorization.
  add column signer_requested uuid references public.profiles (id) on delete set null,
  add column signed_by uuid references public.profiles (id) on delete set null,
  add column signed_at timestamptz,
  add column signature_use uuid references public.lawyer_signature_uses (id) on delete set null,
  add constraint filing_packages_signature_status_check
    check (signature_status is null or signature_status in ('due', 'waiting', 'signed', 'failed')),
  add constraint filing_packages_signature_error_check
    check (signature_error is null or signature_error ~ '^[a-z][a-z0-9_]{1,63}$'),
  add constraint filing_packages_signed_check
    check ((signature_status = 'signed') = (signed_at is not null));

create index filing_packages_signature_idx on public.filing_packages (built_at)
  where status = 'ready' and (signature_status is null or signature_status in ('due', 'waiting'));

alter table public.filing_package_items add column signed_file_id uuid;
alter table public.filing_package_items add constraint filing_package_items_signed_file_fkey
  foreign key (signed_file_id, org_id) references public.files (id, org_id);
create unique index filing_package_items_signed_file_idx on public.filing_package_items (signed_file_id)
  where signed_file_id is not null;

insert into public.platform_settings (key, value, is_public) values
  ('package_signatures', jsonb_build_object(
    -- A package claimed and not recorded for this long goes back to the line.
    'working_minutes', 15,
    -- How many times ONE tries to sign a package before it waits for a person.
    'max_attempts', 3,
    -- After a passing failure the package waits this long times the attempt before it is tried again.
    'retry_minutes', 10
  ), false)
on conflict (key) do nothing;

create or replace function public.package_signature_setting(setting text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (s.value ->> setting)::integer from public.platform_settings s where s.key = 'package_signatures'), fallback);
$$;

revoke all on function public.package_signature_setting(text, integer) from public, anon, authenticated;

/** Whether the court's system of a package takes its files already signed, as a .p7s. */
create or replace function public.package_takes_signed_files(target_package public.filing_packages)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.court_systems cs
    where cs.court = target_package.court and cs.proceeding_kind = target_package.kind
      and cs.system = target_package.system and cs.signed_files = 'p7s'
  );
$$;

revoke all on function public.package_takes_signed_files(public.filing_packages) from public, anon, authenticated;

/**
 * Who signs a package: the lawyer of the lawsuit who asked, with their own
 * authorization in force or nobody; when nobody asked, the lawyer of the
 * lawsuit whose authorization in force lasts the longest.
 */
create or replace function public.package_signer_in_force(target_package public.filing_packages)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select pl.user_id
  from public.proceeding_lawyers pl
  join public.memberships m
    on m.org_id = target_package.org_id and m.user_id = pl.user_id and m.firm_function in ('socio', 'advogado')
  join public.connections c
    on c.org_id = target_package.org_id and c.person_id = pl.user_id and c.provider ~ '^psc[.]'
       and c.status in ('connected', 'error') and c.expires_at > now() + interval '1 minute'
       and exists (select 1 from public.connection_secrets s where s.connection_id = c.id)
  where pl.proceeding_id = target_package.proceeding_id
    and (target_package.signer_requested is null or pl.user_id = target_package.signer_requested)
  order by c.expires_at desc, pl.user_id
  limit 1;
$$;

revoke all on function public.package_signer_in_force(public.filing_packages) from public, anon, authenticated;

/**
 * Whether ONE signs a package by itself, where the firm lets it: one ONE asked
 * for (0039), or one a partner or a lawyer of the firm asked for, who chose
 * its petition and documents. A package somebody else of the team asked for
 * is signed only when a lawyer of the lawsuit asks for it: a lawyer's
 * qualified signature goes by itself only over what ONE or a lawyer put
 * together.
 */
create or replace function public.package_signs_itself(target_package public.filing_packages)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_package.requested_by is null
    or exists (
      select 1 from public.memberships m
      where m.org_id = target_package.org_id and m.user_id = target_package.requested_by
        and m.firm_function in ('socio', 'advogado')
    );
$$;

revoke all on function public.package_signs_itself(public.filing_packages) from public, anon, authenticated;

/**
 * As in 0041, and the files of a package are signed under the claim the
 * backend holds of it, by the lawyer it chose: a use of another claim, or of
 * another lawyer, opens nothing.
 */
create or replace function public.lawyer_signature_package_refusal(
  target_package public.filing_packages,
  target_person uuid,
  target_claim integer
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when target_package.status <> 'ready' then 'invalid_subject'
    when not exists (
      select 1 from public.proceeding_lawyers pl
      where pl.proceeding_id = target_package.proceeding_id and pl.user_id = target_person
    ) then 'not_a_signer'
    when target_package.signature_status is distinct from 'due' or target_package.signature_claimed_at is null
      or target_package.signature_claim is distinct from target_claim then 'not_claimed'
    -- Who asked signs or nobody; else the lawyer the claim chose. With nobody in force, the open says so itself.
    when target_package.signer_requested is not null and target_package.signer_requested <> target_person
      then 'not_the_signer'
    when public.package_signer_in_force(target_package) <> target_person then 'not_the_signer'
  end;
$$;

revoke all on function public.lawyer_signature_package_refusal(public.filing_packages, uuid, integer) from public, anon, authenticated;

/**
 * A package that turns ready owes its signature at once where the court's
 * system takes signed files, the firm lets ONE sign, and ONE or a partner or
 * a lawyer asked for it: the screens say so from their first read, and the
 * job signs it right after the build.
 */
create or replace function public.filing_packages_signature_on_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.package_takes_signed_files(new) and public.firm_autonomy_mode(new.org_id, 'sign_package') = 'auto'
     and public.package_signs_itself(new) then
    new.signature_status := 'due';
    new.signature_attempts := 0;
    new.signature_retry_after := null;
    new.signature_error := null;
    new.signature_claimed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.filing_packages_signature_on_ready() from public, anon, authenticated;

create trigger filing_packages_signature_on_ready
  before update of status on public.filing_packages
  for each row when (new.status = 'ready' and old.status is distinct from 'ready' and new.signature_status is null)
  execute function public.filing_packages_signature_on_ready();

/** The .p7s of a package's files go: no item names one, and what nothing else names is forgotten. */
create or replace function public.drop_package_signed_copies(target_package uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  copies uuid[];
begin
  select coalesce(array_agg(i.signed_file_id), '{}') into copies
  from public.filing_package_items i
  where i.package_id = target_package and i.signed_file_id is not null;
  update public.filing_package_items set signed_file_id = null
  where package_id = target_package and signed_file_id is not null;
  delete from public.files f where f.id = any (copies) and public.filing_part_is_free(f);
end;
$$;

revoke all on function public.drop_package_signed_copies(uuid) from public, anon, authenticated;

/**
 * The .p7s ONE signed of a file of a package, for the lawyer whose
 * certificate signed it and for nobody else: a qualified signature carries
 * its holder's data and stands for their word, so it leaves ONE only in
 * that lawyer's hands, to be filed in the court's system. While they are a
 * partner or a lawyer of the firm who signs the lawsuit; never from a
 * support visit. Anybody of the firm reads that the files are signed, and
 * by whom.
 */
create or replace function public.filing_signed_file(target_item uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  item record;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'not_allowed_in_support_session');
  end if;
  select i.signed_file_id, i.name, p.signed_by, p.org_id, p.proceeding_id into item
  from public.filing_package_items i
  join public.filing_packages p on p.id = i.package_id
  where i.id = target_item and i.signed_file_id is not null
    and p.signature_status = 'signed' and p.status in ('ready', 'filed');
  if not found or not public.is_org_member(item.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if item.signed_by is distinct from caller
     or not public.has_firm_function(item.org_id, array['socio', 'advogado']::public.firm_function[])
     or not exists (
       select 1 from public.proceeding_lawyers pl where pl.proceeding_id = item.proceeding_id and pl.user_id = caller
     ) then
    return jsonb_build_object('ok', false, 'code', 'not_the_signer');
  end if;
  return jsonb_build_object('ok', true, 'code', 'found', 'file_id', item.signed_file_id, 'name', item.name);
end;
$$;

revoke all on function public.filing_signed_file(uuid) from public, anon;
grant execute on function public.filing_signed_file(uuid) to authenticated;

-- ---------- The files of a package, as 0027 forgets them ----------

/**
 * As in 0027, and a signed copy (`signed_file_id`) is a file named too: a
 * part or a .p7s of a package is free only when no item names it either way.
 */
create or replace function public.filing_part_is_free(part public.files)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select part.purpose = 'filing'
    and not exists (select 1 from public.filing_package_items i where i.file_id = part.id or i.signed_file_id = part.id)
    and not exists (select 1 from public.filing_receipts r where r.file_id = part.id)
    and not exists (select 1 from public.case_documents d where d.file_id = part.id or d.normalized_file_id = part.id)
    and not exists (select 1 from public.wa_messages m where m.media_file_id = part.id)
    and not exists (select 1 from public.case_statements s where s.audio_file_id = part.id)
    and not exists (select 1 from public.issued_documents d where d.file_id = part.id);
$$;

revoke all on function public.filing_part_is_free(public.files) from public, anon, authenticated;

/** As in 0027, and the .p7s signed for the package go with its parts. */
create or replace function public.drop_filing_package_files(target_package uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  parts uuid[];
begin
  select coalesce(array_agg(file_id), '{}') into parts
  from (
    select i.file_id from public.filing_package_items i
    join public.files f on f.id = i.file_id
    where i.package_id = target_package and f.purpose = 'filing'
    union all
    select i.signed_file_id from public.filing_package_items i
    where i.package_id = target_package and i.signed_file_id is not null
  ) named;
  delete from public.filing_package_items where package_id = target_package;
  delete from public.files f
  where f.id = any (parts) and public.filing_part_is_free(f);
end;
$$;

revoke all on function public.drop_filing_package_files(uuid) from public, anon, authenticated;

/**
 * As in 0029, and a .p7s a package names is in use too: the signature's
 * worker takes back what it stored when its answer did not come, and a .p7s
 * the database already gave to a package stays with it. Service role only.
 */
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
     or exists (select 1 from public.filing_receipts r where r.file_id = file.id) then
    return jsonb_build_object('ok', false, 'code', 'in_use');
  end if;

  delete from public.files where id = file.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (file.org_id, null, 'file.discarded', 'file', file.id::text,
          jsonb_build_object('purpose', file.purpose, 'status', file.status));
  return jsonb_build_object('ok', true, 'code', 'discarded');
end;
$$;

revoke all on function public.discard_file(uuid) from public, anon, authenticated;

-- ---------- What the backend does ----------

/**
 * What is due is recomputed, then the packages that owe their signature are
 * claimed, each under a number. A lawyer who asked and no longer signs the
 * lawsuit asked for nothing. A package built of a system that takes signed
 * files, of a firm that lets ONE sign, owes it; one that waited for an
 * authorization owes it again once the lawyer it waits for has one; a claim
 * that never came back spends its try, and after the setting's tries the
 * package waits for a person. A package that no longer says what its lawsuit
 * is, or whose lawsuit something keeps from being filed now, is claimed by
 * nobody until that changes. The backend's alone.
 */
create or replace function public.claim_package_signatures(target_limit integer default 3, target_package uuid default null)
returns table (package_id uuid, claim integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  minutes integer := public.package_signature_setting('working_minutes', 15);
  tries integer := greatest(public.package_signature_setting('max_attempts', 3), 1);
  given_up record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.filing_packages p
  set signer_requested = null
  where p.status = 'ready' and p.signer_requested is not null and p.signature_claimed_at is null
    and p.signature_status is distinct from 'signed'
    and not exists (
      select 1 from public.proceeding_lawyers pl
      join public.memberships m
        on m.org_id = p.org_id and m.user_id = pl.user_id and m.firm_function in ('socio', 'advogado')
      where pl.proceeding_id = p.proceeding_id and pl.user_id = p.signer_requested
    );

  update public.filing_packages p
  set signature_status = 'due', signature_attempts = 0, signature_retry_after = null, signature_error = null
  where p.status = 'ready' and p.signature_status is null
    and public.package_takes_signed_files(p)
    and public.firm_autonomy_mode(p.org_id, 'sign_package') = 'auto'
    and public.package_signs_itself(p);

  -- What the firm keeps to a person from now on, or what somebody of the team asked for, is ONE's no longer,
  -- unless a lawyer of the lawsuit asked for its signature.
  update public.filing_packages p
  set signature_status = null, signature_error = null, signature_retry_after = null
  where p.status = 'ready' and p.signature_status in ('due', 'waiting') and p.signer_requested is null
    and p.signature_claimed_at is null
    and (public.firm_autonomy_mode(p.org_id, 'sign_package') <> 'auto' or not public.package_signs_itself(p));

  update public.filing_packages p
  set signature_status = 'due', signature_attempts = 0, signature_retry_after = null, signature_error = null
  where p.status = 'ready' and p.signature_status = 'waiting' and public.package_signer_in_force(p) is not null;

  for given_up in
    update public.filing_packages p
    set signature_claimed_at = null,
        signature_status = case when p.status = 'ready' and p.signature_attempts >= tries then 'failed'
                                else p.signature_status end,
        signature_error = case when p.status = 'ready' and p.signature_attempts >= tries then 'abandoned'
                               else p.signature_error end
    where p.signature_status = 'due' and p.signature_claimed_at < now() - make_interval(mins => minutes)
    returning p.id, p.org_id, p.case_id, p.signature_status
  loop
    if given_up.signature_status = 'failed' then
      perform public.record_case_event(given_up.org_id, given_up.case_id, 'filing_package_signature_failed', 'system',
        jsonb_build_object('package_id', given_up.id, 'code', 'abandoned'));
    end if;
  end loop;

  return query
  with picked as (
    select p.id from public.filing_packages p
    where p.status = 'ready' and p.signature_status = 'due' and p.signature_claimed_at is null
      and (p.signature_retry_after is null or p.signature_retry_after <= now())
      and (p.signer_requested is not null
           or (public.firm_autonomy_mode(p.org_id, 'sign_package') = 'auto' and public.package_signs_itself(p)))
      -- Files that no longer say what the lawsuit is, or that nothing may file now, are signed by nobody.
      and not public.filing_package_outdated(p) and public.filing_blocker(p.proceeding_id) is null
      and (target_package is null or p.id = target_package)
    order by p.built_at
    limit greatest(least(coalesce(target_limit, 3), 10), 1)
    for update skip locked
  )
  update public.filing_packages p
  set signature_claimed_at = now(), signature_claim = p.signature_claim + 1,
      signature_attempts = p.signature_attempts + 1, signature_retry_after = null
  from picked
  where p.id = picked.id
  returning p.id, p.signature_claim;
end;
$$;

revoke all on function public.claim_package_signatures(integer, uuid) from public, anon, authenticated;

/**
 * A claimed package's files to sign, in their order, with who signs them:
 * the lawyer who asked, while they sign the lawsuit and have an authorization
 * in force, or else the lawyer of the lawsuit whose authorization lasts the
 * longest. With nobody, the package waits for an authorization, and nothing
 * is handed out. The backend's alone, under the number of its claim.
 */
create or replace function public.package_signature_to_sign(target_package uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  package public.filing_packages%rowtype;
  signer uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into package from public.filing_packages p
  where p.id = target_package and p.signature_claim = target_claim and p.signature_claimed_at is not null
    and p.status = 'ready' and p.signature_status = 'due'
  for update;
  if not found then
    return null;
  end if;

  signer := public.package_signer_in_force(package);
  if signer is null then
    update public.filing_packages set
      signature_status = 'waiting', signature_claimed_at = null, signature_error = 'no_signature'
    where id = package.id;
    return jsonb_build_object('code', 'waiting');
  end if;

  return jsonb_build_object(
    'code', 'sign',
    'package_id', package.id,
    'org_id', package.org_id,
    'case_id', package.case_id,
    'claim', package.signature_claim,
    'signer', signer,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', i.id,
        'position', i.position,
        'name', i.name,
        'file_id', f.id,
        'storage_path', f.storage_path,
        'sha256', f.sha256
      ) order by i.position), '[]'::jsonb)
      from public.filing_package_items i
      join public.files f on f.id = i.file_id and f.org_id = i.org_id
      where i.package_id = package.id
    )
  );
end;
$$;

revoke all on function public.package_signature_to_sign(uuid, integer) from public, anon, authenticated;

/**
 * What came of signing a claimed package. `signed`: the use (0041) is the
 * signer's, of this package and of this claim, signed, over its files in
 * their order; the signer still signs the lawsuit, and is who asked when
 * somebody did; and each file of the package has its .p7s, a stored file of
 * the firm under the `filing` purpose that nothing else names. `waiting`: the lawyer has no
 * authorization in force after all. `retry`: a passing failure, tried again
 * after a growing wait, and after the setting's tries the package waits for
 * a person (`failed`). `failed`: given up. A package no longer built, or
 * claimed again since, is not touched. The backend's alone.
 */
create or replace function public.record_package_signature(
  target_package uuid,
  target_claim integer,
  target_outcome text,
  target_use uuid default null,
  target_signer uuid default null,
  target_files jsonb default '[]'::jsonb,
  target_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  package public.filing_packages%rowtype;
  code text := nullif(btrim(target_code), '');
  tries integer := public.package_signature_setting('max_attempts', 3);
  wait integer := public.package_signature_setting('retry_minutes', 10);
  items integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_outcome is null or target_outcome not in ('signed', 'waiting', 'retry', 'failed') then
    raise exception 'invalid_outcome' using errcode = '22023';
  end if;
  if code is not null and code !~ '^[a-z][a-z0-9_]{1,63}$' then
    raise exception 'invalid_code' using errcode = '22023';
  end if;

  select * into package from public.filing_packages p
  where p.id = target_package and p.signature_claim = target_claim and p.signature_claimed_at is not null
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_held');
  end if;
  if package.status <> 'ready' or package.signature_status is distinct from 'due' then
    update public.filing_packages set signature_claimed_at = null where id = package.id;
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;

  if target_outcome = 'signed' then
    select count(*) into items from public.filing_package_items where package_id = package.id;
    if target_files is null or jsonb_typeof(target_files) <> 'array' or jsonb_array_length(target_files) <> items
      or items = 0
      -- The use is the signer's, of this package, signed, over its very files in their order.
      or not exists (
        select 1 from public.lawyer_signature_uses u
        where u.id = target_use and u.org_id = package.org_id and u.person_id = target_signer
          and u.purpose = 'filing.package' and u.subject_id = package.id and u.status = 'signed'
          and u.claim = target_claim
          and u.document_hashes = (
            select array_agg(f.sha256 order by i.position)
            from public.filing_package_items i
            join public.files f on f.id = i.file_id and f.org_id = i.org_id
            where i.package_id = package.id
          )
      )
      -- Who signed signs the lawsuit still, and is who asked when somebody did.
      or (package.signer_requested is not null and package.signer_requested is distinct from target_signer)
      or not exists (
        select 1 from public.proceeding_lawyers pl
        join public.memberships m
          on m.org_id = package.org_id and m.user_id = pl.user_id and m.firm_function in ('socio', 'advogado')
        where pl.proceeding_id = package.proceeding_id and pl.user_id = target_signer
      )
      -- Every file of the package has one .p7s, a stored file of the firm under `filing` that nothing names.
      or (
        select count(distinct i.id) from public.filing_package_items i
        join jsonb_array_elements(target_files) given on (given.value ->> 'item_id')::uuid = i.id
        join public.files f on f.id = (given.value ->> 'file_id')::uuid
        where i.package_id = package.id and f.org_id = package.org_id and f.purpose = 'filing'
          and f.status = 'stored' and f.detected_mime = 'application/pkcs7-mime'
          and public.filing_part_is_free(f)
      ) <> items
      or (select count(distinct given.value ->> 'file_id') from jsonb_array_elements(target_files) given) <> items then
      -- Nothing of it is kept, and the claim goes back: tried again after a wait, and after the tries a person's.
      if package.signature_attempts < tries then
        update public.filing_packages set
          signature_claimed_at = null, signature_error = 'invalid_signature',
          signature_retry_after = now() + make_interval(mins => wait * package.signature_attempts)
        where id = package.id;
      else
        update public.filing_packages set
          signature_status = 'failed', signature_claimed_at = null, signature_error = 'invalid_signature'
        where id = package.id;
        perform public.record_case_event(package.org_id, package.case_id, 'filing_package_signature_failed', 'system',
          jsonb_build_object('package_id', package.id, 'code', 'invalid_signature'));
      end if;
      return jsonb_build_object('ok', false, 'code', 'invalid_signature');
    end if;

    update public.filing_package_items i
    set signed_file_id = (given.value ->> 'file_id')::uuid
    from jsonb_array_elements(target_files) given
    where i.package_id = package.id and i.id = (given.value ->> 'item_id')::uuid;
    update public.filing_packages set
      signature_status = 'signed', signature_claimed_at = null, signature_error = null,
      signed_by = target_signer, signed_at = now(), signature_use = target_use
    where id = package.id;

    perform public.record_case_event(package.org_id, package.case_id, 'filing_package_signed', 'system',
      jsonb_build_object('package_id', package.id, 'proceeding_id', package.proceeding_id, 'signer', target_signer,
                         'files', items));
    return jsonb_build_object('ok', true, 'code', 'signed');
  end if;

  if target_outcome = 'waiting' then
    update public.filing_packages set
      signature_status = 'waiting', signature_claimed_at = null, signature_error = coalesce(code, 'no_signature')
    where id = package.id;
    return jsonb_build_object('ok', true, 'code', 'waiting');
  end if;

  if target_outcome = 'retry' and package.signature_attempts < tries then
    update public.filing_packages set
      signature_claimed_at = null, signature_error = coalesce(code, 'failed'),
      signature_retry_after = now() + make_interval(mins => wait * package.signature_attempts)
    where id = package.id;
    return jsonb_build_object('ok', true, 'code', 'retry');
  end if;

  update public.filing_packages set
    signature_status = 'failed', signature_claimed_at = null, signature_error = coalesce(code, 'failed')
  where id = package.id;
  perform public.record_case_event(package.org_id, package.case_id, 'filing_package_signature_failed', 'system',
    jsonb_build_object('package_id', package.id, 'code', coalesce(code, 'failed')));
  return jsonb_build_object('ok', true, 'code', 'failed');
end;
$$;

revoke all on function public.record_package_signature(uuid, integer, text, uuid, uuid, jsonb, text) from public, anon, authenticated;

-- ---------- What a lawyer of the lawsuit does ----------

/**
 * A lawyer of the lawsuit asks ONE to sign the package's files with their
 * own authorization, and with nobody else's: where the firm keeps the
 * signature to a person, after ONE gave up or waited, or to file it
 * themself when another lawyer's signature is on the files (those files go:
 * a .p7s leaves ONE only in the hands of whose certificate signed it). With
 * the second factor, never from a support visit; the package is built, of a
 * system that takes signed files, still says what its lawsuit is and nothing
 * keeps the lawsuit from being filed now, and the lawyer has an
 * authorization in force.
 */
create or replace function public.request_package_signature(target_package uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  package public.filing_packages%rowtype;
  again boolean;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into package from public.filing_packages p where p.id = target_package for update;
  if not found or not public.is_org_member(package.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not exists (
    select 1 from public.proceeding_lawyers pl
    join public.memberships m on m.org_id = package.org_id and m.user_id = pl.user_id
    where pl.proceeding_id = package.proceeding_id and pl.user_id = caller and m.firm_function in ('socio', 'advogado')
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_a_signer');
  end if;
  perform public.require_aal2();
  if package.status <> 'ready' then
    return jsonb_build_object('ok', false, 'code', 'not_built');
  end if;
  if not public.package_takes_signed_files(package) then
    return jsonb_build_object('ok', false, 'code', 'system_signs');
  end if;
  if public.filing_package_outdated(package) then
    return jsonb_build_object('ok', false, 'code', 'package_outdated');
  end if;
  if public.filing_blocker(package.proceeding_id) is not null then
    return jsonb_build_object('ok', false, 'code', public.filing_blocker(package.proceeding_id));
  end if;
  if package.signature_status = 'signed' and package.signed_by = caller then
    return jsonb_build_object('ok', true, 'code', 'already_signed');
  end if;
  if not exists (
    select 1 from public.connections c
    where c.org_id = package.org_id and c.person_id = caller and c.provider ~ '^psc[.]'
      and c.status in ('connected', 'error') and c.expires_at > now() + interval '1 minute'
      and exists (select 1 from public.connection_secrets s where s.connection_id = c.id)
  ) then
    return jsonb_build_object('ok', false, 'code', 'no_signature');
  end if;

  again := package.signature_status = 'signed';
  if again then
    perform public.drop_package_signed_copies(package.id);
  end if;
  update public.filing_packages set
    signature_status = 'due', signer_requested = caller, signature_attempts = 0, signature_retry_after = null,
    signature_error = null, signature_claimed_at = null, signed_by = null, signed_at = null, signature_use = null
  where id = package.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (package.org_id, caller, 'filing.signature_requested', 'filing_package', package.id::text,
          jsonb_build_object('again', again));
  return jsonb_build_object('ok', true, 'code', 'requested');
end;
$$;

revoke all on function public.request_package_signature(uuid) from public, anon;
grant execute on function public.request_package_signature(uuid) to authenticated;
