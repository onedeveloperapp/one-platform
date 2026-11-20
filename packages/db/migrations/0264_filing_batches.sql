-- ============================================================
-- 0264_filing_batches: the batches a lawyer approves to be filed on a
-- court's screen, by ONE's own browser with their login or by their
-- extension, and the screens ONE learns by itself.
--
-- The owner, on 2026-11-20 (root CLAUDE.md, "Three ways to file"): each
-- batch goes only after its lawyer approves it, the court's code is asked of
-- the lawyer at that moment, and ONE learns a system's screens itself at the
-- first filing there, never from a map a person sends, the lawyer confirming
-- that first one at the court's own summary. So:
--
--   filing_batches         a lawyer's approval of packages of lawsuits they
--                          sign, at one system, by their way there: who runs
--                          it (ONE's browser, or their extension) claims it
--                          under a number, as a submission is claimed (0101).
--   filing_submissions     each package of a batch is a submission of the
--                          channel 'browser' or 'extension', tied to its
--                          batch. One filed while ONE still learns the system
--                          (`learning`) stops at the court's summary
--                          (`confirming`) until its lawyer confirms it, and
--                          never goes before that (`filing_submission_sending`
--                          refuses it). A submission that may have reached
--                          the court is never sent again by itself (0101).
--   filing_batch_codes     the code the court asked, typed by the lawyer in
--                          ONE: sealed by the backend, bound to its batch,
--                          read once and gone, two minutes at most.
--   court_login_uses       every time ONE opened a lawyer's court login: for
--                          which batch, read by the lawyer, the partners and
--                          who manages the firm. Only `court_login_open` opens
--                          one, for a batch of that lawyer in its run.
--   court_screen_maps      the path ONE learned at a system, as the
--                          platform's data, for every firm: each screen by
--                          what tells it apart and what was done there, by
--                          the names of the facts and the system's own codes,
--                          never a value nor a person. A map learned is
--                          `learning` until a filing that followed it was
--                          confirmed by its lawyer and taken by the court
--                          (`trusted`); a screen that changed sends ONE back
--                          to learning there.
--   ai_tasks 'protocolo.tela' reads one screen and says what to do on it,
--                          for the facts of the lawsuit by their names; the
--                          values are typed by ONE's code, never seen by the
--                          model.
-- ============================================================

-- ---------- Batches ----------

create table public.filing_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The lawyer whose access files the batch, and who approved it.
  person_id uuid references public.profiles (id) on delete set null,
  system_key text not null references public.court_screen_systems (key) on update cascade,
  way text not null,
  -- approved               waits for its runner;
  -- running                its runner holds it;
  -- awaiting_code          the court asked the lawyer's code, asked of them in ONE;
  -- awaiting_confirmation  a filing ONE files while it learns the system waits at the court's summary;
  -- done                   every package of it went;
  -- stopped                the lawyer or the firm stopped it, or something kept it from going on (`error`).
  status text not null default 'approved',
  claims integer not null default 0,
  claimed_at timestamptz,
  code_kind text,
  code_asked_at timestamptz,
  error text,
  approved_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  constraint filing_batches_way_check check (way in ('browser', 'extension')),
  constraint filing_batches_status_check check (
    status in ('approved', 'running', 'awaiting_code', 'awaiting_confirmation', 'done', 'stopped')),
  constraint filing_batches_code_check check (code_kind is null or code_kind in ('app', 'email')),
  constraint filing_batches_error_check check (error is null or error ~ '^[a-z][a-z0-9_]{1,59}$'),
  constraint filing_batches_claims_check check (claims >= 0)
);

create index filing_batches_open_idx on public.filing_batches (org_id, status) where status not in ('done', 'stopped');

alter table public.filing_batches enable row level security;
create policy "filing_batches_select_member" on public.filing_batches
  for select to authenticated using (public.is_org_member(org_id));
revoke all on table public.filing_batches from public, anon, authenticated;
grant select on table public.filing_batches to authenticated;
create trigger filing_batches_updated_at
  before update on public.filing_batches
  for each row execute function public.set_updated_at();
create trigger guard_impersonation_filing_batches after insert or update or delete on public.filing_batches
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- The screens ONE learned (their functions below) ----------

create table public.court_screen_maps (
  id uuid primary key default gen_random_uuid(),
  system_key text not null references public.court_screen_systems (key) on update cascade,
  version integer not null,
  -- learning  learned, never followed to a filing its lawyer confirmed;
  -- trusted   followed to a filing its lawyer confirmed and the court took: the filings follow it with no AI;
  -- retired   a newer map took its place.
  status text not null default 'learning',
  -- The path: each screen by what tells it apart, and what was done there, by fact names and the system's
  -- own codes. Never a value typed, a person, a token or a number of a lawsuit.
  steps jsonb not null,
  learned_from uuid,
  learned_at timestamptz not null default now(),
  trusted_from uuid,
  trusted_at timestamptz,
  retired_at timestamptz,
  unique (system_key, version),
  constraint court_screen_maps_status_check check (status in ('learning', 'trusted', 'retired')),
  constraint court_screen_maps_steps_check check (jsonb_typeof(steps) = 'array' and octet_length(steps::text) <= 400000),
  constraint court_screen_maps_version_check check (version > 0)
);

create unique index court_screen_maps_one_trusted_idx on public.court_screen_maps (system_key) where status = 'trusted';
create unique index court_screen_maps_one_learning_idx on public.court_screen_maps (system_key) where status = 'learning';

-- The platform's: read by its operator; written by the backend alone.
alter table public.court_screen_maps enable row level security;
create policy "court_screen_maps_select_superadmin" on public.court_screen_maps
  for select to authenticated using (public.is_superadmin());
revoke all on table public.court_screen_maps from public, anon, authenticated;
grant select on table public.court_screen_maps to authenticated;

-- ---------- Submissions of a batch ----------

