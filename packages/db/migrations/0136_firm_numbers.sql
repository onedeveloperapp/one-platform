-- ============================================================
-- 0136 · Os números do escritório
--
-- Phase 11 of the plan of the controladoria, the outcome of the cases and
-- the firm's finance, its first cut. One set behind every number: each
-- lawsuit the firm filed, with what its court decided as ONE read it or a
-- person recorded it (0130), how long it took, and whether a person checked
-- it (`firm_lawsuit_numbers`). The app groups that very set by airline, kind
-- of problem, court, comarca, kind of lawsuit or the month it was filed, so a
-- number always equals its list, with its sample and no average of fewer than
-- five. The money of each case (the fees received against its direct costs)
-- is read apart, by who reads the books (`firm_case_margins`). Partners,
-- lawyers and the controladoria read the numbers; nothing leaves ONE but the
-- spreadsheet a person downloads.
-- ============================================================

/** Who reads the firm's numbers: a partner (or who decides for a firm with none), a lawyer, the controladoria. */
create or replace function public.reads_firm_numbers(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_org_member(target_org)
    and (public.decides_for_firm(target_org)
         or public.has_firm_function(target_org, array['socio', 'advogado', 'controladoria']::public.firm_function[]));
$$;

revoke all on function public.reads_firm_numbers(uuid) from public, anon;
grant execute on function public.reads_firm_numbers(uuid) to authenticated;

/**
 * Each lawsuit the firm filed, with what the numbers read of it: the case's airline and kind of problem, the court, the
 * comarca the court records, the kind of lawsuit, the day it was filed and the day its case opened; its judgment (the
 * latest not corrected) with its day and whether a person checked it; a settlement; the judgment become final; the
 * first money received; the value per claimant the judgment set; whether its case ended; and how many of its facts ONE
 * read and nobody checked. The test cases out unless asked; under a module, only its cases. At most 5,000, the latest
 * filed first.
 */
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
        'court', p.court, 'comarca', nullif(btrim(coalesce(p.comarca, '')), ''), 'kind', p.kind, 'module', c.module,
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

/**
 * The money of each case, for who reads the books: the fees received (the bills of its fees and success paid), its
 * direct costs (what the firm paid and nobody gave back) and the margin; the firm's general cost is an estimate the
 * screen says apart. The test cases out unless asked.
 */
create or replace function public.firm_case_margins(target_org uuid, target_tests boolean default false, target_module text default null)
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
  if not public.finance_reads(target_org) then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('case_id', x.case_id, 'case_seq', x.seq, 'fees_cents', x.fees, 'costs_cents', x.costs,
      'margin_cents', x.fees - x.costs) order by x.fees - x.costs desc, x.seq)
    from (
      select c.id as case_id, c.seq,
        coalesce((select sum(b.paid_cents) from public.finance_bills b
                  where b.case_id = c.id and b.source in ('fees', 'success') and b.direction = 'receive'), 0) as fees,
        coalesce((select sum(cc.cents) from public.case_costs cc
                  where cc.case_id = c.id and cc.paid_by = 'firm' and (cc.owed_by is null or cc.absorbed_at is not null)), 0)
          + coalesce((select sum(cc.cents - coalesce(b.paid_cents, 0)) from public.case_costs cc
                      left join public.finance_bills b on b.id = cc.bill_id
                      where cc.case_id = c.id and cc.paid_by = 'firm' and cc.owed_by is not null and cc.absorbed_at is null
                        and b.status in ('cancelled', 'written_off')), 0) as costs
      from public.cases c
      where c.org_id = target_org and (coalesce(target_tests, false) or not c.is_test)
        and (target_module is null or c.module = target_module)
        and (exists (select 1 from public.finance_bills b where b.case_id = c.id)
             or exists (select 1 from public.case_costs cc where cc.case_id = c.id))
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.firm_case_margins(uuid, boolean, text) from public, anon;
grant execute on function public.firm_case_margins(uuid, boolean, text) to authenticated;
