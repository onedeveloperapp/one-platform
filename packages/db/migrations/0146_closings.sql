-- ============================================================
-- 0146_closings: what counts as a closing (the owner, 2026-11-10).
--
-- A case closes when its client signed the power of attorney or the fee
-- contract and then sent the documents the case needs: counted once per case,
-- on the day the later of the two came (`fechamento-v1`). The signature is the
-- first power of attorney or contract of the case that stands signed: one ONE
-- issued and its envelope came back signed, or one the firm added already
-- signed (never the unsigned paper ONE issued, nor a paper the firm sent to be
-- signed). The documents are the ones the setting names
-- (`cases.required_documents`, as the case screen and `case_standing` read
-- them): each answered by a document nobody refused, on the day the first such
-- came. A refused document answers nothing, so a closing waits for the one
-- sent after it.
--
-- The closing goals (0113) count them now: each goal's period in days of
-- Brasília, its part of the cases, and the firm's real cases; while a firm has
-- no real case its test cases count, and the answer says so, as the
-- controladoria's numbers do (0114).
-- ============================================================

/**
 * When each case of a firm (or the cases named) was signed, had its papers and
 * closed; null where it has not yet. Internal: the goals and the funnel read it.
 */
create or replace function public.case_closings(target_org uuid, target_cases uuid[] default null)
returns table (case_id uuid, signed_at timestamptz, papers_at timestamptz, closed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with knobs as materialized (
    select
      (now() at time zone 'America/Sao_Paulo')::date as today,
      coalesce(public.cases_setting('required_documents'), '[]'::jsonb) as required
  ), k as materialized (
    select c.id from public.cases c
    where c.org_id = target_org and (target_cases is null or c.id = any (target_cases))
  ), signed as (
    select s.case_id, min(s.at) as at
    from (
      -- A power of attorney or a contract ONE issued, whose envelope came back signed.
      select paper.case_id, d.created_at as at
      from public.case_papers paper
      join k on k.id = paper.case_id
      join public.signature_envelopes e on e.id = paper.envelope_id and e.status = 'signed'
      join public.case_documents d on d.id = e.signed_document_id
      where paper.kind in ('procuracao', 'contrato')
      union all
      -- One that stands signed as a document of the case: never ONE's unsigned paper, nor one sent to be signed.
      select d.case_id, d.created_at
      from public.case_documents d
      join k on k.id = d.case_id
      where d.kind in ('power_of_attorney', 'contract') and d.status not in ('uploading', 'rejected')
        and not exists (select 1 from public.case_papers p where p.document_id = d.id)
        and not exists (select 1 from public.signature_envelopes e where e.document_id = d.id)
    ) s
    group by s.case_id
  ), people_of as materialized (
    select cp.id as party_id, cp.case_id, cp.person_id, cp.role, cp.guardian_id, cp.created_at,
           (p.birth_date is not null and p.birth_date <= kn.today
             and p.birth_date > (kn.today - interval '18 years')::date) as minor
    from public.case_parties cp
    join k on k.id = cp.case_id
    join public.people p on p.id = cp.person_id
    cross join knobs kn
    where cp.role in ('claimant', 'guardian')
  ), holder_of as materialized (
    -- Who answers for the case, as `case_standing` (0111) and the case screen say it.
    select distinct on (pf.case_id) pf.case_id, pf.party_id, pf.person_id
    from people_of pf
    order by pf.case_id,
      case
        when pf.role = 'claimant' and pf.guardian_id is null and not pf.minor then 1
        when pf.role = 'guardian' then 2
        when not pf.minor then 3
        else 4
      end,
      pf.created_at, pf.party_id
  ), rules as materialized (
    select r ->> 'per' as per,
           array(select jsonb_array_elements_text(coalesce(r -> 'or', '[]'::jsonb))) || (r ->> 'kind') as kinds
    from knobs kn, jsonb_array_elements(kn.required) r
  ), needs as (
    -- Each document the case needs, with the day the first one nobody refused came (null while none did).
    select h.case_id, (
      select min(d.created_at) from public.case_documents d
      where d.case_id = h.case_id and d.kind = any (r.kinds) and d.status not in ('uploading', 'rejected')
    ) as at
    from holder_of h
    join rules r on r.per = 'case'
    union all
    select h.case_id, (
      select min(d.created_at) from public.case_documents d
      join public.case_parties cp on cp.id = d.party_id
      where d.case_id = h.case_id and cp.person_id = h.person_id and d.kind = any (r.kinds)
        and d.status not in ('uploading', 'rejected')
    )
    from holder_of h
    join rules r on r.per = 'holder'
    union all
    select pf.case_id, (
      select min(d.created_at) from public.case_documents d
      where d.case_id = pf.case_id and d.party_id = pf.party_id and d.kind = any (r.kinds)
        and d.status not in ('uploading', 'rejected')
    )
    from people_of pf
    join rules r on r.per = 'claimant'
    where pf.role = 'claimant'
  ), papers as (
    select n.case_id, case when bool_and(n.at is not null) then max(n.at) end as at
    from needs n
    group by n.case_id
  )
  select k.id, s.at, pa.at,
         case when s.at is not null and pa.at is not null then greatest(s.at, pa.at) end
  from k
  left join signed s on s.case_id = k.id
  left join papers pa on pa.case_id = k.id;
$$;

revoke all on function public.case_closings(uuid, uuid[]) from public, anon, authenticated;

/**
 * The firm's closing goals (0113), each with the closings of its period and of
 * its part of the cases, by the rule `fechamento-v1`; the firm's real cases,
 * or its test cases while it has no real one (`tests_counted`). For anybody of
 * the firm.
 */
create or replace function public.firm_closing_goals(target_org uuid, target_module text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  tests_counted boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  tests_counted := not public.firm_has_real_case(target_org);
  return (
    with closed as materialized (
      select (cl.closed_at at time zone 'America/Sao_Paulo')::date as day,
             c.module, c.incident, c.origin, c.partnership_id
      from public.case_closings(target_org) cl
      join public.cases c on c.id = cl.case_id
      where cl.closed_at is not null and (tests_counted or not c.is_test)
    )
    select jsonb_build_object(
      'today', today,
      -- What counts as a closing: the power of attorney or the contract signed, then the documents sent.
      'rule', 'fechamento-v1',
      'tests_counted', tests_counted,
      'may_manage', public.may_manage_closing_goals(target_org) and not public.is_impersonated(),
      'goals', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', g.id,
          'starts_on', g.starts_on,
          'ends_on', g.ends_on,
          'module', g.module_key,
          'incident', g.incident,
          'origin', g.origin,
          'partnership', g.partnership_id,
          'partner', p.name,
          'target', g.target,
          'closings', (
            select count(*) from closed x
            where x.day between g.starts_on and g.ends_on
              and (g.module_key is null or x.module = g.module_key)
              and (g.incident is null or x.incident = g.incident)
              and (g.origin is null or x.origin = g.origin)
              and (g.partnership_id is null or x.partnership_id = g.partnership_id)
          ),
          'archived_at', g.archived_at,
          'archive_reason', g.archive_reason,
          'updated_at', g.updated_at
        ) order by g.starts_on desc, g.ends_on desc, g.created_at desc)
        from public.closing_goals g
        left join public.partner_links l on l.id = g.partnership_id
        left join public.partners p on p.id = l.partner_id
        where g.org_id = target_org and (target_module is null or g.module_key = target_module)
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.firm_closing_goals(uuid, text) from public, anon;
grant execute on function public.firm_closing_goals(uuid, text) to authenticated;