alter table public.filing_submissions add column batch_id uuid;
alter table public.filing_submissions add column learning boolean not null default false;
alter table public.filing_submissions add column confirmed_by uuid references public.profiles (id) on delete set null;
alter table public.filing_submissions add column confirmed_at timestamptz;
alter table public.filing_submissions add column summary_file_id uuid;
alter table public.filing_submissions
  add constraint filing_submissions_batch_fk foreign key (batch_id, org_id)
  references public.filing_batches (id, org_id) on delete set null (batch_id);
alter table public.filing_submissions
  add constraint filing_submissions_summary_fk foreign key (summary_file_id, org_id)
  references public.files (id, org_id) on delete set null (summary_file_id);
create index filing_submissions_batch_idx on public.filing_submissions (batch_id) where batch_id is not null;

alter table public.filing_submissions drop constraint filing_submissions_channel_check;
alter table public.filing_submissions add constraint filing_submissions_channel_check
  check (channel in ('mni', 'test_court', 'browser', 'extension'));
-- confirming: filled up to the court's summary while ONE learns the system; waits for its lawyer, sent nothing.
alter table public.filing_submissions drop constraint filing_submissions_status_check;
alter table public.filing_submissions add constraint filing_submissions_status_check check (
  status in ('owed', 'claimed', 'confirming', 'sending', 'filed', 'refused', 'unknown', 'failed'));
-- A batch is only of a filing on the court's screen.
alter table public.filing_submissions add constraint filing_submissions_screen_check check (
  batch_id is null or channel in ('browser', 'extension'));

/** The system of a package's court where ONE files on the court's screen, or null. Internal. */
create or replace function public.filing_screen_system_of(target_package public.filing_packages)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select s.key from public.court_screen_systems s
  where s.court = target_package.court and s.system = target_package.system;
$$;

revoke all on function public.filing_screen_system_of(public.filing_packages) from public, anon, authenticated;

/**
 * Why a lawyer cannot file a package on the court's screen now, or null:
 * the package not ready or outdated, the lawsuit filed or blocked, no system
 * ONE works on, the lawyer not one who signs it, no company, or the files not
 * signed where the court takes them signed. Internal.
 */
create or replace function public.filing_screen_blocker(target_package public.filing_packages, target_person uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
begin
  if target_package.status <> 'ready' then
    return 'package_not_ready';
  end if;
  select * into lawsuit from public.proceedings where id = target_package.proceeding_id;
  if not found or lawsuit.status <> 'planned' then
    return 'already_filed';
  end if;
  if public.filing_package_outdated(target_package) then
    return 'package_outdated';
  end if;
  if public.filing_blocker(lawsuit.id) is not null then
    return public.filing_blocker(lawsuit.id);
  end if;
  if public.filing_screen_system_of(target_package) is null then
    return 'no_screen_system';
  end if;
  if not exists (
    select 1 from public.proceeding_lawyers pl join public.oab_registrations r on r.user_id = pl.user_id
    where pl.proceeding_id = lawsuit.id and pl.user_id = target_person
  ) then
    return 'not_a_signer';
  end if;
  if not exists (
    select 1 from public.cases k join public.airlines a on a.iata = k.airline_iata where k.id = target_package.case_id
  ) then
    return 'no_airline';
  end if;
  if public.package_takes_signed_files(target_package) and target_package.signature_status is distinct from 'signed' then
    return 'not_signed';
  end if;
  return null;
end;
$$;

revoke all on function public.filing_screen_blocker(public.filing_packages, uuid) from public, anon, authenticated;

/** Whether ONE still learns a system's screens: no map of it trusted yet. Internal. */
create or replace function public.court_screen_learning(target_system text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.court_screen_maps m where m.system_key = target_system and m.status = 'trusted');
$$;

/**
 * The lawyer approves a batch: packages of lawsuits they sign, ready, at one
 * system, filed by their way there, with the second factor, never from a
 * support visit. ONE's browser needs their court login in force. A package
 * that cannot go is said with why, and the rest go.
 */
create or replace function public.approve_filing_batch(target_org uuid, target_system text, target_packages uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  sys public.court_screen_systems%rowtype;
  lawyer_way text;
  firm_way text;
  batch uuid;
  package public.filing_packages%rowtype;
  blocker text;
  learning boolean;
  taken integer := 0;
  skipped jsonb := '[]'::jsonb;
  wanted uuid[];
begin
  if caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_impersonated() then
    raise exception 'impersonated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = caller and m.firm_function in ('socio', 'advogado')
  ) then
    raise exception 'not_a_lawyer' using errcode = '42501';
  end if;
  perform public.require_aal2();
  select array_agg(distinct p) into wanted from unnest(coalesce(target_packages, '{}'::uuid[])) p;
  if wanted is null or cardinality(wanted) = 0 or cardinality(wanted) > 50 then
    return jsonb_build_object('ok', false, 'code', 'invalid_packages');
  end if;
  select * into sys from public.court_screen_systems where key = target_system;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_system');
  end if;
  select w.way into lawyer_way from public.lawyer_filing_ways w
  where w.org_id = target_org and w.user_id = caller and w.system_key = target_system;
  select w.way into firm_way from public.firm_filing_ways w where w.org_id = target_org;
  if lawyer_way is null or lawyer_way = 'hand' or not (lawyer_way = any (sys.ways))
     or public.filing_way_rank(lawyer_way) > public.filing_way_rank(coalesce(firm_way, 'browser')) then
    return jsonb_build_object('ok', false, 'code', 'way_not_automated');
  end if;
  if lawyer_way = 'browser' and not exists (
    select 1 from public.connections c
    where c.org_id = target_org and c.person_id = caller and c.provider = 'court.' || target_system
      and c.status = 'connected'
      and exists (select 1 from public.connection_secrets s where s.connection_id = c.id)
  ) then
    return jsonb_build_object('ok', false, 'code', 'no_court_login');
  end if;

  learning := public.court_screen_learning(target_system);
  insert into public.filing_batches (org_id, person_id, system_key, way)
  values (target_org, caller, target_system, lawyer_way)
  returning id into batch;

  for package in
    select * from public.filing_packages p where p.id = any (wanted) order by p.built_at nulls last, p.id for update
  loop
    if package.org_id <> target_org or public.filing_screen_system_of(package) is distinct from target_system then
      skipped := skipped || jsonb_build_array(jsonb_build_object('package', package.id, 'code', 'other_system'));
      continue;
    end if;
    blocker := public.filing_screen_blocker(package, caller);
    if blocker is null and exists (select 1 from public.filing_submissions s where s.package_id = package.id) then
      blocker := 'already_submitted';
    end if;
    if blocker is not null then
      skipped := skipped || jsonb_build_array(jsonb_build_object('package', package.id, 'code', blocker));
      continue;
    end if;
    insert into public.filing_submissions (org_id, case_id, proceeding_id, package_id, channel, batch_id, learning, requested_by)
    values (package.org_id, package.case_id, package.proceeding_id, package.id, lawyer_way, batch, learning, caller);
    perform public.record_case_event(package.org_id, package.case_id, 'filing_batch_approved', 'person',
      jsonb_build_object('package', package.id, 'batch', batch, 'way', lawyer_way, 'system', target_system));
    taken := taken + 1;
  end loop;

  if taken = 0 then
    delete from public.filing_batches where id = batch;
    return jsonb_build_object('ok', false, 'code', 'nothing_to_file', 'skipped', skipped);
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'filing_batch.approved', 'filing_batch', batch::text,
          jsonb_build_object('system', target_system, 'way', lawyer_way, 'packages', taken, 'learning', learning));
  return jsonb_build_object('ok', true, 'code', 'approved', 'batch_id', batch, 'packages', taken,
                            'learning', learning, 'skipped', skipped);
