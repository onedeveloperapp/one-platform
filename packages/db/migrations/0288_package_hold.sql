-- ============================================================
-- 0288_package_hold: what holds a package, said by one rule, the same on
-- the case, on /protocolo and for ONE's own filing (the owner, 2026-11-24,
-- after the canvas "Cartões do caso, antes e depois": a package something
-- holds is "Com impedimento", never "Pronto para protocolar").
--
-- The case's card said a package held when it was built for the lawsuit
-- as it was (0027, `filing_package_outdated`) or when the court's screen
-- asks a contact the case lacks (0269, `asks_contact`, the eproc of TJSP),
-- while the queue of /protocolo read only what holds the lawsuit (0025,
-- `filing_blockers`) and said those packages ready; the lawyer's batch
-- offered them, and ONE's browser, the extension and the court's channel
-- would have taken to the court a claimant the eproc refuses.
--
--   filing_package_lacks_contact  the court's screen of the package asks
--                                 each claimant's e-mail and mobile, and a
--                                 claimant of its lawsuit (who answers for a
--                                 represented minor) has no e-mail or no
--                                 phone: the rule of the guide's
--                                 `claimantGroup` (apps/web/src/lib/cases/
--                                 filing-sheet.ts), which says whose;
--   filing_package_hold           the one answer: built for the lawsuit as
--                                 it was, then what holds the lawsuit, then
--                                 the contact (`contact_missing`);
--   filing_package_holds          what holds each package named, for the
--                                 queue and the case (anybody of the firm);
--   filing_submission_blocker     (0101) the court's channel, and
--   filing_screen_blocker         (0267) ONE's browser and the extension,
--                                 hold a package by that rule;
--   filing_packages_waiting       (0269) the reminder that a package waits
--                                 to be filed by hand leaves a held one out.
--
-- The receipt (`attach_filing_receipt`) still asks only what holds the
-- lawsuit: a lawsuit the court took is filed, whatever ONE lacked of it.
-- ============================================================


-- ---------- The contact the court's screen asks ----------

/**
 * Whether the court's screen of a package ready to file asks each claimant's e-mail and mobile
 * (`court_screen_systems.asks_contact`, 0269) and a claimant of its lawsuit lacks either: a represented minor's
 * contact is who answers for them (under 18 on São Paulo's today, with a guardian), anybody else's their own; an
 * e-mail is missing when blank, a phone when it has no digit. As the guide says it, whose included. Internal.
 */
create or replace function public.filing_package_lacks_contact(target_package public.filing_packages)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with today as (select (now() at time zone 'America/Sao_Paulo')::date as day)
  select exists (
    select 1
    from public.court_screen_systems s
    join public.proceeding_parties pp on pp.proceeding_id = target_package.proceeding_id
    join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
    join public.people p on p.id = cp.person_id
    left join public.case_parties g on g.id = cp.guardian_id
    left join public.people gp on gp.id = g.person_id
    cross join today t
    cross join lateral (
      select gp.id is not null and nullif(btrim(gp.full_name), '') is not null
        and p.birth_date is not null and p.birth_date <= t.day
        and p.birth_date > (t.day - interval '18 years')::date as by_guardian
    ) m
    where s.court = target_package.court and s.system = target_package.system and s.asks_contact
      and (
        nullif(btrim(coalesce(case when m.by_guardian then gp.email else p.email end, '')), '') is null
        or regexp_replace(coalesce(case when m.by_guardian then gp.phone else p.phone end, ''), '\D', '', 'g') = ''
      )
  );
$$;

revoke all on function public.filing_package_lacks_contact(public.filing_packages) from public, anon, authenticated;

-- ---------- The one answer ----------

/**
 * What holds a package of a lawsuit still to be filed, or null: built for the lawsuit as it was (`package_outdated`,
 * while asked for or ready), what holds the lawsuit (`filing_blocker`), or, ready, a contact the court's screen asks
 * and the case lacks (`contact_missing`). Null too for a lawsuit no longer planned. Internal.
 */
create or replace function public.filing_package_hold(target_package public.filing_packages)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (
      select 1 from public.proceedings p where p.id = target_package.proceeding_id and p.status = 'planned'
    ) then null
    when target_package.status in ('requested', 'ready') and public.filing_package_outdated(target_package)
      then 'package_outdated'
    else coalesce(
      public.filing_blocker(target_package.proceeding_id),
      case when target_package.status = 'ready' and public.filing_package_lacks_contact(target_package)
        then 'contact_missing' end)
  end;
$$;

revoke all on function public.filing_package_hold(public.filing_packages) from public, anon, authenticated;

/**
 * What holds each package named, of the firm's, with its code (`filing_package_hold`): the queue of /protocolo
 * counts a held package where it is held, never as ready, and the top of the case says what holds it. A package of
 * another firm, or that nothing holds, is left out. Anybody of the firm.
 */
