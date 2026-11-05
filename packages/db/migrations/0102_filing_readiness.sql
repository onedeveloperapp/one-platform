-- ============================================================
-- 0102_filing_readiness: what ONE's filing needs of a person is asked for
-- ahead, and what came back of a filing waits where the firm looks first
-- (the owner's decision of 2026-11-05).
--
-- What ONE needed to file a lawsuit was only looked at once its package was
-- ready: a court that takes the files signed (the Projudi of TJGO) waited
-- there for a lawyer of the lawsuit to authorize ONE's signature in the
-- cloud, an authorization that lasts seven days at most (the PSC's own
-- limit), so it ran out between one lawsuit and the next; and a filing the
-- court refused, that failed or whose answer was lost (0101) was said only
-- on its case.
--
--   - `lawsuits_awaiting_signature`: the planned lawsuits of a firm's open
--     cases (never a test case: the test court takes no signature) whose
--     court takes the files signed, whose package is not signed yet, and that
--     no lawyer of them covers with an authorization in force for the
--     setting's hours ahead (`pending.signature_ahead_hours`, 24): asked from
--     the moment ONE creates the lawsuit, not when its package is built.
--   - `firm_filing_attention`: for the center of what waits and the home,
--     each lawyer such lawsuits wait on (with no CPF declared, no
--     authorization, or one that runs out within the hours ahead) and each
--     filing ONE sent that came back to a person.
--   - `case_signature_ahead`: the same, for one case, on its card of the
--     filing.
-- ============================================================

/**
 * The planned lawsuits of a firm's open cases whose files ONE will sign in
 * the cloud for the court (the court's system takes them signed) and that
 * no lawyer of them covers with an authorization in force for the setting's
 * hours ahead: a case of the test court takes no signature, and a package
 * already signed needs none. Internal.
 */
create or replace function public.lawsuits_awaiting_signature(target_org uuid, target_case uuid default null)
returns table (proceeding_id uuid, case_id uuid, seq integer)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.case_id, k.seq
  from public.proceedings p
  join public.cases k on k.id = p.case_id
  join public.court_systems cs
    on cs.court = p.court and cs.proceeding_kind = p.kind and cs.system = p.system and cs.signed_files = 'p7s'
  where p.org_id = target_org
    and (target_case is null or p.case_id = target_case)
    and p.status = 'planned'
    and not k.is_test
    and k.status not in ('filed', 'closed', 'declined')
    and not exists (
      select 1 from public.filing_packages fp
      where fp.proceeding_id = p.id and fp.status in ('ready', 'filed') and fp.signature_status = 'signed'
    )
    and not exists (
      select 1 from public.proceeding_lawyers pl
      join public.connections c on c.person_id = pl.user_id and c.org_id = p.org_id
      where pl.proceeding_id = p.id and c.status in ('connected', 'error')
        and c.expires_at > now() + make_interval(hours => greatest(public.pending_setting('signature_ahead_hours', 24), 1))
    );
$$;

revoke all on function public.lawsuits_awaiting_signature(uuid, uuid) from public, anon, authenticated;

/**
 * What ONE's filing waits on a person for, in a firm: `signatures`, each
 * partner or lawyer of the lawsuits that will be signed in the cloud with
 * no authorization to cover them (`state`: `cpf_missing`, their CPF never
 * declared, which the authorization needs; `none`; `expiring`, the one in
 * force ends within the setting's hours, with when), how many lawsuits and
 * cases, and the first case; and `filings`, each filing ONE sent that came back to a
 * person (refused, failed, sent with no answer, or taken with no number),
 * the oldest first, with `filings_total`. Anybody of the firm.
 */
create or replace function public.firm_filing_attention(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  list_size integer := least(greatest(public.pending_setting('list_size', 20), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'signatures', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.seq, x.user_id)
      from (
        select pl.user_id,
               coalesce(pr.display_name, '') as name,
               count(distinct a.proceeding_id)::integer as lawsuits,
               count(distinct a.case_id)::integer as cases,
               min(a.seq) as seq,
               (array_agg(a.case_id order by a.seq, a.case_id))[1] as case_id,
               case
                 when not exists (select 1 from public.lawyer_cpfs lc where lc.user_id = pl.user_id) then 'cpf_missing'
                 when exists (
                   select 1 from public.connections c
                   where c.person_id = pl.user_id and c.org_id = target_org and c.status in ('connected', 'error')
                     and c.expires_at > now()
                 ) then 'expiring'
                 else 'none'
               end as state,
               (select max(c.expires_at) from public.connections c
                where c.person_id = pl.user_id and c.org_id = target_org and c.status in ('connected', 'error')
                  and c.expires_at > now()) as expires_at
        from public.lawsuits_awaiting_signature(target_org) a
        join public.proceeding_lawyers pl on pl.proceeding_id = a.proceeding_id
        join public.memberships m
          on m.org_id = target_org and m.user_id = pl.user_id and m.firm_function in ('socio', 'advogado')
        join public.profiles pr on pr.id = pl.user_id
        group by pl.user_id, pr.display_name
      ) x
    ), '[]'::jsonb),
    'filings', coalesce((
      select jsonb_agg(row_to_json(y)::jsonb order by y.since, y.submission_id)
      from (
        select s.id as submission_id, s.case_id, k.seq, s.status, s.error, s.updated_at as since
        from public.filing_submissions s
        join public.cases k on k.id = s.case_id
        where s.org_id = target_org and k.status not in ('closed', 'declined')
          and (s.status in ('refused', 'failed', 'unknown')
               or (s.status = 'filed' and s.error in ('number_missing', 'number_refused')
                   and exists (select 1 from public.filing_packages p where p.id = s.package_id and p.status = 'ready')))
        order by s.updated_at, s.id
        limit list_size
      ) y
    ), '[]'::jsonb),
    'filings_total', (
      select count(*) from public.filing_submissions s
      join public.cases k on k.id = s.case_id
      where s.org_id = target_org and k.status not in ('closed', 'declined')
        and (s.status in ('refused', 'failed', 'unknown')
             or (s.status = 'filed' and s.error in ('number_missing', 'number_refused')
                 and exists (select 1 from public.filing_packages p where p.id = s.package_id and p.status = 'ready')))
    )
  );
end;
$$;

revoke all on function public.firm_filing_attention(uuid) from public, anon;
grant execute on function public.firm_filing_attention(uuid) to authenticated;

/**
 * The planned lawsuits of a case that will be signed in the cloud and that
 * no lawyer of them covers yet (`lawsuits_awaiting_signature`), each with
 * whether the person who asks is one of its lawyers and declared their CPF:
 * what the card of the filing asks for before the package exists. Anybody
 * of the firm.
 */
create or replace function public.case_signature_ahead(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'proceeding_id', a.proceeding_id,
      'viewer_signs', exists (
        select 1 from public.proceeding_lawyers pl where pl.proceeding_id = a.proceeding_id and pl.user_id = auth.uid()),
      'viewer_cpf', exists (select 1 from public.lawyer_cpfs lc where lc.user_id = auth.uid())
    ) order by a.proceeding_id)
    from public.lawsuits_awaiting_signature(current_case.org_id, current_case.id) a
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.case_signature_ahead(uuid) from public, anon;
grant execute on function public.case_signature_ahead(uuid) to authenticated;