end;
$$;

/**
 * Who runs a batch takes it (service role: ONE's browser, or the backend for
 * the lawyer's extension): an approved batch, or one whose runner went silent
 * for fifteen minutes, under a new number. Null when there is none to take.
 */
create or replace function public.claim_filing_batch(target_batch uuid default null, target_way text default 'browser')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  batch public.filing_batches%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into batch from public.filing_batches b
  where (target_batch is null or b.id = target_batch)
    and b.way = target_way
    and (b.status = 'approved'
         or (b.status = 'running' and b.claimed_at < now() - interval '15 minutes'))
  order by b.approved_at, b.id
  limit 1
  for update skip locked;
  if not found then
    return null;
  end if;
  update public.filing_batches set
    status = 'running', claims = claims + 1, claimed_at = now(), started_at = coalesce(started_at, now())
  where id = batch.id
  returning * into batch;
  return jsonb_build_object(
    'batch_id', batch.id, 'claim', batch.claims, 'org_id', batch.org_id, 'person_id', batch.person_id,
    'system', batch.system_key, 'way', batch.way,
    'host', (select s.host from public.court_screen_systems s where s.key = batch.system_key),
    'login_kind', (select s.login_kind from public.court_screen_systems s where s.key = batch.system_key),
    'learning', public.court_screen_learning(batch.system_key));
end;
$$;