create or replace function public.filing_package_holds(target_org uuid, target_packages uuid[])
returns table (package_id uuid, code text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  select h.id, h.code
  from (
    select f.id, public.filing_package_hold(f) as code
    from public.filing_packages f
    where f.org_id = target_org and f.id = any (coalesce(target_packages, '{}'::uuid[]))
  ) h
  where h.code is not null;
end;
$$;

revoke all on function public.filing_package_holds(uuid, uuid[]) from public, anon;
grant execute on function public.filing_package_holds(uuid, uuid[]) to authenticated;

-- ---------- ONE's own filing holds it by the same rule ----------

/**
 * As in 0101, with what holds the package read by its one rule (`filing_package_hold`): a contact the court's
 * screen asks and the case lacks holds it too. Internal.
 */
create or replace function public.filing_submission_blocker(target_package public.filing_packages)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  channel text := public.filing_channel_of(target_package);
  hold text;
  codes jsonb;
  comarca text;
begin
  if target_package.status <> 'ready' then
    return 'package_not_ready';
  end if;
  select * into lawsuit from public.proceedings where id = target_package.proceeding_id;
  if not found or lawsuit.status <> 'planned' then
    return 'already_filed';
  end if;
  hold := public.filing_package_hold(target_package);
  if hold is not null then
    return hold;
  end if;
  if channel is null then
    return 'no_channel';
  end if;
  -- A lawsuit goes signed by a lawyer of it with a registration at the bar, against the company of the case.
  if not exists (
    select 1 from public.proceeding_lawyers pl join public.oab_registrations r on r.user_id = pl.user_id
    where pl.proceeding_id = lawsuit.id
  ) then
    return 'no_signer';
  end if;
  if not exists (
    select 1 from public.cases k join public.airlines a on a.iata = k.airline_iata where k.id = target_package.case_id
  ) then
    return 'no_airline';
  end if;
  if channel = 'mni' then
    select c.codes into codes from public.court_filing_channels c
    where c.court = target_package.court and c.system = target_package.system;
    comarca := coalesce(lawsuit.comarca, '');
    if not ((codes -> 'classes') ? target_package.kind)
       or not ((codes -> 'localities') ? comarca)
       or not ((codes -> 'judging_bodies') ? (comarca || '|' || target_package.kind)) then
      return 'court_codes_missing';
    end if;
    -- Every file goes under the court's code of its kind of document.
    if exists (
      select 1 from public.filing_package_items i
      left join public.case_documents d on d.id = i.document_id
      where i.package_id = target_package.id
        and not ((codes -> 'document_types') ? (
          case when i.document_id = target_package.petition_document_id then 'petition' else coalesce(d.kind, 'other') end))
    ) then
      return 'court_codes_missing';
    end if;
    if public.package_takes_signed_files(target_package) and target_package.signature_status is distinct from 'signed' then
      return 'not_signed';
    end if;
  end if;
  if public.firm_autonomy_mode(target_package.org_id, 'file_lawsuit') <> 'auto'
     and not exists (
       select 1 from public.filing_submissions s where s.package_id = target_package.id and s.requested_by is not null
     ) then
    return 'awaits_lawyer';
  end if;
  return null;
end;
$$;

revoke all on function public.filing_submission_blocker(public.filing_packages) from public, anon, authenticated;

/**
 * As in 0267, with what holds the package read by its one rule (`filing_package_hold`): a lawyer's batch never
 * takes to the court's screen a claimant it refuses. Internal.
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
  hold text;
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
  hold := public.filing_package_hold(target_package);
  if hold is not null then
    return hold;
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

-- ---------- The reminder leaves a held package out ----------

/**
 * As in 0269, with a package held by its one rule (`filing_package_hold`) left out: the firm is asked what holds
 * it, never to file it. Internal.
 */
create or replace function public.filing_packages_waiting(target_org uuid default null)
returns table (
  package_id uuid, org_id uuid, case_id uuid, proceeding_id uuid, seq integer, court text, system text,
  since timestamptz, is_test boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.org_id, p.case_id, p.proceeding_id, k.seq, p.court, p.system,
         coalesce(p.built_at, p.requested_at), coalesce(k.is_test, false)
  from public.filing_packages p
  join public.proceedings pr on pr.id = p.proceeding_id and pr.status = 'planned'
  join public.cases k on k.id = p.case_id and k.status not in ('closed', 'declined')
  where p.status = 'ready'
    and (target_org is null or p.org_id = target_org)
    and coalesce(p.built_at, p.requested_at)
        <= now() - make_interval(days => greatest(public.pending_setting('filing_waits_days', 2), 1))
    and not exists (select 1 from public.filing_submissions s where s.package_id = p.id)
    and public.filing_package_hold(p) is null;
$$;

revoke all on function public.filing_packages_waiting(uuid) from public, anon, authenticated;
