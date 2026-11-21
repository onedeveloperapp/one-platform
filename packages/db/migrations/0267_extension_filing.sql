-- ============================================================
-- 0267_extension_filing: what the lawyer's extension needs of the
-- batches (0264) to file on a court's screen, and three defects of how a
-- batch's filing lived beside the filing through the court's channel
-- (0101), found while building the extension's calls.
--
--   filing_screen_blocker       a test case never goes to a court's
--                               screen: its lawsuit is the test court's
--                               (0101, 0220), and a lawsuit of invented
--                               people typed on a real court's screen would
--                               be filed there.
--   claim_filing_submissions    the sweep that files through a court's
--                               channel (the MNI, the test court) never
--                               takes a filing of a batch, which is its
--                               runner's: it took an owed one of a test case
--                               and, changing its channel, broke on the
--                               check that a batch's filing is on the
--                               screen, for every firm at once.
--   retry_filing_submission     sending again a filing on the court's
--                               screen (refused, failed, or unknown once its
--                               lawyer says the court's system does not have
--                               it) frees its package for a new batch: it
--                               stayed owed under a batch that had ended, and
--                               the package could go nowhere.
--
-- The extension's calls themselves are the backend's, over the functions
-- of 0263 and 0264 the service role alone may call (apps/web/src/app/api/
-- extensao): nothing else changes.
-- ============================================================


-- ---------- A test case stays off a court's screen ----------

/**
 * As in 0264, and a test case is never filed on a court's screen: the test
 * court files it. Internal.
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
  -- A test case is filed by the test court (0101), never typed on a real court's screen.
  if exists (select 1 from public.cases k where k.id = target_package.case_id and k.is_test) then
    return 'test_case';
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

-- ---------- The sweep of the court's channel leaves a batch's filings alone ----------

/**
 * As in 0101, and a filing of a batch is never claimed here: the lawyer's
 * extension or ONE's browser holds it. What went and never came back is
 * still unknown after the minutes of the setting, whatever its channel.
 * Service role.
 */
create or replace function public.claim_filing_submissions(target_limit integer default 3, target_package uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stale integer := greatest(public.filing_submit_setting('stale_minutes', 10), 1);
  wanted integer := greatest(least(coalesce(target_limit, 3), 20), 1);
  claimed jsonb := '[]'::jsonb;
  lost record;
  candidate record;
  package public.filing_packages%rowtype;
  submission public.filing_submissions%rowtype;
  route text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- What went and never came back is not sent again by itself.
  for lost in
    select s.id, s.org_id, s.case_id, s.package_id from public.filing_submissions s
    where s.status = 'sending' and s.sent_at < now() - make_interval(mins => stale)
    for update skip locked
  loop
    update public.filing_submissions
    set status = 'unknown', error = 'no_answer', claimed_at = null, updated_at = now()
    where id = lost.id;
    perform public.record_case_event(lost.org_id, lost.case_id, 'filing_unknown', 'system',
      jsonb_build_object('package', lost.package_id, 'submission', lost.id));
  end loop;

  for candidate in
    select p.id from public.filing_packages p
    left join public.filing_submissions s on s.package_id = p.id
    where p.status = 'ready'
      and (target_package is null or p.id = target_package)
      and (
        s.id is null
        -- A filing of a batch is its runner's (the lawyer's extension, ONE's browser), never this sweep's.
        or (s.batch_id is null and s.status = 'owed' and (s.retry_after is null or s.retry_after <= now()))
        or (s.batch_id is null and s.status = 'claimed' and s.claimed_at < now() - make_interval(mins => stale))
      )
    order by coalesce(s.retry_after, p.built_at, p.requested_at), p.id
    limit 50
  loop
    select * into package from public.filing_packages where id = candidate.id for update skip locked;
    continue when not found;
    continue when public.filing_submission_blocker(package) is not null;
    route := public.filing_channel_of(package);
    select * into submission from public.filing_submissions where package_id = package.id for update skip locked;
    if submission.id is null then
      if exists (select 1 from public.filing_submissions where package_id = package.id) then
        continue;
      end if;
      insert into public.filing_submissions (org_id, case_id, proceeding_id, package_id, channel)
      values (package.org_id, package.case_id, package.proceeding_id, package.id, route)
      returning * into submission;
    end if;
    continue when submission.status not in ('owed', 'claimed') or submission.batch_id is not null;
    update public.filing_submissions
    set status = 'claimed', claims = claims + 1, claimed_at = now(), channel = route,
        updated_at = now()
    where id = submission.id
    returning * into submission;
    claimed := claimed || jsonb_build_array(jsonb_build_object(
      'submission_id', submission.id, 'claim', submission.claims, 'channel', submission.channel,
      'package_id', package.id, 'case_id', package.case_id));
    exit when jsonb_array_length(claimed) >= wanted;
  end loop;
  return jsonb_build_object('claimed', claimed);
end;
$$;

revoke all on function public.claim_filing_submissions(integer, uuid) from public, anon, authenticated;

-- ---------- Sending again a filing on the court's screen ----------

/**
 * As in 0101, and a filing on the court's screen is sent again by a new
 * batch: its package is freed for one, with the second factor, never a
 * support visit.
 */
create or replace function public.retry_filing_submission(target_submission uuid, target_not_in_court boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  submission public.filing_submissions%rowtype;
  current_case public.cases%rowtype;
begin
  select * into submission from public.filing_submissions where id = target_submission;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(submission.case_id);
  if not public.has_firm_function(submission.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_a_lawyer');
  end if;
  perform public.require_aal2();
  select * into submission from public.filing_submissions where id = target_submission for update;
  if submission.status not in ('refused', 'failed', 'unknown') then
    return jsonb_build_object('ok', false, 'code', 'not_retryable');
  end if;
  if submission.status = 'unknown' and not coalesce(target_not_in_court, false) then
    return jsonb_build_object('ok', false, 'code', 'confirm_not_in_court');
  end if;
  -- A filing on the court's screen goes again in a new batch its lawyer approves: its package is freed for one.
  if submission.batch_id is not null or submission.channel in ('browser', 'extension') then
    delete from public.filing_submissions where id = submission.id;
    perform public.record_case_event(submission.org_id, submission.case_id, 'filing_retried', 'person',
      jsonb_build_object('package', submission.package_id, 'submission', submission.id,
                         'not_in_court', coalesce(target_not_in_court, false), 'freed', true));
    return jsonb_build_object('ok', true, 'code', 'freed');
  end if;
  update public.filing_submissions
  set status = 'owed', attempts = 0, retry_after = null, error = null, message = null, protocol = null,
      requested_by = coalesce(requested_by, auth.uid()), updated_at = now()
  where id = submission.id;
  perform public.record_case_event(submission.org_id, submission.case_id, 'filing_retried', 'person',
    jsonb_build_object('package', submission.package_id, 'submission', submission.id,
                       'not_in_court', coalesce(target_not_in_court, false)));
  return jsonb_build_object('ok', true, 'code', 'owed');
end;
$$;

revoke all on function public.retry_filing_submission(uuid, boolean) from public, anon;
grant execute on function public.retry_filing_submission(uuid, boolean) to authenticated;