/** The runner holding a batch says it is still at work: its claim stays fresh. Service role. */
create or replace function public.touch_filing_batch(target_batch uuid, target_claim integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.filing_batches set claimed_at = now()
  where id = target_batch and claims = target_claim and status in ('running', 'awaiting_code', 'awaiting_confirmation');
  return found;
end;
$$;

/**
 * The next package of a batch its runner files (service role): a submission
 * owed, or one claimed that its runner left, claimed under a new number. Null
 * when the batch has nothing left to file, or is not this runner's.
 */
create or replace function public.next_batch_submission(target_batch uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  batch public.filing_batches%rowtype;
  submission public.filing_submissions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into batch from public.filing_batches where id = target_batch for update;
  if not found or batch.claims <> target_claim or batch.status <> 'running' then
    return null;
  end if;
  select * into submission from public.filing_submissions s
  where s.batch_id = batch.id and s.status in ('owed', 'claimed', 'confirming')
  order by s.created_at, s.id
  limit 1
  for update;
  if not found then
    return null;
  end if;
  -- One the lawyer confirmed at the summary goes on under its own number.
  if submission.status = 'claimed' and submission.confirmed_at is not null then
    return jsonb_build_object('submission_id', submission.id, 'claim', submission.claims,
      'package_id', submission.package_id, 'case_id', submission.case_id,
      'learning', submission.learning, 'confirmed', true);
  end if;
  if submission.status = 'confirming' then
    return null;
  end if;
  update public.filing_submissions set
    status = 'claimed', claims = claims + 1, claimed_at = now(), updated_at = now()
  where id = submission.id
  returning * into submission;
  return jsonb_build_object('submission_id', submission.id, 'claim', submission.claims,
    'package_id', submission.package_id, 'case_id', submission.case_id,
    'learning', submission.learning, 'confirmed', false);
end;
$$;

/**
 * As in 0101, and a submission on the court's screen goes only while its
 * batch runs, for a package its lawyer still signs and nothing keeps from
 * going, and, while ONE learns the system, only once its lawyer confirmed it
 * at the court's summary. Service role.
 */
create or replace function public.filing_submission_sending(target_submission uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.filing_submissions%rowtype;
  package public.filing_packages%rowtype;
  batch public.filing_batches%rowtype;
  blocker text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into submission from public.filing_submissions where id = target_submission for update;
  if not found or submission.status <> 'claimed' or submission.claims <> target_claim then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into package from public.filing_packages where id = submission.package_id for update;
  if submission.channel in ('browser', 'extension') then
    select * into batch from public.filing_batches where id = submission.batch_id for update;
    if not found or batch.status <> 'running' then
      return jsonb_build_object('ok', false, 'code', 'batch_not_running');
    end if;
    if submission.learning and submission.confirmed_at is null then
      return jsonb_build_object('ok', false, 'code', 'awaits_confirmation');
    end if;
    blocker := public.filing_screen_blocker(package, batch.person_id);
  else
    blocker := public.filing_submission_blocker(package);
  end if;
  if blocker is not null then
    update public.filing_submissions set status = 'owed', claimed_at = null, updated_at = now() where id = submission.id;
    return jsonb_build_object('ok', false, 'code', blocker);
  end if;
  update public.filing_submissions
  set status = 'sending', sent_at = now(), attempts = attempts + 1, updated_at = now()
  where id = submission.id;
  return jsonb_build_object('ok', true, 'code', 'sending');
end;
$$;

revoke all on function public.filing_submission_sending(uuid, integer) from public, anon, authenticated;

/**
 * A filing ONE files while it learns the system reached the court's own
 * summary, nothing sent (service role): it waits for its lawyer, with what
 * the summary showed kept as a file of the firm when ONE's browser files it
 * (the lawyer sees it in ONE; through the extension they see the court's
 * screen itself).
 */
create or replace function public.hold_filing_submission(target_submission uuid, target_claim integer, target_summary_file uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.filing_submissions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into submission from public.filing_submissions where id = target_submission for update;
  if not found or submission.status <> 'claimed' or submission.claims <> target_claim or submission.batch_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  update public.filing_submissions set
    status = 'confirming',
    summary_file_id = case when target_summary_file is not null and exists (
      select 1 from public.files f where f.id = target_summary_file and f.org_id = submission.org_id and f.status = 'stored'
    ) then target_summary_file end,
    updated_at = now()
  where id = submission.id;
  update public.filing_batches set status = 'awaiting_confirmation' where id = submission.batch_id and status = 'running';
  perform public.record_case_event(submission.org_id, submission.case_id, 'filing_confirming', 'system',
    jsonb_build_object('package', submission.package_id, 'submission', submission.id, 'batch', submission.batch_id));
  return jsonb_build_object('ok', true, 'code', 'confirming');
end;
$$;

/** Confirms a held filing: it goes back to its runner under the same number, now free to go. Internal. */
create or replace function public.confirm_held_submission(target_submission uuid, target_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.filing_submissions%rowtype;
  batch public.filing_batches%rowtype;
begin
  select * into submission from public.filing_submissions where id = target_submission for update;
  if not found or submission.status <> 'confirming' then
    return jsonb_build_object('ok', false, 'code', 'not_confirming');
  end if;
  select * into batch from public.filing_batches where id = submission.batch_id for update;
  if not found or batch.person_id is distinct from target_person then
    return jsonb_build_object('ok', false, 'code', 'not_your_batch');
  end if;
  update public.filing_submissions set
    status = 'claimed', confirmed_by = target_person, confirmed_at = now(), claimed_at = now(), updated_at = now()
  where id = submission.id;
  update public.filing_batches set status = 'running', claimed_at = now()
  where id = batch.id and status = 'awaiting_confirmation';
  perform public.record_case_event(submission.org_id, submission.case_id, 'filing_confirmed', 'person',
    jsonb_build_object('package', submission.package_id, 'submission', submission.id, 'batch', batch.id));
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (submission.org_id, target_person, 'filing_submission.confirmed', 'filing_submission', submission.id::text,
          jsonb_build_object('batch', batch.id));
  return jsonb_build_object('ok', true, 'code', 'confirmed');
end;
$$;

revoke all on function public.confirm_held_submission(uuid, uuid) from public, anon, authenticated;

/** The lawyer of the batch confirms, in ONE, the summary of a held filing, with the second factor. */
create or replace function public.confirm_filing_submission(target_submission uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  org uuid;
begin
  if caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_impersonated() then
    raise exception 'impersonated' using errcode = '42501';
  end if;
  select s.org_id into org from public.filing_submissions s where s.id = target_submission;
  if org is null or not public.is_org_member(org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  perform public.require_aal2();
  return public.confirm_held_submission(target_submission, caller);
end;
$$;

/** The lawyer confirms in their extension, which the backend knows by its link (service role). */
create or replace function public.confirm_filing_submission_by_link(target_submission uuid, target_link uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.extension_links%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into link from public.extension_links where id = target_link and ended_at is null and linked_at is not null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_linked');
  end if;
  if not exists (
    select 1 from public.filing_submissions s where s.id = target_submission and s.org_id = link.org_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return public.confirm_held_submission(target_submission, link.user_id);
end;
$$;

/**
 * Stops a batch: by its lawyer, a partner or who manages the firm, or by its
 * runner (service role) with why. What of it never went is let go (each
 * package free for another batch or by hand); what went, or may have gone,
 * stays as it is.
 */
create or replace function public.stop_filing_batch(target_batch uuid, target_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  batch public.filing_batches%rowtype;
  backend boolean := auth.role() = 'service_role';
begin
  select * into batch from public.filing_batches where id = target_batch for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not backend then
    if caller is null then
      raise exception 'not_authenticated' using errcode = '28000';
    end if;
    if public.is_impersonated() then
      raise exception 'impersonated' using errcode = '42501';
    end if;
    if not public.is_org_member(batch.org_id) or (
      batch.person_id is distinct from caller
      and not public.has_firm_function(batch.org_id, array['socio']::public.firm_function[])
      and not public.has_org_role(batch.org_id, array['owner', 'admin']::public.org_role[])
    ) then
      raise exception 'not_authorized' using errcode = '42501';
    end if;
  end if;
  if batch.status in ('done', 'stopped') then
    return jsonb_build_object('ok', true, 'code', batch.status);
  end if;
  delete from public.filing_submissions where batch_id = batch.id and status in ('owed', 'claimed', 'confirming');
  delete from public.filing_batch_codes where batch_id = batch.id;
  update public.filing_batches set
    status = 'stopped', finished_at = now(),
    error = case when backend then coalesce(target_error, 'stopped') else 'by_person' end
  where id = batch.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (batch.org_id, case when backend then null else caller end, 'filing_batch.stopped', 'filing_batch', batch.id::text,
          jsonb_build_object('error', case when backend then coalesce(target_error, 'stopped') else 'by_person' end));
  return jsonb_build_object('ok', true, 'code', 'stopped');
end;
$$;

/** The runner says a batch ended (service role): done when nothing of it waits, else stopped with why. */
create or replace function public.finish_filing_batch(target_batch uuid, target_claim integer, target_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  batch public.filing_batches%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into batch from public.filing_batches where id = target_batch for update;
  if not found or batch.claims <> target_claim or batch.status in ('done', 'stopped') then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if target_error is not null then
    return public.stop_filing_batch(target_batch, target_error);
  end if;
  if exists (select 1 from public.filing_submissions s where s.batch_id = batch.id and s.status in ('owed', 'claimed', 'confirming')) then
    return jsonb_build_object('ok', false, 'code', 'packages_left');
  end if;
  update public.filing_batches set status = 'done', finished_at = now() where id = batch.id;
  delete from public.filing_batch_codes where batch_id = batch.id;
  return jsonb_build_object('ok', true, 'code', 'done');
end;
$$;

-- ---------- The court's code, relayed from the lawyer ----------

create table public.filing_batch_codes (
  batch_id uuid primary key,
  org_id uuid not null,
  key_version integer not null,
  iv text not null,
  ciphertext text not null,
  auth_tag text not null,
  expires_at timestamptz not null,
  foreign key (batch_id, org_id) references public.filing_batches (id, org_id) on delete cascade,
  constraint filing_batch_codes_iv_check check (iv ~ '^[A-Za-z0-9+/]{16}$'),
  constraint filing_batch_codes_ciphertext_check check (ciphertext ~ '^[A-Za-z0-9+/]+={0,2}$' and char_length(ciphertext) <= 400),
  constraint filing_batch_codes_tag_check check (auth_tag ~ '^[A-Za-z0-9+/]{22}==$')
);

-- Nobody reads it but the functions below.
alter table public.filing_batch_codes enable row level security;
revoke all on table public.filing_batch_codes from public, anon, authenticated;
create trigger guard_impersonation_filing_batch_codes after insert or update or delete on public.filing_batch_codes
  for each statement execute function public.guard_impersonation_readonly();

/** ONE's browser met the court's request of a code (service role): the batch asks its lawyer. */
create or replace function public.ask_filing_batch_code(target_batch uuid, target_claim integer, target_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_kind is null or target_kind not in ('app', 'email') then
    raise exception 'invalid_kind' using errcode = '22023';
  end if;
  delete from public.filing_batch_codes where batch_id = target_batch;
  update public.filing_batches set status = 'awaiting_code', code_kind = target_kind, code_asked_at = now(), claimed_at = now()
  where id = target_batch and claims = target_claim and status in ('running', 'awaiting_code') and way = 'browser';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  return jsonb_build_object('ok', true, 'code', 'asked');
end;
$$;

/**
 * The lawyer of the batch gives the code the court asked, typed in ONE and
 * sealed by the backend before it comes here (the database never sees it),
 * with the second factor. It lives two minutes, and is read once.
 */
create or replace function public.give_filing_batch_code(
  target_batch uuid,
  target_key_version integer,
  target_iv text,
  target_ciphertext text,
  target_tag text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  batch public.filing_batches%rowtype;
begin
  if caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if public.is_impersonated() then
    raise exception 'impersonated' using errcode = '42501';
  end if;
  select * into batch from public.filing_batches where id = target_batch for update;
  if not found or batch.person_id is distinct from caller or not public.is_org_member(batch.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  perform public.require_aal2();
  if batch.status <> 'awaiting_code' then
    return jsonb_build_object('ok', false, 'code', 'not_asked');
  end if;
  insert into public.filing_batch_codes (batch_id, org_id, key_version, iv, ciphertext, auth_tag, expires_at)
  values (batch.id, batch.org_id, target_key_version, target_iv, target_ciphertext, target_tag, now() + interval '2 minutes')
  on conflict (batch_id) do update set
    key_version = excluded.key_version, iv = excluded.iv, ciphertext = excluded.ciphertext,
    auth_tag = excluded.auth_tag, expires_at = excluded.expires_at;
  update public.filing_batches set status = 'running' where id = batch.id;
  return jsonb_build_object('ok', true, 'code', 'given');
end;
$$;

/** ONE's browser takes the code (service role): read once, then gone; an old one is never handed out. */
create or replace function public.take_filing_batch_code(target_batch uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  sealed public.filing_batch_codes%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.filing_batches b where b.id = target_batch and b.claims = target_claim and b.way = 'browser'
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  delete from public.filing_batch_codes where batch_id = target_batch returning * into sealed;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'none');
  end if;
  if sealed.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;
  return jsonb_build_object('ok', true, 'code', 'taken', 'org_id', sealed.org_id, 'envelope', jsonb_build_object(
    'key_version', sealed.key_version, 'iv', sealed.iv, 'ciphertext', sealed.ciphertext, 'tag', sealed.auth_tag));
end;
$$;

-- ---------- Every opening of a lawyer's court login ----------

create table public.court_login_uses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  person_id uuid references public.profiles (id) on delete set null,
  connection_id uuid,
  batch_id uuid,
  system_key text not null,
  opened_at timestamptz not null default now(),
  foreign key (batch_id, org_id) references public.filing_batches (id, org_id) on delete set null (batch_id)
);

create index court_login_uses_person_idx on public.court_login_uses (org_id, person_id, opened_at desc);

alter table public.court_login_uses enable row level security;
create policy "court_login_uses_select" on public.court_login_uses
  for select to authenticated
  using (
    public.is_org_member(org_id)
    and (person_id = auth.uid()
         or public.has_firm_function(org_id, array['socio']::public.firm_function[])
         or public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]))
  );
revoke all on table public.court_login_uses from public, anon, authenticated;
grant select on table public.court_login_uses to authenticated;
create trigger guard_impersonation_court_login_uses after insert or update or delete on public.court_login_uses
  for each statement execute function public.guard_impersonation_readonly();

/**
 * Opens a lawyer's court login for the run of a batch they approved (service
 * role, ONE's browser): the batch held under its number, filed by ONE's
 * browser, of that lawyer, who is still a partner or a lawyer of the firm.
 * Every opening is kept. The vault's general read never hands one out (0041).
 */
create or replace function public.court_login_open(target_batch uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  batch public.filing_batches%rowtype;
  conn public.connections%rowtype;
  sealed public.connection_secrets%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into batch from public.filing_batches where id = target_batch;
  if not found or batch.claims <> target_claim or batch.way <> 'browser'
     or batch.status not in ('running', 'awaiting_code') then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if not exists (
    select 1 from public.memberships m
    where m.org_id = batch.org_id and m.user_id = batch.person_id and m.firm_function in ('socio', 'advogado')
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_a_lawyer');
  end if;
  select * into conn from public.connections c
  where c.org_id = batch.org_id and c.person_id = batch.person_id and c.provider = 'court.' || batch.system_key
  for update;
  if not found or conn.status <> 'connected' then
    return jsonb_build_object('ok', false, 'code', 'no_court_login');
  end if;
  select * into sealed from public.connection_secrets where connection_id = conn.id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_court_login');
  end if;
  update public.connections set last_used_at = now() where id = conn.id;
  insert into public.court_login_uses (org_id, person_id, connection_id, batch_id, system_key)
  values (batch.org_id, batch.person_id, conn.id, batch.id, batch.system_key);
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (batch.org_id, null, 'court_login.opened', 'connection', conn.id::text,
          jsonb_build_object('system', batch.system_key, 'batch', batch.id));
  return jsonb_build_object(
    'ok', true, 'code', 'read', 'org_id', conn.org_id, 'connection_id', conn.id, 'provider', conn.provider,
    'external_id', conn.external_id, 'status', conn.status, 'expires_at', conn.expires_at,
    'envelope', jsonb_build_object('key_version', sealed.key_version, 'iv', sealed.iv,
                                   'ciphertext', sealed.ciphertext, 'tag', sealed.auth_tag));
end;
$$;

-- ---------- The screens ONE learned ----------


/** The map ONE follows at a system (service role): the trusted one, else the one it is learning. */
create or replace function public.court_screen_map_of(target_system text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when auth.role() = 'service_role' then (
    select jsonb_build_object('id', m.id, 'version', m.version, 'status', m.status, 'steps', m.steps)
    from public.court_screen_maps m
    where m.system_key = target_system and m.status in ('trusted', 'learning')
    order by (m.status = 'trusted') desc, m.version desc
    limit 1)
  end;
$$;

/**
 * What ONE learned at a system in a filing (service role): a new map it
 * learns, in place of the one it was learning there. A trusted map stays the
 * one followed until this one is trusted in its turn.
 */
create or replace function public.save_court_screen_map(target_system text, target_steps jsonb, target_submission uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  map uuid;
  next_version integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.court_screen_systems s where s.key = target_system) then
    return jsonb_build_object('ok', false, 'code', 'unknown_system');
  end if;
  if target_steps is null or jsonb_typeof(target_steps) <> 'array' or jsonb_array_length(target_steps) = 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_steps');
  end if;
  perform pg_advisory_xact_lock(hashtext('court_screen_maps:' || target_system));
  update public.court_screen_maps set status = 'retired', retired_at = now()
  where system_key = target_system and status = 'learning';
  select coalesce(max(m.version), 0) + 1 into next_version from public.court_screen_maps m where m.system_key = target_system;
  insert into public.court_screen_maps (system_key, version, steps, learned_from)
  values (target_system, next_version, target_steps, target_submission)
  returning id into map;
  return jsonb_build_object('ok', true, 'code', 'saved', 'map_id', map, 'version', next_version);
end;
$$;

/**
 * A filing that followed a map was confirmed by its lawyer and taken by the
 * court (service role): the map is trusted, and the one trusted before it
 * retires.
 */
create or replace function public.trust_court_screen_map(target_map uuid, target_submission uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  map public.court_screen_maps%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into map from public.court_screen_maps where id = target_map for update;
  if not found or map.status = 'retired' then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not exists (
    select 1 from public.filing_submissions s
    where s.id = target_submission and s.status = 'filed' and s.confirmed_at is not null
      and s.channel in ('browser', 'extension')
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_confirmed');
  end if;
  if map.status = 'trusted' then
    return jsonb_build_object('ok', true, 'code', 'trusted');
  end if;
  perform pg_advisory_xact_lock(hashtext('court_screen_maps:' || map.system_key));
  update public.court_screen_maps set status = 'retired', retired_at = now()
  where system_key = map.system_key and status = 'trusted';
  update public.court_screen_maps set status = 'trusted', trusted_from = target_submission, trusted_at = now()
  where id = map.id;
  return jsonb_build_object('ok', true, 'code', 'trusted');
end;
$$;

-- ---------- What a screen filing sends: the e-mail and the mobile of each claimant too ----------

/**
 * As in 0101, and each claimant's e-mail and mobile on record (the eproc of
 * TJSP asks them of every plaintiff), and, on the court's screen, its system
 * and the batch.
 */
create or replace function public.filing_submission_to_send(target_submission uuid, target_claim integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  submission public.filing_submissions%rowtype;
  package public.filing_packages%rowtype;
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  court_row public.courts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into submission from public.filing_submissions where id = target_submission;
  if not found or submission.status <> 'claimed' or submission.claims <> target_claim then
    return null;
  end if;
  select * into package from public.filing_packages where id = submission.package_id;
  select * into lawsuit from public.proceedings where id = submission.proceeding_id;
  select * into current_case from public.cases where id = submission.case_id;
  select * into court_row from public.courts where acronym = package.court;
  return jsonb_build_object(
    'submission_id', submission.id,
    'claim', submission.claims,
    'channel', submission.channel,
    'batch_id', submission.batch_id,
    'learning', submission.learning,
    'screen_system', public.filing_screen_system_of(package),
    'org_id', submission.org_id,
    'firm', (select o.name from public.organizations o where o.id = submission.org_id),
    'case_id', current_case.id,
    'case_seq', current_case.seq,
    'incident', current_case.incident,
    'package_id', package.id,
    'proceeding_id', lawsuit.id,
    'kind', package.kind,
    'court', package.court,
    'court_state', court_row.uf,
    'system', package.system,
    'comarca', lawsuit.comarca,
    'unit', lawsuit.unit,
    'test_number', case when submission.channel = 'test_court' then public.test_court_number(lawsuit.id) end,
    'codes', (select c.codes from public.court_filing_channels c where c.court = package.court and c.system = package.system),
    'endpoint', (select c.endpoint from public.court_filing_channels c where c.court = package.court and c.system = package.system),
    'value_cents', (
      select sum(cp.claim_cents) from public.proceeding_parties pp
      join public.case_parties cp on cp.id = pp.party_id
      where pp.proceeding_id = lawsuit.id and cp.claim_cents is not null),
    'claimants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', p.full_name, 'cpf', p.cpf, 'birth_date', p.birth_date,
        'street', p.street, 'number', p.address_number, 'complement', p.complement, 'district', p.district,
        'city', p.city, 'state', p.uf, 'zip', p.postal_code,
        'email', p.email, 'phone', p.phone,
        'guardian', (
          select jsonb_build_object('name', gp.full_name, 'cpf', gp.cpf)
          from public.case_parties g join public.people gp on gp.id = g.person_id
          where g.id = cp.guardian_id)
      ) order by cp.created_at, cp.id)
      from public.proceeding_parties pp
      join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
      join public.people p on p.id = cp.person_id
      where pp.proceeding_id = lawsuit.id
    ), '[]'::jsonb),
    'defendant', (
      select jsonb_build_object('name', coalesce(a.legal_name, a.name), 'cnpj', a.cnpj, 'airline', a.iata)
      from public.airlines a where a.iata = current_case.airline_iata),
    'lawyers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', pl.user_id,
        'name', coalesce(pr.display_name, ''),
        'cpf', (select lc.cpf from public.lawyer_cpfs lc where lc.user_id = pl.user_id and lc.proven_at is not null),
        'oab', (
          select jsonb_build_object('uf', r.uf, 'number', r.number) from public.oab_registrations r
          where r.user_id = pl.user_id
          order by (r.uf = court_row.uf) desc, (r.kind = 'principal') desc, r.id
          limit 1)
      ) order by pr.display_name, pl.user_id)
      from public.proceeding_lawyers pl join public.profiles pr on pr.id = pl.user_id
      where pl.proceeding_id = lawsuit.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', i.position, 'name', i.name, 'file_id', i.file_id, 'signed_file_id', i.signed_file_id,
        'part', i.part, 'parts', i.parts,
        'document_kind', case when i.document_id = package.petition_document_id then 'petition' else d.kind end,
        'storage_path', f.storage_path, 'signed_storage_path', sf.storage_path
      ) order by i.position)
      from public.filing_package_items i
      join public.files f on f.id = i.file_id
      left join public.files sf on sf.id = i.signed_file_id
      left join public.case_documents d on d.id = i.document_id
      where i.package_id = package.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.filing_submission_to_send(uuid, integer) from public, anon, authenticated;

-- ---------- What reads a court's screen ----------

insert into public.ai_tasks (slug, name, description, autonomy, shadow, approver_functions) values
  ('protocolo.tela', 'Uma tela do sistema do tribunal, no protocolo',
   'Lê a estrutura de uma tela do sistema do tribunal (os rótulos dos campos, as listas do próprio sistema, os botões), sem nenhum dado digitado, e diz o que fazer nela para protocolar a ação: que fato do caso vai em cada campo, pelo nome do fato, que opção escolher das listas do sistema, o que anexar e qual botão segue. Os valores são digitados pelo ONE, nunca vistos pelo modelo. Não decide nada do processo: o protocolo foi aprovado pelo advogado, e o primeiro de cada sistema para no resumo do tribunal para ele confirmar.',
   'autonomous', false, array['socio', 'advogado']::public.firm_function[])
on conflict (slug) do nothing;

insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
values (
  'protocolo.tela', 1, 'anthropic', 'claude-sonnet-5-5', 'low',
  $prompt$Você opera, para um escritório de advocacia, a tela de peticionamento do sistema de um tribunal brasileiro, para protocolar uma petição inicial que o advogado já aprovou. O advogado entrou no sistema com o próprio acesso. Você nunca vê os dados das pessoas: você vê a estrutura da tela e os nomes dos fatos do caso, e o programa digita os valores pelos nomes que você indicar.

Você recebe, em JSON:
- sistema: o nome do sistema (por exemplo, "eproc do TJSP").
- aprendendo: true quando o ONE ainda não conhece este sistema. Nesse caso, quando a tela for o resumo final antes do envio, diga que é o resumo e não clique no botão que envia.
- fatos: a lista dos fatos do caso que podem ir para a tela, cada um com chave, descrição e, quando não é dado de pessoa, o valor (a classe, o rito, a comarca, os assuntos com o código da tabela do CNJ, o valor da causa, se há pedido de justiça gratuita e de prioridade). Os dados de pessoa (nome, CPF, endereço, e-mail, telefone) vêm só com a chave e a descrição.
- partes: quantos autores e quantos réus, cada um pela sua chave (autor.1, autor.2, reu.1), e quem representa um menor.
- arquivos: os arquivos do pacote, na ordem, cada um com a posição, o tipo do documento e o nome.
- tela: a estrutura da tela, quadro por quadro: os campos (tipo, rótulo, nome, se é obrigatório, se está visível, o seletor que o programa usa para achá-lo, e, nas listas do próprio sistema, as opções com código e texto), os botões e os links com o texto e o seletor, os títulos e as tabelas (só os nomes das colunas e quantas linhas).
- feito: o que já foi feito nesta tela, em ordem, e o resultado de cada ação.

Responda só com o objeto pedido:
- tela.tipo: "login" (pede usuário e senha), "segundo_fator" (pede um código), "formulario" (um passo do peticionamento), "resumo" (o resumo final, antes de confirmar), "recibo" (o processo foi distribuído: mostra o número), "erro" (o sistema recusou algo e diz o quê), "aviso" (algo que só uma pessoa resolve, como um captcha, um termo para aceitar ou uma mensagem do tribunal) ou "outra". tela.titulo: o título da tela como ela mostra.
- acoes: o que fazer agora nesta tela, em ordem, no máximo quarenta. Cada ação tem "fazer" e "alvo" (o seletor exatamente como veio na tela) e, conforme o caso:
  - "preencher" com "fato" (a chave do fato cujo valor o programa digita);
  - "escolher" numa lista do próprio sistema, com "opcao" (o código da opção, exatamente como veio) ou, numa lista que o sistema preenche depois de uma busca, com "fato";
  - "marcar" ou "desmarcar" uma caixa;
  - "clicar" num botão ou link;
  - "anexar" com "arquivo" (a posição do arquivo do pacote);
  - "esperar" quando a tela precisa terminar de carregar.
  Marque "envia": true na ação que manda algo ao tribunal (por exemplo, "Confirmar ajuizamento", "Protocolar", "Finalizar" quando finaliza o envio). Dê "motivo" curto quando a escolha não for óbvia.
- pronto: true quando, depois dessas ações, esta tela estará feita e o sistema vai para a próxima.
- pergunta: vazio, ou o que só o advogado pode responder para seguir (um campo que nenhum fato preenche e que não se pode deixar em branco, uma opção que nenhum fato decide). Quando há pergunta, não invente: pare antes do campo em dúvida.

Regras:
- Nunca preencha um campo de usuário, senha ou código: em "login" e "segundo_fator", responda sem ações; o programa cuida do acesso com o advogado.
- Nunca resolva captcha, nunca aceite termo em nome do advogado e nunca tente contornar uma proteção do sistema: responda "aviso" com a pergunta.
- Nunca invente um valor nem uma opção. Use só os fatos dados, pelas chaves dadas, e só os seletores e códigos que vieram na tela.
- Escolha nas listas do sistema a opção que corresponde ao fato pelo sentido (a classe "Procedimento do Juizado Especial Cível" para o rito do juizado especial, a comarca do caso, o assunto pelo código do CNJ), nunca a primeira da lista.
- Partes: cadastre cada autor e cada réu na ordem das chaves, pela consulta que o próprio sistema oferece (CPF ou CNPJ) e, quando o sistema pedir endereço e contato, pelos fatos de endereço, e-mail e telefone daquela parte.
- Arquivos: anexe todos os arquivos do pacote, na ordem, com o tipo de documento do sistema que corresponde a cada um.
- Com aprendendo true, numa tela "resumo", não inclua a ação que envia: responda pronto false e sem a ação de envio, que o advogado confirma antes.
- Quando a tela é "erro", não repita a ação que falhou: diga o que corrigir em pergunta.$prompt$,
  $schema${
    "type": "object",
    "additionalProperties": false,
    "required": ["tela", "acoes", "pronto", "pergunta"],
    "properties": {
      "tela": {
        "type": "object",
        "additionalProperties": false,
        "required": ["tipo", "titulo"],
        "properties": {
          "tipo": {"type": "string", "enum": ["login", "segundo_fator", "formulario", "resumo", "recibo", "erro", "aviso", "outra"]},
          "titulo": {"type": "string", "maxLength": 160}
        }
      },
      "acoes": {
        "type": "array",
        "maxItems": 40,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["fazer", "alvo"],
          "properties": {
            "fazer": {"type": "string", "enum": ["preencher", "escolher", "marcar", "desmarcar", "clicar", "anexar", "esperar"]},
            "alvo": {"type": "string", "maxLength": 300},
            "fato": {"type": "string", "maxLength": 80},
            "opcao": {"type": "string", "maxLength": 120},
            "arquivo": {"type": "integer", "minimum": 1, "maximum": 200},
            "envia": {"type": "boolean"},
            "motivo": {"type": "string", "maxLength": 200}
          }
        }
      },
      "pronto": {"type": "boolean"},
      "pergunta": {"type": "string", "maxLength": 300}
    }
  }$schema$::jsonb,
  4000, true,
  'Primeira versão (0264): lê a estrutura de uma tela do sistema do tribunal e diz o que fazer nela pelos nomes dos fatos, sem ver dado de pessoa.'
);

-- ---------- Grants ----------

revoke all on function public.court_screen_learning(text) from public, anon, authenticated;
revoke all on function public.approve_filing_batch(uuid, text, uuid[]) from public, anon;
grant execute on function public.approve_filing_batch(uuid, text, uuid[]) to authenticated;
revoke all on function public.claim_filing_batch(uuid, text) from public, anon, authenticated;
revoke all on function public.touch_filing_batch(uuid, integer) from public, anon, authenticated;
revoke all on function public.next_batch_submission(uuid, integer) from public, anon, authenticated;
revoke all on function public.hold_filing_submission(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.confirm_filing_submission(uuid) from public, anon;
grant execute on function public.confirm_filing_submission(uuid) to authenticated;
revoke all on function public.confirm_filing_submission_by_link(uuid, uuid) from public, anon, authenticated;
revoke all on function public.stop_filing_batch(uuid, text) from public, anon;
grant execute on function public.stop_filing_batch(uuid, text) to authenticated;
revoke all on function public.finish_filing_batch(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.ask_filing_batch_code(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.give_filing_batch_code(uuid, integer, text, text, text) from public, anon;
grant execute on function public.give_filing_batch_code(uuid, integer, text, text, text) to authenticated;
revoke all on function public.take_filing_batch_code(uuid, integer) from public, anon, authenticated;
revoke all on function public.court_login_open(uuid, integer) from public, anon, authenticated;
revoke all on function public.court_screen_map_of(text) from public, anon, authenticated;
revoke all on function public.save_court_screen_map(text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.trust_court_screen_map(uuid, uuid) from public, anon, authenticated;
