-- ============================================================
-- 0082_case_journey: how many of a firm's cases are at each step of their
-- way, for the home's view of their progress (the owner, 2026-11-03).
--
-- The steps are the app's rule (`lib/cases/journey.ts`): before the court
-- they are the case's stages, and in court, where a case stays "filed" until
-- it ends, what its lawsuits show: a hearing held, a publication in force
-- triaged as a decision, one triaged as a payment. This only counts: the
-- cases of a firm (of a module, or of every one) grouped by their stage and,
-- for a case in court, by those three facts; the app reads each group into
-- its step. Anybody of the firm reads it; nobody writes it.
-- ============================================================

/**
 * A firm's cases grouped by their stage and, for a case in court, by whether a hearing of it was held and whether
 * a publication of it in force was triaged as a decision and as a payment: `[{status, held, decided, paid, cases}]`.
 * Of one module, or of every one when none is named.
 */
create or replace function public.firm_case_journey(target_org uuid, target_module text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'status', g.status, 'held', g.held, 'decided', g.decided, 'paid', g.paid, 'cases', g.cases
    ) order by g.status, g.held, g.decided, g.paid)
    from (
      select f.status, f.held, f.decided, f.paid, count(*)::integer as cases
      from (
        select c.status,
          c.status = 'filed' and exists (
            select 1 from public.hearings h where h.case_id = c.id and h.org_id = c.org_id and h.status = 'held'
          ) as held,
          c.status = 'filed' and exists (
            select 1 from public.publications p
            where p.case_id = c.id and p.org_id = c.org_id and p.active and p.category = 'decisao'
          ) as decided,
          c.status = 'filed' and exists (
            select 1 from public.publications p
            where p.case_id = c.id and p.org_id = c.org_id and p.active and p.category = 'pagamento'
          ) as paid
        from public.cases c
        where c.org_id = target_org and (target_module is null or c.module = target_module)
      ) f
      group by f.status, f.held, f.decided, f.paid
    ) g
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.firm_case_journey(uuid, text) from public, anon;
grant execute on function public.firm_case_journey(uuid, text) to authenticated;
