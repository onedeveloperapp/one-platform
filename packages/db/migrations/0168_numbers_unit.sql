-- ============================================================
-- 0168 · Os números por vara ou juizado
--
-- Phase 11 of the plan of the controladoria and the finance: the firm's numbers are grouped by the airline, the kind
-- of problem, the court, the comarca and the kind of lawsuit (0136). Each lawsuit of the set now says its unit, the vara
-- or juizado the court records (`firm_lawsuit_numbers` redefined from 0136), so the app groups by it too and projects
-- the judgments of the months ahead from the firm's own history.
-- ============================================================

/** The firm's lawsuits filed, the set every number groups (0136), each with its unit (0168). */
create or replace function public.firm_lawsuit_numbers(target_org uuid, target_tests boolean default false, target_module text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.reads_firm_numbers(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(row_data order by row_data ->> 'filed_on' desc, row_data ->> 'id')
    from (
      select jsonb_build_object(
        'id', p.id, 'case_id', c.id, 'case_seq', c.seq, 'cnj', p.cnj, 'airline', c.airline_iata, 'incident', c.incident,
        'court', p.court, 'comarca', nullif(btrim(coalesce(p.comarca, '')), ''),
        'unit', nullif(btrim(coalesce(p.unit, '')), ''), 'kind', p.kind, 'module', c.module,
        'is_test', c.is_test,
        'filed_on', p.filed_at, 'opened_on', (c.created_at at time zone 'America/Sao_Paulo')::date,
        'result', j.result, 'judged_on', j.happened_on, 'judged_checked', j.checked, 'value_cents', j.per_claimant_cents,
        'settled', s.id is not null, 'settled_cents', s.cents,
        'final', exists (select 1 from public.lawsuit_facts f where f.proceeding_id = p.id and f.kind = 'transito' and f.corrected_at is null),
        'paid_on', (select min(f.received_on) from public.lawsuit_facts f
                    where f.proceeding_id = p.id and f.kind = 'alvara' and f.received_on is not null and f.corrected_at is null),
        'closed', c.status in ('closed', 'declined'),
        'claimants', (select count(*) from public.proceeding_parties pp where pp.proceeding_id = p.id),
        'unchecked', (select count(*) from public.lawsuit_facts f where f.proceeding_id = p.id and f.corrected_at is null
                      and f.by_one and f.confirmed_by is null and f.source <> 'person')
      ) as row_data
      from public.proceedings p
      join public.cases c on c.id = p.case_id
      left join lateral (
        select f.result, f.happened_on, (f.source = 'person' or f.confirmed_by is not null) as checked,
          case when f.cents is null then null
               when f.per_claimant then f.cents
               else f.cents / greatest((select count(*) from public.proceeding_parties pp where pp.proceeding_id = p.id), 1) end
            as per_claimant_cents
        from public.lawsuit_facts f
        where f.proceeding_id = p.id and f.kind = 'sentenca' and f.corrected_at is null
        order by f.happened_on desc, f.created_at desc limit 1
      ) j on true
      left join lateral (
        select f.id, f.cents from public.lawsuit_facts f
        where f.proceeding_id = p.id and f.kind = 'acordo' and f.corrected_at is null
        order by f.happened_on desc limit 1
      ) s on true
      where p.org_id = target_org and p.filed_at is not null and p.status in ('filed', 'closed')
        and (coalesce(target_tests, false) or not c.is_test)
        and (target_module is null or c.module = target_module)
      order by p.filed_at desc
      limit 5000
    ) rows
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.firm_lawsuit_numbers(uuid, boolean, text) from public, anon;
grant execute on function public.firm_lawsuit_numbers(uuid, boolean, text) to authenticated;
